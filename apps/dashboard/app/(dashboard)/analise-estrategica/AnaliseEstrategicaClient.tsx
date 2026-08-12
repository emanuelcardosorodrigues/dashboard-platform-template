'use client'

import { clsx } from 'clsx'
import { formatPercent, formatNumber, formatCurrency } from '@/lib/formatters'
import { getSemaforoColorForFunil, SEMAFORO_CSS } from '@/lib/thresholds'
import { Video, Image as ImageIcon, Star, Target, AlertCircle, Lightbulb } from 'lucide-react'

interface CriativoInsight {
  criativo: string
  tipo: string
  vendas: number
  ticketMedio: number
  cpa: number
  pctQualificados: number
  pctSemi: number
  pctLeads: number
  topDores: string[]
  topMedos: string[]
  topObjetivos: string[]
  faturamentoModa: string
  alunosMentoria: number
}

interface CanalData {
  canal: string
  vendas: number
  faturamento: number
  pctTotal: number
  ticketMedio?: number
  pctQualificados?: number
}

interface Props {
  criativos: CriativoInsight[]
  canaisUltimoToque: CanalData[]
  primeiroImpacto: CanalData[]
  totalInvestimento: number
  funil?: string
  ticketMedioPeriodo?: number
}

export default function AnaliseEstrategicaClient({ criativos, canaisUltimoToque, primeiroImpacto, totalInvestimento, funil, ticketMedioPeriodo }: Props) {
  return (
    <div className="space-y-8">
      {/* Section 1: Dores por criativo */}
      <section>
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">
          Dores por Criativo — Top 8 por Vendas
        </h2>
        {criativos.length === 0 && (
          <p className="text-sm text-gray-400 py-6">Sem criativos com vendas no período selecionado.</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {criativos.map((c) => (
            <div
              key={c.criativo}
              className={clsx(
                'bg-[#111827] border rounded-xl p-5 space-y-4',
                c.alunosMentoria > 0 ? 'border-yellow-500/40' : 'border-[#1F2937]'
              )}
            >
              {/* Header */}
              <div className="flex items-start gap-2">
                {c.tipo === 'imagem' ? (
                  <ImageIcon size={16} className="text-gray-500 mt-0.5 shrink-0" />
                ) : (
                  <Video size={16} className="text-cyan-400 mt-0.5 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{c.criativo}</p>
                  <p className="text-xs text-gray-500">
                    {formatNumber(c.vendas)} vendas
                    {c.ticketMedio > 0 && <span className="ml-2 text-cyan-400">TM: {formatCurrency(c.ticketMedio)}</span>}
                    {c.cpa > 0 && <span className={clsx('ml-2', SEMAFORO_CSS[getSemaforoColorForFunil('cpa', c.cpa, funil, ticketMedioPeriodo)])}>CPA: {formatCurrency(c.cpa)}</span>}
                  </p>
                </div>
                {c.alunosMentoria > 0 && (
                  <div className="ml-auto flex items-center gap-1 text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full shrink-0">
                    <Star size={11} />
                    <span>{c.alunosMentoria} programa</span>
                  </div>
                )}
              </div>

              {/* Qualification bar */}
              <div>
                <p className="text-xs text-gray-500 mb-1">Qualificação</p>
                <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
                  {c.pctQualificados > 0 && (
                    <div style={{ width: `${c.pctQualificados}%` }} className="bg-emerald-500" title={`Qualificados: ${formatPercent(c.pctQualificados)}`} />
                  )}
                  {c.pctSemi > 0 && (
                    <div style={{ width: `${c.pctSemi}%` }} className="bg-amber-400" title={`Semi: ${formatPercent(c.pctSemi)}`} />
                  )}
                  {c.pctLeads > 0 && (
                    <div style={{ width: `${c.pctLeads}%` }} className="bg-gray-600" title={`Leads: ${formatPercent(c.pctLeads)}`} />
                  )}
                </div>
                <p className="text-xs text-emerald-400 mt-1">{formatPercent(c.pctQualificados)} qualificados</p>
              </div>

              {/* Dores */}
              {c.topDores.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <AlertCircle size={12} className="text-rose-400" />
                    <p className="text-xs font-medium text-rose-400">Top Dores</p>
                  </div>
                  <ul className="space-y-1">
                    {c.topDores.map((d, i) => (
                      <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                        <span className="text-rose-500 shrink-0">•</span>
                        <span className="break-words min-w-0">{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Medos */}
              {c.topMedos.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Target size={12} className="text-amber-400" />
                    <p className="text-xs font-medium text-amber-400">Top Medos</p>
                  </div>
                  <ul className="space-y-1">
                    {c.topMedos.map((m, i) => (
                      <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                        <span className="text-amber-500 shrink-0">•</span>
                        <span className="break-words min-w-0">{m}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Objetivos */}
              {c.topObjetivos.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Lightbulb size={12} className="text-cyan-400" />
                    <p className="text-xs font-medium text-cyan-400">Top Objetivos</p>
                  </div>
                  <ul className="space-y-1">
                    {c.topObjetivos.map((o, i) => (
                      <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                        <span className="text-cyan-500 shrink-0">•</span>
                        <span className="break-words min-w-0">{o}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Empty state when no qualification data */}
              {c.topDores.length === 0 && c.topMedos.length === 0 && c.topObjetivos.length === 0 && (
                <p className="text-xs text-gray-400 italic">Sem fichas de qualificação vinculadas</p>
              )}

              {/* Faturamento moda */}
              <div className="pt-2 border-t border-[#1F2937]">
                <p className="text-xs text-gray-500">Faturamento mais comum</p>
                <p className="text-sm font-semibold text-white mt-0.5">{c.faturamentoModa}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 2: Primeiro vs Último Impacto */}
      <section>
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">
          Análise de Primeiro vs. Último Impacto
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-4">Último Toque (canal que converteu)</h3>
            {canaisUltimoToque.length === 0 && <p className="text-sm text-gray-400">Sem dados de UTM no período.</p>}
            <div className="space-y-3">
              {canaisUltimoToque.map((c) => (
                <div key={c.canal} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white">{c.canal}</p>
                    <p className="text-xs text-gray-500">{formatNumber(c.vendas)} vendas{c.ticketMedio ? ` · TM: ${formatCurrency(c.ticketMedio)}` : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-cyan-400">{formatPercent(c.pctTotal)}</p>
                    {c.pctQualificados !== undefined && (
                      <p className="text-xs text-emerald-400">{formatPercent(c.pctQualificados)} qual.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-4">Primeiro Impacto (primeiro canal)</h3>
            {primeiroImpacto.length === 0 && <p className="text-sm text-gray-400">Sem dados de UTM no período.</p>}
            <div className="space-y-3">
              {primeiroImpacto.map((c) => (
                <div key={c.canal} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white">{c.canal}</p>
                    <p className="text-xs text-gray-500">{formatNumber(c.vendas)} vendas</p>
                  </div>
                  <p className="text-sm font-semibold text-amber-400">{formatPercent(c.pctTotal)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Mapa de Canais */}
      <section>
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">
          Mapa de Canais — Comparativo
        </h2>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1F2937]">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-widest">Canal</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">Vendas (Últ.)</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">% (Últ.)</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">CPA (Últ.)</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">Vendas (1º)</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">% (1º)</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">CPA (1º)</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">Lucro</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-widest">% Qualif.</th>
                </tr>
              </thead>
              <tbody>
                {canaisUltimoToque.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-center text-sm text-gray-400">
                      Sem dados de canal no período selecionado.
                    </td>
                  </tr>
                ) : (
                  canaisUltimoToque.map((canal) => {
                    const primeiro = primeiroImpacto.find((p) => p.canal === canal.canal)
                    const cpaUltimo  = canal.vendas > 0 ? totalInvestimento * (canal.pctTotal / 100) / canal.vendas : 0
                    const cpaPrimeiro = primeiro && primeiro.vendas > 0 ? totalInvestimento * (primeiro.pctTotal / 100) / primeiro.vendas : 0
                    const lucro = canal.faturamento - totalInvestimento * (canal.pctTotal / 100)
                    return (
                      <tr key={canal.canal} className="border-b border-[#1F2937] hover:bg-[#1F2937]/50 transition-colors duration-150">
                        <td className="px-4 py-3 text-white font-medium">{canal.canal}</td>
                        <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{formatNumber(canal.vendas)}</td>
                        <td className="px-4 py-3 text-right text-cyan-400 tabular-nums">{formatPercent(canal.pctTotal)}</td>
                        <td className="px-4 py-3 text-right text-rose-400 tabular-nums">{cpaUltimo > 0 ? formatCurrency(cpaUltimo) : '–'}</td>
                        <td className="px-4 py-3 text-right text-gray-300 tabular-nums">{primeiro ? formatNumber(primeiro.vendas) : '–'}</td>
                        <td className="px-4 py-3 text-right text-amber-400 tabular-nums">{primeiro ? formatPercent(primeiro.pctTotal) : '–'}</td>
                        <td className="px-4 py-3 text-right text-rose-400 tabular-nums">{cpaPrimeiro > 0 ? formatCurrency(cpaPrimeiro) : '–'}</td>
                        <td className={`px-4 py-3 text-right font-semibold tabular-nums ${lucro >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(lucro)}</td>
                        <td className="px-4 py-3 text-right text-emerald-400 tabular-nums">{canal.pctQualificados !== undefined ? formatPercent(canal.pctQualificados) : '–'}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
