/**
 * Controle Meta (escrita) — ações manuais do operador na UI. Admin-only.
 *
 * GET  /api/criativos/ads/[adId]/action
 *   → estado AO VIVO { status, adsetId, campaignId, daily_budget_cents, is_cbo,
 *     max_daily_budget_cents } pro modal de confirmação (base do compare-and-set).
 *
 * POST /api/criativos/ads/[adId]/action
 *   body: { tipo: 'escalar'|'pausar'|'ativar',
 *           new_daily_budget_cents?|budget_diff_pct?: number,  // escalar
 *           expected_old_cents?: number,                       // compare-and-set
 *           motivo?: string, dry_run?: boolean }
 *   → executa no Meta e registra em criativo_acoes_log (ator = sessão).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { resolveWorkspaceFromRequest } from '@/lib/criativo-pipeline'
import { executarAcao, CriativoAcaoLockError } from '@/lib/criativo-acoes'
import { getAdContext, getAdsetBudget, getEntityBudget, maxDailyBudgetCents, MetaActionError } from '@/lib/meta-actions'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Revalida sessão admin no próprio handler (defense-in-depth; rejeita bypass de CRON_SECRET). */
async function requireAdmin(): Promise<{ email: string } | NextResponse> {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value
  const session = sessionId ? await lookupSession(sessionId) : null
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden: controle do Meta exige admin' }, { status: 403 })
  }
  return { email: session.email }
}

/**
 * GET /api/criativos/ads/[adId]/action
 * Lê o estado AO VIVO do ad no Meta (status real + orçamento do adset) pro modal
 * de confirmação. É o valor que vira `expected_old_cents` no compare-and-set:
 * se mudar entre abrir o modal e confirmar, o POST devolve 409.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ adId: string }> }) {
  const { adId } = await ctx.params
  if (!adId || !/^\d+$/.test(adId)) {
    return NextResponse.json({ error: 'adId inválido' }, { status: 400 })
  }
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard

  const escopo = new URL(req.url).searchParams.get('escopo') ?? 'criativo'

  try {
    const ceil = maxDailyBudgetCents()
    const max_daily_budget_cents = ceil > 0 ? ceil : null

    if (escopo === 'conjunto' || escopo === 'campanha') {
      // id JÁ é a entidade com orçamento (adset/campanha) — lê direto.
      const ent = await getEntityBudget(adId)
      return NextResponse.json({
        adId,
        escopo,
        status: ent.status,
        daily_budget_cents: ent.daily_budget_cents,
        // sem orçamento próprio: conjunto → CBO; campanha → ABO
        is_cbo: ent.daily_budget_cents == null,
        max_daily_budget_cents,
      })
    }

    // criativo: resolve o adset do ad.
    const adCtx = await getAdContext(adId)
    const adset = await getAdsetBudget(adCtx.adsetId)
    return NextResponse.json({
      adId,
      escopo: 'criativo',
      adsetId: adCtx.adsetId,
      campaignId: adCtx.campaignId,
      status: adCtx.status, // ACTIVE | PAUSED | ...
      daily_budget_cents: adset.daily_budget_cents,
      is_cbo: adset.daily_budget_cents == null, // sem budget no adset = CBO (budget na campanha)
      max_daily_budget_cents,
    })
  } catch (err) {
    const status = err instanceof MetaActionError && err.status ? err.status : 502
    const msg = err instanceof Error ? err.message : String(err)
    log.error('ads state read failed', { adId, msg })
    return NextResponse.json({ error: msg }, { status })
  }
}

function supa() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

interface ActionBody {
  tipo: 'escalar' | 'pausar' | 'ativar'
  escopo?: 'criativo' | 'conjunto' | 'campanha'
  budget_diff_pct?: number
  new_daily_budget_cents?: number
  expected_old_cents?: number
  motivo?: string
  dry_run?: boolean
  executado_por?: string
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ adId: string }> }) {
  const { adId } = await ctx.params
  if (!adId) return NextResponse.json({ error: 'adId requerido' }, { status: 400 })

  // ── Segurança P0 (ação que MEXE EM DINHEIRO no Meta) ───────────────────────
  // Revalida no próprio handler (defense-in-depth — não confia só no proxy) e
  // EXIGE sessão admin. Isso também REJEITA o bypass de CRON_SECRET do proxy:
  // uma requisição via Bearer não carrega cookie de sessão → 401. v1 = admin-only;
  // permissão granular `pode_escrever_meta` entra na Fase 8.
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value
  const session = sessionId ? await lookupSession(sessionId) : null
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden: ação de escrita no Meta exige admin' }, { status: 403 })
  }

  let body: ActionBody
  try {
    body = (await req.json()) as ActionBody
  } catch {
    return NextResponse.json({ error: 'body inválido' }, { status: 400 })
  }
  if (!body.tipo || !['escalar', 'pausar', 'ativar'].includes(body.tipo)) {
    return NextResponse.json({ error: 'tipo deve ser escalar|pausar|ativar' }, { status: 400 })
  }
  if (body.tipo === 'escalar') {
    if (typeof body.budget_diff_pct !== 'number' && typeof body.new_daily_budget_cents !== 'number') {
      return NextResponse.json({ error: 'escalar requer budget_diff_pct ou new_daily_budget_cents' }, { status: 400 })
    }
    // Compare-and-set OBRIGATÓRIO: sem expected_old_cents um caller direto burlaria
    // a checagem de staleness. A UI sempre envia (lê o valor vivo no GET).
    if (typeof body.expected_old_cents !== 'number') {
      return NextResponse.json({ error: 'escalar requer expected_old_cents (compare-and-set)' }, { status: 400 })
    }
  }

  try {
    const client = supa()
    const { id: workspaceId } = await resolveWorkspaceFromRequest(client, req)
    const result = await executarAcao(client, {
      workspaceId,
      adId,
      tipo: body.tipo,
      escopo: body.escopo ?? 'criativo',
      payload: { budget_diff_pct: body.budget_diff_pct, new_daily_budget_cents: body.new_daily_budget_cents, expected_old_cents: body.expected_old_cents, motivo: body.motivo },
      sugestaoId: null,
      executadoPor: session.email, // ator do SERVIDOR (sessão), nunca do body — auditoria confiável
      dryRun: !!body.dry_run,
    })
    const status = result.status === 'failed' ? 502 : 200
    return NextResponse.json({ adId, ...result }, { status })
  } catch (err) {
    if (err instanceof CriativoAcaoLockError) {
      return NextResponse.json({ error: err.message, code: 'LOCKED' }, { status: 409 })
    }
    const msg = err instanceof Error ? err.message : String(err)
    log.error('ads action failed', { adId, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
