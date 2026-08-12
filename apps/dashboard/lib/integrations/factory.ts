/**
 * Factory de configuração de integrações POR PROJETO (Onda 5).
 *
 * Cada resolver devolve a config de um provider para um workspace, lendo PRIMEIRO
 * a credencial cifrada (workspace_credentials) e, se não houver, caindo no ENV
 * GLOBAL — é o que mantém o DEMO funcionando idêntico enquanto suas credenciais
 * não forem migradas pra tabela. Retorna null quando não há nem cred nem env
 * (projeto sem aquela integração → o caller pula gracioso).
 *
 * Os libs de integração (meta-graph, vturb, ga4, clarity, ...) passam a receber
 * essa config em vez de ler process.env direto. Os crons resolvem por workspace.
 */
import { getWorkspaceCredential } from './credentials'
import { isDefaultWorkspace } from '@/lib/workspace-context'

function csv(v: string | undefined | null): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

export interface MetaConfig {
  accessToken: string
  pageToken: string | null
  accountIds: string[]
  taxRate: number
}
export async function getMetaConfig(workspaceId: string): Promise<MetaConfig | null> {
  const c = await getWorkspaceCredential<{ accessToken?: string; pageToken?: string; accountIds?: string; taxRate?: string }>(workspaceId, 'meta')
  if (c?.secret?.accessToken) {
    return {
      accessToken: c.secret.accessToken,
      pageToken: c.secret.pageToken || null,
      accountIds: csv(c.secret.accountIds),
      taxRate: Number(c.secret.taxRate) || 1.1382,
    }
  }
  // Fallback de ENV só pro workspace default (DEMO). Outro tenant sem cred → null (sem vazar DEMO).
  if (!(await isDefaultWorkspace(workspaceId))) return null
  const token = process.env.META_ACCESS_TOKEN
  if (!token) return null
  return {
    accessToken: token,
    pageToken: process.env.META_PAGE_TOKEN || null,
    accountIds: csv(process.env.META_ACCOUNT_IDS),
    taxRate: Number(process.env.META_TAX_RATE) || 1.1382,
  }
}

export interface VturbConfig { apiToken: string; companyId: string | null }
export async function getVturbConfig(workspaceId: string): Promise<VturbConfig | null> {
  const c = await getWorkspaceCredential<{ apiToken?: string; companyId?: string }>(workspaceId, 'vturb')
  if (c?.secret?.apiToken) return { apiToken: c.secret.apiToken, companyId: c.secret.companyId || null }
  if (!(await isDefaultWorkspace(workspaceId))) return null
  const token = process.env.VTURB_API_TOKEN
  if (!token) return null
  return { apiToken: token, companyId: process.env.VTURB_COMPANY_ID || null }
}

export interface Ga4Config { propertyId: string; serviceAccountEmail: string; privateKey: string }
export async function getGa4Config(workspaceId: string): Promise<Ga4Config | null> {
  const c = await getWorkspaceCredential<{ propertyId?: string; serviceAccountEmail?: string; privateKey?: string }>(workspaceId, 'ga4')
  // Fallback de ENV só pro default (DEMO); outro tenant sem cred ga4 → null (não herda o GA4 da DEMO).
  const env = (await isDefaultWorkspace(workspaceId)) ? process.env : ({} as NodeJS.ProcessEnv)
  const propertyId = c?.secret?.propertyId || env.GA4_PROPERTY_ID || ''
  const email = c?.secret?.serviceAccountEmail || env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''
  const key = c?.secret?.privateKey || env.GOOGLE_PRIVATE_KEY || ''
  if (!propertyId || !email || !key) return null
  return { propertyId, serviceAccountEmail: email, privateKey: key }
}

export interface ClarityConfig { apiToken: string }
export async function getClarityConfig(workspaceId: string): Promise<ClarityConfig | null> {
  const c = await getWorkspaceCredential<{ apiToken?: string }>(workspaceId, 'clarity')
  // Fallback de ENV só pro default (DEMO) — senão vaza o token Clarity da DEMO pra outro tenant.
  const env = (await isDefaultWorkspace(workspaceId)) ? process.env : ({} as NodeJS.ProcessEnv)
  const token = c?.secret?.apiToken || env.CLARITY_API_TOKEN
  return token ? { apiToken: token } : null
}

export interface HotmartConfig { clientId: string; clientSecret: string; webhookToken: string }
export async function getHotmartConfig(workspaceId: string): Promise<HotmartConfig | null> {
  const c = await getWorkspaceCredential<{ clientId?: string; clientSecret?: string; webhookToken?: string }>(workspaceId, 'hotmart')
  // Fallback de ENV só pro default (DEMO) — outro tenant sem cred Hotmart não herda
  // client/secret/webhookToken da DEMO (senão validaria webhook alheio com token da DEMO).
  const env = (await isDefaultWorkspace(workspaceId)) ? process.env : ({} as NodeJS.ProcessEnv)
  const clientId = c?.secret?.clientId || env.HOTMART_CLIENT_ID || ''
  const clientSecret = c?.secret?.clientSecret || env.HOTMART_CLIENT_SECRET || ''
  const webhookToken = c?.secret?.webhookToken || env.HOTMART_WEBHOOK_TOKEN || ''
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret, webhookToken }
}

export interface CloudflareConfig {
  apiToken: string; accountId: string
  abKvNamespaceId: string | null; quizKvNamespaceId: string | null; d1DatabaseId: string | null
  /** Encurtador orgânico (Onda 6): KV + domínio do cliente (ex. example.com/l). */
  linksKvNamespaceId: string | null; linksDomain: string | null
}
export async function getCloudflareConfig(workspaceId: string): Promise<CloudflareConfig | null> {
  const c = await getWorkspaceCredential<{ apiToken?: string; accountId?: string; abKvNamespaceId?: string; quizKvNamespaceId?: string; d1DatabaseId?: string; linksKvNamespaceId?: string; linksDomain?: string }>(workspaceId, 'cloudflare')
  const apiToken = c?.secret?.apiToken || process.env.CLOUDFLARE_API_TOKEN || ''
  const accountId = c?.secret?.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || ''
  if (!apiToken || !accountId) return null
  return {
    apiToken, accountId,
    abKvNamespaceId: c?.secret?.abKvNamespaceId || process.env.AB_KV_NAMESPACE_ID || null,
    quizKvNamespaceId: c?.secret?.quizKvNamespaceId || process.env.QUIZ_KV_NAMESPACE_ID || null,
    d1DatabaseId: c?.secret?.d1DatabaseId || process.env.D1_DATABASE_ID || null,
    linksKvNamespaceId: c?.secret?.linksKvNamespaceId || null,
    linksDomain: c?.secret?.linksDomain || null,
  }
}

/**
 * YouTube orgânico (OAuth do dono do canal — Onda 1 do Orgânico).
 * clientId/clientSecret são DO APP (env global, um app Google p/ todos os
 * projetos); o que é por-workspace são os REFRESH TOKENS, um por canal
 * conectado: secret = { tokens: { [channelId]: refreshToken } } — gravado pelo
 * callback /api/oauth/youtube (multi-canal nativo). Fallback env
 * YOUTUBE_REFRESH_TOKEN entra como token default ('*') pro DEMO funcionar antes
 * do fluxo OAuth rodar.
 */
export interface YoutubeConfig {
  clientId: string
  clientSecret: string
  /** refresh tokens por canal (external_id → token). '*' = default do env. */
  tokens: Record<string, string>
}
export async function getYoutubeConfig(workspaceId: string): Promise<YoutubeConfig | null> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || ''
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''
  if (!clientId || !clientSecret) return null
  const c = await getWorkspaceCredential<{ tokens?: Record<string, string> }>(workspaceId, 'youtube')
  const tokens: Record<string, string> = { ...(c?.secret?.tokens ?? {}) }
  if (process.env.YOUTUBE_REFRESH_TOKEN && Object.keys(tokens).length === 0) {
    tokens['*'] = process.env.YOUTUBE_REFRESH_TOKEN
  }
  if (Object.keys(tokens).length === 0) return null
  return { clientId, clientSecret, tokens }
}

/**
 * Instagram orgânico (OAuth via app Meta — Onda 2 do Orgânico).
 * appId/appSecret são DO APP (env global META_APP_ID/META_APP_SECRET); por
 * workspace ficam os PAGE TOKENS, um por conta IG conectada:
 * secret = { tokens: { [igUserId]: pageToken, __user: longLivedUserToken } }.
 * Sem fallback de env pros tokens — IG só conecta pela UI.
 */
export interface InstagramOrganicConfig {
  appId: string
  appSecret: string
  /** page tokens por conta IG (igUserId → token); '__user' = user token. */
  tokens: Record<string, string>
}
export async function getInstagramOrganicConfig(workspaceId: string): Promise<InstagramOrganicConfig | null> {
  const appId = process.env.META_APP_ID || ''
  const appSecret = process.env.META_APP_SECRET || ''
  if (!appId || !appSecret) return null
  const c = await getWorkspaceCredential<{ tokens?: Record<string, string> }>(workspaceId, 'instagram')
  const tokens = c?.secret?.tokens ?? {}
  if (Object.keys(tokens).filter((k) => k !== '__user').length === 0) return null
  return { appId, appSecret, tokens }
}

export interface NfseConfig { workerUrl: string; apiKey: string }
export async function getNfseConfig(workspaceId: string): Promise<NfseConfig | null> {
  const c = await getWorkspaceCredential<{ workerUrl?: string; apiKey?: string }>(workspaceId, 'nfse')
  const workerUrl = c?.secret?.workerUrl || process.env.NFSE_WORKER_URL || ''
  const apiKey = c?.secret?.apiKey || process.env.NFSE_API_KEY || ''
  if (!workerUrl || !apiKey) return null
  return { workerUrl, apiKey }
}
