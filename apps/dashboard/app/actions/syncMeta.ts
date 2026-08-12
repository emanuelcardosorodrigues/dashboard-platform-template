'use server'

import { cookies, headers } from 'next/headers'
import { revalidateTag } from 'next/cache'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'

export interface SyncJobResult {
  job: string
  ok: boolean
  status?: number
  inseridos?: number
  error?: string
}

export interface SyncAllResult {
  ok: boolean
  total: number
  jobs: SyncJobResult[]
  error?: string
}

const JOBS: Array<{ path: string; label: string; tag?: string }> = [
  { path: '/api/cron/sync-meta',           label: 'meta',     tag: 'sb-meta-ads' },
  { path: '/api/cron/sync-clarity',        label: 'clarity',  tag: 'sb-clarity' },
  { path: '/api/cron/quarantine-bots',     label: 'bots' },
  { path: '/api/cron/generate-ai-insights', label: 'ai',      tag: 'sb-ai-insights' },
]

interface MetaCronResponse { accounts?: Record<string, { inseridos?: number; erro?: string }> }
interface ClarityCronResponse { inseridos?: number }
interface GenericCronResponse { ok?: boolean; inseridos?: number }

async function callJob(baseUrl: string, bearer: string, job: typeof JOBS[number]): Promise<SyncJobResult> {
  try {
    const res = await fetch(`${baseUrl}${job.path}`, {
      headers: { Authorization: `Bearer ${bearer}` },
    })
    if (!res.ok) {
      return { job: job.label, ok: false, status: res.status, error: `HTTP ${res.status}` }
    }
    const text = await res.text()
    let inseridos: number | undefined
    try {
      const parsed = JSON.parse(text) as MetaCronResponse & ClarityCronResponse & GenericCronResponse
      if (parsed.accounts) {
        inseridos = Object.values(parsed.accounts).reduce((s, a) => s + (a.inseridos ?? 0), 0)
      } else if (typeof parsed.inseridos === 'number') {
        inseridos = parsed.inseridos
      }
    } catch { /* não-JSON, segue ok */ }
    // expire:0 = expiração imediata (refresh de verdade; 'max' é stale-while-revalidate
    // e o usuário não veria o dado novo ao recarregar). Ver lib/supabase.ts.
    if (job.tag) revalidateTag(job.tag, { expire: 0 })
    return { job: job.label, ok: true, status: res.status, inseridos }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'fetch-failed'
    return { job: job.label, ok: false, error: msg }
  }
}

export async function syncAllAction(): Promise<SyncAllResult> {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  if (!sessionId) return { ok: false, total: 0, jobs: [], error: 'unauthorized' }

  const session = await lookupSession(sessionId)
  if (!session || session.role !== 'admin') {
    return { ok: false, total: 0, jobs: [], error: 'forbidden' }
  }

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return { ok: false, total: 0, jobs: [], error: 'cron-secret-missing' }

  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return { ok: false, total: 0, jobs: [], error: 'host-unknown' }
  const baseUrl = `${proto}://${host}`

  const jobs = await Promise.all(JOBS.map(j => callJob(baseUrl, cronSecret, j)))
  const okJobs = jobs.filter(j => j.ok).length
  const total = jobs.reduce((s, j) => s + (j.inseridos ?? 0), 0)

  // Refresh imediato de TODO o cache de dados do dashboard (não só dos jobs):
  // o usuário clicou "Atualizar" e espera ver tudo fresco ao recarregar.
  for (const tag of ['sb-transacoes', 'sb-meta-ads', 'sb-qualificacao', 'sb-config']) {
    revalidateTag(tag, { expire: 0 })
  }

  return {
    ok: okJobs === JOBS.length,
    total,
    jobs,
  }
}
