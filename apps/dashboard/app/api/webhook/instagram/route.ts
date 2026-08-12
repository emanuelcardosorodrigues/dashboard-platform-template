/**
 * Webhook do Instagram — story_insights (números FINAIS na expiração do story).
 *
 * GET  = verificação da assinatura do webhook no app Meta (hub.challenge).
 *        Verify token = env INSTAGRAM_WEBHOOK_VERIFY_TOKEN (você define o valor
 *        no painel do app Meta ao assinar o tópico `instagram` → story_insights).
 * POST = evento. Assinatura X-Hub-Signature-256 validada com META_APP_SECRET
 *        sobre o corpo CRU (sem isso, qualquer um postaria métricas falsas).
 *
 * O payload usa nomes LEGADOS (impressions, taps_forward...) — mapeados pras
 * nossas colunas. A linha é localizada por external_id (media id é globalmente
 * único) e marcada finalized=true. Rota pública (proxy libera /api/webhook/).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'crypto'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'

/** Compara strings em tempo constante (evita side-channel de timing no verify token). */
function safeStrEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const mode = sp.get('hub.mode')
  // trim nos dois lados: espaço/quebra de linha colado junto do token (no env
  // ou no painel do Meta) é a causa nº 1 de "verification failed"
  const token = (sp.get('hub.verify_token') ?? '').trim()
  const challenge = sp.get('hub.challenge')
  const expected = (process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ?? '').trim()
  if (mode === 'subscribe' && expected.length > 0 && safeStrEqual(token, expected) && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  log.warn('[webhook/instagram] verify falhou', { mode, env_present: expected.length > 0 })
  // diagnóstico temporário (sem vazar o valor): tamanhos ajudam a achar
  // env ausente/valor trocado sem expor o segredo
  return NextResponse.json(
    { error: 'verification failed', env_present: expected.length > 0, env_len: expected.length, got_len: token.length },
    { status: 403 },
  )
}

function validSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET
  if (!secret || !header?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const got = header.slice('sha256='.length)
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Mesmo app Meta serve organico (aqui) e o CRM. Como o app só entrega o objeto
// `instagram` num único callback, este webhook DEMUXA: story_insights fica aqui;
// evento de DM (messaging) é ENCAMINHADO cru + assinatura pro CRM, que revalida
// com o MESMO META_APP_SECRET e transforma em conversa no inbox.
const CRM_META_WEBHOOK = process.env.CRM_META_WEBHOOK_URL

function hasInstagramDm(body: { entry?: Array<{ messaging?: unknown[]; changes?: Array<{ field?: string }> }> }): boolean {
  for (const entry of body.entry ?? []) {
    if (Array.isArray(entry.messaging) && entry.messaging.length > 0) return true
    for (const ch of entry.changes ?? []) if (ch.field === 'messages') return true
  }
  return false
}

// Comentário em mídia/IG → CRM (feature de comentários do inbox). Mesmo destino e
// mesmo encaminhamento cru+assinatura do DM; só muda o `field` detectado.
function hasInstagramComment(body: { entry?: Array<{ changes?: Array<{ field?: string }> }> }): boolean {
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) if (ch.field === 'comments') return true
  }
  return false
}

// fire-and-forget com timeout: nunca atrasar o 200 que a Meta exige.
async function forwardDmToCrm(raw: string, sig: string | null): Promise<void> {
  if (!CRM_META_WEBHOOK) return
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    const res = await fetch(CRM_META_WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature-256': sig } : {}) },
      body: raw,
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (!res.ok) console.warn('[webhook-instagram] forward CRM status', res.status)
  } catch (e) {
    console.warn('[webhook-instagram] forward CRM falhou:', e instanceof Error ? e.message : String(e))
  }
}

interface StoryInsightsValue {
  media_id?: string
  impressions?: number
  reach?: number
  replies?: number
  shares?: number
  follows?: number
  profile_visits?: number
  taps_forward?: number
  taps_back?: number
  exits?: number
  swipe_forward?: number
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!validSignature(raw, req.headers.get('x-hub-signature-256'))) {
    log.warn('[webhook/instagram] assinatura inválida', { hasSig: !!req.headers.get('x-hub-signature-256'), len: raw.length })
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let body: {
    object?: string
    entry?: Array<{ messaging?: unknown[]; changes?: Array<{ field?: string; value?: StoryInsightsValue }> }>
  }
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  // DM e COMENTÁRIO do Instagram → CRM (chat/inbox). Um único forward por request
  // (o CRM recebe o raw inteiro com todos os entry/changes). Organico (story_insights)
  // segue local, abaixo — `field === 'comments'` cai no `continue` daquele loop, sem colidir.
  if (hasInstagramDm(body) || hasInstagramComment(body)) {
    await forwardDmToCrm(raw, req.headers.get('x-hub-signature-256'))
  }

  const supabase = db()
  let updated = 0
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'story_insights' || !change.value?.media_id) continue
      const v = change.value
      // Só sobrescreve com número presente — webhook é a palavra final, mas
      // campo ausente não vira NULL em cima de dado do poll.
      const patch: Record<string, unknown> = { finalized: true }
      if (v.impressions != null) patch.views = v.impressions
      if (v.reach != null) patch.reach = v.reach
      if (v.replies != null) patch.replies = v.replies
      if (v.shares != null) patch.shares = v.shares
      if (v.follows != null) patch.follows = v.follows
      if (v.profile_visits != null) patch.profile_visits = v.profile_visits
      if (v.taps_forward != null) patch.taps_forward = v.taps_forward
      if (v.taps_back != null) patch.taps_back = v.taps_back
      if (v.exits != null) patch.exits = v.exits
      if (v.swipe_forward != null) patch.swipes_forward = v.swipe_forward

      const { error, count } = await supabase.from('organic_stories')
        .update(patch, { count: 'exact' })
        .eq('external_id', v.media_id)
      if (error) console.warn('[webhook-instagram] update story:', error.message)
      else updated += count ?? 0
    }
  }

  // Meta espera 200 rápido; reprocessamento não é necessário (poll cobre gaps)
  return NextResponse.json({ ok: true, updated })
}
