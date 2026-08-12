'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import { ChevronDown, Save, Download, Target, AlertTriangle, SlidersHorizontal } from 'lucide-react'
import FilterToggle from '@/components/filters/FilterToggle'
import { formatNumber } from '@/lib/formatters'
import {
  ALVO_OPTIONS, TIERS, maxScoreOf,
  type LeadScoreConfig, type Question, type LeadSummary, type Tier,
} from '@/lib/leadScore'

const TIER_LABEL: Record<Tier, string> = { quente: 'Quente', morno: 'Morno', frio: 'Frio' }
const TIER_TEXT: Record<Tier, string> = { quente: 'text-emerald-400', morno: 'text-amber-400', frio: 'text-slate-400' }
const TIER_BG: Record<Tier, string> = { quente: 'bg-emerald-500/15 text-emerald-300', morno: 'bg-amber-500/15 text-amber-300', frio: 'bg-slate-500/15 text-slate-300' }
const TIER_BAR: Record<Tier, string> = { quente: 'bg-emerald-500', morno: 'bg-amber-500', frio: 'bg-slate-600' }

const pct = (n: number) => `${n.toFixed(1).replace('.', ',')}%`
function maskEmail(e: string) {
  const [u, d] = e.split('@')
  if (!d) return e
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`
}
function csvCell(v: string | number) {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function LeadScoringClient({
  config, questions, summary, janela,
}: {
  config: LeadScoreConfig; questions: Question[]; summary: LeadSummary
  janela: { de: string; ate: string; funil: string }
}) {
  const router = useRouter()
  const [weights, setWeights] = useState<LeadScoreConfig['weights']>(config.weights)
  const [tierQuente, setTierQuente] = useState(config.tierQuente)
  const [tierMorno, setTierMorno] = useState(config.tierMorno)
  const [alvoColuna, setAlvoColuna] = useState(config.alvoColuna)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())

  const maxScore = maxScoreOf(weights)
  const alvoLabel = ALVO_OPTIONS.find((a) => a.col === alvoColuna)?.label ?? alvoColuna

  function setPoint(field: string, option: string, points: number) {
    setWeights((prev) => ({ ...prev, [field]: { ...(prev[field] ?? {}), [option]: points } }))
    setDirty(true)
  }
  function toggle(field: string) {
    setOpen((prev) => { const n = new Set(prev); n.has(field) ? n.delete(field) : n.add(field); return n })
  }
  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/lead-score-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ funil: config.funil, weights, tier_quente: tierQuente, tier_morno: tierMorno, alvo_coluna: alvoColuna }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      router.refresh()
    } catch (e) {
      alert('Erro ao salvar: ' + (e instanceof Error ? e.message : String(e)))
    } finally { setSaving(false) }
  }
  function exportHot() {
    const hot = summary.scored.filter((s) => s.tier === 'quente')
    const header = ['email', 'nome', 'score', 'tier', 'faturamento', 'criativo', 'convertido']
    const lines = hot.map((s) => [s.email, s.nome, s.score, s.tier, s.faturamento, s.criativo, s.convertido ? 'sim' : 'nao'].map(csvCell).join(','))
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `leads-quentes-${config.funil}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const totalLeads = summary.scored.length
  const alvoBaixo = summary.alvoPositivos > 0 && summary.alvoPositivos < 10

  return (
    <div className="space-y-5">
      <FilterToggle prefix="l" />

      {/* Contexto */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
        <span className="tabular-nums">Período: {janela.de} → {janela.ate}</span>
        <span>· config do funil <span className="text-gray-300">{config.funil}</span></span>
        <span>· {formatNumber(totalLeads, 0)} leads com ficha</span>
        <span className="flex items-center gap-1"><Target size={11} /> alvo: <span className="text-gray-300">{alvoLabel}</span> ({summary.alvoPositivos} convertidos)</span>
      </div>

      {summary.alvoPositivos === 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-amber-400"><AlertTriangle size={12} /> Nenhum convertido no alvo neste recorte — a calibração fica vazia. Escolha outro alvo de conversão ou amplie o período/funil.</p>
      )}
      {alvoBaixo && (
        <p className="flex items-center gap-1.5 text-[11px] text-amber-400"><AlertTriangle size={12} /> Só {summary.alvoPositivos} convertidos no alvo — amostra pequena, a calibração é indicativa (não conclusiva).</p>
      )}

      {/* Distribuição + Calibração */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4">Distribuição dos leads</h2>
          {totalLeads === 0 ? <p className="text-sm text-gray-400">Sem leads no recorte.</p> : (
            <>
              <div className="flex h-3 rounded-full overflow-hidden mb-4">
                {TIERS.map((t) => summary.dist[t] > 0 && (
                  <div key={t} className={TIER_BAR[t]} style={{ width: `${(summary.dist[t] / totalLeads) * 100}%` }} title={`${TIER_LABEL[t]}: ${summary.dist[t]}`} />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {TIERS.map((t) => (
                  <div key={t}>
                    <div className={clsx('text-[10px] uppercase tracking-wider', TIER_TEXT[t])}>{TIER_LABEL[t]}</div>
                    <div className="text-xl font-bold text-white tabular-nums">{formatNumber(summary.dist[t], 0)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-1">Calibração — conversão por tier</h2>
          <p className="text-[10px] text-gray-400 mb-4">% de cada tier que bateu o alvo. Um score bom faz o Quente converter bem mais que o Frio.</p>
          <div className="space-y-2.5">
            {TIERS.map((t) => {
              const c = summary.conv[t]
              return (
                <div key={t} className="flex items-center gap-3">
                  <span className={clsx('w-14 text-xs', TIER_TEXT[t])}>{TIER_LABEL[t]}</span>
                  <div className="flex-1 h-2 rounded-full bg-[#1F2937] overflow-hidden">
                    <div className={TIER_BAR[t]} style={{ width: `${Math.min(c.taxa, 100)}%`, height: '100%' }} />
                  </div>
                  <span className="w-28 text-right text-xs tabular-nums text-gray-300">{pct(c.taxa)} <span className="text-gray-400">({c.convertidos}/{c.total})</span></span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Construtor */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#1F2937]">
          <h2 className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-widest">
            <SlidersHorizontal size={14} /> Construtor do score — funil {config.funil}
          </h2>
          <div className="flex items-center gap-3">
            {saved && !dirty && <span className="text-[11px] text-emerald-400">✓ salvo e recalculado</span>}
            {dirty && <span className="text-[11px] text-amber-400">alterações não salvas</span>}
            <button onClick={save} disabled={saving || !dirty}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-black px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer">
              <Save size={13} /> {saving ? 'Salvando…' : 'Salvar e recalcular'}
            </button>
          </div>
        </div>

        {/* Alvo + tiers */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-5 py-4 border-b border-[#1F2937]">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500">Alvo de conversão (o que conta como "comprou")</span>
            <select value={alvoColuna} onChange={(e) => { setAlvoColuna(e.target.value); setDirty(true) }}
              className="bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-cyan-500/60 cursor-pointer">
              {ALVO_OPTIONS.map((a) => <option key={a.col} value={a.col}>{a.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500">Corte Quente (score ≥)</span>
            <input type="number" min={0} max={100} value={tierQuente} onChange={(e) => { setTierQuente(Number(e.target.value)); setDirty(true) }}
              className="bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-1.5 text-xs text-gray-200 tabular-nums focus:outline-none focus:border-cyan-500/60" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500">Corte Morno (score ≥)</span>
            <input type="number" min={0} max={100} value={tierMorno} onChange={(e) => { setTierMorno(Number(e.target.value)); setDirty(true) }}
              className="bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-1.5 text-xs text-gray-200 tabular-nums focus:outline-none focus:border-cyan-500/60" />
          </label>
        </div>

        {/* Perguntas */}
        <div className="px-5 py-3">
          {questions.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">Sem perguntas de múltipla escolha com dados neste recorte. Amplie o período/funil.</p>
          ) : (
            <>
              <p className="text-[11px] text-gray-500 mb-2">Pontue as alternativas de cada pergunta (0 = ignora). Score do lead = soma dos pontos ÷ máximo possível ({maxScore} pts).</p>
              <div className="divide-y divide-[#1F2937]">
                {questions.map((q) => {
                  const fieldMax = Math.max(0, ...Object.values(weights[q.field] ?? {}))
                  const isOpen = open.has(q.field)
                  return (
                    <div key={q.field}>
                      <button onClick={() => toggle(q.field)} className="w-full flex items-center justify-between py-2.5 text-left cursor-pointer group">
                        <span className="text-sm text-gray-200 group-hover:text-white">{q.label} <span className="text-[10px] text-gray-400">· {q.options.length} alternativas</span></span>
                        <span className="flex items-center gap-2">
                          {fieldMax > 0 && <span className="text-[10px] text-cyan-400 tabular-nums">máx {fieldMax}</span>}
                          <ChevronDown size={15} className={clsx('text-gray-500 transition-transform', isOpen && 'rotate-180')} />
                        </span>
                      </button>
                      {isOpen && (
                        <div className="pb-3 space-y-1.5">
                          {q.options.map((opt) => (
                            <div key={opt} className="flex items-center gap-3 pl-1">
                              <input type="number" min={0} value={weights[q.field]?.[opt] ?? 0}
                                onChange={(e) => setPoint(q.field, opt, Math.max(0, Number(e.target.value)))}
                                className="w-16 bg-[#0A0F1E] border border-[#1F2937] rounded-md px-2 py-1 text-xs text-gray-200 tabular-nums focus:outline-none focus:border-cyan-500/60" />
                              <span className="text-xs text-gray-400 truncate">{opt}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Resultados */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1F2937]">
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest">Leads pontuados</h2>
          <button onClick={exportHot} disabled={summary.dist.quente === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#1F2937] hover:border-cyan-500/50 text-gray-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 text-xs transition-colors cursor-pointer">
            <Download size={13} /> Exportar quentes ({summary.dist.quente})
          </button>
        </div>
        {!summary.configurado ? (
          <p className="text-sm text-gray-500 py-10 text-center">Pontue ao menos uma pergunta acima e salve pra gerar os scores.</p>
        ) : summary.scored.length === 0 ? (
          <p className="text-sm text-gray-500 py-10 text-center">Sem leads com ficha no recorte.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1F2937] text-[11px] uppercase tracking-wider text-gray-500">
                  <th scope="col" className="text-left py-2.5 px-5 font-semibold">Lead</th>
                  <th scope="col" className="text-left py-2.5 px-3 font-semibold w-48">Score</th>
                  <th scope="col" className="text-left py-2.5 px-3 font-semibold">Tier</th>
                  <th scope="col" className="text-left py-2.5 px-3 font-semibold">Faturamento</th>
                  <th scope="col" className="text-left py-2.5 px-3 font-semibold">Criativo</th>
                  <th scope="col" className="text-center py-2.5 px-3 font-semibold">Convertido</th>
                </tr>
              </thead>
              <tbody>
                {summary.scored.slice(0, 300).map((s, i) => (
                  <tr key={s.email + i} className="border-b border-[#1F2937]/50 hover:bg-[#1F2937]/30">
                    <td className="py-2 px-5 text-gray-300">{maskEmail(s.email)}</td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-[#1F2937] overflow-hidden max-w-[110px]">
                          <div className={TIER_BAR[s.tier]} style={{ width: `${s.score}%`, height: '100%' }} />
                        </div>
                        <span className="tabular-nums text-gray-200 w-8 text-right">{s.score}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3"><span className={clsx('text-[10px] px-1.5 py-0.5 rounded', TIER_BG[s.tier])}>{TIER_LABEL[s.tier]}</span></td>
                    <td className="py-2 px-3 text-gray-400 text-xs">{s.faturamento || '—'}</td>
                    <td className="py-2 px-3 text-gray-500 text-xs truncate max-w-[180px]">{s.criativo || '—'}</td>
                    <td className="py-2 px-3 text-center">{s.convertido ? <span className="text-emerald-400">✓</span> : <span className="text-gray-700">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {summary.scored.length > 300 && <p className="px-5 py-2 text-[10px] text-gray-400">Mostrando os 300 maiores scores de {summary.scored.length}.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
