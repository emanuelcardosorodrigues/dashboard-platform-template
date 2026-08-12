/**
 * GET /api/cron/backfill-thumbs?max=25&dry=1
 *
 * Conserta as thumbnails já quebradas. Toda linha de `criativo_analise` cujo
 * `thumbnail_url` aponta pro fbcdn carrega uma URL assinada que vence em ~2 semanas
 * (`oe=` unix hex); passada a data, o CDN devolve 403 e o card fica sem prévia.
 *
 * Aqui NÃO dá pra só copiar a URL do banco — ela já está vencida. Tem que re-resolver
 * o criativo no Meta (que devolve uma assinatura nova), baixar e republicar no nosso
 * Storage. O dado nunca se perdeu: o que expira é o link do CDN, não o criativo.
 *
 * Idempotente: quem já está no Storage não é selecionado. Roda em lote (o Vercel corta
 * a função) — chame em loop até `restantes: 0`.
 *
 * `?ads=id1,id2` força ads específicos mesmo já estando no Storage — pra re-resolver
 * quem foi salvo antes da correção de resolução (o `creative.thumbnail_url` do Meta
 * vem 64x64; o bom vem da edge /thumbnails, 1080x1920).
 *
 * Auth: x-vercel-cron OU Authorization: Bearer CRON_SECRET. Sob /api/cron/ (proxy libera).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdCreativeAssets, MetaGraphError } from '@/lib/meta-graph'
import { getMetaConfig } from '@/lib/integrations/factory'
import { persistThumbnail, THUMB_BUCKET } from '@/lib/criativo-thumbnail'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Assinatura de URL do nosso bucket — o que NÃO casa com isto é de terceiro. */
const STORAGE_MARKER = `/object/public/${THUMB_BUCKET}/`
const HARD_MAX = 100
/** Margem pro handler responder antes de a plataforma cortar. */
const TIME_BUDGET_MS = 240_000

type Row = { workspace_id: string; ad_id: string; ad_name: string | null; thumbnail_url: string | null; fonte: string | null }

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const k = (req.headers.get('authorization') || '').replace('Bearer ', '')
  if (!isVercelCron && (!process.env.CRON_SECRET || k !== process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rawMax = parseInt(url.searchParams.get('max') ?? '25', 10)
  const max = Math.min(Math.max(Number.isFinite(rawMax) ? rawMax : 25, 1), HARD_MAX)
  const dry = url.searchParams.get('dry') === '1'
  const startedAt = Date.now()

  const supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })

  const alvos = (url.searchParams.get('ads') ?? '').split(',').map((s) => s.trim()).filter(Boolean)

  // Pendente = tem thumb que NÃO é do nosso Storage. Default-deny: filtrar por
  // `%fbcdn%` deixaria de fora o `facebook.com/ads/image` (e o host de terceiro
  // que aparecer amanhã).
  const pendente = (q: ReturnType<typeof supa.from>) =>
    q.select('workspace_id, ad_id, ad_name, thumbnail_url, fonte').not('ad_id', 'is', null).not('thumbnail_url', 'is', null).not('thumbnail_url', 'like', `%${STORAGE_MARKER}%`)

  const { data, error } = alvos.length
    ? await supa.from('criativo_analise').select('workspace_id, ad_id, ad_name, thumbnail_url, fonte').in('ad_id', alvos).limit(HARD_MAX)
    : await pendente(supa.from('criativo_analise')).limit(max)
  if (error) return NextResponse.json({ error: `fetch pendentes: ${error.message}` }, { status: 500 })

  const rows = (data ?? []) as Row[]
  const { count: restantesTotal } = await supa
    .from('criativo_analise')
    .select('ad_id', { count: 'exact', head: true })
    .not('thumbnail_url', 'is', null)
    .not('thumbnail_url', 'like', `%${STORAGE_MARKER}%`)

  if (dry) {
    return NextResponse.json({ dry: true, selecionados: rows.length, restantes: restantesTotal ?? 0, amostra: rows.slice(0, 5) })
  }

  // Token é por workspace (multi-tenant) e a resolução bate no banco — cacheia por run.
  const tokenCache = new Map<string, { accessToken?: string; videoToken?: string } | null>()
  async function tokensFor(wsId: string) {
    if (!tokenCache.has(wsId)) {
      const cfg = await getMetaConfig(wsId)
      tokenCache.set(wsId, cfg ? { accessToken: cfg.accessToken, videoToken: cfg.pageToken || cfg.accessToken } : null)
    }
    return tokenCache.get(wsId) ?? null
  }

  let corrigidos = 0
  const falhas: Array<{ adId: string; motivo: string }> = []

  for (const row of rows) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break
    try {
      let source: string | null
      if (row.fonte === 'biblioteca') {
        // Asset da Ad Library tem asset_key sintético (`lib_img_…`), não ad_id —
        // não há o que re-resolver no Meta. Só dá pra copiar a URL guardada, e só
        // enquanto ela não venceu. As vencidas se recuperam sozinhas no próximo
        // sync da biblioteca, que agora já grava permanente.
        source = row.thumbnail_url
      } else {
        const tokens = await tokensFor(row.workspace_id)
        if (!tokens) {
          falhas.push({ adId: row.ad_id, motivo: 'workspace sem credencial Meta' })
          continue
        }
        // Assinatura NOVA direto do Meta — a que está no banco já morreu.
        source = (await getAdCreativeAssets(row.ad_id, tokens)).thumbnailUrl
      }
      if (!source) {
        falhas.push({ adId: row.ad_id, motivo: 'sem thumbnail de origem' })
        continue
      }
      const permanente = await persistThumbnail(supa, row.ad_id, source)
      if (!permanente) {
        falhas.push({ adId: row.ad_id, motivo: 'cópia pro Storage falhou' })
        continue
      }
      const { error: upErr } = await supa
        .from('criativo_analise')
        .update({ thumbnail_url: permanente })
        .eq('workspace_id', row.workspace_id)
        .eq('ad_id', row.ad_id)
      if (upErr) {
        falhas.push({ adId: row.ad_id, motivo: `update: ${upErr.message}` })
        continue
      }
      corrigidos++
    } catch (err) {
      // Ad apagado no Meta cai aqui — segue a fila, não derruba o lote.
      const motivo = err instanceof MetaGraphError ? `Meta: ${err.message}` : err instanceof Error ? err.message : String(err)
      log.warn('backfill-thumbs per-ad error', { adId: row.ad_id, motivo })
      falhas.push({ adId: row.ad_id, motivo })
    }
  }

  return NextResponse.json({
    processados: rows.length,
    corrigidos,
    falhas,
    restantes: Math.max(0, (restantesTotal ?? corrigidos) - corrigidos),
    elapsedMs: Date.now() - startedAt,
  })
}
