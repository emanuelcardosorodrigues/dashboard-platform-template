'use client'

import { clsx } from 'clsx'
import type { SbClarityDaily, ClarityRecorte } from '@/lib/supabase'
import { getClarityColor, SEMAFORO_CSS, SEMAFORO_BG, SEMAFORO_BORDER } from '@/lib/thresholds'
import { formatNumber, formatPercent } from '@/lib/formatters'

export const RECORTE_LABEL: Record<ClarityRecorte, string> = {
  total: '—',
  url: 'URL',
  device: 'Device',
  source: 'Source',
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/**
 * Nota de UX 0–10 (Fase 6): composto ponderado de frustração (rage/dead/quick-back/
 * erros) + engajamento + scroll. Quanto pior a experiência (mais fricção, menos
 * engajamento), menor a nota — correlaciona com queda de conversão e pressão no CPM.
 */
function uxScore(r: SbClarityDaily): number | null {
  const s = r.sessions ?? 0
  if (s <= 0) return null
  const pct = (v?: number | null) => ((v ?? 0) / s) * 100
  const ragePen = Math.min(1, pct(r.rage_clicks) / 5)
  const deadPen = Math.min(1, pct(r.dead_clicks) / 10)
  const qbPen = Math.min(1, pct(r.quick_backs) / 25)
  const errPen = Math.min(1, pct((r.script_errors ?? 0) + (r.error_clicks ?? 0)) / 10)
  const engGood = clamp01(((r.engagement_time_sec ?? 0) - 10) / 50)
  const scrollGood = clamp01(((r.scroll_depth_pct ?? 0) - 30) / 50)
  const good = 0.25 * engGood + 0.15 * scrollGood + 0.20 * (1 - ragePen) + 0.20 * (1 - deadPen) + 0.10 * (1 - qbPen) + 0.10 * (1 - errPen)
  return Math.round(clamp01(good) * 100) / 10
}

function uxColor(score: number): 'green' | 'yellow' | 'red' {
  return score >= 8 ? 'green' : score >= 5 ? 'yellow' : 'red'
}

/**
 * Diagnóstico de problema na HEAD/dobra da página. Combina os sinais reais de
 * "gente chega no topo e não engaja": scroll baixo (não rola além da dobra) +
 * quick-back alto (sai rápido) + dead-clicks (clica em algo que não responde no
 * topo) + erro de carregamento. NÃO é medição above-the-fold (o Clarity é agregado
 * por URL) — é inferência forte. Pra confirmar, cruzar com connect rate/Web Vitals.
 */
function headRisk(r: SbClarityDaily): { level: 'green' | 'yellow' | 'red'; reason: string } {
  const s = r.sessions ?? 0
  if (s <= 0) return { level: 'green', reason: 'sem sessões' }
  const scroll = r.scroll_depth_pct ?? 100
  const qbPct = ((r.quick_backs ?? 0) / s) * 100
  const deadPct = ((r.dead_clicks ?? 0) / s) * 100
  const errPct = (((r.script_errors ?? 0) + (r.error_clicks ?? 0)) / s) * 100
  const lowScroll = scroll < 40
  const highQb = qbPct >= 25
  const highDead = deadPct >= 10
  const loadErr = errPct >= 8
  const causas: string[] = []
  if (lowScroll) causas.push(`pouca gente rola além da dobra (scroll ${scroll.toFixed(0)}%)`)
  if (highQb) causas.push(`muitos saem rápido (quick-back ${qbPct.toFixed(0)}%)`)
  if (highDead) causas.push(`cliques sem resposta no topo (dead ${deadPct.toFixed(0)}%)`)
  if (loadErr) causas.push(`erros no carregamento (${errPct.toFixed(0)}%/sessão)`)
  // Vermelho: erro de carga, OU scroll baixo combinado com saída rápida/cliques mortos.
  if (loadErr || (lowScroll && (highQb || highDead))) {
    return { level: 'red', reason: `Provável problema na head/dobra: ${causas.join('; ')}.` }
  }
  if (causas.length > 0) return { level: 'yellow', reason: `Sinais a vigiar na head: ${causas.join('; ')}.` }
  return { level: 'green', reason: 'Topo da página segura a atenção (rola, fica, sem erro).' }
}

export function ClarityTable({ rows, recorte }: { rows: SbClarityDaily[]; recorte: ClarityRecorte }) {
  const dimensaoLabel = RECORTE_LABEL[recorte]

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase border-b border-[#1F2937]">
            <th className="py-2 pr-4">{dimensaoLabel}</th>
            <th className="py-2 pr-4 text-right" title="Nota de experiência 0–10 (engajamento, scroll, frustração, erros). Menor = pior UX, pressiona CPM e derruba conversão.">UX 0–10</th>
            <th className="py-2 pr-4 text-right">Sessions</th>
            <th className="py-2 pr-4 text-right">Pgs/Sess</th>
            <th className="py-2 pr-4 text-right">Scroll %</th>
            <th className="py-2 pr-4 text-right">Engaj. (s)</th>
            <th className="py-2 pr-4 text-right">Rage</th>
            <th className="py-2 pr-4 text-right">Dead</th>
            <th className="py-2 pr-4 text-right">Quick-back</th>
            <th className="py-2 pr-4 text-right">Erros</th>
            <th scope="col" className="py-2 pr-0 text-right" title="Problema na HEAD/dobra? Combina scroll baixo + saída rápida (quick-back) + cliques sem resposta no topo + erro de carregamento. Inferência (o Clarity é agregado por URL), não medição above-the-fold.">Head?</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const sessions = r.sessions ?? 0
            const ragePct = sessions > 0 ? ((r.rage_clicks ?? 0) / sessions) * 100 : 0
            const deadPct = sessions > 0 ? ((r.dead_clicks ?? 0) / sessions) * 100 : 0
            const qbPct = sessions > 0 ? ((r.quick_backs ?? 0) / sessions) * 100 : 0
            const erros = (r.script_errors ?? 0) + (r.error_clicks ?? 0)
            const score = uxScore(r)
            const head = headRisk(r)
            const key = `${r.data}|${r.dimensao_valor}|${idx}`

            return (
              <tr key={key} className="border-b border-[#1F2937] hover:bg-[#131c2e]">
                <td className="py-2 pr-4 text-gray-300 max-w-[260px] truncate" title={r.dimensao_valor}>
                  {r.dimensao_valor === '*' ? 'Todos' : r.dimensao_valor}
                </td>
                <td className="py-2 pr-4 text-right">
                  {score === null ? (
                    <span className="text-gray-400 tabular-nums">—</span>
                  ) : (
                    <span className={clsx('inline-block px-2 py-0.5 rounded-md tabular-nums font-bold border',
                      SEMAFORO_CSS[uxColor(score)], SEMAFORO_BG[uxColor(score)], SEMAFORO_BORDER[uxColor(score)])}>
                      {score.toFixed(1).replace('.', ',')}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4 text-right text-white tabular-nums">{formatNumber(sessions)}</td>
                <td className="py-2 pr-4 text-right text-gray-300 tabular-nums">
                  {r.pages_per_session != null ? formatNumber(r.pages_per_session, 2) : '—'}
                </td>
                <Semaforo metric="scroll_depth_pct" value={r.scroll_depth_pct} format={(v) => formatPercent(v, 1)} />
                <Semaforo metric="engagement_sec" value={r.engagement_time_sec} format={(v) => formatNumber(v, 1)} />
                <Semaforo metric="rage_clicks_pct" value={ragePct} format={(v) => formatPercent(v, 1)} />
                <Semaforo metric="dead_clicks_pct" value={deadPct} format={(v) => formatPercent(v, 1)} />
                <Semaforo metric="quick_back_pct" value={qbPct} format={(v) => formatPercent(v, 1)} />
                <td className="py-2 pr-4 text-right text-gray-300 tabular-nums">{formatNumber(erros)}</td>
                <td className="py-2 pr-0 text-right">
                  <span
                    className={clsx('inline-block px-2 py-0.5 rounded-md text-[11px] font-medium border cursor-help',
                      SEMAFORO_CSS[head.level], SEMAFORO_BG[head.level], SEMAFORO_BORDER[head.level])}
                    title={head.reason}
                  >
                    {head.level === 'red' ? 'head!' : head.level === 'yellow' ? 'vigiar' : 'ok'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Semaforo({
  metric,
  value,
  format,
}: {
  metric: 'scroll_depth_pct' | 'engagement_sec' | 'rage_clicks_pct' | 'dead_clicks_pct' | 'quick_back_pct'
  value: number | null
  format: (v: number) => string
}) {
  if (value == null) {
    return <td className="py-2 pr-4 text-right text-gray-400 tabular-nums">—</td>
  }
  const color = getClarityColor(metric, value)
  return (
    <td className="py-2 pr-4 text-right">
      <span
        className={clsx(
          'inline-block px-2 py-0.5 rounded-md tabular-nums font-medium border',
          SEMAFORO_CSS[color],
          SEMAFORO_BG[color],
          SEMAFORO_BORDER[color]
        )}
      >
        {format(value)}
      </span>
    </td>
  )
}

/**
 * Agrega rows do clarity_daily por chave de recorte, somando contadores
 * e tirando média ponderada por sessions para métricas percentuais.
 */
export function aggregateClarityRows(rows: SbClarityDaily[]): SbClarityDaily[] {
  if (!rows.length) return []
  const byKey = new Map<string, SbClarityDaily[]>()
  for (const r of rows) {
    const key = `${r.recorte}|${r.dimensao_valor}`
    const arr = byKey.get(key)
    if (arr) arr.push(r)
    else byKey.set(key, [r])
  }
  const out: SbClarityDaily[] = []
  for (const [, group] of byKey) {
    const sessions = group.reduce((s, r) => s + (r.sessions ?? 0), 0)
    const totalPageviews = group.reduce((s, r) => s + (r.total_pageviews ?? 0), 0)
    const deadClicks = group.reduce((s, r) => s + (r.dead_clicks ?? 0), 0)
    const rageClicks = group.reduce((s, r) => s + (r.rage_clicks ?? 0), 0)
    const quickBacks = group.reduce((s, r) => s + (r.quick_backs ?? 0), 0)
    const excessiveScroll = group.reduce((s, r) => s + (r.excessive_scroll ?? 0), 0)
    const scriptErrors = group.reduce((s, r) => s + (r.script_errors ?? 0), 0)
    const errorClicks = group.reduce((s, r) => s + (r.error_clicks ?? 0), 0)

    const weighted = (field: 'scroll_depth_pct' | 'engagement_time_sec' | 'pages_per_session') => {
      let num = 0
      let den = 0
      for (const r of group) {
        const v = r[field]
        const w = r.sessions ?? 0
        if (v != null && w > 0) {
          num += Number(v) * w
          den += w
        }
      }
      return den > 0 ? num / den : null
    }

    const first = group[0]
    out.push({
      data: first.data,
      recorte: first.recorte,
      dimensao_valor: first.dimensao_valor,
      sessions,
      pages_per_session: weighted('pages_per_session'),
      total_pageviews: totalPageviews,
      scroll_depth_pct: weighted('scroll_depth_pct'),
      engagement_time_sec: weighted('engagement_time_sec'),
      dead_clicks: deadClicks,
      rage_clicks: rageClicks,
      quick_backs: quickBacks,
      excessive_scroll: excessiveScroll,
      script_errors: scriptErrors,
      error_clicks: errorClicks,
      raw_json: null,
      synced_at: first.synced_at,
    })
  }
  return out.sort((a, b) => (b.sessions ?? 0) - (a.sessions ?? 0))
}
