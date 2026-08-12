/**
 * GET  /api/planejamento — lista os planejamentos (is_planejamento=true) do workspace
 * POST /api/planejamento — cria um planejamento (+ semeia cenários Base/A/B) ou duplica um existente
 * body: { nome, tipo?, sigla?, data_inicio?, data_fim?, duplicarDe? }
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { log } from '@/lib/log'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { estadoSeedFunil, VARIACAO_FUNIL_A, VARIACAO_FUNIL_B } from '@/lib/funilEngine'
import { estadoVazio, VARIACAO_CENARIO_A, VARIACAO_CENARIO_B } from '@/lib/simulador'
import type { AcaoTipo } from '@/lib/acoesVendas'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

const TIPOS = ['low_ticket', 'lancamento_gratis', 'lancamento_pago', 'perpetuo_vsl']

/** Cenários iniciais (Base/A/B). Lançamento Pago = motor LaunchSim; demais = funil. */
function cenariosSeed(ws: string, acaoId: string, tipo: AcaoTipo) {
  const mk = (nome: string, ordem: number, base: object, variacao: Record<string, number>) => ({
    workspace_id: ws, acao_id: acaoId, nome, ordem, kind: 'simulado' as const,
    estado: { ...base, variacao }, is_melhor: false,
  })
  if (tipo === 'lancamento_pago') {
    const base = estadoVazio()
    return [
      mk('Base', 0, base, { variacaoCpm: 0, variacaoCtr: 0, variacaoConnectRate: 0, variacaoTxConversao: 0 }),
      mk('Cenário A', 1, base, VARIACAO_CENARIO_A),
      mk('Cenário B', 2, base, VARIACAO_CENARIO_B),
    ]
  }
  const base = estadoSeedFunil(tipo)
  return [
    mk('Base', 0, base, {}),
    mk('Cenário A', 1, base, VARIACAO_FUNIL_A),
    mk('Cenário B', 2, base, VARIACAO_FUNIL_B),
  ]
}

export async function GET() {
  try {
    const ws = await getActiveWorkspaceId()
    const { data, error } = await supa().from('acoes_vendas').select('*')
      .eq('workspace_id', ws).eq('is_planejamento', true).order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ planejamentos: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>
    const ws = await getActiveWorkspaceId()
    const db = supa()

    // ── Duplicar planejamento existente (copia campos + cenários simulados; limpa notas) ──
    const duplicarDe = typeof b.duplicarDe === 'string' ? b.duplicarDe : null
    if (duplicarDe) {
      const { data: src, error: e1 } = await db.from('acoes_vendas').select('*').eq('id', duplicarDe).eq('workspace_id', ws).single()
      if (e1 || !src) return NextResponse.json({ error: 'planejamento de origem não encontrado' }, { status: 404 })
      const nome = typeof b.nome === 'string' && b.nome.trim() ? b.nome.trim() : `${src.nome} (cópia)`
      const { data: nova, error: e2 } = await db.from('acoes_vendas').insert({
        workspace_id: ws, nome, tipo: src.tipo, is_planejamento: true, status: 'rascunho',
        data_inicio: src.data_inicio, data_fim: src.data_fim, sigla: null, thumbnail_url: src.thumbnail_url,
        produtos_front: src.produtos_front, produtos_ob: src.produtos_ob, produtos_upsell: src.produtos_upsell, produtos_downsell: src.produtos_downsell,
        metas: src.metas ?? {}, config_impostos: src.config_impostos ?? {}, comparacao_kpis: src.comparacao_kpis ?? {}, descricao: src.descricao,
      }).select().single()
      if (e2 || !nova) return NextResponse.json({ error: e2?.message || 'falha ao duplicar' }, { status: 500 })
      // copia só os cenários simulados
      const { data: cens } = await db.from('acao_cenarios').select('*').eq('acao_id', duplicarDe).eq('workspace_id', ws).eq('kind', 'simulado')
      if (cens && cens.length) {
        await db.from('acao_cenarios').insert(cens.map((c) => ({
          workspace_id: ws, acao_id: nova.id, nome: c.nome, ordem: c.ordem, kind: 'simulado', estado: c.estado, is_melhor: c.is_melhor,
        })))
      }
      return NextResponse.json(nova, { status: 201 })
    }

    // ── Criar novo ──
    const nome = typeof b.nome === 'string' ? b.nome.trim() : ''
    if (!nome) return NextResponse.json({ error: 'nome requerido' }, { status: 400 })
    const tipo = typeof b.tipo === 'string' && TIPOS.includes(b.tipo) ? b.tipo : 'lancamento_pago'
    const sigla = typeof b.sigla === 'string' ? b.sigla.trim().toUpperCase() : null
    const perpetuo = b.perpetuo === true

    const { data: nova, error } = await db.from('acoes_vendas').insert({
      workspace_id: ws, nome, tipo, is_planejamento: true, status: 'rascunho', perpetuo,
      data_inicio: (b.data_inicio as string) || null, data_fim: perpetuo ? null : (b.data_fim as string) || null,
      sigla: sigla || null, produtos_front: [], produtos_ob: [], produtos_upsell: [], produtos_downsell: [],
      metas: {}, config_impostos: {}, comparacao_kpis: {},
    }).select().single()
    if (error || !nova) return NextResponse.json({ error: error?.message || 'falha ao criar' }, { status: 500 })

    const { error: eC } = await db.from('acao_cenarios').insert(cenariosSeed(ws, nova.id, tipo as AcaoTipo))
    if (eC) log.error('planejamento: falha ao semear cenários', { msg: eC.message, acao: nova.id })

    return NextResponse.json(nova, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('planejamento POST failed', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
