/**
 * Meta Graph API — actions (pausar, escalar budget).
 *
 * Requer META_ACCESS_TOKEN com escopo `ads_management`. Token de leitura
 * (ads_read) NÃO basta.
 *
 * Budget Meta vive em adset.daily_budget (cents). Em CBO (Campaign Budget
 * Optimization) o budget vive em campaign.daily_budget — fall back manual.
 * Aqui escalamos adset; se for CBO o caller recebe MetaActionError tipado.
 */
const META_API = process.env.META_GRAPH_URL ?? 'https://graph.facebook.com/v20.0'

export class MetaActionError extends Error {
  constructor(msg: string, readonly status?: number, readonly cause?: unknown) {
    super(msg)
    this.name = 'MetaActionError'
  }
}

function getToken(): string {
  const t = process.env.META_ACCESS_TOKEN
  if (!t) throw new MetaActionError('META_ACCESS_TOKEN não configurado')
  return t
}

async function postJson<T>(path: string, body: Record<string, unknown>, where: string): Promise<T> {
  const token = getToken()
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(body)) params.append(k, String(v))
  params.append('access_token', token)

  let res: Response
  try {
    res = await fetch(`${META_API}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
  } catch (cause) {
    throw new MetaActionError(`network failure ${where}`, undefined, cause)
  }
  let json: unknown
  try {
    json = await res.json()
  } catch (cause) {
    throw new MetaActionError(`non-JSON ${where} (status ${res.status})`, res.status, cause)
  }
  const env = json as { error?: { message?: string; code?: number; error_subcode?: number } }
  if (env?.error) {
    const sub = env.error.error_subcode ? `/${env.error.error_subcode}` : ''
    throw new MetaActionError(
      `Meta API ${where}: ${env.error.message ?? '?'} (code ${env.error.code ?? '?'}${sub})`,
      res.status
    )
  }
  if (!res.ok) throw new MetaActionError(`HTTP ${res.status} ${where}`, res.status)
  return json as T
}

// Códigos Meta dignos de retry: 1=temporário, 2=service unavailable,
// 4=app rate limit, 17=user rate limit, 32=page rate limit, 613=custom limit.
const RETRYABLE_META_CODES = new Set([1, 2, 4, 17, 32, 613])
const GET_RETRIES = 3
const GET_BACKOFF_MS = [250, 750, 1500]

function isRetryable(status: number | undefined, code: number | undefined): boolean {
  if (status !== undefined && status >= 500 && status < 600) return true
  if (code !== undefined && RETRYABLE_META_CODES.has(code)) return true
  return false
}

async function getJson<T>(path: string, where: string): Promise<T> {
  const token = getToken()
  const url = `${META_API}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`

  let lastErr: MetaActionError | null = null
  for (let attempt = 0; attempt < GET_RETRIES; attempt++) {
    let res: Response
    try {
      res = await fetch(url)
    } catch (cause) {
      lastErr = new MetaActionError(`network failure ${where}`, undefined, cause)
      await new Promise((r) => setTimeout(r, GET_BACKOFF_MS[attempt] ?? 1500))
      continue
    }
    let json: unknown
    try {
      json = await res.json()
    } catch (cause) {
      lastErr = new MetaActionError(`non-JSON ${where} (status ${res.status})`, res.status, cause)
      if (!isRetryable(res.status, undefined)) throw lastErr
      await new Promise((r) => setTimeout(r, GET_BACKOFF_MS[attempt] ?? 1500))
      continue
    }
    const env = json as { error?: { message?: string; code?: number } }
    if (env?.error) {
      const err = new MetaActionError(
        `Meta API ${where}: ${env.error.message ?? '?'} (code ${env.error.code ?? '?'})`,
        res.status
      )
      if (!isRetryable(res.status, env.error.code)) throw err
      lastErr = err
      await new Promise((r) => setTimeout(r, GET_BACKOFF_MS[attempt] ?? 1500))
      continue
    }
    if (!res.ok) {
      const err = new MetaActionError(`HTTP ${res.status} ${where}`, res.status)
      if (!isRetryable(res.status, undefined)) throw err
      lastErr = err
      await new Promise((r) => setTimeout(r, GET_BACKOFF_MS[attempt] ?? 1500))
      continue
    }
    return json as T
  }
  throw lastErr ?? new MetaActionError(`retries exhausted ${where}`)
}

// ─── Pause ───────────────────────────────────────────────────────────────────

export async function pauseAd(adId: string): Promise<{ id: string; status: 'PAUSED' }> {
  if (!/^\d+$/.test(adId)) {
    throw new MetaActionError(`adId inválido: ${adId} (esperado dígitos)`)
  }
  await postJson<{ success: boolean }>(adId, { status: 'PAUSED' }, `pauseAd(${adId})`)
  return { id: adId, status: 'PAUSED' }
}

export async function activateAd(adId: string): Promise<{ id: string; status: 'ACTIVE' }> {
  if (!/^\d+$/.test(adId)) {
    throw new MetaActionError(`adId inválido: ${adId} (esperado dígitos)`)
  }
  await postJson<{ success: boolean }>(adId, { status: 'ACTIVE' }, `activateAd(${adId})`)
  return { id: adId, status: 'ACTIVE' }
}

// ─── Budget read/write ───────────────────────────────────────────────────────

interface AdsetReadResponse {
  id: string
  daily_budget?: string // em cents
  lifetime_budget?: string
  status?: string
  campaign_id?: string
}

interface AdReadResponse {
  id: string
  adset_id: string
  status: string
  campaign_id: string
}

export async function getAdContext(adId: string): Promise<{
  adId: string
  adsetId: string
  campaignId: string
  status: string
}> {
  const r = await getJson<AdReadResponse>(`${adId}?fields=adset_id,campaign_id,status`, `getAdContext(${adId})`)
  return { adId, adsetId: r.adset_id, campaignId: r.campaign_id, status: r.status }
}

export async function getAdsetBudget(adsetId: string): Promise<{
  adsetId: string
  daily_budget_cents: number | null
  lifetime_budget_cents: number | null
  status: string
  campaign_id: string
}> {
  const r = await getJson<AdsetReadResponse>(
    `${adsetId}?fields=daily_budget,lifetime_budget,status,campaign_id`,
    `getAdsetBudget(${adsetId})`
  )
  return {
    adsetId,
    daily_budget_cents: r.daily_budget ? parseInt(r.daily_budget) : null,
    lifetime_budget_cents: r.lifetime_budget ? parseInt(r.lifetime_budget) : null,
    status: r.status ?? '',
    campaign_id: r.campaign_id ?? '',
  }
}

/**
 * Aplica um budget novo no adset. Se o adset estiver em CBO (sem
 * daily_budget próprio), retorna erro tipado — caller deve mover pra
 * campaign level (não cobrimos automaticamente).
 */
export async function setAdsetDailyBudget(
  adsetId: string,
  newCents: number
): Promise<{ adsetId: string; daily_budget_cents: number }> {
  if (!Number.isFinite(newCents) || newCents < 100) {
    throw new MetaActionError(`budget inválido: ${newCents} cents (mínimo 100)`)
  }
  await postJson<{ success: boolean }>(adsetId, { daily_budget: Math.round(newCents) }, `setAdsetBudget(${adsetId})`)
  return { adsetId, daily_budget_cents: Math.round(newCents) }
}

export const SCALE_PCT_MIN = -90
export const SCALE_PCT_MAX = 300

// ─── Budget de entidade genérica (conjunto/adset OU campanha) ─────────────────
//
// Diferente de scaleAdBudget (que recebe um AD e resolve o adset dele), aqui o
// id JÁ é a entidade com orçamento. Usado pelas tabelas Campanhas/Conjuntos,
// onde o orçamento de fato vive (anúncio não tem orçamento no Meta).

interface EntityReadResponse {
  id: string
  daily_budget?: string // cents
  status?: string
}

export async function getEntityBudget(entityId: string): Promise<{
  entityId: string
  daily_budget_cents: number | null
  status: string
}> {
  if (!/^\d+$/.test(entityId)) throw new MetaActionError(`id inválido: ${entityId} (esperado dígitos)`)
  const r = await getJson<EntityReadResponse>(`${entityId}?fields=daily_budget,status`, `getEntityBudget(${entityId})`)
  return {
    entityId,
    daily_budget_cents: r.daily_budget ? parseInt(r.daily_budget) : null,
    status: r.status ?? '',
  }
}

/**
 * Altera o orçamento diário de um conjunto (adset) ou campanha. Mesmas travas
 * de scaleAdBudget: compare-and-set (409), teto fail-closed, reject < R$1.
 * Se a entidade não tem orçamento próprio: conjunto → CBO (orçamento na
 * campanha); campanha → ABO (orçamento nos conjuntos) → erro 422 claro.
 */
export async function scaleEntityBudget(opts: {
  entityId: string
  escopo: 'conjunto' | 'campanha'
  new_daily_budget_cents?: number
  budget_diff_pct?: number
  expected_old_cents?: number
}): Promise<{
  entityId: string
  escopo: string
  old_daily_budget_cents: number | null
  new_daily_budget_cents: number
  budget_diff_pct: number
}> {
  if (!/^\d+$/.test(opts.entityId)) throw new MetaActionError(`id inválido: ${opts.entityId} (esperado dígitos)`)
  const cur = await getEntityBudget(opts.entityId)

  if (cur.daily_budget_cents == null) {
    const msg = opts.escopo === 'conjunto'
      ? `conjunto ${opts.entityId} sem orçamento próprio (campanha em CBO — ajuste o orçamento na campanha)`
      : `campanha ${opts.entityId} sem orçamento próprio (em ABO — ajuste o orçamento nos conjuntos)`
    throw new MetaActionError(msg, 422)
  }

  if (opts.expected_old_cents != null && Math.round(opts.expected_old_cents) !== cur.daily_budget_cents) {
    throw new MetaActionError(
      `orçamento mudou desde a leitura (Meta=${cur.daily_budget_cents}, esperado=${Math.round(opts.expected_old_cents)}) — recarregue e tente de novo`,
      409,
    )
  }

  let next: number
  if (opts.new_daily_budget_cents != null) {
    if (!Number.isFinite(opts.new_daily_budget_cents)) throw new MetaActionError('novo orçamento inválido')
    next = Math.round(opts.new_daily_budget_cents)
    if (next < 100) throw new MetaActionError(`novo orçamento abaixo do mínimo R$1,00 (recebido ${next} cents)`, 422)
  } else if (opts.budget_diff_pct != null) {
    if (opts.budget_diff_pct < SCALE_PCT_MIN || opts.budget_diff_pct > SCALE_PCT_MAX) {
      throw new MetaActionError(`budget_diff_pct fora do range [${SCALE_PCT_MIN}, ${SCALE_PCT_MAX}]: ${opts.budget_diff_pct}`)
    }
    next = Math.max(100, Math.round(cur.daily_budget_cents * (1 + opts.budget_diff_pct / 100)))
  } else {
    throw new MetaActionError('informe budget_diff_pct ou new_daily_budget_cents')
  }

  const ceil = maxDailyBudgetCents()
  if (ceil <= 0) {
    throw new MetaActionError('alteração de orçamento bloqueada: configure META_MAX_DAILY_BUDGET_CENTS (teto de segurança) antes de escalar', 422)
  }
  if (next > ceil) {
    throw new MetaActionError(`novo orçamento R$${(next / 100).toFixed(2)} excede o teto R$${(ceil / 100).toFixed(2)} (META_MAX_DAILY_BUDGET_CENTS)`, 422)
  }

  await postJson<{ success: boolean }>(opts.entityId, { daily_budget: next }, `setEntityBudget(${opts.entityId})`)

  return {
    entityId: opts.entityId,
    escopo: opts.escopo,
    old_daily_budget_cents: cur.daily_budget_cents,
    new_daily_budget_cents: next,
    budget_diff_pct: opts.budget_diff_pct ?? Math.round((next / cur.daily_budget_cents - 1) * 100),
  }
}

/**
 * Escala budget do adset que abriga o ad. Calcula novo budget a partir do
 * atual + budget_diff_pct. Se adset estiver em CBO → MetaActionError.
 */

/**
 * Teto absoluto de orçamento diário por adset (cents). Configurável via env
 * META_MAX_DAILY_BUDGET_CENTS. 0/ausente = sem teto.
 */
export function maxDailyBudgetCents(): number {
  const n = parseInt(process.env.META_MAX_DAILY_BUDGET_CENTS ?? '0', 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export async function scaleAdBudget(opts: {
  adId: string
  budget_diff_pct?: number
  /** Alternativa ao pct: define o orçamento diário absoluto (cents). UI "digite o novo valor". */
  new_daily_budget_cents?: number
  /** Compare-and-set: rejeita (409) se o orçamento atual no Meta ≠ este valor (mata stale-data + duplo-clique). */
  expected_old_cents?: number
}): Promise<{
  adId: string
  adsetId: string
  campaignId: string
  old_daily_budget_cents: number | null
  new_daily_budget_cents: number
  budget_diff_pct: number
}> {
  if (!/^\d+$/.test(opts.adId)) {
    throw new MetaActionError(`adId inválido: ${opts.adId} (esperado dígitos)`)
  }
  const ctx = await getAdContext(opts.adId)
  const cur = await getAdsetBudget(ctx.adsetId)

  if (cur.daily_budget_cents == null) {
    throw new MetaActionError(
      `adset ${ctx.adsetId} sem daily_budget (provavelmente CBO — ajuste o orçamento da campanha ${ctx.campaignId} no Gerenciador; não escalamos CBO automaticamente)`,
      422,
    )
  }

  // Compare-and-set: o orçamento no Meta tem que ser o que o usuário viu.
  if (opts.expected_old_cents != null && Math.round(opts.expected_old_cents) !== cur.daily_budget_cents) {
    throw new MetaActionError(
      `orçamento mudou desde a leitura (Meta=${cur.daily_budget_cents}, esperado=${Math.round(opts.expected_old_cents)}) — recarregue e tente de novo`,
      409,
    )
  }

  let next: number
  if (opts.new_daily_budget_cents != null) {
    if (!Number.isFinite(opts.new_daily_budget_cents)) throw new MetaActionError('novo orçamento inválido')
    next = Math.round(opts.new_daily_budget_cents)
    // Caminho absoluto: REJEITA abaixo do mínimo (não floor silencioso — input
    // ruim deve falhar alto, não virar R$1,00 por baixo dos panos).
    if (next < 100) {
      throw new MetaActionError(`novo orçamento abaixo do mínimo R$1,00 (recebido ${next} cents)`, 422)
    }
  } else if (opts.budget_diff_pct != null) {
    if (opts.budget_diff_pct < SCALE_PCT_MIN || opts.budget_diff_pct > SCALE_PCT_MAX) {
      throw new MetaActionError(`budget_diff_pct fora do range [${SCALE_PCT_MIN}, ${SCALE_PCT_MAX}]: ${opts.budget_diff_pct}`)
    }
    // Caminho percentual: floor no mínimo é OK (ex: -90% de um budget baixo).
    next = Math.max(100, Math.round(cur.daily_budget_cents * (1 + opts.budget_diff_pct / 100)))
  } else {
    throw new MetaActionError('informe budget_diff_pct ou new_daily_budget_cents')
  }

  // Teto de segurança OBRIGATÓRIO (fail-closed): sem META_MAX_DAILY_BUDGET_CENTS
  // qualquer escalada é RECUSADA. É o backstop final contra erro de parse/input
  // mandar um orçamento absurdo pro Meta. Configurar o teto é pré-requisito de
  // ligar o controle de orçamento.
  const ceil = maxDailyBudgetCents()
  if (ceil <= 0) {
    throw new MetaActionError(
      'alteração de orçamento bloqueada: configure META_MAX_DAILY_BUDGET_CENTS (teto de segurança) antes de escalar',
      422,
    )
  }
  if (next > ceil) {
    throw new MetaActionError(
      `novo orçamento R$${(next / 100).toFixed(2)} excede o teto R$${(ceil / 100).toFixed(2)} (META_MAX_DAILY_BUDGET_CENTS)`,
      422,
    )
  }

  await setAdsetDailyBudget(ctx.adsetId, next)

  return {
    adId: opts.adId,
    adsetId: ctx.adsetId,
    campaignId: ctx.campaignId,
    old_daily_budget_cents: cur.daily_budget_cents,
    new_daily_budget_cents: next,
    budget_diff_pct: opts.budget_diff_pct ?? Math.round((next / cur.daily_budget_cents - 1) * 100),
  }
}
