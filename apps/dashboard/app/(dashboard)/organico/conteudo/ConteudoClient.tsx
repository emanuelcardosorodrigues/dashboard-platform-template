'use client'

/**
 * Grade da Análise de Conteúdo (mesma dinâmica da Análise de Criativos): pills de
 * plataforma + segmented de formato + ORDENAÇÃO por qualquer métrica + seletor de
 * MÉTRICAS (quais barras aparecem no card — comentários, shares, saves, etc., 1–4)
 * com padrão pré-selecionado persistido + Padrões Campeões.
 */
import { useEffect, useMemo, useState } from 'react'
import { Trophy, SlidersHorizontal } from 'lucide-react'
import OrganicPostCard, {
  type OrganicCardPost, type OrganicMetricKey,
  ORGANIC_BAR_OPTIONS, DEFAULT_ORGANIC_BARS, ORGANIC_SORT_OPTIONS, organicSortValue,
} from '@/components/organico/OrganicPostCard'

type PlataformaFiltro = 'todas' | 'youtube' | 'instagram' | 'tiktok'
type FormatoFiltro = 'todos' | 'curto' | 'longo'
type Ordenacao = OrganicMetricKey | 'recentes'

const CURTOS = new Set(['short', 'reel', 'feed', 'carousel'])
const ORDENAR_KEY = 'org-conteudo-ordenar'
const METRICAS_KEY = 'org-conteudo-metricas'

export default function ConteudoClient({ cards, campeoes }: {
  cards: OrganicCardPost[]
  campeoes: { total: number; cortes: Array<{ label: string; valor: string; pct: number }> } | null
}) {
  const [plataforma, setPlataforma] = useState<PlataformaFiltro>('todas')
  const [formato, setFormato] = useState<FormatoFiltro>('todos')
  const [ordenar, setOrdenar] = useState<Ordenacao>('score')
  const [metricas, setMetricas] = useState<OrganicMetricKey[]>(DEFAULT_ORGANIC_BARS)
  const [metricsOpen, setMetricsOpen] = useState(false)

  // Ordenação e métricas escolhidas viram o PADRÃO do usuário (persistido).
  useEffect(() => {
    try {
      const o = localStorage.getItem(ORDENAR_KEY)
      if (o && ORGANIC_SORT_OPTIONS.some((s) => s.key === o)) setOrdenar(o as Ordenacao)
      const m = localStorage.getItem(METRICAS_KEY)
      if (m) {
        const a = (JSON.parse(m) as OrganicMetricKey[]).filter((k) => ORGANIC_BAR_OPTIONS.some((x) => x.key === k))
        if (a.length) setMetricas(a)
      }
    } catch { /* ignore */ }
  }, [])
  function pickOrdenar(v: Ordenacao) {
    setOrdenar(v)
    try { localStorage.setItem(ORDENAR_KEY, v) } catch { /* ignore */ }
  }
  function toggleMetrica(k: OrganicMetricKey) {
    setMetricas((prev) => {
      const next = prev.includes(k) ? (prev.length > 1 ? prev.filter((m) => m !== k) : prev) : (prev.length < 4 ? [...prev, k] : prev)
      try { localStorage.setItem(METRICAS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const filtrados = useMemo(() => {
    let out = cards
    if (plataforma !== 'todas') out = out.filter((c) => c.platform === plataforma)
    if (formato === 'curto') out = out.filter((c) => CURTOS.has(c.format ?? ''))
    if (formato === 'longo') out = out.filter((c) => c.format === 'long' || c.format === 'live')
    if (ordenar === 'recentes') return [...out].sort((a, b) => b.published_at.localeCompare(a.published_at))
    return [...out].sort((a, b) => organicSortValue(b, ordenar) - organicSortValue(a, ordenar))
  }, [cards, plataforma, formato, ordenar])

  const pill = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs border transition-colors ${active
      ? 'bg-blue-600 border-blue-500 text-white'
      : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'}`

  return (
    <div className="space-y-4">
      {/* Padrões Campeões (composite ≥150 = acima de 1.5× a mediana) */}
      {campeoes && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
          <h3 className="text-sm font-semibold text-amber-300 flex items-center gap-2 mb-2">
            <Trophy size={14} /> Padrões Campeões — o que os {campeoes.total} melhores têm em comum
          </h3>
          <div className="flex flex-wrap gap-2">
            {campeoes.cortes.map((c) => (
              <span key={c.label} className="rounded-md border border-amber-500/20 bg-black/20 px-2.5 py-1 text-[11px] text-gray-300">
                <span className="text-gray-500">{c.label}:</span> <b className="text-amber-200">{c.valor}</b>
                <span className="text-gray-500"> ({c.pct}%)</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {(['todas', 'youtube', 'instagram', 'tiktok'] as const).map((p) => (
            <button key={p} onClick={() => setPlataforma(p)} className={pill(plataforma === p)}>
              {p === 'todas' ? 'Todas' : p === 'youtube' ? 'YouTube' : p === 'instagram' ? 'Instagram' : 'TikTok'}
            </button>
          ))}
        </div>
        <span className="text-gray-700">|</span>
        <div className="flex gap-1.5">
          {(['todos', 'curto', 'longo'] as const).map((f) => (
            <button key={f} onClick={() => setFormato(f)} className={pill(formato === f)}>
              {f === 'todos' ? 'Todos' : f === 'curto' ? 'Curto' : 'Longo'}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={ordenar}
            onChange={(e) => pickOrdenar(e.target.value as Ordenacao)}
            className="rounded-md bg-[#0B1120] border border-[#1F2937] px-2.5 py-1.5 text-xs text-gray-300 outline-none focus:border-blue-500"
          >
            {ORGANIC_SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>Ordenar: {o.label}</option>
            ))}
          </select>

          {/* Seletor de métricas (quais barras aparecem no card) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMetricsOpen((v) => !v)}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-[#1F2937] bg-[#0B1120] text-gray-400 hover:text-white"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" /> Métricas <span className="text-fuchsia-300">{metricas.length}</span>
            </button>
            {metricsOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMetricsOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-[#1F2937] bg-[#0B1120] shadow-xl p-1">
                  <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-gray-500">Barras do card</p>
                  {ORGANIC_BAR_OPTIONS.map((m) => {
                    const on = metricas.includes(m.key)
                    return (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => toggleMetrica(m.key)}
                        className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-left rounded hover:bg-white/[0.04]"
                      >
                        <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center ${on ? 'bg-fuchsia-500 border-fuchsia-500' : 'border-gray-600'}`}>
                          {on && <span className="text-[9px] text-white">✓</span>}
                        </span>
                        <span className={on ? 'text-gray-100' : 'text-gray-400'}>{m.label}</span>
                      </button>
                    )
                  })}
                  <p className="text-[9px] text-gray-600 px-2 pt-1">1–4 métricas</p>
                </div>
              </>
            )}
          </div>
          <span className="text-[11px] text-gray-600">{filtrados.length} conteúdos</span>
        </div>
      </div>

      {/* Grade */}
      {filtrados.length === 0 ? (
        <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-10 text-center text-sm text-gray-500">
          Nenhum conteúdo nesse recorte ainda — ajuste os filtros ou aguarde o próximo sync.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {filtrados.map((c) => <OrganicPostCard key={c.id} post={c} bars={metricas} />)}
        </div>
      )}

      <p className="text-[11px] text-gray-600">
        Comparação entre plataformas usa TAXAS (sobre views/alcance) e idade normalizada (views/dia).
        Outlier e Score são calculados contra a MEDIANA do grupo (plataforma+formato) — 100 = mediana, ≥150 = campeão.
      </p>
    </div>
  )
}
