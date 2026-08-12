'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Download, ChevronDown, Check, FileText, Video, Clock, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  computeMetrics, formatDuration, funilLabel, contaLabel,
  type RaioXReport, type RaioXWindow,
} from '@/lib/raioX'
import {
  formatCurrency, formatPercent, formatRoas, formatNumber, formatDateBR,
} from '@/lib/formatters'
import type { VturbPlayer } from '@/lib/vturb'

interface Props {
  report: RaioXReport
  players: VturbPlayer[]
  selectedPlayerIds: string[]
}

/** "mm:ss" / "hh:mm:ss" / número solto (minutos) → segundos. Vazio/inválido → null. */
function parsePitchToSeconds(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => Number(p))
    if (parts.some((n) => !Number.isInteger(n) || n < 0)) return null
    return parts.reduce((acc, n) => acc * 60 + n, 0)
  }
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 60) // número solto = minutos
}

export default function RaioXClient({ report, players, selectedPlayerIds }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const selectedSet = useMemo(() => new Set(selectedPlayerIds), [selectedPlayerIds])

  // Tempo do pitch — preenchido à mão (varia de VSL pra VSL). Vazio = auto vTurb.
  const [pitchInput, setPitchInput] = useState('')
  const pitchSeconds = useMemo(() => parsePitchToSeconds(pitchInput), [pitchInput])
  const pitchInvalid = pitchInput.trim() !== '' && pitchSeconds === null

  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  function applyPlayers(ids: string[]) {
    const params = new URLSearchParams(sp?.toString() ?? '')
    if (ids.length === 0) {
      params.delete('players')
    } else if (ids.length === players.length && players.length > 0) {
      params.set('players', 'all')
    } else {
      params.set('players', ids.join(','))
    }
    startTransition(() => router.push(`${pathname}?${params.toString()}`))
  }

  // Baixa via fetch+blob (em vez de navegar por <a href>): se a API falhar, um
  // <a href> navegaria pra fora do dashboard e mostraria o JSON de erro cru.
  // Com fetch dá pra checar res.ok e mostrar um aviso on-theme sem sair da página.
  async function downloadPdf() {
    setDownloadError(null)
    setIsDownloading(true)
    try {
      const params = new URLSearchParams()
      params.set('funil', report.funil)
      params.set('conta', report.conta)
      const arg = sp?.get('players') ?? ''
      if (arg) params.set('players', arg)
      if (pitchSeconds != null) params.set('pitch', String(pitchSeconds))

      const res = await fetch(`/api/raio-x/pdf?${params.toString()}`)
      if (!res.ok) {
        throw new Error('Não foi possível gerar o PDF agora. Tente novamente em instantes.')
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const filename = disposition.match(/filename="?([^"]+)"?/)?.[1] ?? 'raio-x-escala.pdf'

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'Não foi possível gerar o PDF agora. Tente novamente em instantes.')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <>
      {/* Toolbar */}
      <div className="glass-panel rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <FileText className="w-4 h-4 text-brand-blue" />
          <span>
            <span className="text-text-primary font-medium">{funilLabel(report.funil)}</span>
            {' · '}
            <span>{contaLabel(report.conta, report.contaRotulo)}</span>
            {' · '}
            <span>Gerado em {formatDateBR(report.geradoEmBR)}</span>
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {report.vturbAvailable && players.length > 0 ? (
            <MultiPlayerSelect
              players={players}
              selectedIds={selectedSet}
              onApply={applyPlayers}
              disabled={isPending}
            />
          ) : (
            <span className="text-xs text-text-secondary flex items-center gap-1">
              <Video className="w-3.5 h-3.5" />
              VSL indisponível
            </span>
          )}

          <label
            className="flex items-center gap-1.5 text-xs text-text-secondary"
            title="Momento do pitch na VSL. Varia de VSL pra VSL — preencha à mão (mm:ss). Vazio usa o valor da vTurb."
          >
            <Clock className="w-3.5 h-3.5 text-text-secondary" />
            <span className="hidden sm:inline">Tempo do pitch</span>
            <input
              type="text"
              inputMode="numeric"
              value={pitchInput}
              onChange={(e) => setPitchInput(e.target.value)}
              placeholder="mm:ss"
              aria-invalid={pitchInvalid}
              className={cn(
                'w-[80px] px-2 py-1.5 rounded-lg bg-surface border text-sm text-text-primary text-center tabular-nums placeholder:text-text-tertiary focus:outline-none transition-colors',
                pitchInvalid ? 'border-red-500/60' : 'border-border focus:border-brand-blue/50',
              )}
            />
          </label>

          <button
            onClick={downloadPdf}
            disabled={isDownloading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-blue hover:bg-brand-blue/90 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {isDownloading ? 'Gerando PDF...' : 'Baixar PDF'}
          </button>
        </div>
      </div>

      {downloadError && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{downloadError}</span>
        </div>
      )}

      {/* Preview das 3 janelas */}
      {report.windows.map((w) => (
        <WindowPreview key={w.key} window={w} pitchOverride={pitchSeconds} />
      ))}

      <div className="text-xs text-text-secondary text-center pt-4">
        Dados em UTC-3 (Brasília). Métricas Meta com imposto BR; vendas Hotmart; VSL via vTurb.
      </div>
    </>
  )
}

function WindowPreview({ window: w, pitchOverride }: { window: RaioXWindow; pitchOverride: number | null }) {
  const m = computeMetrics(w)
  const multi = w.vsl.playerCount > 1
  const noVsl = w.vsl.playerCount === 0
  const noVslData = !w.vsl.stats

  const pitchRow: [string, string] | [string, string, string] =
    pitchOverride != null
      ? ['Tempo do Pitch', formatDuration(pitchOverride), 'preenchido manualmente']
      : [multi ? 'Pitch Total (todos VSLs)' : 'Tempo do Pitch', noVsl ? '—' : formatDuration(m.tempoPitch)]

  return (
    <div className="elevated-card rounded-2xl p-6">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border pb-3 mb-4">
        <h2 className="text-xl font-semibold text-text-primary">{w.label}</h2>
        <span className="text-sm text-text-secondary">
          {formatDateBR(w.from)} — {formatDateBR(w.to)}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Métricas Gerais" rows={[
          ['Investimento', formatCurrency(m.investimento)],
          ['Faturamento', formatCurrency(m.faturamento)],
          ['Lucro', formatCurrency(m.lucro), 'após taxa Hotmart'],
          ['ROAS Bruto', formatRoas(m.roi)],
          ['ROAS Líquido', formatRoas(m.roasLiquido), 'após taxa Hotmart'],
          ['CPA', formatCurrency(m.cpa)],
          ['ARPU', formatCurrency(m.arpu), 'ticket médio FE'],
        ]} />

        <Section title="Tráfego" rows={[
          ['CPM', formatCurrency(m.cpm)],
          ['CTR', formatPercent(m.ctr, 2)],
          ['CPC', formatCurrency(m.cpc)],
          ['Connect Rate', formatPercent(m.connectRate, 1), 'LPV / cliques'],
          ['CPV', formatCurrency(m.cpv), 'custo por view da página'],
          ['CPI', formatCurrency(m.cpi), 'custo por início de checkout'],
          ['Conversão / Page View', formatPercent(m.convPagina, 2)],
        ]} />

        <Section title="VSL (Vídeo Sales Letter)" rows={[
          [multi ? 'Tempo Total (todos VSLs)' : 'Tempo da VSL', noVsl ? '—' : formatDuration(m.tempoVsl)],
          pitchRow,
          ['Play Rate', noVslData ? '—' : formatPercent(m.playRate, 1)],
        ]} />

        <Section title="Engajamento" rows={[
          ['Retenção ao Pitch', noVslData ? '—' : formatPercent(m.retencaoPitch, 1)],
          ['Cliques no Botão', noVslData ? '—' : formatNumber(m.cliquesBotao)],
          ['Conversões', noVslData ? '—' : formatNumber(m.conversoes)],
          ['Taxa de Conversão', noVslData ? '—' : formatPercent(m.taxaConversao, 2)],
          ['RPV (Revenue/View)', noVslData ? '—' : formatCurrency(m.rpv)],
        ]} />
      </div>

      <div className="mt-4 pt-3 border-t border-border text-xs text-text-secondary flex flex-wrap gap-x-4 gap-y-1 justify-center">
        <span>Impressões: <span className="text-text-primary tabular-nums">{formatNumber(w.summary.impressoes)}</span></span>
        <span>Cliques: <span className="text-text-primary tabular-nums">{formatNumber(w.summary.cliques)}</span></span>
        <span>LPV: <span className="text-text-primary tabular-nums">{formatNumber(w.summary.landingViews)}</span></span>
        <span>Checkouts: <span className="text-text-primary tabular-nums">{formatNumber(w.summary.checkouts)}</span></span>
        <span>Vendas FE: <span className="text-text-primary tabular-nums">{formatNumber(w.summary.vendasFront)}</span></span>
      </div>
    </div>
  )
}

function Section({ title, rows }: { title: string; rows: Array<[string, string] | [string, string, string]> }) {
  return (
    <div className="glass-panel rounded-xl p-4">
      <div className="text-[11px] font-semibold tracking-widest text-brand-blue mb-3 uppercase">{title}</div>
      <div className="space-y-2">
        {rows.map(([label, value, note], i) => (
          <div key={i} className="flex items-baseline justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-sm text-text-secondary">{label}</span>
              {note && <span className="text-[10px] text-text-secondary/70 italic">{note}</span>}
            </div>
            <span className="text-sm font-semibold text-text-primary tabular-nums">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MultiPlayerSelect({
  players, selectedIds, onApply, disabled,
}: {
  players: VturbPlayer[]
  selectedIds: Set<string>
  onApply: (ids: string[]) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Set<string>>(selectedIds)

  function openDropdown() {
    setDraft(new Set(selectedIds))
    setOpen(true)
  }
  function toggle(id: string) {
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function selectAll() { setDraft(new Set(players.map((p) => p.id))) }
  function clearAll() { setDraft(new Set()) }
  function apply() { onApply([...draft]); setOpen(false) }

  const label = (() => {
    if (selectedIds.size === 0) return 'Nenhuma VSL'
    if (selectedIds.size === 1) {
      const p = players.find((pl) => selectedIds.has(pl.id))
      return p?.name ?? '1 VSL'
    }
    if (selectedIds.size === players.length) return `Todas (${players.length})`
    return `${selectedIds.size} VSLs`
  })()

  return (
    <div className="relative">
      <button
        onClick={() => (open ? setOpen(false) : openDropdown())}
        disabled={disabled}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface border border-border hover:border-brand-blue/40 transition-colors text-sm text-text-primary disabled:opacity-50"
      >
        <Video className="w-3.5 h-3.5 text-text-secondary" />
        <span className="truncate max-w-[200px]">{label}</span>
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 w-[340px] bg-surface border border-border rounded-lg shadow-2xl z-20 flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border text-[11px]">
              <span className="text-text-secondary tabular-nums">{draft.size} de {players.length} selecionadas</span>
              <div className="flex gap-3">
                <button onClick={selectAll} className="text-brand-blue hover:underline">Todas</button>
                <button onClick={clearAll} className="text-text-secondary hover:underline">Limpar</button>
              </div>
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {players.map((p) => {
                const checked = draft.has(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors flex items-center gap-2',
                      checked && 'bg-brand-blue/10',
                    )}
                  >
                    <span className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                      checked ? 'bg-brand-blue border-brand-blue text-white' : 'border-border bg-transparent',
                    )}>
                      {checked && <Check className="w-3 h-3" strokeWidth={3} />}
                    </span>
                    <span className="truncate flex-1 text-text-primary">{p.name}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border">
              <button onClick={() => setOpen(false)} className="text-[12px] text-text-secondary hover:text-text-primary px-2 py-1">
                Cancelar
              </button>
              <button
                onClick={apply}
                className="text-[12px] px-3 py-1 rounded-md font-medium bg-brand-blue text-white hover:bg-brand-blue/90 transition-colors"
              >
                Aplicar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
