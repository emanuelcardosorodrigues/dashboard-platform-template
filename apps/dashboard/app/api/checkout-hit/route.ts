/**
 * POST /api/checkout-hit — ingestão pública dos cliques no CTA de checkout.
 *
 * Fonte principal (robusta): o GTM SERVER-SIDE (Stape, ts.example.com)
 * dispara no evento begin_checkout e faz um POST server-to-server com
 * `{url, cid}` — onde url = page_location e cid = GA client_id. Sem navegador no
 * meio: 0 CORS, 0 bloqueador, pega 100% dos cliques. O slug é derivado da url aqui.
 * (Também aceita `{slug, cid}` direto, p/ compat com o beacon web legado.)
 *
 * Guardamos 1 clicante distinto (cid) por página por dia → a Análise de Páginas
 * passa a ter "passagem pro checkout" pra QUALQUER página, não só as com teste A/B.
 *
 * Público (liberado no proxy). Best-effort: NUNCA bloqueia o checkout. Anti-spam:
 * rate-limit por IP + validação de slug/cid + dedup diário (UNIQUE) que colapsa
 * cliques repetidos do mesmo cid. Sem cid → fingerprint server-side (hash ip+ua+dia).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { pageSlug } from '@/lib/paginas'
import { checkRateLimit } from '@/lib/rateLimit'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'

const DEFAULT_SLUG = (process.env.DEFAULT_WORKSPACE_SLUG || 'demo').trim()

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

function clientIp(req: NextRequest): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
}

/** Último segmento do path de uma URL → slug (igual ao "JS - Page Slug" do GTM web). */
function slugFromUrl(u: string): string {
  try {
    const parts = new URL(u).pathname.split('/').filter(Boolean)
    return parts[parts.length - 1] || ''
  } catch { return '' }
}

/** Host da requisição (Origin > Referer) pra mapear tenant por vault_domains. */
function requestHost(req: NextRequest): string | null {
  const raw = req.headers.get('origin') || req.headers.get('referer') || ''
  try { return raw ? new URL(raw).host.toLowerCase() : null } catch { return null }
}

/** Resolve o workspace pelo host (vault_domains); fallback = default (DEMO). */
async function resolveWorkspaceId(db: ReturnType<typeof supa>, host: string | null): Promise<string | null> {
  if (host) {
    const { data } = await db.from('workspaces').select('id').contains('vault_domains', [host]).limit(1).maybeSingle()
    if (data?.id) return data.id
  }
  const { data } = await db.from('workspaces').select('id').eq('slug', DEFAULT_SLUG).maybeSingle()
  return data?.id ?? null
}

// CORS: o beacon vem de OUTRO domínio (landing → dashboard). Sem isso, um POST
// application/json cross-origin exige preflight OPTIONS que ninguém respondia, e o
// navegador BLOQUEAVA o beacon antes de sair. '*' é seguro aqui (sem credenciais).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}
function noContent(status = 204) {
  return new NextResponse(null, { status, headers: CORS })
}

// Responde o preflight do navegador (quando a tag manda application/json cross-origin).
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(req: NextRequest) {
  // Rate-limit por IP: 120/min é folgado pra clique real, corta flood de spam.
  const ip = clientIp(req)
  const rl = await checkRateLimit(`checkout-hit:${ip}`, 120, 60)
  if (!rl.allowed) return noContent(429)

  // Parse robusto: lê o corpo como texto e faz JSON.parse — funciona pra
  // application/json E text/plain (o beacon pode mandar qualquer um).
  const raw = await req.text().catch(() => '')

  const body = (() => { try { return JSON.parse(raw) as { slug?: unknown; cid?: unknown; url?: unknown; uid?: unknown } } catch { return null } })()
  if (!body) return noContent() // corpo inválido: ignora silencioso (beacon)

  // slug direto (beacon web legado) OU derivado da url (tag server-side manda page_location).
  const rawSlug = typeof body.slug === 'string' && body.slug.trim()
    ? body.slug
    : (typeof body.url === 'string' ? slugFromUrl(body.url) : '')
  const slug = pageSlug(rawSlug)
  if (!slug || slug.length > 80 || !/^[a-z0-9_-]+$/.test(slug)) {
    return noContent() // slug inválido: ignora (não polui a tabela)
  }

  // cid = GA client id (do cookie _ga). Ausente → fingerprint estável por device-dia.
  let cid = typeof body.cid === 'string' ? body.cid.trim().slice(0, 64) : ''
  if (!cid) {
    const ua = req.headers.get('user-agent') ?? ''
    const dia = new Date().toISOString().slice(0, 10)
    cid = 'fp_' + createHash('sha1').update(`${ip}|${ua}|${dia}`).digest('hex').slice(0, 16)
  }

  // uid = cookie do Worker A/B, lido SERVER-SIDE pelo GTM server (Stape) no header Cookie.
  // É HttpOnly (o JS do navegador não lê), mas viaja em todo request first-party — o
  // container server-side só precisa repassar. Mesma identidade de `impressions.uid`, o que
  // torna a passagem EXATA por interseção em vez do ~GA aproximado (cid ÷ usuários GA4).
  // Ausente = visitante que não veio pelo /r/ (direto/orgânico, sem cookie) → fica NULL e a
  // passagem daquele slug cai no ~GA. Nunca inventa uid: sem cookie, não há identidade.
  const uidRaw = typeof body.uid === 'string' ? body.uid.trim() : ''
  const uid = /^[A-Za-z0-9_-]{8,64}$/.test(uidRaw) ? uidRaw : null

  try {
    const db = supa()
    const workspaceId = await resolveWorkspaceId(db, requestHost(req))
    const row: Record<string, unknown> = { slug, cid }
    if (uid) row.uid = uid
    if (workspaceId) row.workspace_id = workspaceId // senão cai no DEFAULT (DEMO) da coluna
    // Upsert idempotente: 2º clique do mesmo cid na mesma página/dia não duplica.
    //
    // `ignoreDuplicates` depende de TER uid, e o motivo é sutil: se a 1ª linha do dia
    // entrar sem uid (clique anterior à tag, ou visitante sem cookie) e um clique
    // posterior trouxer o uid, com ignoreDuplicates=true o uid NUNCA seria gravado —
    // aquele (cid, dia) ficaria cego pra sempre e a passagem cairia no ~GA sem motivo.
    //  - com uid  → merge: preenche/confirma o uid na linha existente (idempotente: o
    //               mesmo visitante tem sempre o mesmo uid, então não há sobrescrita real).
    //  - sem uid  → ignora: jamais apaga com NULL um uid que já foi gravado.
    const { error } = await db
      .from('checkout_hits')
      .upsert(row, { onConflict: 'workspace_id,slug,cid,dia', ignoreDuplicates: !uid })
    if (error) log.warn('[checkout-hit] upsert falhou', { message: error.message })
  } catch (err) {
    log.warn('[checkout-hit] exceção', { message: err instanceof Error ? err.message : String(err) })
  }

  // Sempre 204: beacon não espera corpo; erro nunca deve estourar no cliente.
  return noContent()
}
