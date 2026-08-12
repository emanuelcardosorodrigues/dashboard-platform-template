'use client'

import { useMemo, useState } from 'react'
import { X, Copy, Check } from 'lucide-react'
import type { CriativoCard } from '@/types/criativos'
import { mecanismoLabel, formatoLabel } from '@/lib/taxonomia-demo'

const brl = (v: number | null) =>
  v == null || !Number.isFinite(v) ? '—' : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(2)}%`)
const compact = (v: number | null) =>
  v == null || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v)

type Frame = { cat: string; url: string }
function parseFrames(raw: string | null): Frame[] {
  if (!raw) return []
  try {
    const a = JSON.parse(raw)
    return Array.isArray(a) ? a.filter((f): f is Frame => !!f && typeof f.url === 'string' && f.url.trim() !== '') : []
  } catch {
    return []
  }
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2 bg-surface">
      <div className="text-[10px] uppercase tracking-wide text-text-secondary">{label}</div>
      <div className="text-sm font-semibold text-text-primary tabular-nums">{value}</div>
    </div>
  )
}

function PillRow({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-text-secondary">{label}</span>
      {items.map((it, i) => (
        <span key={`${it}-${i}`} className="text-[11px] px-1.5 py-0.5 rounded bg-bg-base border border-border text-text-primary/80">
          {it}
        </span>
      ))}
    </div>
  )
}

/**
 * A-F3 — modal do anúncio (abre ao clicar no nome). Ordem pedida:
 * Preview → Investimento|Lucro, CPC|CTR, Hook|Hold, Conv.Clique|CPM → demais
 * métricas ocultas (revelam ao clicar) → Tags → Análise de copy | Transcrição.
 * Vídeo com play entra quando o mp4 estiver espelhado no bucket (A-F0/VPS).
 */
export function CriativoModal({ criativo, onClose }: { criativo: CriativoCard; onClose: () => void }) {
  const [showAll, setShowAll] = useState(false)
  const [tab, setTab] = useState<'analise' | 'transcricao'>('analise')
  const [copied, setCopied] = useState(false)
  const c = criativo
  const frames = useMemo(() => parseFrames(c.frames_path), [c.frames_path])
  // só toca vídeo do NOSSO bucket (a URL fbcdn expira — default-deny)
  const bucketVideo = !!c.video_url && c.video_url.includes('/object/public/criativos/')

  const hidden: { label: string; value: string }[] = [
    { label: 'CPA', value: brl(c.cpa) },
    { label: 'Custo/Checkout', value: brl(c.custo_por_checkout) },
    { label: 'Conv. Body', value: pct(c.conv_body) },
    { label: 'Comentários', value: String(c.comentarios ?? 0) },
    { label: 'Receita', value: brl(c.receita) },
    { label: 'ROAS', value: `${(c.roas ?? 0).toFixed(2)}x` },
    { label: 'ROAS Bruto', value: `${(c.roasBruto ?? 0).toFixed(2)}x` },
    { label: 'Vendas', value: String(c.vendas ?? 0) },
    { label: 'Impressões', value: compact(c.impressoes) },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border sticky top-0 bg-surface z-10">
          <h2 className="text-sm font-semibold text-text-primary truncate" title={c.ad_name || c.ad_id}>
            {c.ad_name || c.ad_id}
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(c.ad_id_canonico || c.ad_id)
                  .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
                  .catch(() => {})
              }}
              title={`Copiar ID do anúncio de maior lucro (${c.ad_id_canonico || c.ad_id})`}
              className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md border border-border text-text-secondary hover:text-text-primary"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />} Copiar ID
            </button>
            <button type="button" onClick={onClose} title="Fechar" className="p-1 rounded hover:bg-bg-base text-text-secondary">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* preview (thumbnail + frames; vídeo com play chega com o mp4 espelhado) */}
          <div className="rounded-lg overflow-hidden border border-border bg-bg-base/60">
            {bucketVideo ? (
              <video
                controls
                playsInline
                poster={c.thumbnail_url ?? undefined}
                src={c.video_url!}
                className="w-full max-h-72 bg-black"
              />
            ) : c.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.thumbnail_url} alt={c.ad_name} className="w-full max-h-72 object-contain bg-black" />
            ) : (
              <div className="h-40 flex items-center justify-center text-text-secondary text-sm">sem prévia</div>
            )}
            {frames.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto p-2">
                {frames.map((f, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={`${f.url}-${i}`} src={f.url} alt={f.cat} loading="lazy" className="shrink-0 w-16 h-16 rounded object-cover border border-border" />
                ))}
              </div>
            )}
          </div>

          {/* matriz 2 colunas na ordem pedida */}
          <div className="grid grid-cols-2 gap-px bg-border rounded-lg overflow-hidden border border-border">
            <Cell label="Investimento" value={brl(c.investimento)} />
            <Cell label="Lucro" value={brl(c.lucro)} />
            <Cell label="CPC" value={brl(c.cpc_link)} />
            <Cell label="CTR" value={pct(c.ctr)} />
            <Cell label="Hook Rate" value={pct(c.hook_rate)} />
            <Cell label="Hold Rate" value={pct(c.hold_rate)} />
            <Cell label="Conv. Clique" value={pct(c.conv_clique)} />
            <Cell label="CPM" value={brl(c.cpm)} />
            {showAll && hidden.map((m) => <Cell key={m.label} label={m.label} value={m.value} />)}
          </div>
          <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[12px] text-purple-300 hover:text-purple-200">
            {showAll ? 'Ocultar métricas' : 'Ver todas as métricas'}
          </button>

          {/* tags */}
          {(c.tags?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {c.tags!.map((t) => (
                <span
                  key={t.id}
                  title={`Tag ${t.namespace}: ${t.label}`}
                  className="text-[11px] px-2 py-0.5 rounded-full text-white border"
                  style={{ backgroundColor: (t.color ?? '#8b5cf6') + 'cc', borderColor: t.color ?? '#8b5cf6' }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          )}

          {/* Análise de copy | Transcrição (duas separadas) */}
          <div className="flex items-center gap-2 text-[12px] border-b border-border">
            <button
              type="button"
              onClick={() => setTab('analise')}
              className={`px-2 py-1 -mb-px border-b-2 ${tab === 'analise' ? 'border-purple-400 text-text-primary' : 'border-transparent text-text-secondary'}`}
            >
              Análise de copy
            </button>
            <button
              type="button"
              onClick={() => setTab('transcricao')}
              className={`px-2 py-1 -mb-px border-b-2 ${tab === 'transcricao' ? 'border-purple-400 text-text-primary' : 'border-transparent text-text-secondary'}`}
            >
              Transcrição
            </button>
          </div>
          {tab === 'analise' ? (
            <div className="space-y-2 text-[12px]">
              {c.resumo ? (
                <p className="text-text-primary/90 leading-relaxed border-l-2 border-purple-400/40 pl-2 italic">{c.resumo}</p>
              ) : (
                <p className="text-text-secondary">Sem resumo.</p>
              )}
              {c.hook_tipo && <PillRow label="Hook" items={c.hook_tipo.map(mecanismoLabel)} />}
              {c.angulo_copy && <PillRow label="Ângulo" items={c.angulo_copy} />}
              {c.formato_visual && <PillRow label="Formato" items={c.formato_visual.map(formatoLabel)} />}
              {c.cta && <PillRow label="CTA" items={c.cta} />}
            </div>
          ) : (
            <p className="text-[12px] text-text-primary/85 whitespace-pre-wrap leading-relaxed">{c.transcricao || 'Sem transcrição.'}</p>
          )}
        </div>
      </div>
    </div>
  )
}
