export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { fetchTransacoes } from '@/lib/supabase'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { fetchAcaoVenda, analyzeAcao, ACAO_TIPO_LABEL } from '@/lib/acoesVendas'
import { formatNumber, formatCurrency, formatCurrencyCompact } from '@/lib/formatters'
import AcaoActions from './AcaoActions'

const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const TIPO_LABEL: Record<string, string> = { front: 'Front-end', ob: 'Order Bumps', upsell: 'Upsells', downsell: 'Downsells', outro: 'Outros' }

export default async function AcaoPainelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acao = await fetchAcaoVenda(id, await getActiveWorkspaceId())
  if (!acao) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 p-6">
        <p className="text-sm text-gray-400">Ação de vendas não encontrada.</p>
        <Link href="/acoes-vendas" className="text-xs text-cyan-400 hover:text-cyan-300">← voltar</Link>
      </div>
    )
  }
  const transacoes = await fetchTransacoes()
  const r = analyzeAcao(acao, transacoes)
  const maxSerie = Math.max(1, ...r.serie.map((s) => s.vendas))
  const maxDow = Math.max(1, ...r.porDiaSemana.map((d) => d.vendas))
  const maxHora = Math.max(1, ...r.porHora.map((h) => h.vendas))
  const maxCri = Math.max(1, ...r.topCriativos.map((c) => c.vendas))
  const fmtKpi = (tipo: string, v: number) => (tipo === 'brl' ? formatCurrency(v) : tipo === 'pct' ? `${v.toFixed(1).replace('.', ',')}%` : formatNumber(v, 0))

  return (
    <div className="flex flex-col h-full">
      <header className="h-16 bg-[#0A0F1E] border-b border-[#1F2937] flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/acoes-vendas" className="text-gray-500 hover:text-white"><ArrowLeft size={18} /></Link>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-white truncate font-[family-name:var(--font-heading)]">{acao.nome}</h1>
            <p className="text-xs text-gray-500">{ACAO_TIPO_LABEL[acao.tipo]} · {acao.data_inicio || '—'} → {acao.data_fim || '—'}</p>
          </div>
        </div>
        <AcaoActions id={acao.id} status={acao.status} />
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Dado 100% correto: sem produtos cadastrados a ação soma TODOS os
            produtos do período (pode misturar funis) — avisar sempre. */}
        {acao.produtos_front.length + acao.produtos_ob.length + acao.produtos_upsell.length + acao.produtos_downsell.length === 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
            <p className="text-sm font-medium text-amber-300">Ação sem produtos cadastrados</p>
            <p className="text-xs text-amber-200/70 mt-0.5">
              Os números abaixo somam TODAS as vendas do período — inclusive de outros funis. Edite a ação e marque os produtos (front/OB/upsell/downsell) pra restringir.
            </p>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="Vendas front" value={formatNumber(r.vendasFront, 0)} />
          <Kpi label="Faturamento" value={formatCurrencyCompact(r.faturamentoFront)} />
          <Kpi label="Receita líquida" value={formatCurrencyCompact(r.receitaLiquida)} accent />
          <Kpi label="Ticket médio" value={formatCurrency(r.ticketMedio)} />
          <Kpi label="Take rate OB" value={`${r.takeRateOB.toFixed(1).replace('.', ',')}%`} />
          <Kpi label="Pace/dia" value={formatNumber(r.paceDiarioVendas, 1)} sub={`${formatNumber(r.paceSemanalVendas, 1)}/sem`} />
        </div>

        {/* Metas */}
        {r.metas.length > 0 && (
          <Painel titulo="Progresso vs metas">
            <div className="space-y-3">
              {r.metas.map((m) => (
                <div key={m.key}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-400">{m.label}</span>
                    <span className="tabular-nums text-gray-300">{fmtKpi(m.tipo, m.atual)} <span className="text-gray-400">/ {fmtKpi(m.tipo, m.meta)} · {m.pct.toFixed(0)}%</span></span>
                  </div>
                  <div className="h-2 rounded-full bg-[#1F2937] overflow-hidden">
                    <div className={m.pct >= 100 ? 'h-full bg-emerald-500' : 'h-full bg-cyan-500'} style={{ width: `${Math.min(m.pct, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Painel>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pace diário */}
          <Painel titulo="Pace diário (vendas front)">
            {r.serie.length === 0 ? <Vazio /> : (
              <div className="flex items-end gap-1 h-40">
                {r.serie.map((s) => (
                  <div key={s.data} className="flex-1 flex flex-col items-center justify-end group" title={`${s.data}: ${s.vendas} vendas`}>
                    <div className="w-full bg-cyan-500/70 group-hover:bg-cyan-400 rounded-t" style={{ height: `${(s.vendas / maxSerie) * 100}%` }} />
                    <span className="text-[8px] text-gray-400 mt-1 rotate-0 truncate w-full text-center">{s.data.slice(8)}</span>
                  </div>
                ))}
              </div>
            )}
          </Painel>

          {/* Melhores dias da semana */}
          <Painel titulo="Melhores dias da semana">
            <div className="space-y-1.5">
              {r.porDiaSemana.map((d) => (
                <div key={d.dia} className="flex items-center gap-2">
                  <span className="w-8 text-[11px] text-gray-500">{DOW[d.dia]}</span>
                  <div className="flex-1 h-3 rounded bg-[#1F2937] overflow-hidden">
                    <div className="h-full bg-cyan-500/70" style={{ width: `${(d.vendas / maxDow) * 100}%` }} />
                  </div>
                  <span className="w-8 text-right text-[11px] tabular-nums text-gray-400">{d.vendas}</span>
                </div>
              ))}
            </div>
          </Painel>

          {/* Melhores horários */}
          <Painel titulo="Melhores horários (compra)">
            <div className="flex items-end gap-0.5 h-32">
              {r.porHora.map((h) => (
                <div key={h.hora} className="flex-1 flex flex-col items-center justify-end" title={`${h.hora}h: ${h.vendas}`}>
                  <div className="w-full bg-amber-500/60 rounded-t" style={{ height: `${(h.vendas / maxHora) * 100}%` }} />
                  {h.hora % 3 === 0 && <span className="text-[7px] text-gray-400 mt-0.5">{h.hora}</span>}
                </div>
              ))}
            </div>
          </Painel>

          {/* Breakdown por tipo */}
          <Painel titulo="Por tipo de produto">
            {r.breakdown.length === 0 ? <Vazio /> : (
              <div className="space-y-2">
                {r.breakdown.map((b) => (
                  <div key={b.tipo} className="flex items-center justify-between text-xs bg-[#1F2937]/40 rounded-lg px-3 py-2">
                    <span className="text-gray-300">{TIPO_LABEL[b.tipo]}</span>
                    <span className="tabular-nums text-gray-400">{b.vendas} vendas · {formatCurrencyCompact(b.faturamento)}</span>
                  </div>
                ))}
              </div>
            )}
          </Painel>
        </div>

        {/* Melhores argumentos (criativos) */}
        <Painel titulo="Melhores argumentos de venda (criativos)">
          {r.topCriativos.length === 0 ? <Vazio /> : (
            <div className="space-y-1.5">
              {r.topCriativos.slice(0, 15).map((c) => (
                <div key={c.criativo} className="flex items-center gap-3">
                  <span className="flex-1 truncate text-xs text-gray-300">{c.criativo}</span>
                  <div className="w-40 h-2 rounded-full bg-[#1F2937] overflow-hidden">
                    <div className="h-full bg-cyan-500/70" style={{ width: `${(c.vendas / maxCri) * 100}%` }} />
                  </div>
                  <span className="w-10 text-right text-[11px] tabular-nums text-gray-400">{c.vendas}</span>
                  <span className="w-20 text-right text-[11px] tabular-nums text-gray-500">{formatCurrencyCompact(c.receita)}</span>
                </div>
              ))}
            </div>
          )}
        </Painel>

        <p className="text-[10px] text-gray-400">
          Fase 1 — métricas de transações (Hotmart). Comparecimento ao vivo, replay e grupo de super interessados (Fase 2) dependem de integração (Evolution/YouTube) e estão no backlog.
        </p>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${accent ? 'text-cyan-400' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 tabular-nums">{sub}</div>}
    </div>
  )
}
function Painel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
      <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">{titulo}</h2>
      {children}
    </div>
  )
}
function Vazio() { return <p className="text-xs text-gray-400 py-4 text-center">Sem dados no período da ação.</p> }
