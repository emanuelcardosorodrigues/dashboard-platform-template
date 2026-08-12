/**
 * GET /api/organico/hashtag?ws=<uuid|slug>&hashtags=a,b,c[&igUserId=]
 *
 * Resolve cada hashtag respeitando o ORÇAMENTO da Meta (30 únicas / 7 dias por
 * conta IG — ver lib/organico/hashtag.ts), busca top/recent media (público),
 * PERSISTE o agregado em hashtag_media e devolve o ranking + o saldo do orçamento.
 *
 * Chamado SOB DEMANDA pelo botão "Atualizar" da aba Inteligência de Conteúdo
 * (nunca cron — estouraria o orçamento). Auth = sessão do dashboard (proxy).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveWsParam } from '@/lib/organico/resolveWs'
import { getInstagramOrganicConfig } from '@/lib/integrations/factory'
import {
  normalizeHashtags, getHashtagBudget, resolveHashtagWithBudget,
  fetchHashtagTopMedia, fetchHashtagRecentMedia, persistHashtagMedia,
  HASHTAG_BUDGET_LIMIT, type HashtagMedia, type BudgetUsage,
} from '@/lib/organico/hashtag'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

export async function GET(req: NextRequest) {
  const ws = await resolveWsParam(req.nextUrl.searchParams.get('ws') || req.nextUrl.searchParams.get('workspaceId'))
  const hashtags = normalizeHashtags((req.nextUrl.searchParams.get('hashtags') || '').split(','))
  if (hashtags.length === 0) return NextResponse.json({ error: 'Informe ?hashtags= (separadas por vírgula).' }, { status: 400 })
  if (hashtags.length > HASHTAG_BUDGET_LIMIT) return NextResponse.json({ error: `Máximo de ${HASHTAG_BUDGET_LIMIT} hashtags por chamada.` }, { status: 400 })

  const cfg = await getInstagramOrganicConfig(ws)
  if (!cfg) return NextResponse.json({ error: 'Instagram não conectado neste projeto. Conecte em Admin → Projetos.' }, { status: 400 })

  // Conta IG: ?igUserId= se for uma conta conectada; senão a 1ª conectada.
  const accounts = Object.keys(cfg.tokens).filter((k) => k !== '__user')
  const reqIg = req.nextUrl.searchParams.get('igUserId') || ''
  const igUserId = reqIg && accounts.includes(reqIg) ? reqIg : accounts[0]
  if (!igUserId) return NextResponse.json({ error: 'Nenhuma conta Instagram conectada neste projeto.' }, { status: 400 })
  const token = cfg.tokens[igUserId]

  const client = db()
  let usage: BudgetUsage
  try {
    usage = await getHashtagBudget(client, ws, igUserId)
  } catch {
    return NextResponse.json({ error: 'Tabela de orçamento ausente — rode a migration 0037_hashtag_query_budget.sql no Supabase.' }, { status: 503 })
  }

  const results: Array<{ hashtag: string; hashtagId: string | null; reused?: boolean; top: HashtagMedia[]; recent: HashtagMedia[]; note?: string; error?: string }> = []
  const blocked: string[] = []

  for (const hashtag of hashtags) {
    try {
      const r = await resolveHashtagWithBudget(client, token, ws, igUserId, hashtag, usage)
      if (r.blocked) { blocked.push(hashtag); continue }
      if (!r.id) { results.push({ hashtag, hashtagId: null, top: [], recent: [], note: 'hashtag não encontrada' }); continue }
      const [top, recent] = await Promise.all([
        fetchHashtagTopMedia(token, igUserId, r.id).catch(() => [] as HashtagMedia[]),
        fetchHashtagRecentMedia(token, igUserId, r.id).catch(() => [] as HashtagMedia[]),
      ])
      await persistHashtagMedia(client, ws, hashtag, 'top', top)
      await persistHashtagMedia(client, ws, hashtag, 'recent', recent)
      results.push({ hashtag, hashtagId: r.id, reused: r.reused, top, recent })
    } catch (e) {
      results.push({ hashtag, hashtagId: null, top: [], recent: [], error: (e as Error).message.slice(0, 160) })
    }
  }

  const payload = {
    igUserId,
    budget: { used: usage.used, limit: HASHTAG_BUDGET_LIMIT, remaining: usage.remaining },
    results,
    blocked,
  }

  // 429 quando TUDO que foi pedido caiu no bloqueio de orçamento (nada servível).
  if (blocked.length > 0 && results.length === 0) {
    return NextResponse.json(
      { ...payload, error: `Orçamento de ${HASHTAG_BUDGET_LIMIT} hashtags/7 dias atingido. Bloqueadas: ${blocked.join(', ')}.` },
      { status: 429 },
    )
  }
  return NextResponse.json(payload)
}
