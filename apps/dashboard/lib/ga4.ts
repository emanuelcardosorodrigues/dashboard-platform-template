/**
 * GA4 Data API client (Google Analytics Data API v1beta).
 *
 * Reusa o service account já configurado pra Sheets:
 *   - GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   - GOOGLE_PRIVATE_KEY
 *
 * Adicional: GA4_PROPERTY_ID (numérico, ex: "123456789").
 *
 * Setup no Google Analytics:
 *   1. Admin → Property → Property access management
 *   2. Add user (GOOGLE_SERVICE_ACCOUNT_EMAIL) com role "Viewer"
 *
 * Docs: https://developers.google.com/analytics/devguides/reporting/data/v1
 */

import { google } from 'googleapis'
import { unstable_cache } from 'next/cache'
import { cache } from 'react'
import { getGa4Config, type Ga4Config } from '@/lib/integrations/factory'
import { getActiveWorkspaceId } from '@/lib/workspace-context'

const GA4_BASE = 'https://analyticsdata.googleapis.com/v1beta'
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'

export function ga4PropertyId(): string {
  return (process.env.GA4_PROPERTY_ID ?? '').trim()
}

export function ga4IsConfigured(): boolean {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? ''
  const key = process.env.GOOGLE_PRIVATE_KEY ?? ''
  return (
    email.length > 0 && !email.toLowerCase().includes('placeholder') &&
    key.length > 0 && !key.includes('PLACEHOLDER') &&
    ga4PropertyId().length > 0
  )
}

async function getAccessToken(cfg: Ga4Config): Promise<string> {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: cfg.serviceAccountEmail.trim(),
      private_key: cfg.privateKey.trim().replace(/\\n/g, '\n'),
    },
    scopes: [SCOPE],
  })
  const client = await auth.getClient()
  const token = await client.getAccessToken()
  if (!token || !token.token) throw new Error('Falha ao obter access_token GA4')
  return token.token
}

/** GA4 configurado pro workspace ATIVO (cred cifrada OU env do DEMO). */
export async function ga4ConfiguredForActive(): Promise<boolean> {
  return (await getGa4Config(await getActiveWorkspaceId())) !== null
}

interface RunReportArgs {
  startDate: string  // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
  dimensions?: string[]
  metrics?: string[]
  orderBy?: { metric: string; desc?: boolean }
  limit?: number
}

interface GA4Row {
  dimensionValues: Array<{ value: string }>
  metricValues: Array<{ value: string }>
}

interface GA4Response {
  dimensionHeaders?: Array<{ name: string }>
  metricHeaders?: Array<{ name: string; type: string }>
  rows?: GA4Row[]
  rowCount?: number
}

async function runReport(cfg: Ga4Config, args: RunReportArgs): Promise<GA4Response> {
  const token = await getAccessToken(cfg)
  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: args.startDate, endDate: args.endDate }],
    dimensions: (args.dimensions ?? []).map((name) => ({ name })),
    metrics: (args.metrics ?? []).map((name) => ({ name })),
    limit: String(args.limit ?? 10000),
  }
  if (args.orderBy) {
    body.orderBys = [{ metric: { metricName: args.orderBy.metric }, desc: args.orderBy.desc ?? true }]
  }
  const res = await fetch(`${GA4_BASE}/properties/${cfg.propertyId.trim()}:runReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    next: { revalidate: 600, tags: ['ga4'] },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GA4 ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<GA4Response>
}

// ─── Types públicos ───────────────────────────────────────────────────────

export interface GA4Overview {
  sessions: number
  totalUsers: number
  newUsers: number
  engagedSessions: number
  engagementRate: number      // 0..1
  averageSessionDuration: number // seconds
  bounceRate: number          // 0..1
  conversions: number
  totalRevenue: number
}

export interface GA4DailyPoint {
  date: string  // YYYY-MM-DD
  sessions: number
  totalUsers: number
  conversions: number
}

export interface GA4SourceRow {
  source: string
  medium: string
  sessions: number
  totalUsers: number
  conversions: number
  totalRevenue: number
}

export interface GA4PageRow {
  pagePath: string
  pageTitle: string
  sessions: number
  screenPageViews: number
  totalUsers: number
  averageSessionDuration: number
}

export interface GA4CampaignRow {
  campaignId: string  // utm_id — no Meta = ad.id
  sessions: number
  totalUsers: number
  engagedSessions: number
  conversions: number
  totalRevenue: number
}

// ─── Helpers de parsing ───────────────────────────────────────────────────

function num(s: string | undefined): number { return s ? Number(s) : 0 }

function parseDate(s: string): string {
  // GA4 retorna "20260515" — converte pra ISO
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return s
}

// ─── API surface (cacheada) ───────────────────────────────────────────────

async function _fetchOverview(cfg: Ga4Config, startDate: string, endDate: string): Promise<GA4Overview> {
  const res = await runReport(cfg, {
    startDate,
    endDate,
    metrics: [
      'sessions', 'totalUsers', 'newUsers', 'engagedSessions',
      'engagementRate', 'averageSessionDuration', 'bounceRate',
      'conversions', 'totalRevenue',
    ],
  })
  const row = res.rows?.[0]
  if (!row) {
    return {
      sessions: 0, totalUsers: 0, newUsers: 0, engagedSessions: 0,
      engagementRate: 0, averageSessionDuration: 0, bounceRate: 0,
      conversions: 0, totalRevenue: 0,
    }
  }
  const v = row.metricValues
  return {
    sessions: num(v[0]?.value),
    totalUsers: num(v[1]?.value),
    newUsers: num(v[2]?.value),
    engagedSessions: num(v[3]?.value),
    engagementRate: num(v[4]?.value),
    averageSessionDuration: num(v[5]?.value),
    bounceRate: num(v[6]?.value),
    conversions: num(v[7]?.value),
    totalRevenue: num(v[8]?.value),
  }
}

async function _fetchDaily(cfg: Ga4Config, startDate: string, endDate: string): Promise<GA4DailyPoint[]> {
  const res = await runReport(cfg, {
    startDate,
    endDate,
    dimensions: ['date'],
    metrics: ['sessions', 'totalUsers', 'conversions'],
    orderBy: { metric: 'sessions', desc: false },
  })
  return (res.rows ?? []).map((r) => ({
    date: parseDate(r.dimensionValues[0].value),
    sessions: num(r.metricValues[0]?.value),
    totalUsers: num(r.metricValues[1]?.value),
    conversions: num(r.metricValues[2]?.value),
  })).sort((a, b) => a.date.localeCompare(b.date))
}

async function _fetchTopSources(cfg: Ga4Config, startDate: string, endDate: string, limit: number): Promise<GA4SourceRow[]> {
  const res = await runReport(cfg, {
    startDate,
    endDate,
    dimensions: ['sessionSource', 'sessionMedium'],
    metrics: ['sessions', 'totalUsers', 'conversions', 'totalRevenue'],
    orderBy: { metric: 'sessions', desc: true },
    limit,
  })
  return (res.rows ?? []).map((r) => ({
    source: r.dimensionValues[0].value,
    medium: r.dimensionValues[1].value,
    sessions: num(r.metricValues[0]?.value),
    totalUsers: num(r.metricValues[1]?.value),
    conversions: num(r.metricValues[2]?.value),
    totalRevenue: num(r.metricValues[3]?.value),
  }))
}

async function _fetchTopPages(cfg: Ga4Config, startDate: string, endDate: string, limit: number): Promise<GA4PageRow[]> {
  const res = await runReport(cfg, {
    startDate,
    endDate,
    dimensions: ['pagePath', 'pageTitle'],
    metrics: ['sessions', 'screenPageViews', 'totalUsers', 'averageSessionDuration'],
    orderBy: { metric: 'screenPageViews', desc: true },
    limit,
  })
  return (res.rows ?? []).map((r) => ({
    pagePath: r.dimensionValues[0].value,
    pageTitle: r.dimensionValues[1].value,
    sessions: num(r.metricValues[0]?.value),
    screenPageViews: num(r.metricValues[1]?.value),
    totalUsers: num(r.metricValues[2]?.value),
    averageSessionDuration: num(r.metricValues[3]?.value),
  }))
}

async function _fetchByCampaignId(cfg: Ga4Config, startDate: string, endDate: string, limit: number): Promise<GA4CampaignRow[]> {
  const res = await runReport(cfg, {
    startDate,
    endDate,
    dimensions: ['sessionCampaignId'],
    metrics: ['sessions', 'totalUsers', 'engagedSessions', 'conversions', 'totalRevenue'],
    orderBy: { metric: 'sessions', desc: true },
    limit,
  })
  return (res.rows ?? []).map((r) => ({
    campaignId: r.dimensionValues[0].value,
    sessions: num(r.metricValues[0]?.value),
    totalUsers: num(r.metricValues[1]?.value),
    engagedSessions: num(r.metricValues[2]?.value),
    conversions: num(r.metricValues[3]?.value),
    totalRevenue: num(r.metricValues[4]?.value),
  })).filter((r) => r.campaignId && r.campaignId !== '(not set)')
}

// Multi-tenant: o core é chaveado por workspaceId (cache isolado por projeto) e
// resolve a config (cred cifrada ou env do DEMO) dentro; sem cfg → retorno vazio.
// O fetcher público mantém a assinatura antiga e resolve o workspace ativo → os
// call sites (ga4/page, analise-paginas, score-bots) não mudam.
const EMPTY_OVERVIEW: GA4Overview = {
  sessions: 0, totalUsers: 0, newUsers: 0, engagedSessions: 0,
  engagementRate: 0, averageSessionDuration: 0, bounceRate: 0, conversions: 0, totalRevenue: 0,
}

const _overviewCore = unstable_cache(
  async (workspaceId: string, startDate: string, endDate: string): Promise<GA4Overview> => {
    const cfg = await getGa4Config(workspaceId)
    return cfg ? _fetchOverview(cfg, startDate, endDate) : EMPTY_OVERVIEW
  }, ['ga4-overview-v2'], { revalidate: 600, tags: ['ga4'] },
)
const _dailyCore = unstable_cache(
  async (workspaceId: string, startDate: string, endDate: string): Promise<GA4DailyPoint[]> => {
    const cfg = await getGa4Config(workspaceId)
    return cfg ? _fetchDaily(cfg, startDate, endDate) : []
  }, ['ga4-daily-v2'], { revalidate: 600, tags: ['ga4'] },
)
const _topSourcesCore = unstable_cache(
  async (workspaceId: string, startDate: string, endDate: string, limit: number): Promise<GA4SourceRow[]> => {
    const cfg = await getGa4Config(workspaceId)
    return cfg ? _fetchTopSources(cfg, startDate, endDate, limit) : []
  }, ['ga4-sources-v2'], { revalidate: 600, tags: ['ga4'] },
)
const _topPagesCore = unstable_cache(
  async (workspaceId: string, startDate: string, endDate: string, limit: number): Promise<GA4PageRow[]> => {
    const cfg = await getGa4Config(workspaceId)
    return cfg ? _fetchTopPages(cfg, startDate, endDate, limit) : []
  }, ['ga4-pages-v2'], { revalidate: 600, tags: ['ga4'] },
)
const _byCampaignCore = unstable_cache(
  async (workspaceId: string, startDate: string, endDate: string, limit: number): Promise<GA4CampaignRow[]> => {
    const cfg = await getGa4Config(workspaceId)
    return cfg ? _fetchByCampaignId(cfg, startDate, endDate, limit) : []
  }, ['ga4-by-campaign-v2'], { revalidate: 600, tags: ['ga4'] },
)

export const fetchGa4Overview = cache(async (startDate: string, endDate: string) =>
  _overviewCore(await getActiveWorkspaceId(), startDate, endDate))
export const fetchGa4Daily = cache(async (startDate: string, endDate: string) =>
  _dailyCore(await getActiveWorkspaceId(), startDate, endDate))
export const fetchGa4TopSources = cache(async (startDate: string, endDate: string, limit: number) =>
  _topSourcesCore(await getActiveWorkspaceId(), startDate, endDate, limit))
export const fetchGa4TopPages = cache(async (startDate: string, endDate: string, limit: number) =>
  _topPagesCore(await getActiveWorkspaceId(), startDate, endDate, limit))
export const fetchGa4ByCampaignId = cache(async (startDate: string, endDate: string, limit: number) =>
  _byCampaignCore(await getActiveWorkspaceId(), startDate, endDate, limit))

/**
 * Fase 3: engagement por pagePath (sessions + engagedSessions) — alimenta o
 * composite bot score (GA4 signal). Janela default: últimas 24h.
 */
export interface PathEngagement {
  pagePath: string
  sessions: number
  engagedSessions: number
  engagementRate: number
}

export async function fetchPathEngagement(paths: string[]): Promise<PathEngagement[]> {
  if (paths.length === 0) return []
  const cfg = await getGa4Config(await getActiveWorkspaceId())
  if (!cfg) return []
  const res = await runReport(cfg, {
    startDate: '1daysAgo',
    // 'today' relativo respeita o fuso da Property (BRT) — evita o off-by-1 que
    // `new Date().toISOString()` (UTC) causava perto da meia-noite.
    endDate: 'today',
    dimensions: ['pagePath'],
    metrics: ['sessions', 'engagedSessions'],
    limit: 1000,
  })
  const all = (res.rows ?? []).map(r => ({
    pagePath: r.dimensionValues[0].value,
    sessions: num(r.metricValues[0]?.value),
    engagedSessions: num(r.metricValues[1]?.value),
  }))
  return all
    .filter(r => paths.includes(r.pagePath))
    .map(r => ({
      ...r,
      engagementRate: r.sessions > 0 ? r.engagedSessions / r.sessions : 0,
    }))
}
