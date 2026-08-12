'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import {
  Plus,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FlaskConical,
  Play,
  Pause,
  X,
  Trash2,
  Link2,
  ShoppingCart,
  Tag,
  Calendar,
  Clock,
  Archive,
  HelpCircle,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Pencil,
  LayoutGrid,
  Activity,
  Sparkles,
  Bot,
  ShieldCheck,
  Scale,
  History,
} from 'lucide-react'
import type { SbExperiment } from '@/lib/supabase'
import type { OrphanBucket } from '@/lib/abAttribution'
import { validatePageVariant, findDuplicateSlug } from '@/lib/experimentValidation'
import { zTest, requiredSampleSize, sequentialPocock } from '@/lib/stats'
import { connectRateDisplay, CONNECT_RATE_MIN_CLICKS } from '@/lib/experimentPassthrough'
import { formatCurrency, formatDateBR } from '@/lib/formatters'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'

// Domínio base das URLs de entrada do Worker A/B.
// Configure NEXT_PUBLIC_ENTRY_BASE no .env.local (ex: seudominio.com.br/r).
const ENTRY_BASE = (process.env.NEXT_PUBLIC_ENTRY_BASE ?? 'seudominio.com.br/r').trim()

interface VariantStat {
  name: string
  slug: string
  url?: string
  weight: number
  impressions: number
  conversions: number
  receita: number
  desde?: string | null    // 1ª impressão da variante ("rodando desde"). null = ainda sem tráfego.
  checkoutViews?: number   // quem viu esta variante e clicou pro checkout
  // 'ab'/'uid' = interseção de uid (exato); 'hits' = cid do GA ÷ usuários GA4 (aprox., ~GA)
  checkoutFonte?: 'ab' | 'uid' | 'hits' | null
  checkoutDenom?: number   // denominador na MESMA identidade do numerador (uids do A/B ou usuários GA4)
  uniqueVisitors?: number  // UIDs únicos que viram esta variante (views do beacon)
  routeClicks?: number     // UIDs distintos que o 302 roteou (cliques no anúncio)
  connectLanded?: number   // dos roteados, quantos o beacon confirmou na página (interseção)
  connectRate?: number | null  // landed ÷ roteados — performance da página no salto
}

interface ExperimentStats {
  variants: VariantStat[]
  totalImpressions: number
}

interface Props {
  experiments: SbExperiment[]
  statsMap: Record<string, ExperimentStats>
  orphanSales?: { sck_slug: string; count: number; receita: number }[]
  inactiveSlugs?: OrphanBucket[]
  neverTestedSlugs?: OrphanBucket[]
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ativo',
  paused: 'Pausado',
  ended: 'Encerrado',
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400',
  active: 'bg-emerald-500/20 text-emerald-400',
  paused: 'bg-yellow-500/20 text-yellow-400',
  ended: 'bg-red-500/20 text-red-400',
}

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  page: { label: 'página', cls: 'bg-cyan-500/15 text-cyan-400' },
  checkout: { label: 'checkout', cls: 'bg-violet-500/15 text-violet-400' },
  ob: { label: 'order bump', cls: 'bg-amber-500/15 text-amber-400' },
}

const VARIANT_COLORS = ['text-cyan-400', 'text-violet-400', 'text-amber-400', 'text-rose-400', 'text-emerald-400', 'text-sky-400']
const VARIANT_BAR_COLORS = ['bg-cyan-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-emerald-500', 'bg-sky-500']

function fmt(n: number) {
  return n.toLocaleString('pt-BR')
}

function fmtBRL(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function fmtPct(n: number) {
  return n.toFixed(2).replace('.', ',') + '%'
}

// Connect rate = views ÷ clicks. ≥90% é o alvo (mesma régua do Meta); <75% é página
// perdendo gente no salto (lenta / desistência). Cinza = ainda sem cliques na janela.
function connectRateColor(rate: number | null | undefined): string {
  if (rate == null) return 'text-gray-500'
  if (rate >= 90) return 'text-emerald-400'
  if (rate >= 75) return 'text-amber-400'
  return 'text-rose-400'
}

/** dd/mm — formato curto ao lado do id da variante (ex: "lps-pv01 08/07"). */
function ddmm(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
  })
}

/** Uma linha da lista de métricas: rótulo à esquerda, valor à direita. */
function MetricRow({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5" title={title}>
      <span className="text-[10px] text-gray-500">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  )
}

// ── Novo Experimento Modal ────────────────────────────────────────────────────

interface VariantDraft {
  // Identidade ESTÁVEL da linha no editor (não deriva do índice/tamanho do
  // array). Vem de um contador monotônico (useRef) que nunca reusa um valor,
  // mesmo depois de remover variantes — evita key duplicada em VariantEditor
  // quando "Adicionar" roda depois de uma remoção. Nunca é enviado ao backend.
  id: number
  name: string
  slug: string
  url: string   // vazio para type=ob
  weight: number
  enabled?: boolean   // ausente = ativa. false = desativada (fora do sorteio, histórico preservado)
}

// Teto prático de variantes por experimento. O backend (Zod/API/Worker) aceita
// ilimitado; este número só evita que a UI vire sopa de letrinhas. Subir aqui é
// suficiente — variantName() já gera nomes além de Z (AA, AB...).
const MAX_VARIANTS = 26

// Nome da variante por índice: A..Z, depois AA, AB... (estilo coluna de planilha).
// Substitui o antigo array fixo de 6 nomes pra suportar "quantas eu quiser".
function variantName(i: number): string {
  let n = i
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

function buildDefaultVariants(): VariantDraft[] {
  return [
    { id: 0, name: 'A', slug: '', url: '', weight: 0.5 },
    { id: 1, name: 'B', slug: '', url: '', weight: 0.5 },
  ]
}

type ExpType = 'page' | 'checkout' | 'ob'

const TYPE_CONFIG: Record<ExpType, {
  label: string
  icon: React.ReactNode
  entryPrefix: string
  entryPlaceholder: string
  slugLabel: string
  slugPlaceholder: string
  urlLabel: string | null
  urlPlaceholder: string
  hint: string
}> = {
  page: {
    label: 'Página',
    icon: <FlaskConical size={12} />,
    entryPrefix: '/',
    entryPlaceholder: 'col',
    slugLabel: 'ID da variante (sck[0])',
    slugPlaceholder: 'col-pv02',
    urlLabel: 'URL de destino',
    urlPlaceholder: 'https://seudominio.com.br/variante-a/',
    hint: 'Testa qual versão da página converte mais.',
  },
  checkout: {
    label: 'Checkout',
    icon: <ShoppingCart size={12} />,
    entryPrefix: '/check/',
    entryPlaceholder: 'col',
    slugLabel: 'ID de checkout',
    slugPlaceholder: 'ck-v1',
    urlLabel: 'URL Hotmart',
    urlPlaceholder: 'https://pay.hotmart.com/PRODUTO?off=OFERTA',
    hint: `Testa ofertas diferentes no checkout. Link: ${ENTRY_BASE}/check/{id}`,
  },
  ob: {
    label: 'Order Bump',
    icon: <Tag size={12} />,
    entryPrefix: '/',
    entryPlaceholder: 'col',
    slugLabel: 'ID do order bump',
    slugPlaceholder: 'ob1',
    urlLabel: null,
    urlPlaceholder: '',
    hint: 'Testa quais order bumps aparecem no checkout. Sem URL — controlado pelo Hotmart.',
  },
}

function universalLink(exp: SbExperiment): string {
  if (exp.type === 'checkout') {
    return `${ENTRY_BASE}/check/${exp.entry_path.slice(1)}`
  }
  return `${ENTRY_BASE}${exp.entry_path}`
}

// ── Editor de variantes (compartilhado entre criar e editar) ──────────────────

const round2 = (n: number) => Math.round(n * 100) / 100

// Input de peso decimal com 2 casas, em pt-BR (vírgula). Mantém um rascunho de
// texto enquanto focado pra você conseguir digitar "33,35" sem o controle
// reescrever no meio; ao desfocar mostra o valor normalizado do estado.
function WeightInput({ pct, disabled, onChange }: {
  pct: number
  disabled?: boolean
  onChange: (pct: number) => void
}) {
  const [draft, setDraft] = useState<string>('')
  const [focused, setFocused] = useState(false)
  const formatted = round2(pct).toString().replace('.', ',')
  return (
    <input
      type="text"
      inputMode="decimal"
      disabled={disabled}
      value={focused ? draft : formatted}
      onFocus={() => { setDraft(formatted); setFocused(true) }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const s = e.target.value.replace(/[^0-9.,]/g, '')
        setDraft(s)
        const n = parseFloat(s.replace(',', '.'))
        if (!isNaN(n)) onChange(Math.min(100, Math.max(0, n)))
      }}
      className={clsx(
        'w-20 bg-[#0D1117] border border-[#1F2937] rounded-lg px-2.5 py-1.5 text-xs text-white text-right focus:outline-none focus:border-cyan-500/50',
        disabled && 'opacity-40 cursor-not-allowed'
      )}
    />
  )
}

function VariantEditor({ variants, setVariants, type, editableSlug, onAdd, onRemove, lockedSlugs, statsBySlug }: {
  variants: VariantDraft[]
  setVariants: React.Dispatch<React.SetStateAction<VariantDraft[]>>
  type: ExpType
  editableSlug: boolean
  onAdd?: () => void
  onRemove?: (idx: number) => void
  // Slugs de variantes que já existiam (experimento ativo): ficam travados pra
  // não quebrar a atribuição histórica. Variantes novas (slug fora deste set)
  // permanecem com slug editável e removível, mesmo com editableSlug=false.
  lockedSlugs?: Set<string>
  // Histórico por variante (slug → métricas). Quando presente (modo edição),
  // mostra um resumo inline por variante pra embasar editar/excluir/desativar.
  statsBySlug?: Map<string, VariantStat>
}) {
  const cfg = TYPE_CONFIG[type]
  const enabledCount = variants.filter((v) => v.enabled !== false).length
  const enabledSum = variants.reduce((s, v) => (v.enabled !== false ? s + v.weight : s), 0)
  // Na EDIÇÃO (recebe lockedSlugs) dá pra podar até 1 variante e excluir
  // qualquer uma, inclusive as antigas. Na CRIAÇÃO mantém o piso de 2 (é um teste).
  const minKeep = lockedSlugs ? 1 : 2

  // % efetivo do tráfego = peso da variante normalizado entre as ATIVAS.
  function effectivePct(v: VariantDraft): number {
    if (v.enabled === false || enabledSum <= 0) return 0
    return (v.weight / enabledSum) * 100
  }
  function setWeightPct(idx: number, pct: number) {
    setVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, weight: pct / 100 } : v)))
  }
  function setField(idx: number, field: 'slug' | 'url', value: string) {
    setVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, [field]: value } : v)))
  }
  function toggleEnabled(idx: number) {
    setVariants((prev) => {
      const turningOff = prev[idx].enabled !== false
      // Trava: nunca deixar zero variantes ativas.
      if (turningOff && enabledCount <= 1) return prev
      return prev.map((v, i) => (i === idx ? { ...v, enabled: !turningOff } : v))
    })
  }
  // Iguala SÓ as ativas (33,34/33,33/33,33 trata o resto), desativadas ficam fora.
  function equalize() {
    const enabledIdxs = variants.map((v, i) => (v.enabled !== false ? i : -1)).filter((i) => i >= 0)
    if (enabledIdxs.length === 0) return
    const each = Math.floor((100 / enabledIdxs.length) * 100) / 100
    const remainder = round2(100 - each * enabledIdxs.length)
    setVariants((prev) => prev.map((v, i) => {
      if (v.enabled === false) return v
      const pct = i === enabledIdxs[0] ? round2(each + remainder) : each
      return { ...v, weight: pct / 100 }
    }))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs text-gray-400 font-medium">Variantes</label>
        <div className="flex items-center gap-3">
          <button type="button" onClick={equalize} className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer transition-colors">
            <Scale size={12} /> Igualar ativas
          </button>
          {onAdd && variants.length < MAX_VARIANTS && (
            <button type="button" onClick={onAdd} className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer transition-colors">
              <Plus size={12} /> Adicionar
            </button>
          )}
        </div>
      </div>

      {variants.map((v, idx) => {
        const off = v.enabled === false
        // Variante "travada" = já existia no experimento ativo. Slug read-only e
        // sem botão de remover (preserva histórico). Variantes novas: editáveis.
        const slugLocked = !!lockedSlugs && !!v.slug && lockedSlugs.has(v.slug)
        return (
          <div key={v.id} className={clsx('bg-[#111827] border rounded-xl p-4 space-y-3', off ? 'border-[#1F2937]/60 opacity-60' : 'border-[#1F2937]')}>
            <div className="flex items-center justify-between gap-2">
              <span className={clsx('text-xs font-bold', VARIANT_COLORS[idx % VARIANT_COLORS.length])}>Variante {v.name}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleEnabled(idx)}
                  disabled={!off && enabledCount <= 1}
                  className={clsx(
                    'text-[10px] font-medium px-2 py-0.5 rounded-full cursor-pointer transition-colors',
                    off ? 'bg-gray-500/20 text-gray-400 hover:bg-gray-500/30' : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30',
                    !off && enabledCount <= 1 && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {off ? 'desativada' : 'ativa'}
                </button>
                {onRemove && variants.length > minKeep && (
                  <button type="button" onClick={() => onRemove(idx)} title="Excluir variante" aria-label="Excluir variante" className="text-gray-400 hover:text-red-400 transition-colors cursor-pointer">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>

            {(editableSlug || !slugLocked) ? (
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500">{cfg.slugLabel}</label>
                <input
                  value={v.slug}
                  onChange={(e) => setField(idx, 'slug', e.target.value.replace(/[^a-zA-Z0-9-]/g, ''))}
                  placeholder={cfg.slugPlaceholder}
                  className="w-full bg-[#0D1117] border border-[#1F2937] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-700 font-mono focus:outline-none focus:border-cyan-500/50"
                />
              </div>
            ) : (
              <div className="flex justify-end">
                <span className="text-[10px] font-mono text-gray-400 bg-[#0D1117] px-1.5 py-0.5 rounded">{v.slug}</span>
              </div>
            )}

            {statsBySlug && (() => {
              const st = statsBySlug.get(v.slug)
              if (!st) return <p className="text-[10px] text-gray-600 italic">Variante nova — sem histórico ainda.</p>
              const cvr = st.impressions > 0 ? (st.conversions / st.impressions) * 100 : 0
              return (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-400 bg-[#0D1117]/70 border border-[#1F2937] rounded-lg px-2.5 py-1.5">
                  <span title="Visualizações">👁 <span className="text-gray-200 font-medium">{fmt(st.impressions)}</span> views</span>
                  <span title="Conversões (vendas front-end)">🛒 <span className="text-gray-200 font-medium">{fmt(st.conversions)}</span> vendas</span>
                  <span title="Taxa de conversão = vendas ÷ views">conv <span className="text-gray-200 font-medium">{fmtPct(cvr)}</span></span>
                  <span title="Receita atribuída a esta variante" className="ml-auto text-emerald-400/90 font-medium">{fmtBRL(st.receita)}</span>
                </div>
              )
            })()}

            <div className="space-y-1">
              <label className="text-[10px] text-gray-500">Peso (%)</label>
              <div className="flex items-center gap-2">
                <WeightInput pct={v.weight * 100} disabled={off} onChange={(pct) => setWeightPct(idx, pct)} />
                <span className="text-[10px] text-gray-500">
                  {off ? '— fora do sorteio' : `→ ${fmtPct(effectivePct(v))} do tráfego`}
                </span>
              </div>
            </div>

            {cfg.urlLabel && (
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500">{cfg.urlLabel}</label>
                <input
                  value={v.url}
                  onChange={(e) => setField(idx, 'url', e.target.value)}
                  onBlur={editableSlug ? (e) => setField(idx, 'url', e.target.value.trim()) : undefined}
                  placeholder={cfg.urlPlaceholder}
                  className={clsx(
                    'w-full bg-[#0D1117] border rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-700 font-mono focus:outline-none focus:border-cyan-500/50',
                    v.url && !isHttpsUrl(v.url) ? 'border-red-500/50' : 'border-[#1F2937]'
                  )}
                />
              </div>
            )}
          </div>
        )
      })}

      <p className="text-[10px] text-gray-500">
        {enabledCount} ativa{enabledCount === 1 ? '' : 's'} · soma dos pesos ativos: {fmtPct(enabledSum * 100)}
        {Math.abs(enabledSum - 1) > 0.001 && (
          <span className="text-yellow-500"> — o sistema normaliza pra 100%, mas pra % literais deixe a soma em 100%.</span>
        )}
      </p>
    </div>
  )
}

// ── Admin Gate Modal ──────────────────────────────────────────────────────────

function AdminGateModal({
  label,
  onConfirm,
  onClose,
}: {
  label: string
  onConfirm: (pwd: string) => void
  onClose: () => void
}) {
  const [pwd, setPwd] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#0D1117] border border-[#1F2937] rounded-2xl w-full max-w-sm mx-4 overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1F2937]">
          <span className="text-sm font-semibold text-white">Confirmar operação</span>
          <button onClick={onClose} title="Fechar" aria-label="Fechar" className="text-gray-500 hover:text-white transition-colors cursor-pointer"><X size={14} /></button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <p className="text-xs text-gray-400">{label}</p>
          <input
            type="password"
            autoFocus
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && pwd) onConfirm(pwd) }}
            placeholder="Senha de admin"
            className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
          />
          <button
            onClick={() => pwd && onConfirm(pwd)}
            disabled={!pwd}
            className={clsx(
              'w-full rounded-xl py-2 text-sm font-medium transition-all cursor-pointer',
              pwd ? 'bg-cyan-500 text-black hover:bg-cyan-400' : 'bg-cyan-500/20 text-cyan-500/50 cursor-not-allowed'
            )}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

function isValidUrl(s: string): boolean {
  try { new URL(s); return true } catch { return false }
}

function isHttpsUrl(s: string): boolean {
  try { const u = new URL(s); return u.protocol === 'https:' } catch { return false }
}

// ── Manual de Experimentos ────────────────────────────────────────────────────

type ManualTab = 'page' | 'checkout' | 'ob' | 'vturb' | 'edit'

function ManualModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<ManualTab>('page')

  const tabs: { id: ManualTab; label: string; icon: React.ReactNode; color: string; active: string }[] = [
    { id: 'page',     label: 'Página',        icon: <FlaskConical size={12} />, color: 'text-cyan-400',    active: 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400' },
    { id: 'checkout', label: 'Checkout',       icon: <ShoppingCart size={12} />, color: 'text-violet-400',  active: 'bg-violet-500/15 border-violet-500/40 text-violet-400' },
    { id: 'ob',       label: 'Order Bump',    icon: <Tag size={12} />,          color: 'text-amber-400',   active: 'bg-amber-500/15 border-amber-500/40 text-amber-400' },
    { id: 'vturb',    label: 'VTURB',         icon: <Link2 size={12} />,        color: 'text-emerald-400', active: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400' },
    { id: 'edit',     label: 'Editar teste',  icon: <Pencil size={12} />,       color: 'text-rose-400',    active: 'bg-rose-500/15 border-rose-500/40 text-rose-400' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#0D1117] border border-[#1F2937] rounded-2xl w-full max-w-2xl mx-4 shadow-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1F2937] shrink-0">
          <div className="flex items-center gap-2">
            <HelpCircle size={16} className="text-cyan-400" />
            <span className="text-sm font-semibold text-white">Manual de Configuração — A/B Testing</span>
          </div>
          <button onClick={onClose} title="Fechar manual" aria-label="Fechar manual" className="text-gray-500 hover:text-white transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>

        {/* Tab selector */}
        <div className="px-6 pt-4 shrink-0">
          <div className="grid grid-cols-5 gap-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={clsx(
                  'flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer border',
                  tab === t.id
                    ? t.active
                    : 'bg-[#111827] border-[#1F2937] text-gray-500 hover:text-gray-300'
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto px-6 py-4 space-y-3 flex-1">
          {tab === 'page' && <ManualPage />}
          {tab === 'checkout' && <ManualCheckout />}
          {tab === 'ob' && <ManualOB />}
          {tab === 'vturb' && <ManualVTURB />}
          {tab === 'edit' && <ManualEdit />}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#1F2937] shrink-0">
          <button
            onClick={onClose}
            className="w-full bg-cyan-500 hover:bg-cyan-400 text-black text-sm font-semibold rounded-xl py-2.5 transition-colors cursor-pointer"
          >
            Entendi — fechar manual
          </button>
        </div>
      </div>
    </div>
  )
}

function StepBlock({ num, title, color, border, bg, items, note }: {
  num: number; title: string; color: string; border: string; bg: string
  items: string[]; note?: string | null
}) {
  return (
    <div className={clsx('border rounded-xl overflow-hidden', border)}>
      <div className={clsx('flex items-center gap-2.5 px-4 py-3', bg)}>
        <span className={clsx('text-xs font-bold w-5 h-5 rounded-full border flex items-center justify-center shrink-0', color, border)}>
          {num}
        </span>
        <span className={clsx('text-sm font-semibold', color)}>{title}</span>
      </div>
      <div className="px-4 py-3 space-y-1.5 bg-[#0D1117]">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <ArrowRight size={11} className="text-gray-400 shrink-0 mt-0.5" />
            <p className="text-xs text-gray-300 leading-relaxed">{item}</p>
          </div>
        ))}
        {note && (
          <div className="mt-2 flex items-start gap-2 bg-[#111827] rounded-lg px-3 py-2">
            <CheckCircle2 size={11} className="text-gray-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-gray-500 leading-relaxed">{note}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ManualPage() {
  return (
    <div className="space-y-3">
      <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl px-4 py-3 flex gap-3">
        <AlertCircle size={15} className="text-cyan-400 shrink-0 mt-0.5" />
        <p className="text-xs text-cyan-300 leading-relaxed">
          O teste de página é o mais simples. Ele sorteia qual versão da sua landing page o visitante vai ver. <strong>Pode ser usado sozinho</strong>, sem checkout ou order bump ativos.
        </p>
      </div>

      <StepBlock num={1} title="Crie o experimento de Página"
        color="text-cyan-400" border="border-cyan-500/30" bg="bg-cyan-500/10"
        items={[
          'Clique em "Novo experimento" → selecione Página',
          'Slug de entrada: identificador livre (ex: col-vsl, mentoria-vsl)',
          'Cada variante = uma versão diferente da sua LP (URL completa)',
          'Slug da variante: ex col-pv01, col-pv02 (sem underline)',
          'URL: endereço completo da página (https://seudominio.com.br/variante-a/)',
          'URL de fallback: página que abre se o teste estiver pausado',
          'Defina o peso de cada variante (padrão: 50/50)',
          'Publique como ativo',
        ]}
        note={null}
      />

      <StepBlock num={2} title="Configure o anúncio para apontar para o Worker"
        color="text-cyan-400" border="border-cyan-500/30" bg="bg-cyan-500/10"
        items={[
          `O link do anúncio deve ser: ${ENTRY_BASE}/SEU-SLUG`,
          `Ex: ${ENTRY_BASE}/seu-slug`,
          'NUNCA aponte o anúncio direto para a LP — sempre pelo Worker',
          'O Worker redireciona o visitante para a variante sorteada automaticamente',
        ]}
        note="O visitante não vê a URL do Worker — ele cai diretamente na LP sorteada."
      />

      <StepBlock num={3} title="Verifique o chtml no GTM da página"
        color="text-cyan-400" border="border-cyan-500/30" bg="bg-cyan-500/10"
        items={[
          'O chtml lê a URL da página e salva o slug no cookie cookiePageSlug',
          'Esse slug é usado para atribuir as vendas à variante correta no relatório',
          'Se não tiver o chtml, o dashboard não consegue vincular vendas às variantes',
          'Peça ao desenvolvedor para verificar se o chtml está instalado e ativo',
        ]}
        note={null}
      />

      <StepBlock num={4} title="(Opcional) Vincular ao teste de checkout"
        color="text-violet-400" border="border-violet-500/30" bg="bg-violet-500/10"
        items={[
          'Se o slug da página for diferente do slug do checkout, use este campo',
          'Exemplo: página em /col-vsl mas checkout em /col — selecione o checkout /col',
          'Quando vinculado, o Worker injeta ?ck= e ?ob= na URL da LP ao redirecionar',
          'Assim o visitante já chega na LP com o sorteio definido — zero overhead extra',
          'Sem vínculo: o checkout sorteia independentemente quando o usuário clica em comprar',
        ]}
        note="Use o campo 'Vincular ao teste de checkout' no formulário de criação ou edição da página."
      />

      <StepBlock num={5} title="Teste e valide"
        color="text-emerald-400" border="border-emerald-500/30" bg="bg-emerald-500/10"
        items={[
          `Abra uma aba anônima → acesse ${ENTRY_BASE}/SEU-SLUG`,
          'Você deve cair em uma das variantes',
          'Feche e abra outra aba anônima para ter chance de cair na outra variante',
          'Cada sessão nova tem probabilidade igual de cair em qualquer variante',
          'No mesmo navegador sem limpar cookies, você SEMPRE cai na mesma variante',
        ]}
        note={null}
      />
    </div>
  )
}

function ManualCheckout() {
  return (
    <div className="space-y-3">
      <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-3 flex gap-3">
        <AlertCircle size={15} className="text-violet-400 shrink-0 mt-0.5" />
        <p className="text-xs text-violet-300 leading-relaxed">
          O teste de checkout sorteia qual oferta da Hotmart o visitante vê ao clicar no botão. <strong>Funciona independente do teste de página.</strong> O slug do checkout NÃO precisa ser igual ao da página.
        </p>
      </div>

      <StepBlock num={1} title="Crie o experimento de Checkout"
        color="text-violet-400" border="border-violet-500/30" bg="bg-violet-500/10"
        items={[
          'Clique em "Novo experimento" → selecione Checkout',
          'Slug de entrada: identificador do funil (ex: col, mentoria)',
          'Cada variante = uma oferta diferente na Hotmart (preço, desconto, prazo...)',
          'ID de checkout: ex ck-v1, ck-v2 (somente letras, números e hífen)',
          'URL Hotmart: link de pagamento da oferta (https://pay.hotmart.com/...?off=...)',
          'URL de fallback: link de pagamento padrão se o teste estiver pausado',
          'Publique como ativo',
        ]}
        note={null}
      />

      <StepBlock num={2} title="Configure o botão da Landing Page"
        color="text-violet-400" border="border-violet-500/30" bg="bg-violet-500/10"
        items={[
          `O link do botão de compra deve apontar para: ${ENTRY_BASE}/check/SEU-SLUG`,
          `Ex: ${ENTRY_BASE}/check/seu-slug`,
          'O Worker sorteia a variante e redireciona para a URL da Hotmart automaticamente',
          'Se o visitante já passou pela página com ?ck= na URL, o Worker respeita esse sorteio',
        ]}
        note="Use o mesmo slug para Checkout e Order Bump se quiser usar a Matriz de Links."
      />

      <StepBlock num={3} title="Teste e valide"
        color="text-emerald-400" border="border-emerald-500/30" bg="bg-emerald-500/10"
        items={[
          `Abra uma aba anônima → acesse ${ENTRY_BASE}/check/SEU-SLUG`,
          'Você deve cair em uma das URLs da Hotmart',
          'Feche e abra outra aba anônima para ter chance de cair na outra variante',
          'Cada sessão nova tem probabilidade igual de cair em qualquer variante',
        ]}
        note={null}
      />
    </div>
  )
}

function ManualOB() {
  return (
    <div className="space-y-3">
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 flex gap-3">
        <AlertCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300 leading-relaxed">
          O teste de Order Bump <strong>depende de um Checkout ativo com o mesmo slug</strong>. Sem isso, a Matriz de Links não aparece e o teste não funciona corretamente.
        </p>
      </div>

      <StepBlock num={1} title="Pré-requisito: Checkout ativo com o mesmo slug"
        color="text-violet-400" border="border-violet-500/30" bg="bg-violet-500/10"
        items={[
          'Confirme que já existe um experimento de Checkout ativo',
          'Anote o slug de entrada do Checkout (ex: col)',
          'O OB usará EXATAMENTE esse mesmo slug',
        ]}
        note={null}
      />

      <StepBlock num={2} title="Crie as ofertas na Hotmart com os Order Bumps"
        color="text-amber-400" border="border-amber-500/30" bg="bg-amber-500/10"
        items={[
          'No painel da Hotmart, vá em Ofertas do produto',
          'Para cada combinação de preço × bump, crie uma oferta separada',
          'Ex: 2 checkouts × 2 bumps = 4 ofertas na Hotmart',
          'Copie o link de pagamento de cada oferta — você colará na Matriz',
          'Dica: anote em uma planilha qual link corresponde a cada combinação',
        ]}
        note="2 ck × 2 ob = 4 links | 2 ck × 3 ob = 6 links | 3 ck × 2 ob = 6 links"
      />

      <StepBlock num={3} title="Crie o experimento de Order Bump"
        color="text-amber-400" border="border-amber-500/30" bg="bg-amber-500/10"
        items={[
          'Clique em "Novo experimento" → selecione Order Bump',
          'Slug de entrada: EXATAMENTE o mesmo que o Checkout (ex: col)',
          'Adicione as variantes de bump: cada variante = um tipo de order bump diferente',
          'ID do OB: ex ob1, ob2 (somente letras, números e hífen — sem underline)',
          'A Matriz de Links aparece automaticamente abaixo das variantes',
          'Preencha cada célula com o link da Hotmart correspondente à combinação',
          'Publique como ativo',
        ]}
        note="Se a Matriz mostrar só 'Padrão', o slug do OB está diferente do slug do Checkout."
      />

      <div className="bg-[#111827] border border-[#1F2937] rounded-xl px-4 py-3 space-y-2">
        <p className="text-xs font-semibold text-white">Como preencher a Matriz de Links</p>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          Cada célula responde: <em className="text-gray-300">"Se o usuário sortear o Checkout X e o OB Y, qual link da Hotmart ele abre?"</em>
        </p>
        <div className="overflow-x-auto">
          <table className="text-[10px] w-full border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="text-left text-gray-400 font-normal pb-1" />
                <th className="text-center text-amber-400 font-semibold pb-1 px-2">OB 1 (E-book)</th>
                <th className="text-center text-amber-400 font-semibold pb-1 px-2">OB 2 (Mentoria)</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['CK A (R$ 97)', 'pay.hotmart.com → R$97 + E-book', 'pay.hotmart.com → R$97 + Mentoria'],
                ['CK B (R$ 147)', 'pay.hotmart.com → R$147 + E-book', 'pay.hotmart.com → R$147 + Mentoria'],
              ].map(([ck, c1, c2], i) => (
                <tr key={i}>
                  <td className={clsx('pr-2 font-semibold', i === 0 ? 'text-violet-400' : 'text-violet-300')}>{ck}</td>
                  <td className="bg-[#0D1117] border border-[#1F2937] rounded px-2 py-1 text-gray-400">{c1}</td>
                  <td className="bg-[#0D1117] border border-[#1F2937] rounded px-2 py-1 text-gray-400">{c2}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <StepBlock num={4} title="Regra de ouro dos slugs"
        color="text-cyan-400" border="border-cyan-500/30" bg="bg-cyan-500/10"
        items={[
          `Página → slug livre, ex: meu-slug (link do anúncio: ${ENTRY_BASE}/meu-slug)`,
          'Checkout → slug do funil, ex: col (link do botão: tab.../check/col)',
          'Order Bump → MESMO slug do Checkout, ex: col',
          'Checkout e OB são os "gêmeos" — sempre o mesmo slug',
        ]}
        note={null}
      />

      <StepBlock num={5} title="Teste e valide"
        color="text-emerald-400" border="border-emerald-500/30" bg="bg-emerald-500/10"
        items={[
          `Abra uma aba anônima → acesse ${ENTRY_BASE}/check/SEU-SLUG`,
          'Observe para qual URL da Hotmart você foi redirecionado',
          'Confira na Matriz se esse link corresponde à combinação correta',
          'Feche e abra nova aba anônima para testar outra combinação',
          'Sempre teste em aba anônima — nunca no mesmo navegador com cookies',
        ]}
        note={null}
      />
    </div>
  )
}

function ManualVTURB() {
  return (
    <div className="space-y-3">
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 flex gap-3">
        <AlertCircle size={15} className="text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-xs text-emerald-300 leading-relaxed">
          O VTURB renderiza o botão dentro de um <strong>iframe</strong> — cliques não são detectáveis pelo GTM normalmente. Use o <strong>Click Interceptor</strong> instalado via GTM para capturar o clique e disparar o evento <code className="font-mono">initiate_checkout</code> antes do redirect.
        </p>
      </div>

      <StepBlock num={1} title="Configure o botão no VTURB"
        color="text-emerald-400" border="border-emerald-500/30" bg="bg-emerald-500/10"
        items={[
          'No painel VTURB, abra o vídeo → Botão de ação → Editar',
          `URL do botão: ${ENTRY_BASE}/check/SEU-SLUG`,
          'IMPORTANTE: desmarque "Abrir link em nova guia" — deve redirecionar a página',
          'Salve o botão',
        ]}
        note={null}
      />

      <StepBlock num={2} title="Configure o rastreio no VTURB (sem conflito)"
        color="text-emerald-400" border="border-emerald-500/30" bg="bg-emerald-500/10"
        items={[
          'No VTURB → Configurações → Conversão',
          'Escolha o parâmetro de rastreio — NÃO use o mesmo parâmetro que o seu indexador (ex: SCK)',
          'Use outro parâmetro disponível (ex: src) para evitar sobrescrever o SCK',
          'Se só existir um parâmetro disponível igual ao indexador, adapte o código com a IA',
        ]}
        note="Conflito entre rastreio do VTURB e o indexador é a causa mais comum de SCK zerado."
      />

      <StepBlock num={3} title="Instale o Click Interceptor no GTM"
        color="text-emerald-400" border="border-emerald-500/30" bg="bg-emerald-500/10"
        items={[
          'No GTM, crie uma nova tag → Tipo: HTML Personalizado',
          'Cole o código do Click Interceptor (gerado pelo sistema)',
          'O código detecta cliques em links /r/check/, chama /r/assign para obter ck e ob,',
          'e redireciona para o checkout com ?ck=...&ob=... já definidos',
          'Acionador: All Pages',
          'Nome da tag: "Redirect — Click Interceptor VTURB"',
        ]}
        note={null}
      />

      <StepBlock num={4} title="Configure o acionador initiate_checkout"
        color="text-emerald-400" border="border-emerald-500/30" bg="bg-emerald-500/10"
        items={[
          'No GTM, crie um acionador → Tipo: Evento Personalizado',
          'Nome do evento: initiate_checkout',
          'Atribua esse acionador às suas tags de conversão de checkout (Facebook, Google, TikTok)',
          'O Click Interceptor dispara esse evento automaticamente a cada clique no botão',
        ]}
        note="Com esse acionador, as tags de conversão disparam ANTES do redirect — sem perda de dados."
      />

      <StepBlock num={5} title="Teste e valide"
        color="text-emerald-400" border="border-emerald-500/30" bg="bg-emerald-500/10"
        items={[
          'Abra o GTM em modo Preview → acesse a LP com o VTURB',
          'Clique no botão do VTURB',
          'No painel do GTM Preview, você deve ver o evento "initiate_checkout" disparado',
          'Verifique que o URL de destino inclui ?ck=...&ob=...',
          'Confirme que o SCK correto foi enviado para o servidor de tracking',
        ]}
        note={null}
      />
    </div>
  )
}

function ManualEdit() {
  return (
    <div className="space-y-3">
      <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 flex gap-3">
        <AlertCircle size={15} className="text-rose-400 shrink-0 mt-0.5" />
        <p className="text-xs text-rose-300 leading-relaxed">
          Você pode editar um teste <strong>enquanto ele está em execução</strong> — nome, pesos das variantes, URLs e fallback. O slug das variantes é bloqueado para proteger as chaves da Matriz de Links.
        </p>
      </div>

      <StepBlock num={1} title="Como abrir o editor"
        color="text-rose-400" border="border-rose-500/30" bg="bg-rose-500/10"
        items={[
          'Localize o experimento na lista — qualquer status (ativo, pausado, rascunho)',
          'Clique no ícone de lápis (✏️) à direita do nome do experimento',
          'O modal de edição abre sem interromper o experimento em execução',
        ]}
        note={null}
      />

      <StepBlock num={2} title="O que pode ser editado"
        color="text-rose-400" border="border-rose-500/30" bg="bg-rose-500/10"
        items={[
          'Nome do experimento — apenas visual, não afeta o sorteio',
          'Pesos das variantes — redistribui o tráfego a partir da próxima visita',
          'URLs das variantes — altera para onde o visitante é redirecionado',
          'URL de fallback — link usado quando o teste está pausado',
        ]}
        note="Pesos alterados afetam apenas novos visitantes — quem já recebeu um cookie mantém a variante sorteada."
      />

      <StepBlock num={3} title="O que NÃO pode ser editado"
        color="text-gray-400" border="border-gray-600/30" bg="bg-gray-600/10"
        items={[
          'Slug de entrada — identifica o experimento no Worker e no banco',
          'Slug das variantes — são as chaves da Matriz de Links do OB; mudar quebraria todos os links',
          'Tipo do experimento (Página / Checkout / OB) — não é possível converter',
          'Para mudar slugs: encerre o experimento atual e crie um novo',
        ]}
        note={null}
      />

      <StepBlock num={4} title="Editar a Matriz de Links (OB)"
        color="text-amber-400" border="border-amber-500/30" bg="bg-amber-500/10"
        items={[
          'Para editar os links da Matriz de OB, clique no ícone de grade (⊞) do experimento de OB',
          'A Matriz abre em popup — edite as células e salve',
          'Cada célula = combinação de checkout × order bump → URL da Hotmart',
          'Salvar a matriz não reinicia nem interrompe o experimento',
        ]}
        note={null}
      />
    </div>
  )
}

// ── Edit Experiment Modal ─────────────────────────────────────────────────────

function EditExperimentModal({
  exp,
  allExps,
  stats,
  onClose,
  onSaved,
}: {
  exp: SbExperiment
  allExps: SbExperiment[]
  stats: ExperimentStats
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(exp.name)
  const [variants, setVariants] = useState<VariantDraft[]>(
    exp.variants.map((v, i) => ({ id: i, name: v.name, slug: v.slug, url: v.url ?? '', weight: v.weight, enabled: v.enabled !== false }))
  )
  // Contador monotônico pra ids de variantes NOVAS adicionadas neste editor.
  // Nunca reinicia nem reusa — mesmo removendo variantes, o próximo id só sobe.
  const nextIdRef = useRef(exp.variants.length)
  const [fallbackUrl, setFallbackUrl] = useState(exp.fallback_url ?? '')
  const [checkoutSlug, setCheckoutSlug] = useState(exp.checkout_slug ?? '')
  // A/B 2.0
  const [vturbEnabled, setVturbEnabled] = useState<boolean>(exp.vturb_enabled ?? false)
  const [autoOptimize, setAutoOptimize] = useState<boolean>(exp.auto_optimize ?? false)
  const [championVariant, setChampionVariant] = useState<string>(exp.champion_variant ?? '')
  const [banditMinConv, setBanditMinConv] = useState<number>(exp.bandit_min_conv ?? 30)
  const [adminPwd, setAdminPwd] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const needsFallback = exp.type === 'page' || exp.type === 'checkout'
  const enabledVariants = variants.filter((v) => v.enabled !== false)
  const weightOk = enabledVariants.length >= 1 && enabledVariants.reduce((s, v) => s + v.weight, 0) > 0

  // Slugs que já existiam quando o modal abriu: ficam travados (read-only, sem
  // remover) pra não quebrar a atribuição histórica. Variantes adicionadas aqui
  // entram com slug editável e peso 0 — zero perturbação no sorteio de quem já
  // está no teste, até você dar peso a elas.
  const lockedSlugs = new Set(exp.variants.map((v) => v.slug).filter(Boolean))
  // Histórico por variante (slug → métricas) pra mostrar inline no editor — ajuda
  // a decidir o que excluir/desativar. Reflete o filtro de data atual do dashboard.
  const statsBySlug = new Map(stats.variants.map((s) => [s.slug, s]))

  function addVariant() {
    if (variants.length >= MAX_VARIANTS) return
    const id = nextIdRef.current++
    setVariants((prev) => [
      ...prev,
      { id, name: variantName(id), slug: '', url: '', weight: 0, enabled: true },
    ])
  }
  function removeVariant(idx: number) {
    const v = variants[idx]
    // Excluir uma variante que JÁ existe (tem histórico) pede confirmação — é
    // diferente de só desativar. O dado bruto fica no banco; recriar uma variante
    // com o MESMO ID traz o histórico de volta no detalhamento.
    const isExisting = !!v?.slug && lockedSlugs.has(v.slug)
    if (isExisting && !window.confirm(
      `Excluir a variante ${v.name} (ID "${v.slug}")?\n\n` +
      `Ela sai do experimento e some do detalhamento. Pra só pausar sem perder do relatório, use "desativar".`
    )) return
    setVariants((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)))
  }

  async function handleSave() {
    setError('')
    if (!name.trim()) { setError('Nome é obrigatório.'); return }
    if (!weightOk) { setError('Defina ao menos uma variante ativa com peso maior que zero.'); return }
    for (const v of variants) {
      if (!v.slug.trim()) { setError(`Preencha o ID da variante ${v.name}.`); return }
      if (v.slug.includes('_')) { setError(`ID da variante ${v.name} não pode ter underline.`); return }
      if (exp.type !== 'ob' && !v.url?.trim()) { setError(`Preencha a URL da variante ${v.name}.`); return }
      if (exp.type === 'page') {
        const r = validatePageVariant({ name: v.name, slug: v.slug, url: v.url ?? '', weight: v.weight })
        if (!r.ok) { setError(r.error); return }
      }
    }
    const dup = findDuplicateSlug(variants)
    if (dup) { setError(`ID "${dup}" repetido entre variantes. Cada variante precisa de um ID único pra rastrear a atribuição.`); return }
    if (needsFallback && fallbackUrl && !isHttpsUrl(fallbackUrl.trim())) {
      setError('URL de fallback inválida. Deve começar com https://'); return
    }
    setSaving(true)
    try {
      const cleanVariants = variants.map(({ url, id: _id, ...rest }) => {
        const v: Record<string, unknown> = { ...rest }
        if (exp.type !== 'ob' && url.trim()) v.url = url.trim()
        return v
      })
      const body: Record<string, unknown> = { id: exp.id, name: name.trim(), variants: cleanVariants }
      if (needsFallback) body.fallback_url = fallbackUrl.trim()
      if (exp.type === 'page') body.checkout_slug = checkoutSlug.trim() || null
      // A/B 2.0 — só envia se mudou (evita writes desnecessários)
      if (vturbEnabled !== (exp.vturb_enabled ?? false)) body.vturb_enabled = vturbEnabled
      if (autoOptimize !== (exp.auto_optimize ?? false)) body.auto_optimize = autoOptimize
      if ((championVariant || null) !== (exp.champion_variant ?? null)) body.champion_variant = championVariant || null
      if (banditMinConv !== (exp.bandit_min_conv ?? 30)) body.bandit_min_conv = banditMinConv
      const res = await fetch('/api/experimentos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPwd },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || 'Erro ao salvar.'); return }
      onSaved()
    } catch { setError('Erro de rede.') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#0D1117] border border-[#1F2937] rounded-2xl w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1F2937] shrink-0 sticky top-0 bg-[#0D1117] z-10">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <Pencil size={14} className="text-cyan-400" />
            Editar experimento
          </div>
          <button onClick={onClose} title="Fechar" aria-label="Fechar" className="text-gray-500 hover:text-white transition-colors cursor-pointer"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {/* Badges info */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded', TYPE_BADGE[exp.type ?? 'page'].cls)}>
              {TYPE_BADGE[exp.type ?? 'page'].label}
            </span>
            <span className="text-[10px] font-mono text-gray-500">
              {exp.type === 'checkout'
                ? `${ENTRY_BASE}/check/${exp.entry_path.slice(1)}`
                : `${ENTRY_BASE}${exp.entry_path}`}
            </span>
            <span className={clsx('text-[10px] font-medium px-2 py-0.5 rounded-full ml-auto', STATUS_COLOR[exp.status])}>
              {STATUS_LABEL[exp.status]}
            </span>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-3 py-2.5 flex gap-2">
            <AlertCircle size={13} className="text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-yellow-300 leading-relaxed">
              Alterações entram em vigor imediatamente. Mudar URLs ou pesos no meio do teste altera os dados a partir deste ponto — os dados anteriores são preservados.
            </p>
          </div>

          {/* Nome */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400 font-medium">Nome do experimento</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
            />
          </div>

          {/* Variants — pode adicionar/remover em experimento ativo. Slugs antigos
              ficam travados (atribuição); novos entram editáveis com peso 0. */}
          <VariantEditor
            variants={variants}
            setVariants={setVariants}
            type={exp.type as ExpType}
            editableSlug={false}
            onAdd={addVariant}
            onRemove={removeVariant}
            lockedSlugs={lockedSlugs}
            statsBySlug={statsBySlug}
          />

          {/* Fallback */}
          {needsFallback && (
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 font-medium">URL de fallback</label>
              <input
                value={fallbackUrl}
                onChange={e => setFallbackUrl(e.target.value)}
                onBlur={e => setFallbackUrl(e.target.value.trim())}
                placeholder={exp.type === 'checkout' ? 'https://pay.hotmart.com/...' : 'https://seudominio.com.br/...'}
                className={clsx(
                  'w-full bg-[#111827] border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 font-mono',
                  fallbackUrl && !isHttpsUrl(fallbackUrl)
                    ? 'border-red-500/50 focus:border-red-500/70 focus:ring-red-500/20'
                    : 'border-[#1F2937] focus:border-cyan-500/50 focus:ring-cyan-500/20'
                )}
              />
            </div>
          )}

          {/* Vincular ao checkout (page apenas) */}
          {exp.type === 'page' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Link2 size={12} className="text-violet-400" />
                <label className="text-xs text-gray-400 font-medium">Vincular ao teste de checkout</label>
                <span className="text-[10px] text-gray-400">(opcional)</span>
              </div>
              <select
                value={checkoutSlug}
                onChange={e => setCheckoutSlug(e.target.value)}
                className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 cursor-pointer"
              >
                <option value="">— nenhum (checkout independente) —</option>
                {allExps
                  .filter((e) => e.type === 'checkout' && e.status !== 'ended')
                  .map((e) => (
                    <option key={e.id} value={e.entry_path}>
                      {e.name} ({e.entry_path})
                    </option>
                  ))}
              </select>
              <p className="text-[10px] text-gray-500">
                O Worker injeta <span className="font-mono text-gray-400">?ck=</span> e <span className="font-mono text-gray-400">?ob=</span> desse checkout ao redirecionar o visitante.
              </p>
            </div>
          )}

          {/* A/B 2.0 — vTurb + Auto-otimizar + Campeã + min_conv */}
          <div className="space-y-3 border border-[#1F2937] bg-[#0B0F16] rounded-xl p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              <FlaskConical size={12} className="text-fuchsia-400" /> A/B Testing 2.0
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={vturbEnabled}
                onChange={e => setVturbEnabled(e.target.checked)}
                className="accent-cyan-500"
              />
              <span className="text-xs text-gray-300">vTurb habilitado <span className="text-gray-400">(usa play-rate como sinal de bot)</span></span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoOptimize}
                onChange={e => setAutoOptimize(e.target.checked)}
                className="accent-fuchsia-500"
              />
              <span className="text-xs text-gray-300">Auto-otimizar (bandit) <span className="text-gray-400">— cron diário ajusta pesos via Thompson Sampling</span></span>
            </label>

            {autoOptimize && (
              <div className="space-y-3 pl-6 border-l-2 border-fuchsia-500/30">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500">Variante campeã (lock manual) <span className="text-gray-700">opcional</span></label>
                  <select
                    value={championVariant}
                    onChange={e => setChampionVariant(e.target.value)}
                    className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-fuchsia-500/50 cursor-pointer"
                  >
                    <option value="">— sem lock (bandit livre) —</option>
                    {variants.filter((v) => v.slug).map(v => (
                      <option key={v.slug} value={v.slug}>{v.name} ({v.slug})</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-400">Quando definida, o bandit garante peso ≥60% para a variante escolhida.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 flex justify-between">
                    <span>Mínimo de conversões antes do bandit agir</span>
                    <span className="font-mono text-fuchsia-300">{banditMinConv}</span>
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={200}
                    step={1}
                    value={banditMinConv}
                    onChange={e => setBanditMinConv(Number(e.target.value))}
                    className="w-full accent-fuchsia-500"
                  />
                  <p className="text-[10px] text-gray-400">Abaixo desse threshold por variante, mantém pesos uniformes (evita decisão precoce).</p>
                </div>
              </div>
            )}
          </div>

          {/* Admin */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400 font-medium">Senha de admin</label>
            <input
              type="password"
              value={adminPwd}
              onChange={e => setAdminPwd(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && adminPwd) handleSave() }}
              placeholder="••••••••"
              className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving || !weightOk || !adminPwd}
            className={clsx(
              'w-full rounded-xl py-2.5 text-sm font-medium transition-all cursor-pointer',
              saving || !weightOk || !adminPwd
                ? 'bg-cyan-500/20 text-cyan-500/50 cursor-not-allowed'
                : 'bg-cyan-500 text-black hover:bg-cyan-400'
            )}
          >
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Matriz OB Modal ───────────────────────────────────────────────────────────

function MatrizOBModal({
  ckExp,
  obExp,
  onClose,
  onSaved,
}: {
  ckExp: SbExperiment
  obExp: SbExperiment
  onClose: () => void
  onSaved: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-3xl" onClick={e => e.stopPropagation()}>
        <MatrizOB ckExp={ckExp} obExp={obExp} onSaved={onSaved} onClose={onClose} />
      </div>
    </div>
  )
}

function NovoExperimentoModal({
  onClose,
  onCreated,
  experiments,
}: {
  onClose: () => void
  onCreated: () => void
  experiments: SbExperiment[]
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<ExpType>('page')
  const [entrySlug, setEntrySlug] = useState('')
  const [variants, setVariants] = useState<VariantDraft[]>(buildDefaultVariants())
  // Contador monotônico pra ids de variantes NOVAS — nunca reusa, mesmo após
  // remover uma variante (buildDefaultVariants já usa os ids 0 e 1).
  const nextIdRef = useRef(2)
  const [fallbackUrl, setFallbackUrl] = useState('')
  const [checkoutSlug, setCheckoutSlug] = useState('')
  const [schedStart, setSchedStart] = useState('')
  const [schedEnd, setSchedEnd] = useState('')
  const [obMatrix, setObMatrix] = useState<Record<string, string>>({})
  // A/B 2.0
  const [vturbEnabled, setVturbEnabled] = useState(false)
  const [autoOptimize, setAutoOptimize] = useState(false)
  const [championVariant, setChampionVariant] = useState('')
  const [banditMinConv, setBanditMinConv] = useState(30)
  const [adminPwd, setAdminPwd] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const needsFallback = type === 'page' || type === 'checkout'

  // Para OB: busca experimento de checkout ativo/pausado no mesmo path
  const ckExp = type === 'ob' && entrySlug
    ? experiments.find((e) => e.type === 'checkout' && e.entry_path === `/${entrySlug}` && e.status !== 'ended')
    : null
  const ckRows: { name: string; slug: string }[] = ckExp?.variants ?? [{ name: 'Padrão', slug: 'padrao' }]

  function getMatrixUrl(ckSlug: string, obSlug: string) { return obMatrix[`${ckSlug}_${obSlug}`] ?? '' }
  function setMatrixUrl(ckSlug: string, obSlug: string, url: string) {
    setObMatrix((prev) => ({ ...prev, [`${ckSlug}_${obSlug}`]: url }))
  }

  const cfg = TYPE_CONFIG[type]
  const entryPath = `/${entrySlug}`

  function addVariant() {
    if (variants.length >= MAX_VARIANTS) return
    const id = nextIdRef.current++
    setVariants((prev) => [
      ...prev,
      { id, name: variantName(id), slug: '', url: '', weight: 0 },
    ])
  }

  function removeVariant(idx: number) {
    if (variants.length <= 2) return
    setVariants((prev) => prev.filter((_, i) => i !== idx))
  }

  const enabledVariants = variants.filter((v) => v.enabled !== false)
  const weightOk = enabledVariants.length >= 1 && enabledVariants.reduce((s, v) => s + v.weight, 0) > 0

  const obSlugsForMatrix = variants.map((v) => v.slug).filter(Boolean)
  const matrixComplete = type !== 'ob' || ckRows.every((ck) =>
    obSlugsForMatrix.every((obSlug) => {
      const url = getMatrixUrl(ck.slug, obSlug)
      return url.trim() && isHttpsUrl(url.trim())
    })
  )

  // Valida e submete. publish=true → cria já como active.
  async function handleSave(publish: boolean) {
    setError('')
    if (!name.trim()) { setError('Nome é obrigatório.'); return }
    if (!entrySlug.trim()) { setError(type === 'ob' ? 'Selecione o checkout vinculado.' : 'Slug de entrada é obrigatório.'); return }
    if (!weightOk) { setError('Defina ao menos uma variante ativa com peso maior que zero.'); return }

    for (const v of variants) {
      if (!v.slug.trim()) { setError(`Preencha o ID da variante ${v.name}.`); return }
      if (v.slug.includes('_')) { setError(`ID da variante ${v.name} não pode ter underline.`); return }
      if (type !== 'ob' && !v.url.trim()) { setError(`Preencha a URL da variante ${v.name}.`); return }
      if (type === 'page') {
        const r = validatePageVariant({ name: v.name, slug: v.slug, url: v.url, weight: v.weight })
        if (!r.ok) { setError(r.error); return }
      }
    }

    const dup = findDuplicateSlug(variants)
    if (dup) { setError(`ID "${dup}" repetido entre variantes. Cada variante precisa de um ID único pra rastrear a atribuição.`); return }

    if (needsFallback) {
      if (!fallbackUrl.trim()) { setError('URL de fallback é obrigatória.'); return }
      if (!isHttpsUrl(fallbackUrl.trim())) { setError('URL de fallback inválida. Deve começar com https://'); return }
    }

    if (schedStart && schedEnd && new Date(schedStart) >= new Date(schedEnd)) {
      setError('A data de início deve ser anterior à data de fim.'); return
    }

    // Validação obrigatória da matriz para OB
    if (type === 'ob') {
      const obSlugs = variants.map((v) => v.slug).filter(Boolean)
      for (const ck of ckRows) {
        for (const obSlug of obSlugs) {
          const url = getMatrixUrl(ck.slug, obSlug)
          if (!url.trim()) { setError(`Preencha a URL: ${ck.name} × ${obSlug}.`); return }
          if (!isHttpsUrl(url.trim())) { setError(`URL inválida (deve ser https://): ${ck.name} × ${obSlug}.`); return }
        }
      }
    }

    setSaving(true)
    try {
      const cleanVariants = variants.map(({ url, id: _id, ...rest }) => {
        const v: Record<string, unknown> = { ...rest }
        if (type !== 'ob' && url.trim()) v.url = url.trim()
        return v
      })
      const body: Record<string, unknown> = {
        name: name.trim(),
        entry_path: entryPath,
        type,
        variants: cleanVariants,
        status: publish ? 'active' : 'draft',
      }
      if (needsFallback) body.fallback_url = fallbackUrl.trim()
      if (schedStart) body.scheduled_start = new Date(schedStart).toISOString()
      if (schedEnd) body.scheduled_end = new Date(schedEnd).toISOString()
      if (type === 'ob') body.matrix = obMatrix
      if (type === 'page' && checkoutSlug) body.checkout_slug = checkoutSlug
      // A/B 2.0 — só envia quando o admin opta por algo diferente do default
      if (vturbEnabled) body.vturb_enabled = true
      if (autoOptimize) body.auto_optimize = true
      if (championVariant) body.champion_variant = championVariant
      if (banditMinConv !== 30) body.bandit_min_conv = banditMinConv
      const res = await fetch('/api/experimentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPwd },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Erro ao criar experimento.'); return }
      onCreated()
    } catch {
      setError('Erro de rede.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#0D1117] border border-[#1F2937] rounded-2xl w-full max-w-lg mx-4 overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1F2937] sticky top-0 bg-[#0D1117] z-10">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <FlaskConical size={16} className="text-cyan-400" />
            Novo Experimento
          </div>
          <button onClick={onClose} title="Fechar" aria-label="Fechar" className="text-gray-500 hover:text-white transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Tipo */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400 font-medium">Tipo</label>
            <div className="grid grid-cols-3 gap-2">
              {(['page', 'checkout', 'ob'] as ExpType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setType(t); setEntrySlug('') }}
                  className={clsx(
                    'flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer border',
                    type === t
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400'
                      : 'bg-[#111827] border-[#1F2937] text-gray-500 hover:text-gray-300'
                  )}
                >
                  {TYPE_CONFIG[t].icon}
                  {TYPE_CONFIG[t].label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-500">{cfg.hint}</p>
          </div>

          {/* Nome */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400 font-medium">Nome do experimento</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`ex: dashboard-demo — col ${type}`}
              className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
            />
          </div>

          {/* Entry slug */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400 font-medium">
              {type === 'ob' ? 'Checkout vinculado' : 'Slug de entrada'}
            </label>
            {type === 'ob' ? (() => {
              const activeCheckouts = experiments.filter((e) => e.type === 'checkout' && e.status === 'active')
              return (
                <>
                  <select
                    value={entrySlug}
                    onChange={(e) => setEntrySlug(e.target.value)}
                    className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 cursor-pointer"
                  >
                    <option value="">— selecione um checkout ativo —</option>
                    {activeCheckouts.map((e) => (
                      <option key={e.id} value={e.entry_path.replace(/^\//, '')}>
                        {e.name} ({e.entry_path})
                      </option>
                    ))}
                  </select>
                  {activeCheckouts.length === 0 && (
                    <p className="text-[10px] text-yellow-500">Nenhum checkout ativo encontrado. Ative um experimento de checkout primeiro.</p>
                  )}
                  {entrySlug && (
                    <p className="text-[10px] text-gray-400 font-mono">{ENTRY_BASE}/{entrySlug}</p>
                  )}
                </>
              )
            })() : (
              <>
                <div className="flex items-center bg-[#111827] border border-[#1F2937] rounded-lg overflow-hidden focus-within:border-cyan-500/50 focus-within:ring-1 focus-within:ring-cyan-500/20">
                  <span className="text-xs text-gray-400 px-3 font-mono shrink-0">/</span>
                  <input
                    value={entrySlug}
                    onChange={(e) => setEntrySlug(e.target.value.replace(/[^a-zA-Z0-9-]/g, ''))}
                    placeholder={cfg.entryPlaceholder}
                    className="flex-1 bg-transparent py-2 pr-3 text-sm text-white placeholder-gray-500 font-mono focus:outline-none"
                  />
                </div>
                <p className="text-[10px] text-gray-400">
                  {type === 'checkout'
                    ? `${ENTRY_BASE}/check/${entrySlug || '...'}`
                    : `${ENTRY_BASE}${entryPath}`}
                </p>
              </>
            )}
          </div>

          {/* Variants */}
          <VariantEditor
            variants={variants}
            setVariants={setVariants}
            type={type}
            editableSlug={true}
            onAdd={addVariant}
            onRemove={removeVariant}
          />

          {/* Agendamento (opcional) */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Calendar size={12} className="text-gray-500" />
              <label className="text-xs text-gray-400 font-medium">Agendamento</label>
              <span className="text-[10px] text-gray-400">(opcional)</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500">Início</label>
                <input
                  type="datetime-local"
                  value={schedStart}
                  onChange={(e) => setSchedStart(e.target.value)}
                  className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500/50 [color-scheme:dark]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500">Fim</label>
                <input
                  type="datetime-local"
                  value={schedEnd}
                  onChange={(e) => setSchedEnd(e.target.value)}
                  className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500/50 [color-scheme:dark]"
                />
              </div>
            </div>
            <p className="text-[10px] text-gray-400 flex items-center gap-1">
              <Clock size={9} />
              Fora do intervalo o Worker redireciona para o fallback automaticamente.
            </p>
          </div>

          {/* URL de fallback (page e checkout apenas) */}
          {needsFallback && (
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 font-medium">
                URL de fallback
                <span className="ml-1 text-red-400">*</span>
              </label>
              <input
                value={fallbackUrl}
                onChange={(e) => setFallbackUrl(e.target.value)}
                onBlur={(e) => setFallbackUrl(e.target.value.trim())}
                placeholder={type === 'checkout' ? 'https://pay.hotmart.com/...' : 'https://seudominio.com.br/...'}
                className={clsx(
                  'w-full bg-[#111827] border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 font-mono',
                  fallbackUrl && !isHttpsUrl(fallbackUrl)
                    ? 'border-red-500/50 focus:border-red-500/70 focus:ring-red-500/20'
                    : 'border-[#1F2937] focus:border-cyan-500/50 focus:ring-cyan-500/20'
                )}
              />
              <p className="text-[10px] text-gray-500">
                Destino usado quando o teste estiver pausado ou encerrado. Deve começar com https://.
              </p>
            </div>
          )}

          {/* Vincular ao teste de checkout (page apenas) */}
          {type === 'page' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Link2 size={12} className="text-violet-400" />
                <label className="text-xs text-gray-400 font-medium">Vincular ao teste de checkout</label>
                <span className="text-[10px] text-gray-400">(opcional)</span>
              </div>
              <select
                value={checkoutSlug}
                onChange={(e) => setCheckoutSlug(e.target.value)}
                className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 cursor-pointer"
              >
                <option value="">— nenhum (checkout independente) —</option>
                {experiments
                  .filter((e) => e.type === 'checkout' && e.status !== 'ended')
                  .map((e) => (
                    <option key={e.id} value={e.entry_path}>
                      {e.name} ({e.entry_path})
                    </option>
                  ))}
              </select>
              <p className="text-[10px] text-gray-500">
                Quando definido, o Worker injeta <span className="font-mono text-gray-400">?ck=</span> e <span className="font-mono text-gray-400">?ob=</span> desse checkout ao redirecionar o visitante para esta página.
              </p>
            </div>
          )}

          {/* A/B 2.0 — vTurb + Auto-otimizar + Campeã + min_conv */}
          <div className="space-y-3 border border-[#1F2937] bg-[#0B0F16] rounded-xl p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              <FlaskConical size={12} className="text-fuchsia-400" /> A/B Testing 2.0
            </div>

            {type === 'page' && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={vturbEnabled}
                  onChange={(e) => setVturbEnabled(e.target.checked)}
                  className="accent-cyan-500"
                />
                <span className="text-xs text-gray-300">vTurb habilitado <span className="text-gray-400">(usa play-rate como sinal de bot)</span></span>
              </label>
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoOptimize}
                onChange={(e) => setAutoOptimize(e.target.checked)}
                className="accent-fuchsia-500"
              />
              <span className="text-xs text-gray-300">Auto-otimizar (bandit) <span className="text-gray-400">— cron diário ajusta pesos via Thompson Sampling</span></span>
            </label>

            {autoOptimize && (
              <div className="space-y-3 pl-6 border-l-2 border-fuchsia-500/30">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500">Variante campeã (lock manual) <span className="text-gray-700">opcional</span></label>
                  <select
                    value={championVariant}
                    onChange={(e) => setChampionVariant(e.target.value)}
                    className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-fuchsia-500/50 cursor-pointer"
                  >
                    <option value="">— sem lock (bandit livre) —</option>
                    {variants.filter((v) => v.slug).map((v) => (
                      <option key={v.slug} value={v.slug}>{v.name} ({v.slug})</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-400">Quando definida, o bandit garante peso ≥60% para a variante escolhida.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 flex justify-between">
                    <span>Mínimo de conversões antes do bandit agir</span>
                    <span className="font-mono text-fuchsia-300">{banditMinConv}</span>
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={200}
                    step={1}
                    value={banditMinConv}
                    onChange={(e) => setBanditMinConv(Number(e.target.value))}
                    className="w-full accent-fuchsia-500"
                  />
                  <p className="text-[10px] text-gray-400">Abaixo desse threshold por variante, mantém pesos uniformes (evita decisão precoce).</p>
                </div>
              </div>
            )}
          </div>

          {/* Senha de admin */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400 font-medium">Senha de admin</label>
            <input
              type="password"
              value={adminPwd}
              onChange={(e) => setAdminPwd(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
            />
          </div>

          {/* Matriz de links — obrigatória para Order Bump */}
          {type === 'ob' && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Tag size={12} className="text-amber-400" />
                <label className="text-xs text-gray-400 font-medium">
                  Matriz de Links
                  <span className="ml-1 text-red-400">*</span>
                </label>
                {ckExp
                  ? <span className="text-[10px] text-emerald-400">checkout encontrado: {ckExp.variants.length} variante{ckExp.variants.length !== 1 ? 's' : ''}</span>
                  : <span className="text-[10px] text-yellow-400">sem checkout — 1 linha padrão</span>
                }
              </div>
              <div className="bg-[#0D1117] border border-[#1F2937] rounded-xl overflow-x-auto">
                <table className="w-full text-xs border-separate border-spacing-1 p-2">
                  <thead>
                    <tr>
                      <th className="text-left text-gray-400 font-normal pb-1 pr-2 min-w-[90px]" />
                      {variants.map((ob, i) => (
                        <th key={i} className={clsx('text-center pb-1 px-1 font-normal min-w-[180px]', VARIANT_COLORS[i])}>
                          <div className="font-semibold">{ob.name}</div>
                          <div className="text-[10px] text-gray-400 font-mono font-normal">{ob.slug || '—'}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ckRows.map((ck, ri) => (
                      <tr key={ck.slug}>
                        <td className="pr-2 py-1 align-middle">
                          <div className={clsx('text-xs font-semibold', VARIANT_COLORS[ri])}>{ck.name}</div>
                          <div className="text-[10px] text-gray-400 font-mono">{ck.slug}</div>
                        </td>
                        {variants.map((ob, ci) => {
                          // Sem slug ainda, a chave da matriz seria `${ck.slug}_` — igual
                          // pra qualquer variante OB sem slug, colidindo entre elas. Trava
                          // a célula até o ID da variante existir.
                          const noSlug = !ob.slug
                          const url = noSlug ? '' : getMatrixUrl(ck.slug, ob.slug)
                          const invalid = url.length > 0 && !isHttpsUrl(url)
                          return (
                            <td key={ci} className="py-1 px-1">
                              <input
                                value={url}
                                disabled={noSlug}
                                onChange={(e) => setMatrixUrl(ck.slug, ob.slug, e.target.value)}
                                onBlur={(e) => setMatrixUrl(ck.slug, ob.slug, e.target.value.trim())}
                                placeholder={noSlug ? 'Preencha o ID da variante acima' : 'https://pay.hotmart.com/...'}
                                title={noSlug ? 'Preencha o ID da variante acima antes de definir o link' : undefined}
                                className={clsx(
                                  'w-full bg-[#111827] border rounded-lg px-2 py-1.5 text-[10px] font-mono text-white placeholder-gray-700 focus:outline-none focus:ring-1',
                                  noSlug
                                    ? 'border-[#1F2937] opacity-40 cursor-not-allowed'
                                    : invalid
                                      ? 'border-red-500/50 focus:border-red-500/70 focus:ring-red-500/20'
                                      : url ? 'border-emerald-500/30 focus:border-emerald-500/50 focus:ring-emerald-500/10'
                                      : 'border-[#1F2937] focus:border-cyan-500/50 focus:ring-cyan-500/20'
                                )}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={saving || !weightOk || !adminPwd}
              className={clsx(
                'rounded-xl py-2.5 text-sm font-medium transition-all cursor-pointer border',
                saving || !weightOk || !adminPwd
                  ? 'border-gray-700 text-gray-400 cursor-not-allowed'
                  : 'border-[#1F2937] text-gray-300 hover:border-gray-500 hover:text-white'
              )}
            >
              {saving ? '...' : 'Criar experimento'}
            </button>
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={saving || !weightOk || !adminPwd || !matrixComplete}
              className={clsx(
                'rounded-xl py-2.5 text-sm font-medium transition-all cursor-pointer',
                saving || !weightOk || !adminPwd || !matrixComplete
                  ? 'bg-emerald-500/20 text-emerald-500/50 cursor-not-allowed'
                  : 'bg-emerald-500 text-black hover:bg-emerald-400'
              )}
            >
              {saving ? 'Salvando...' : 'Criar e publicar AGORA!'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Matriz de Order Bump ──────────────────────────────────────────────────────

function MatrizOB({
  ckExp,
  obExp,
  onSaved,
  onClose,
}: {
  ckExp: SbExperiment
  obExp: SbExperiment
  onSaved: () => void
  onClose?: () => void
}) {
  const [matrix, setMatrix] = useState<Record<string, string>>(obExp.matrix ?? {})
  const [pwd, setPwd] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  function key(ckSlug: string, obSlug: string) { return `${ckSlug}_${obSlug}` }
  function getUrl(ckSlug: string, obSlug: string) { return matrix[key(ckSlug, obSlug)] ?? '' }
  function setUrl(ckSlug: string, obSlug: string, url: string) {
    setMatrix((prev) => ({ ...prev, [key(ckSlug, obSlug)]: url }))
  }

  async function save() {
    setError('')
    for (const ck of ckExp.variants) {
      for (const ob of obExp.variants) {
        const url = getUrl(ck.slug, ob.slug)
        if (!url.trim()) { setError(`Preencha a URL: ${ck.slug} × ${ob.slug}.`); return }
        if (!isHttpsUrl(url.trim())) { setError(`URL inválida (deve ser https://): ${ck.slug} × ${ob.slug}.`); return }
      }
    }
    setSaving(true)
    try {
      const res = await fetch('/api/experimentos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': pwd },
        body: JSON.stringify({ id: obExp.id, matrix }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || 'Erro ao salvar.'); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      onSaved()
    } catch { setError('Erro de rede.') }
    finally { setSaving(false) }
  }

  const totalCells = ckExp.variants.length * obExp.variants.length
  const filledCells = ckExp.variants.reduce((acc, ck) =>
    acc + obExp.variants.filter((ob) => isHttpsUrl(getUrl(ck.slug, ob.slug))).length, 0)

  return (
    <div className="bg-[#111827] border border-amber-500/20 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1F2937]">
        <div className="flex items-center gap-2">
          <Tag size={13} className="text-amber-400" />
          <span className="text-sm font-semibold text-white">Matriz de Links</span>
          <span className="text-[10px] text-gray-500 font-mono">{ckExp.entry_path}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={clsx(
            'text-[10px] font-medium px-2 py-0.5 rounded-full',
            filledCells === totalCells
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-yellow-500/15 text-yellow-400'
          )}>
            {filledCells}/{totalCells} links
          </span>
          {onClose && (
            <button onClick={onClose} title="Fechar" aria-label="Fechar" className="text-gray-500 hover:text-white transition-colors cursor-pointer ml-1">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto p-4">
        <table className="w-full text-xs border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="text-left text-gray-400 font-normal pb-1 pr-2 min-w-[100px]" />
              {obExp.variants.map((ob, i) => (
                <th key={ob.slug} className={clsx('text-center pb-1 px-1 font-normal min-w-[200px]', VARIANT_COLORS[i])}>
                  <div className="font-semibold">{ob.name}</div>
                  <div className="text-[10px] text-gray-400 font-mono font-normal">{ob.slug}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ckExp.variants.map((ck, ri) => (
              <tr key={ck.slug}>
                <td className="pr-2 py-1 align-middle">
                  <div className={clsx('text-xs font-semibold', VARIANT_COLORS[ri])}>{ck.name}</div>
                  <div className="text-[10px] text-gray-400 font-mono">{ck.slug}</div>
                </td>
                {obExp.variants.map((ob) => {
                  const url = getUrl(ck.slug, ob.slug)
                  const invalid = url.length > 0 && !isHttpsUrl(url)
                  return (
                    <td key={ob.slug} className="py-1 px-1">
                      <input
                        value={url}
                        onChange={(e) => setUrl(ck.slug, ob.slug, e.target.value)}
                        onBlur={(e) => setUrl(ck.slug, ob.slug, e.target.value.trim())}
                        placeholder="https://pay.hotmart.com/..."
                        className={clsx(
                          'w-full bg-[#0D1117] border rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white placeholder-gray-700 focus:outline-none focus:ring-1',
                          invalid
                            ? 'border-red-500/50 focus:border-red-500/70 focus:ring-red-500/20'
                            : url
                              ? 'border-emerald-500/30 focus:border-emerald-500/50 focus:ring-emerald-500/10'
                              : 'border-[#1F2937] focus:border-cyan-500/50 focus:ring-cyan-500/20'
                        )}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Save */}
      <div className="flex items-center gap-2 px-4 pb-4">
        <input
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && pwd) save() }}
          placeholder="Senha de admin"
          className="bg-[#0D1117] border border-[#1F2937] rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 w-40"
        />
        <button
          onClick={save}
          disabled={saving || !pwd}
          className={clsx(
            'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer',
            saving || !pwd
              ? 'bg-cyan-500/20 text-cyan-500/50 cursor-not-allowed'
              : 'bg-cyan-500 text-black hover:bg-cyan-400'
          )}
        >
          {saving ? 'Salvando...' : 'Salvar matriz'}
        </button>
        {saved && <span className="text-[10px] text-emerald-400">Salvo!</span>}
        {error && <span className="text-[10px] text-red-400">{error}</span>}
      </div>
    </div>
  )
}

// ── Experiment Row ────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      // Clipboard pode falhar (permissão negada, contexto não-seguro, etc.) —
      // avisa em vez de falhar silenciosamente.
      setFailed(true)
      setTimeout(() => setFailed(false), 2000)
    })
  }
  const title = `Copiar ${label}`
  return (
    <button
      onClick={handleCopy}
      title={title}
      aria-label={title}
      className={clsx(
        'flex items-center gap-1 text-[10px] transition-colors cursor-pointer',
        failed ? 'text-red-400' : 'text-gray-500 hover:text-cyan-400'
      )}
    >
      <Link2 size={10} />
      {copied ? 'Copiado!' : failed ? 'Falha ao copiar' : label}
    </button>
  )
}

// ── ExperimentHealthCard ──────────────────────────────────────────────────────
// Card no topo do painel expandido: lê experiment_health view + último insight
// e oferece botão "Gerar Insight" (POST /insight com x-admin-password).

type ExperimentHealth = { pct_bots: number; clarity_rage_pct: number | null; uids_24h: number }
type LatestInsight = { conteudo: string; gerado_at: string }

function ExperimentHealthCard({ experimentId }: { experimentId: string }) {
  const [health, setHealth] = useState<ExperimentHealth | null>(null)
  const [insight, setInsight] = useState<LatestInsight | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [askPwd, setAskPwd] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [insightOpen, setInsightOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/experimentos/${experimentId}/health`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || 'Falha ao carregar saúde.'); return }
      setHealth(json.health ?? null)
      setInsight(json.latestInsight ?? null)
    } catch {
      setError('Erro de rede.')
    } finally {
      setLoading(false)
    }
  }, [experimentId])

  useEffect(() => { load() }, [load])

  async function generateInsight(pwd: string) {
    setAskPwd(false)
    setGenerating(true)
    setError('')
    try {
      const res = await fetch(`/api/experimentos/${experimentId}/insight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': pwd },
        body: '{}',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || 'Falha ao gerar insight.')
        return
      }
      setInsight({ conteudo: json.insight as string, gerado_at: new Date().toISOString() })
      setInsightOpen(true)
    } catch {
      setError('Erro de rede ao gerar insight.')
    } finally {
      setGenerating(false)
    }
  }

  const botsPct = health ? Math.round((health.pct_bots || 0) * 100) : 0
  const ragePct = health?.clarity_rage_pct != null ? Math.round(health.clarity_rage_pct * 100) : null
  const botsTone =
    botsPct >= 30 ? 'bg-red-500/15 text-red-400 border-red-500/30'
    : botsPct >= 10 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
  const rageTone =
    ragePct != null && ragePct >= 15 ? 'bg-red-500/15 text-red-400 border-red-500/30'
    : ragePct != null && ragePct >= 8 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    : 'bg-[#1F2937] text-gray-400 border-[#374151]'

  return (
    <div className="mb-3 bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity size={12} className="text-fuchsia-400" />
          <span className="text-[11px] font-semibold text-gray-300 uppercase tracking-wider">Saúde do experimento</span>
          {loading && <span className="text-[10px] text-gray-400">carregando…</span>}
        </div>
        <div className="flex items-center gap-2">
          {insight && (
            <button
              onClick={() => setInsightOpen((x) => !x)}
              className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-cyan-400 transition-colors cursor-pointer"
            >
              {insightOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              Último insight · {new Date(insight.gerado_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </button>
          )}
          <button
            onClick={() => setAskPwd(true)}
            disabled={generating}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-medium border transition-colors cursor-pointer',
              generating
                ? 'bg-fuchsia-500/10 text-fuchsia-300/50 border-fuchsia-500/20 cursor-not-allowed'
                : 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30 hover:bg-fuchsia-500/25'
            )}
            title="Chama Gemini com health + Bayes + sample-size e persiste em ai_insights"
          >
            <Sparkles size={11} />
            {generating ? 'Gerando…' : 'Gerar Insight'}
          </button>
        </div>
      </div>

      {health && (
        <div className="flex flex-wrap gap-1.5">
          <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border', botsTone)} title="% de UIDs confirmados como bot nas impressões deste exp">
            <Bot size={10} /> Bots {botsPct}%
          </span>
          <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border', rageTone)} title="Rage clicks no caminho de entrada (Clarity 7d)">
            <AlertCircle size={10} /> Rage {ragePct != null ? `${ragePct}%` : '—'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border bg-[#1F2937] text-gray-300 border-[#374151]" title="UIDs únicos nas últimas 24h">
            <ShieldCheck size={10} /> Uids 24h {fmt(health.uids_24h)}
          </span>
        </div>
      )}

      {error && <p className="text-[10px] text-red-400">{error}</p>}

      {insight && insightOpen && (
        <div className="mt-2 bg-[#0D1117] border border-fuchsia-500/20 rounded-lg px-3 py-2.5 max-h-72 overflow-y-auto">
          <pre className="text-[11px] text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{insight.conteudo}</pre>
        </div>
      )}

      {askPwd && (
        <AdminGateModal
          label="Gerar insight via IA. Confirme a senha de admin para chamar o Gemini."
          onConfirm={(pwd) => generateInsight(pwd)}
          onClose={() => setAskPwd(false)}
        />
      )}
    </div>
  )
}

// Labels de métricas por tipo de experimento
const METRIC_LABELS: Record<string, { cvr: string; rpv: string; passthrough?: string }> = {
  page:     { cvr: 'Conversão da página',    rpv: 'R$/view de página',    passthrough: 'Passagem p/ checkout' },
  checkout: { cvr: 'Conversão do checkout',  rpv: 'R$/view do checkout',  passthrough: undefined },
  ob:       { cvr: 'Conversão do checkout',  rpv: 'R$/view (este OB)',    passthrough: undefined },
}

// ── Histórico da variante ─────────────────────────────────────────────────────
// Duas abas de naturezas DIFERENTES, e a UI precisa ser honesta sobre isso:
//  - Desempenho: derivado de impressions/route_clicks/checkout_hits/vendas → tem o passado
//    inteiro, retroativo.
//  - Alterações: nunca foi gravado antes (o JSON de variants guarda só o estado atual), então
//    começa VAZIO e só enche daqui pra frente. Dizer isso na tela evita o usuário achar que
//    "não mudou nada" quando na verdade é "não sabemos o que mudou".

interface VariantHistoryData {
  experimento: string
  variant: string
  slug: string
  url: string | null
  desde: string | null
  desempenho: {
    dia: string; visualizacoes: number; visitantes: number; roteados: number; chegaram: number
    connectRate: number | null; cliquesCheckout: number; vendas: number; receita: number
  }[]
  alteracoes: { occurred_at: string; texto: string; origem: string; ator: string | null }[]
}

function VariantHistoryModal({ expId, expName, variant, slug, onClose }: {
  expId: string; expName: string; variant: string; slug: string; onClose: () => void
}) {
  const [aba, setAba] = useState<'desempenho' | 'alteracoes'>('desempenho')
  const [data, setData] = useState<VariantHistoryData | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    fetch(`/api/experimentos/${expId}/variant-history?variant=${encodeURIComponent(variant)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Erro ${r.status}`)
        return r.json()
      })
      .then((d: VariantHistoryData) => { if (vivo) setData(d) })
      .catch((e: unknown) => { if (vivo) setErro(e instanceof Error ? e.message : 'Falha ao carregar') })
    return () => { vivo = false }
  }, [expId, variant])

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-[#111827] border border-[#1F2937] rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Histórico da variante ${variant}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-[#1F2937]">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">
              Variante {variant} · <span className="font-mono text-gray-400">{slug}</span>
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5 truncate">
              {expName}
              {data?.desde && ` · rodando desde ${formatDateBR(data.desde)}`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-white transition-colors shrink-0 ml-3" aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        {/* Abas */}
        <div className="flex gap-1 px-4 pt-3 border-b border-[#1F2937]">
          {(['desempenho', 'alteracoes'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAba(a)}
              className={clsx(
                'px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors',
                aba === a ? 'bg-[#0D1117] text-white' : 'text-gray-500 hover:text-gray-300',
              )}
            >
              {a === 'desempenho' ? 'Desempenho' : 'Alterações'}
              {a === 'alteracoes' && data && data.alteracoes.length > 0 && (
                <span className="ml-1.5 text-[10px] text-gray-500">{data.alteracoes.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto p-4">
          {erro && <p className="text-xs text-rose-400">{erro}</p>}
          {!data && !erro && <div className="h-32 bg-[#0D1117] rounded-lg animate-pulse" />}

          {data && aba === 'desempenho' && (
            data.desempenho.length === 0 ? (
              <p className="text-xs text-gray-500 py-8 text-center">Esta variante ainda não recebeu tráfego.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-[#1F2937]">
                      <th scope="col" className="text-left py-2 pr-3 font-medium">Dia</th>
                      <th scope="col" className="text-right py-2 px-3 font-medium" title="Page loads (recarga conta de novo)">Views</th>
                      <th scope="col" className="text-right py-2 px-3 font-medium" title="uids distintos que viram">Visitantes</th>
                      <th scope="col" className="text-right py-2 px-3 font-medium" title="Roteados pelo 302 → confirmados na página">Roteados → chegaram</th>
                      <th scope="col" className="text-right py-2 px-3 font-medium">Connect</th>
                      <th scope="col" className="text-right py-2 px-3 font-medium" title="Dos que viram, quantos clicaram pro checkout (uid)">Checkout</th>
                      <th scope="col" className="text-right py-2 pl-3 font-medium">Vendas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F2937]/60">
                    {data.desempenho.map((d) => (
                      <tr key={d.dia} className="text-gray-300">
                        <td className="py-2 pr-3 tabular-nums">{formatDateBR(d.dia)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{fmt(d.visualizacoes)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{fmt(d.visitantes)}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-gray-400">
                          {d.roteados > 0 ? <>{fmt(d.roteados)} <span className="text-gray-600">→</span> {fmt(d.chegaram)}</> : '—'}
                        </td>
                        <td className={clsx('py-2 px-3 text-right tabular-nums font-medium', connectRateColor(d.connectRate))}>
                          {d.connectRate != null ? fmtPct(d.connectRate) : '—'}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums text-amber-400">{d.cliquesCheckout > 0 ? fmt(d.cliquesCheckout) : '—'}</td>
                        <td className="py-2 pl-3 text-right tabular-nums">
                          {d.vendas > 0 ? <span className="text-emerald-400">{fmt(d.vendas)}</span> : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {data && aba === 'alteracoes' && (
            data.alteracoes.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-xs text-gray-400">Nenhuma alteração registrada nesta variante.</p>
                <p className="text-[11px] text-gray-600 max-w-md mx-auto leading-relaxed">
                  O histórico de alterações passou a ser gravado agora. Mudanças anteriores
                  (peso, ativar/desativar, URL) não existem no banco — nunca foram registradas.
                  A partir daqui, toda mudança aparece aqui.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {data.alteracoes.map((a, idx) => (
                  <li key={`${a.occurred_at}-${idx}`} className="flex items-start gap-3 bg-[#0D1117] rounded-lg px-3 py-2">
                    <span className="text-[10px] text-gray-500 tabular-nums shrink-0 mt-0.5 w-24">
                      {new Date(a.occurred_at).toLocaleString('pt-BR', {
                        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                    <span className="text-xs text-gray-300 flex-1">{a.texto}</span>
                    <span
                      className={clsx(
                        'text-[10px] px-1.5 py-0.5 rounded shrink-0',
                        a.origem === 'bandit'
                          ? 'bg-violet-500/15 text-violet-300'
                          : 'bg-[#1F2937] text-gray-400',
                      )}
                      title={a.origem === 'bandit' ? 'Decidido pelo Thompson Sampling (auto-otimização), não por você' : 'Edição manual'}
                    >
                      {a.origem === 'bandit' ? 'bandit' : 'manual'}
                    </span>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      </div>
    </div>
  )
}

function ExperimentRow({
  exp,
  ckExp,
  stats,
  onStatusChange,
  onDelete,
  onUpdated,
  allExps,
}: {
  exp: SbExperiment
  ckExp?: SbExperiment
  stats: ExperimentStats
  onStatusChange: (id: string, status: string) => void
  onDelete: (id: string, status: string) => void
  onUpdated: () => void
  allExps: SbExperiment[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showMatrix, setShowMatrix] = useState(false)
  const [historicoDe, setHistoricoDe] = useState<{ variant: string; slug: string } | null>(null)
  const typeBadge = TYPE_BADGE[exp.type ?? 'page']
  const labels = METRIC_LABELS[exp.type ?? 'page']

  const canActivate = exp.status === 'draft' || exp.status === 'paused'
  const canPause    = exp.status === 'active'
  const canEdit     = exp.status === 'active' || exp.status === 'paused'
  const canEnd      = exp.status === 'active' || exp.status === 'paused'
  const canDelete   = exp.status === 'draft' || exp.status === 'paused' || exp.status === 'ended'
  const canMatrix   = exp.type === 'ob' && !!ckExp && exp.status !== 'ended'
  // "Rascunho" só se aplica a exp.status === 'draft' — paused/ended já rodaram
  // e têm histórico, então o texto de exclusão precisa refletir isso.
  const deleteLabel = exp.status === 'draft' ? 'Excluir rascunho' : 'Excluir experimento'

  function toggle() { onStatusChange(exp.id, exp.status === 'active' ? 'paused' : 'active') }
  function end()    { onStatusChange(exp.id, 'ended') }

  const maxImpressions = Math.max(...stats.variants.map(v => v.impressions), 1)

  return (
    <>
      <tr className="border-b border-[#1F2937] hover:bg-[#111827]/60 transition-colors">
        {/* Expand */}
        <td className="pl-4 pr-2 py-3">
          <button
            onClick={() => setExpanded(x => !x)}
            title={expanded ? 'Recolher detalhes' : 'Expandir detalhes'}
            aria-label={expanded ? 'Recolher detalhes' : 'Expandir detalhes'}
            className="text-gray-500 hover:text-white transition-colors cursor-pointer"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>

        {/* Name + path */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-1.5">
            <p className="text-sm text-white font-medium leading-tight">{exp.name}</p>
            <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded', typeBadge.cls)}>{typeBadge.label}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-[11px] text-gray-500 font-mono">
              {exp.type === 'checkout'
                ? `${ENTRY_BASE}/check/${exp.entry_path.slice(1)}`
                : `${ENTRY_BASE}${exp.entry_path}`}
            </p>
            <CopyButton
              text={exp.type === 'checkout'
                ? `https://${ENTRY_BASE}/check/${exp.entry_path.slice(1)}`
                : `https://${ENTRY_BASE}${exp.entry_path}`}
              label="copiar"
            />
          </div>
        </td>

        {/* Variants summary */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {exp.variants.map((v, i) => (
              <span key={v.name} className={clsx('text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#1F2937]', VARIANT_COLORS[i])}>
                {v.name} {Math.round(v.weight * 100)}%
              </span>
            ))}
          </div>
        </td>

        {/* Status */}
        <td className="px-3 py-3">
          <span className={clsx('text-[11px] font-medium px-2 py-0.5 rounded-full', STATUS_COLOR[exp.status])}>
            {STATUS_LABEL[exp.status]}
          </span>
        </td>

        <td className="px-3 py-3 text-right text-sm text-gray-300">{fmt(stats.totalImpressions)}</td>
        <td className="px-3 py-3 text-right text-sm text-gray-300">{fmt(stats.variants.reduce((s, v) => s + v.conversions, 0))}</td>
        <td className="px-3 py-3 text-right text-sm text-gray-300">{fmtBRL(stats.variants.reduce((s, v) => s + v.receita, 0))}</td>

        {/* Actions */}
        <td className="px-3 py-3 pr-4">
          <div className="flex items-center gap-1 justify-end">
            {canMatrix && (
              <button
                onClick={() => setShowMatrix(true)}
                title="Editar Matriz de Links"
                aria-label="Editar Matriz de Links"
                className="p-1.5 rounded-lg text-gray-500 hover:text-amber-400 hover:bg-amber-400/10 transition-colors cursor-pointer"
              >
                <LayoutGrid size={13} />
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => setShowEdit(true)}
                title="Editar experimento"
                aria-label="Editar experimento"
                className="p-1.5 rounded-lg text-gray-500 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors cursor-pointer"
              >
                <Pencil size={13} />
              </button>
            )}
            {(canActivate || canPause) && (
              <button
                onClick={toggle}
                title={canActivate ? 'Ativar' : 'Pausar'}
                aria-label={canActivate ? 'Ativar' : 'Pausar'}
                className={clsx(
                  'p-1.5 rounded-lg transition-colors cursor-pointer',
                  canActivate
                    ? 'text-gray-500 hover:text-emerald-400 hover:bg-emerald-400/10'
                    : 'text-gray-500 hover:text-yellow-400 hover:bg-yellow-400/10'
                )}
              >
                {canActivate ? <Play size={13} /> : <Pause size={13} />}
              </button>
            )}
            {canEnd && (
              <button onClick={end} title="Encerrar" aria-label="Encerrar" className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer">
                <X size={13} />
              </button>
            )}
            {canDelete && (
              <button onClick={() => onDelete(exp.id, exp.status)} title={deleteLabel} aria-label={deleteLabel} className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded variant stats */}
      {expanded && (
        <tr className="border-b border-[#1F2937]">
          <td colSpan={8} className="px-4 pb-4 pt-2">
            {(exp.fallback_url || exp.scheduled_start || exp.scheduled_end || exp.checkout_slug) && (
              <div className="mb-3 bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2 space-y-1.5">
                {exp.fallback_url && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 shrink-0">Fallback:</span>
                    <a href={exp.fallback_url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-gray-400 hover:text-cyan-400 transition-colors truncate">
                      {exp.fallback_url}
                    </a>
                    <ExternalLink size={9} className="shrink-0 text-gray-400" />
                  </div>
                )}
                {exp.checkout_slug && (
                  <div className="flex items-center gap-2">
                    <Link2 size={9} className="text-violet-400 shrink-0" />
                    <span className="text-[10px] text-gray-500 shrink-0">Checkout vinculado:</span>
                    <span className="text-[10px] font-mono text-violet-400">{exp.checkout_slug}</span>
                  </div>
                )}
                {(exp.scheduled_start || exp.scheduled_end) && (
                  <div className="flex items-center gap-3 text-[10px] text-gray-500">
                    <Clock size={9} className="shrink-0" />
                    {exp.scheduled_start && <span>Início: <span className="text-gray-300">{new Date(exp.scheduled_start).toLocaleString('pt-BR')}</span></span>}
                    {exp.scheduled_end   && <span>Fim: <span className="text-gray-300">{new Date(exp.scheduled_end).toLocaleString('pt-BR')}</span></span>}
                  </div>
                )}
              </div>
            )}

            {(exp.status === 'active' || exp.status === 'paused') && (
              <ExperimentHealthCard experimentId={exp.id} />
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {stats.variants.map((v, i) => {
                const cvr    = v.impressions  > 0 ? (v.conversions / v.impressions) * 100 : 0
                const rpm    = v.impressions  > 0 ? v.receita / v.impressions : 0
                const ticket = v.conversions  > 0 ? v.receita / v.conversions : 0
                // O denominador vem do servidor junto do numerador, na MESMA identidade:
                // 'ab' → uids da variante; 'hits' → usuários GA4 da página. Nunca cruzados.
                const passthroughDenom = v.checkoutDenom ?? 0
                const passthrough = passthroughDenom > 0 && v.checkoutViews !== undefined
                  ? (v.checkoutViews / passthroughDenom) * 100 : null
                const barPct = maxImpressions > 0 ? (v.impressions / maxImpressions) * 100 : 0

                // Z-test: compara esta variante contra a variante A (controle, i=0)
                const control = stats.variants[0]
                const sig = i > 0 ? zTest({
                  n1: control.impressions, c1: control.conversions,
                  n2: v.impressions,       c2: v.conversions,
                  mde: 0.1,
                }) : null
                const sampleShortfall = sig && !sig.meetsMinSample && typeof sig.minSampleNeeded === 'number'
                  ? Math.max(0, sig.minSampleNeeded - v.impressions)
                  : 0

                return (
                  <div key={v.name} className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <span className={clsx('text-xs font-bold', VARIANT_COLORS[i])}>
                        Variante {v.name} · {Math.round(v.weight * 100)}%
                      </span>
                      {v.url && (
                        <a href={v.url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-cyan-400 transition-colors" title="Abrir">
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>

                    {/* Slug (id da variante) + desde quando roda + histórico */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-[10px] font-mono text-gray-500 truncate">{v.slug}</p>
                        {v.desde && (
                          <span
                            className="text-[10px] font-mono text-gray-600 shrink-0"
                            title={`Rodando desde ${formatDateBR(v.desde)} (primeira impressão registrada desta variante)`}
                          >
                            {ddmm(v.desde)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setHistoricoDe({ variant: v.name, slug: v.slug })}
                          className="shrink-0 text-gray-600 hover:text-cyan-400 transition-colors"
                          title="Histórico desta variante"
                          aria-label={`Histórico da variante ${v.name}`}
                        >
                          <History size={11} />
                        </button>
                      </div>
                      {exp.type === 'checkout' && (
                        <CopyButton text={`https://${universalLink(exp)}`} label="link universal" />
                      )}
                    </div>

                    {/* Badges estatísticas (Z-test + Bayes + amostra) */}
                    {sig && (
                      <div className="flex flex-wrap gap-1.5">
                        <div className={clsx(
                          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium',
                          sig.confidence >= 95
                            ? sig.winner === 'B'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-red-500/15 text-red-400 border border-red-500/30'
                            : sig.confidence === 90
                              ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'
                              : 'bg-[#1F2937] text-gray-500 border border-[#374151]'
                        )}>
                          {sig.confidence >= 95 ? (
                            sig.winner === 'B' ? `↑ Vence A com ${sig.confidence}% conf.` : `↓ Perde de A com ${sig.confidence}% conf.`
                          ) : sig.confidence === 90 ? (
                            `~ Tendência ${sig.winner === 'B' ? 'positiva' : 'negativa'} 90%`
                          ) : (
                            `Z dados insuficientes`
                          )}
                        </div>
                        {typeof sig.bayesProb === 'number' && (
                          <div className={clsx(
                            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium border',
                            sig.bayesProb >= 0.95 ? 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30'
                              : sig.bayesProb >= 0.8 ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                              : 'bg-[#1F2937] text-gray-500 border-[#374151]',
                          )} title="Probabilidade bayesiana de vencer A">
                            P(vence A) = {(sig.bayesProb * 100).toFixed(0)}%
                          </div>
                        )}
                        {sampleShortfall > 0 && (
                          <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium border bg-amber-500/10 text-amber-400 border-amber-500/30" title="Amostra mínima pelo Lehr (MDE 10%, α 5%, β 20%)">
                            Faltam {fmt(sampleShortfall)} visitantes
                          </div>
                        )}
                      </div>
                    )}

                    {/* Metrics 2×2 */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-[#0D1117] rounded-lg p-2.5 text-center">
                        <p className="text-[10px] text-gray-500 leading-tight">{labels.cvr}</p>
                        <p className="text-sm text-white font-semibold mt-0.5">{fmtPct(cvr)}</p>
                      </div>
                      <div className="bg-[#0D1117] rounded-lg p-2.5 text-center">
                        <p className="text-[10px] text-gray-500 leading-tight">Faturamento</p>
                        <p className="text-sm text-emerald-400 font-semibold mt-0.5">{fmtBRL(v.receita)}</p>
                      </div>
                      <div className="bg-[#0D1117] rounded-lg p-2.5 text-center">
                        <p className="text-[10px] text-gray-500 leading-tight">{labels.rpv}</p>
                        <p className="text-sm text-white font-semibold mt-0.5">{fmtBRL(rpm)}</p>
                      </div>
                      <div className="bg-[#0D1117] rounded-lg p-2.5 text-center">
                        <p className="text-[10px] text-gray-500 leading-tight">Ticket médio</p>
                        <p className="text-sm text-white font-semibold mt-0.5">{ticket > 0 ? fmtBRL(ticket) : '—'}</p>
                      </div>
                    </div>

                    {/* Lista vertical das métricas de tráfego (uma embaixo da outra) */}
                    {(() => {
                      const cr = connectRateDisplay(v.connectRate ?? null, v.routeClicks ?? 0, v.connectLanded ?? 0)
                      const ehPagina = exp.type === 'page'
                      return (
                        <div className="bg-[#0D1117] rounded-lg px-3 py-2 divide-y divide-[#1F2937]/60">
                          {/* O RESULTADO da variante vem primeiro — é o que o teste quer decidir.
                              As métricas abaixo explicam COMO se chegou nele. */}
                          <MetricRow
                            label="Vendas"
                            title="Vendas do produto principal (front-end) atribuídas a esta variante pelo sck. Só conta venda posterior ao início do experimento."
                            value={
                              <span className={v.conversions > 0 ? 'text-emerald-400 tabular-nums' : 'text-gray-500 tabular-nums'}>
                                {fmt(v.conversions)}
                              </span>
                            }
                          />

                          {ehPagina && (
                            <MetricRow
                              label="Connect rate"
                              title={
                                cr.kind === 'low-sample'
                                  ? `Amostra baixa: ${cr.routed} clique(s) roteado(s). Precisa de ~${CONNECT_RATE_MIN_CLICKS} por variante pro % valer (±10 pts). A fórmula está certa; falta volume.`
                                  : cr.kind === 'none'
                                    ? 'Aguardando cliques roteados na janela. Não é 0% — é falta de dado.'
                                    : 'Dos uids que o 302 roteou, quantos o beacon confirmou na página (interseção, mesma identidade). A diferença é a perda no salto: página lenta ou desistência. Alvo ≥ 90%.'
                              }
                              value={
                                cr.kind === 'low-sample'
                                  ? <span className="text-gray-500">n baixo ({cr.routed})</span>
                                  : cr.kind === 'value'
                                    ? <span className={connectRateColor(cr.rate)}>{fmtPct(cr.rate)}</span>
                                    : <span className="text-gray-500">—</span>
                              }
                            />
                          )}

                          {ehPagina && labels.passthrough && (
                            <MetricRow
                              label="Passagem p/ checkout"
                              title={
                                v.checkoutFonte === 'hits'
                                  ? 'Aproximada (~GA): clicantes distintos (client id do GA) ÷ usuários GA4 desta página. O cid reseta (Safari/ITP, outro aparelho) — tende a subestimar. Cobre todo o tráfego.'
                                  : v.checkoutFonte === 'uid'
                                    ? 'EXATA: dos uids que viram esta variante, quantos clicaram pro checkout. O GTM server-side lê o cookie uid (HttpOnly) — mesma identidade das views. Cobre só o tráfego roteado.'
                                    : v.checkoutFonte === 'ab'
                                      ? 'EXATA: interseção de uid entre quem viu esta variante e quem entrou no checkout A/B vinculado.'
                                      : 'Imensurável: sem checkout A/B vinculado e sem cliques da tag. Não é 0% — é falta de instrumentação.'
                              }
                              value={
                                passthrough !== null
                                  ? <span className="text-white">{fmtPct(passthrough)}</span>
                                  : <span className="text-gray-500">— <span className="text-[9px]">s/ teste</span></span>
                              }
                            />
                          )}

                          {ehPagina && (
                            <MetricRow
                              label="Roteados → na página"
                              title="Quantos o 302 roteou → quantos o beacon confirmou que abriram a página. A diferença é a perda no salto."
                              value={
                                <span className="text-gray-300 tabular-nums">
                                  {v.routeClicks !== undefined ? fmt(v.routeClicks) : '—'}
                                  <span className="text-gray-600"> → </span>
                                  {v.connectLanded !== undefined ? fmt(v.connectLanded) : '—'}
                                </span>
                              }
                            />
                          )}

                          <MetricRow
                            label="Visualizações de página"
                            title="Page loads contados pelo beacon (uma pessoa que recarrega conta mais de uma vez)."
                            value={<span className="text-gray-300 tabular-nums">{fmt(v.impressions)}</span>}
                          />

                          {ehPagina && v.uniqueVisitors !== undefined && (
                            <MetricRow
                              label="Visitantes únicos"
                              title="uids distintos que viram esta variante (o mesmo visitante conta uma vez)."
                              value={<span className="text-gray-300 tabular-nums">{fmt(v.uniqueVisitors)}</span>}
                            />
                          )}

                          {ehPagina && labels.passthrough && (
                            <MetricRow
                              label="Cliques pro checkout"
                              title={
                                v.checkoutFonte === 'uid'
                                  ? 'Exato: uid do Worker lido server-side pelo GTM (mesma identidade das views).'
                                  : 'Aproximado: clicantes distintos pelo client id do GA (visitante não veio pelo link /r/).'
                              }
                              value={
                                <span className="text-amber-400 tabular-nums">
                                  {v.checkoutViews !== undefined ? fmt(v.checkoutViews) : '—'}
                                  {v.checkoutFonte === 'hits' && <span className="ml-1 text-[9px] font-normal text-amber-400/70">~GA</span>}
                                  {v.checkoutFonte === 'uid' && <span className="ml-1 text-[9px] font-normal text-emerald-400/70">uid</span>}
                                </span>
                              }
                            />
                          )}

                          {/* Barra: divisão de tráfego entre as variantes, num relance */}
                          <div className="pt-1.5">
                            <div className="h-1 bg-[#1F2937] rounded-full overflow-hidden">
                              <div className={clsx('h-full rounded-full transition-all', VARIANT_BAR_COLORS[i])} style={{ width: `${barPct}%` }} />
                            </div>
                          </div>
                        </div>
                      )
                    })()}

                  </div>
                )
              })}
            </div>
          </td>
        </tr>
      )}

      {/* Modais locais */}
      {historicoDe && (
        <VariantHistoryModal
          expId={exp.id}
          expName={exp.name}
          variant={historicoDe.variant}
          slug={historicoDe.slug}
          onClose={() => setHistoricoDe(null)}
        />
      )}
      {showEdit && (
        <EditExperimentModal
          exp={exp}
          allExps={allExps}
          stats={stats}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); onUpdated() }}
        />
      )}
      {showMatrix && ckExp && (
        <MatrizOBModal
          ckExp={ckExp}
          obExp={exp}
          onClose={() => setShowMatrix(false)}
          onSaved={() => { setShowMatrix(false); onUpdated() }}
        />
      )}
    </>
  )
}

// ── Experiments Table ─────────────────────────────────────────────────────────

interface ExperimentsTableProps {
  exps: SbExperiment[]
  allExps: SbExperiment[]
  statsMap: Record<string, { variants: VariantStat[]; totalImpressions: number }>
  onStatusChange: (id: string, status: string) => void
  onDelete: (id: string, status: string) => void
  onUpdated: () => void
}

// ── F4: guarda de significância (mobile) ──────────────────────────────────────
//
// No mobile a tabela crua vira UM veredito por experimento. Toda a matemática é
// deterministica e vem de lib/stats.ts (zTest / requiredSampleSize /
// sequentialPocock — o Bayes roda dentro do zTest). NADA é gerado por IA.
//
// Estados: 'no-data' (sem tráfego suficiente pra comparar) · 'collecting' (ainda
// não bateu a amostra mínima) · 'winner' (venceu o limiar sequencial) ·
// 'inconclusive' (amostra ok, diferença não passou do limiar).

type ExpStateKind = 'no-data' | 'collecting' | 'winner' | 'inconclusive'

interface ExpState {
  kind: ExpStateKind
  title: string     // rótulo textual — nunca só cor (ex.: "Vencedor: B", "Coletando")
  detail?: string   // linha de apoio (ex.: "62% da amostra · ~4 dias", "+18%")
  tone: 'emerald' | 'cyan' | 'slate' | 'gray'
}

const EXP_STATE_TONE: Record<ExpState['tone'], { box: string; icon: string }> = {
  emerald: { box: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: 'text-emerald-400' },
  cyan:    { box: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',          icon: 'text-cyan-400' },
  slate:   { box: 'bg-slate-500/15 text-slate-300 border-slate-500/30',       icon: 'text-slate-300' },
  gray:    { box: 'bg-[#1F2937] text-gray-400 border-[#374151]',              icon: 'text-gray-500' },
}

const EXP_STATE_ICON: Record<ExpStateKind, React.ComponentType<{ size?: number; className?: string }>> = {
  winner: CheckCircle2,
  collecting: Activity,
  inconclusive: Scale,
  'no-data': FlaskConical,
}

const DAY_MS = 86_400_000

/**
 * Deriva o veredito de um experimento — determinístico, em código.
 *
 * Limiar de significância: NÃO usa o 1,96 fixo (α 5%). Usa `sequentialPocock`
 * com o índice de espiada REAL (≈ 1 espiada por dia rodando): quanto mais dias
 * o teste é olhado, mais alta a barra pra declarar vencedor — é a correção do
 * "peeking problem" (espiar 10× a 5% ⇒ ~19% de falso positivo real).
 *
 * Amostra: `requiredSampleSize` (Lehr) sobre a CR do controle. % = braço-gargalo
 * ÷ amostra mínima. "~N dias" = extrapolação linear pelo ritmo atual do gargalo.
 * Sem amostra mínima NUNCA declara vencedor (regra do módulo lib/stats.ts).
 */
function deriveExperimentState(exp: SbExperiment, stats: ExperimentStats): ExpState {
  const variants = stats.variants
  const control = variants[0]
  const cr = (v: VariantStat) => (v.impressions > 0 ? v.conversions / v.impressions : 0)

  // Precisa de controle com tráfego + ao menos um desafiante com tráfego.
  const challengers = variants.slice(1).filter((v) => v.impressions > 0)
  if (!control || control.impressions === 0 || challengers.length === 0) {
    return { kind: 'no-data', title: 'Sem dados', tone: 'gray' }
  }

  // Melhor desafiante por CR = o braço a comparar contra o controle (A vs B).
  const best = challengers.reduce((a, b) => (cr(b) > cr(a) ? b : a))

  // Dias rodando: started_at do experimento; senão a 1ª impressão mais antiga.
  const startIso =
    exp.started_at ??
    variants.map((v) => v.desde).filter((d): d is string => !!d).sort()[0] ??
    null
  const daysRunning = startIso
    ? Math.max(1, Math.round((Date.now() - new Date(startIso).getTime()) / DAY_MS))
    : 1

  // Amostra mínima por variante (Lehr) — baseline = CR do controle, piso 1%
  // (mesma régua interna do zTest). Braço-gargalo = o menor dos dois.
  const required = requiredSampleSize({ baselineCR: Math.max(cr(control), 0.01), mde: 0.1 })
  const bottleneck = Math.min(control.impressions, best.impressions)
  const pct = required > 0 ? Math.min(1, bottleneck / required) : 1
  const meetsSample = required > 0 && bottleneck >= required

  // Ainda coletando: mostra % e ETA no ritmo atual, sem declarar vencedor.
  if (!meetsSample) {
    const remaining = Math.max(0, required - bottleneck)
    const perDay = bottleneck / daysRunning
    const daysLeft = perDay > 0 && remaining > 0 ? Math.ceil(remaining / perDay) : 0
    const detail = daysLeft > 0
      ? `${Math.round(pct * 100)}% da amostra · ~${daysLeft} dia${daysLeft === 1 ? '' : 's'}`
      : `${Math.round(pct * 100)}% da amostra`
    return { kind: 'collecting', title: 'Coletando', detail, tone: 'cyan' }
  }

  // Amostra ok: significância pelo limiar sequencial (não pelo 1,96 fixo).
  const sig = zTest({
    n1: control.impressions, c1: control.conversions,
    n2: best.impressions,    c2: best.conversions,
    mde: 0.1,
  })
  const zThreshold = sequentialPocock(daysRunning, daysRunning)

  if (sig.z >= zThreshold && sig.winner) {
    const winnerName = sig.winner === 'B' ? best.name : control.name
    // lift do VENCEDOR sobre o perdedor, sempre exibido positivo.
    const liftPct = sig.winner === 'B'
      ? sig.lift * 100
      : cr(best) > 0 ? ((cr(control) - cr(best)) / cr(best)) * 100 : 0
    return {
      kind: 'winner',
      title: `Vencedor: ${winnerName}`,
      detail: `+${Math.round(liftPct)}%`,
      tone: 'emerald',
    }
  }

  return { kind: 'inconclusive', title: 'Inconclusivo', tone: 'slate' }
}

// ── C6: dot-and-whisker (mobile) ──────────────────────────────────────────────
//
// Complementa o veredito textual do F4 com a GEOMETRIA da decisão: para cada
// desafiante vs. controle, um ponto (diferença de conversão) e um bigode (o
// intervalo de confiança), com uma régua vertical no ZERO. O bigode cruzar o
// zero é, por construção, a MESMA leitura do estado — porque usa o MESMO limiar
// sequencial (`sequentialPocock`) e o MESMO `z` (`zTest`) que o veredito.
//
// Truque que evita reimplementar estatística: `zTest` devolve `z = |Δ| / se`, com
// Δ = cr2 − cr1. Então `se = |Δ| / z`, e o bigode é `Δ ± zThreshold·se`. Isso cruza
// o zero ⇔ `z < zThreshold` ⇔ o veredito não declara vencedor. Um único limiar
// governa as duas leituras — nunca se contradizem.

interface Whisker {
  name: string
  colorIdx: number
  center: number        // diferença de conversão: cr(desafiante) − cr(controle), em fração
  lo: number
  hi: number
  wide: boolean         // z≈0 (Δ nulo): incerteza máxima, bigode ocupa a régua toda
  crossesZero: boolean
  meetsSample: boolean
  label: string         // lift relativo (%) — mesmo número do card; pp quando cr(controle)=0
}

function computeWhiskers(exp: SbExperiment, stats: ExperimentStats): { rows: Whisker[]; domain: number } | null {
  const variants = stats.variants
  const control = variants[0]
  if (!control || control.impressions === 0) return null
  const cr = (v: VariantStat) => (v.impressions > 0 ? v.conversions / v.impressions : 0)
  const crControl = cr(control)

  // Mesmo start/dias/limiar sequencial que `deriveExperimentState` — é o que
  // amarra "cruza o zero" a "não há vencedor". O limiar SOBE com os dias rodando
  // (correção de peeking); o bigode alarga junto, então espiar não vira falso win.
  const startIso =
    exp.started_at ??
    variants.map((v) => v.desde).filter((d): d is string => !!d).sort()[0] ??
    null
  const daysRunning = startIso
    ? Math.max(1, Math.round((Date.now() - new Date(startIso).getTime()) / DAY_MS))
    : 1
  const zThreshold = sequentialPocock(daysRunning, daysRunning)
  const required = requiredSampleSize({ baselineCR: Math.max(crControl, 0.01), mde: 0.1 })

  const rows: Whisker[] = []
  variants.forEach((v, i) => {
    if (i === 0 || v.impressions === 0) return
    // zTest dá z, cr1, cr2 e lift — a estatística inteira vem daqui, não reimplementamos.
    const sig = zTest({
      n1: control.impressions, c1: control.conversions,
      n2: v.impressions,       c2: v.conversions,
      mde: 0.1,
    })
    const center = sig.cr2 - sig.cr1
    const se = sig.z > 0 ? Math.abs(center) / sig.z : Infinity
    const half = Number.isFinite(se) ? zThreshold * se : Infinity
    const wide = !Number.isFinite(half)
    const lo = wide ? 0 : center - half
    const hi = wide ? 0 : center + half
    const crossesZero = wide || (lo <= 0 && hi >= 0)
    const bottleneck = Math.min(control.impressions, v.impressions)
    const meetsSample = required > 0 && bottleneck >= required
    const sign = center >= 0 ? '+' : ''
    const label = crControl > 0
      ? `${sign}${(sig.lift * 100).toFixed(0)}%`
      : `${sign}${(center * 100).toFixed(1)}pp`
    rows.push({ name: v.name, colorIdx: i, center, lo, hi, wide, crossesZero, meetsSample, label })
  })
  if (rows.length === 0) return null

  // Domínio SIMÉTRICO em torno do zero → a régua do zero fica sempre no centro
  // (50%), e "cruzar a linha do meio" é a leitura direta. Cobre a ponta mais
  // extrema entre todos os desafiantes + folga; piso evita colapso quando ~0.
  let maxAbs = 0
  for (const r of rows) {
    if (r.wide) continue
    maxAbs = Math.max(maxAbs, Math.abs(r.lo), Math.abs(r.hi), Math.abs(r.center))
  }
  const domain = Math.max(maxAbs * 1.15, 0.005)
  return { rows, domain }
}

const WHISKER_TONE: Record<'emerald' | 'rose' | 'cyan' | 'slate', { bar: string; dot: string; text: string }> = {
  emerald: { bar: 'bg-emerald-500', dot: 'bg-emerald-300 border-emerald-600', text: 'text-emerald-400' },
  rose:    { bar: 'bg-rose-500',    dot: 'bg-rose-300 border-rose-600',       text: 'text-rose-400' },
  cyan:    { bar: 'bg-cyan-500',    dot: 'bg-cyan-300 border-cyan-600',       text: 'text-cyan-400' },
  slate:   { bar: 'bg-slate-500',   dot: 'bg-slate-300 border-slate-500',     text: 'text-slate-300' },
}

// Tom por linha, NUNCA cor sozinha (a régua do zero é o sinal primário):
// cruza o zero → slate (inconclusivo, a regra-mãe); separado mas sem amostra
// mínima → cyan (coletando); separado e com amostra → emerald/rose pela direção.
function whiskerTone(r: Whisker): keyof typeof WHISKER_TONE {
  if (r.crossesZero) return 'slate'
  if (!r.meetsSample) return 'cyan'
  return r.center >= 0 ? 'emerald' : 'rose'
}

function DotWhisker({ exp, stats }: { exp: SbExperiment; stats: ExperimentStats }) {
  const data = computeWhiskers(exp, stats)
  if (!data) return null
  const { rows, domain } = data
  // Mapeia lift → posição %: domínio [-domain,+domain] → [3%,97%]; zero em 50%.
  const pos = (x: number) => Math.max(3, Math.min(97, 50 + (x / domain) * 50))
  const controlName = stats.variants[0]?.name ?? 'A'

  return (
    <div className="rounded-lg border border-[#1F2937] bg-[#0D1117] px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
          Lift vs. controle ({controlName})
        </span>
        <span className="text-[10px] text-gray-500">ponto ± IC</span>
      </div>

      <div className="space-y-1.5">
        {rows.map((r) => {
          const t = WHISKER_TONE[whiskerTone(r)]
          const loPos = r.wide ? 3 : pos(r.lo)
          const hiPos = r.wide ? 97 : pos(r.hi)
          const cPos = pos(r.center)
          return (
            <div
              key={r.name}
              className="flex items-center gap-2"
              title={`Variante ${r.name}: ${r.label} vs. ${controlName}${r.crossesZero ? ' — intervalo cruza o zero (inconclusivo)' : ''}`}
            >
              <span className={clsx('w-4 shrink-0 text-center text-[11px] font-bold', VARIANT_COLORS[r.colorIdx % VARIANT_COLORS.length])}>
                {r.name}
              </span>
              {/* Faixa do gráfico — puramente visual (o rótulo textual à direita e o
                  card acima já dão o equivalente acessível, ver C13). */}
              <div className="relative h-6 flex-1" aria-hidden="true">
                {/* Régua vertical no ZERO: domínio simétrico ⇒ sempre no centro. */}
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gray-500/70" />
                <span className="absolute left-1/2 top-0 -translate-x-1/2 text-[8px] leading-none text-gray-600">0</span>
                {/* Bigode = intervalo de confiança. */}
                <div
                  className={clsx('absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full', t.bar)}
                  style={{ left: `${loPos}%`, width: `${Math.max(0, hiPos - loPos)}%` }}
                />
                {/* Tampas do bigode (limites do IC). */}
                <div className={clsx('absolute top-1/2 h-2.5 w-px -translate-y-1/2', t.bar)} style={{ left: `${loPos}%` }} />
                <div className={clsx('absolute top-1/2 h-2.5 w-px -translate-y-1/2', t.bar)} style={{ left: `${hiPos}%` }} />
                {/* Ponto = diferença de conversão (lift). */}
                <div
                  className={clsx('absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border', t.dot)}
                  style={{ left: `${cPos}%` }}
                />
              </div>
              <span className={clsx('w-11 shrink-0 text-right text-[11px] tabular-nums', t.text)}>
                {r.label}
              </span>
            </div>
          )
        })}
      </div>

      <p className="text-[10px] leading-snug text-gray-500">
        Ponto = diferença de conversão · barra = intervalo de confiança (sequencial). Cruza a linha do zero → <span className="text-slate-300">inconclusivo</span>.
      </p>
    </div>
  )
}

/**
 * Card de estado mobile (F4). Mostra o veredito e, sob o CTA "ver números",
 * expande a MESMA tabela crua do desktop (ExperimentsTableDesktop) para este
 * único experimento — o desktop nunca vê este componente (fica atrás de md:hidden).
 */
function ExperimentStateCard({
  exp, stats, allExps, onStatusChange, onDelete, onUpdated,
}: {
  exp: SbExperiment
  stats: ExperimentStats
} & Omit<ExperimentsTableProps, 'exps' | 'statsMap'>) {
  const [showNumbers, setShowNumbers] = useState(false)
  const st = deriveExperimentState(exp, stats)
  const tone = EXP_STATE_TONE[st.tone]
  const StateIcon = EXP_STATE_ICON[st.kind]
  const typeBadge = TYPE_BADGE[exp.type ?? 'page']
  const path = exp.type === 'checkout'
    ? `${ENTRY_BASE}/check/${exp.entry_path.slice(1)}`
    : `${ENTRY_BASE}${exp.entry_path}`

  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 space-y-3">
      {/* Cabeçalho: nome + tipo + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm text-white font-medium leading-tight truncate">{exp.name}</p>
            <span className={clsx('shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded', typeBadge.cls)}>{typeBadge.label}</span>
          </div>
          <p className="text-[11px] text-gray-500 font-mono truncate mt-0.5">{path}</p>
        </div>
        <span className={clsx('shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full', STATUS_COLOR[exp.status])}>
          {STATUS_LABEL[exp.status]}
        </span>
      </div>

      {/* O veredito — cor por tom, mas SEMPRE com ícone + rótulo textual */}
      <div className={clsx('flex items-center gap-2.5 rounded-lg border px-3 py-2.5', tone.box)}>
        <StateIcon size={18} className={clsx('shrink-0', tone.icon)} />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{st.title}</p>
          {st.detail && <p className="text-[11px] leading-tight mt-0.5 opacity-80">{st.detail}</p>}
        </div>
      </div>

      {/* C6 — dot-and-whisker: complementa o veredito com a geometria da decisão
          (ponto = lift, bigode = IC, régua no zero). Renderiza só aqui, no card
          mobile; o desktop nunca monta este componente. Null quando 'sem dados'. */}
      <DotWhisker exp={exp} stats={stats} />

      {/* CTA: abre a tabela crua (a mesma que fica md:block no desktop) */}
      <button
        onClick={() => setShowNumbers((x) => !x)}
        aria-expanded={showNumbers}
        className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-cyan-400 border border-[#1F2937] rounded-lg py-2 transition-colors cursor-pointer"
      >
        {showNumbers ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {showNumbers ? 'ocultar números' : 'ver números'}
      </button>

      {showNumbers && (
        <ExperimentsTableDesktop
          exps={[exp]}
          allExps={allExps}
          statsMap={{ [exp.id]: stats }}
          onStatusChange={onStatusChange}
          onDelete={onDelete}
          onUpdated={onUpdated}
        />
      )}
    </div>
  )
}

/**
 * Dispatcher: desktop mantém a tabela crua INTACTA (hidden md:block); mobile
 * (< md) troca por um card de veredito por experimento (F4). A computação
 * estatística do mobile só roda quando `useIsMobile()` é true — no desktop o
 * bloco mobile nem monta, então zero custo de Monte Carlo lá.
 */
function ExperimentsTable(props: ExperimentsTableProps) {
  const isMobile = useIsMobile()
  return (
    <>
      {/* Desktop: idêntico ao anterior (a tabela abaixo não muda em nada ≥ md). */}
      <div className="hidden md:block">
        <ExperimentsTableDesktop {...props} />
      </div>

      {/* Mobile: um estado por experimento, não a tabela crua. */}
      {isMobile && (
        <div className="md:hidden space-y-2">
          {props.exps.map((exp) => (
            <ExperimentStateCard
              key={exp.id}
              exp={exp}
              stats={props.statsMap[exp.id] ?? { variants: exp.variants.map((v) => ({ ...v, impressions: 0, conversions: 0, receita: 0 })), totalImpressions: 0 }}
              allExps={props.allExps}
              onStatusChange={props.onStatusChange}
              onDelete={props.onDelete}
              onUpdated={props.onUpdated}
            />
          ))}
        </div>
      )}
    </>
  )
}

function ExperimentsTableDesktop({
  exps,
  allExps,
  statsMap,
  onStatusChange,
  onDelete,
  onUpdated,
}: ExperimentsTableProps) {
  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1F2937] text-[11px] text-gray-500 uppercase tracking-wider">
              <th className="pl-4 pr-2 py-3 w-8" />
              <th className="px-3 py-3 text-left">Experimento</th>
              <th className="px-3 py-3 text-left">Variantes</th>
              <th className="px-3 py-3 text-left">Status</th>
              <th className="px-3 py-3 text-right">Visualizações</th>
              <th className="px-3 py-3 text-right">Vendas</th>
              <th className="px-3 py-3 text-right">Faturamento</th>
              <th className="px-3 py-3 pr-4 w-28" />
            </tr>
          </thead>
          <tbody>
            {exps.map((exp) => {
              const ckExp = exp.type === 'ob'
                ? allExps.find(e => e.type === 'checkout' && e.entry_path === exp.entry_path && e.status !== 'ended')
                : undefined
              return (
                <ExperimentRow
                  key={exp.id}
                  exp={exp}
                  ckExp={ckExp}
                  stats={statsMap[exp.id] ?? { variants: exp.variants.map(v => ({ ...v, impressions: 0, conversions: 0, receita: 0 })), totalImpressions: 0 }}
                  onStatusChange={onStatusChange}
                  onDelete={onDelete}
                  onUpdated={onUpdated}
                  allExps={allExps}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Quarentena de bot_uids (collapsible) ──────────────────────────────────────
// Lê /api/admin/bot-uids?status=suspect, deixa admin confirmar ou limpar cada
// uid. Confirma viraliza pra status='confirmed' (exp_health considera bot);
// Limpar volta pra 'cleared' (ignorado pelo scoring).

type BotUidRow = {
  uid: string
  score: number
  signals: Record<string, unknown>
  status: string
  created_at: string
}

function QuarantineSection() {
  const [rows, setRows] = useState<BotUidRow[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<{ uid: string; status: 'confirmed' | 'cleared' } | null>(null)
  const [busyUid, setBusyUid] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/bot-uids?status=suspect&limit=100', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || 'Falha ao carregar.'); return }
      setRows((json.rows ?? []) as BotUidRow[])
    } catch {
      setError('Erro de rede.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (open) load() }, [open, load])

  async function applyStatus(uid: string, status: 'confirmed' | 'cleared', pwd: string) {
    setPending(null)
    setBusyUid(uid)
    try {
      const res = await fetch('/api/admin/bot-uids', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': pwd },
        body: JSON.stringify({ uid, status }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || 'Erro ao atualizar.'); return }
      // Remove da lista local — mudou de status (suspect → confirmed|cleared)
      setRows((prev) => prev.filter((r) => r.uid !== uid))
    } catch {
      setError('Erro de rede ao atualizar.')
    } finally {
      setBusyUid('')
    }
  }

  function signalsSummary(signals: Record<string, unknown>): string {
    const keys = Object.entries(signals)
      .filter(([, v]) => v && v !== 0 && v !== false)
      .map(([k]) => k)
    return keys.length ? keys.join(', ') : '—'
  }

  return (
    <div className="rounded-xl border border-[#1F2937] overflow-hidden">
      <button
        onClick={() => setOpen((x) => !x)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#111827] hover:bg-[#1a2234] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Bot size={13} className="text-amber-400" />
          <span className="font-medium">Quarentena de bots</span>
          <span className="text-gray-400">
            {loading ? 'carregando…' : `${rows.length} uid${rows.length !== 1 ? 's' : ''} suspeito${rows.length !== 1 ? 's' : ''}`}
          </span>
        </div>
        {open ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
      </button>
      {open && (
        <div className="border-t border-[#1F2937]">
          {error && <p className="px-4 py-2 text-[11px] text-red-400">{error}</p>}
          {!loading && rows.length === 0 && !error && (
            <p className="px-4 py-6 text-[11px] text-gray-500 text-center">Nenhum uid suspeito no momento.</p>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-[#1F2937]">
                    <th className="py-2 px-4 font-medium">uid</th>
                    <th className="py-2 px-3 font-medium text-right">score</th>
                    <th className="py-2 px-3 font-medium">sinais</th>
                    <th className="py-2 px-3 font-medium">visto em</th>
                    <th className="py-2 px-4 font-medium text-right">ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const busy = busyUid === r.uid
                    return (
                      <tr key={r.uid} className="border-b border-[#1F2937] last:border-b-0">
                        <td className="py-2 px-4 font-mono text-[11px] text-gray-300 truncate max-w-[260px]" title={r.uid}>{r.uid}</td>
                        <td className="py-2 px-3 text-right text-gray-300">{Number(r.score).toFixed(2)}</td>
                        <td className="py-2 px-3 text-[10px] text-gray-400 font-mono">{signalsSummary(r.signals ?? {})}</td>
                        <td className="py-2 px-3 text-[10px] text-gray-500">{new Date(r.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td className="py-2 px-4 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => setPending({ uid: r.uid, status: 'confirmed' })}
                              disabled={busy}
                              title="Confirmar como bot (entra no scoring)"
                              className={clsx(
                                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium border transition-colors cursor-pointer',
                                busy ? 'opacity-40 cursor-not-allowed' : 'bg-red-500/10 text-red-300 border-red-500/30 hover:bg-red-500/20'
                              )}
                            >
                              <Bot size={10} /> Confirmar
                            </button>
                            <button
                              onClick={() => setPending({ uid: r.uid, status: 'cleared' })}
                              disabled={busy}
                              title="Limpar (ignorar — não é bot)"
                              className={clsx(
                                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium border transition-colors cursor-pointer',
                                busy ? 'opacity-40 cursor-not-allowed' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                              )}
                            >
                              <ShieldCheck size={10} /> Limpar
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-end px-4 py-2 border-t border-[#1F2937] bg-[#0D1117]">
            <button
              onClick={load}
              className="text-[10px] text-gray-500 hover:text-cyan-400 transition-colors cursor-pointer"
            >
              {loading ? 'carregando…' : 'recarregar'}
            </button>
          </div>
        </div>
      )}

      {pending && (
        <AdminGateModal
          label={pending.status === 'confirmed'
            ? 'Confirmar este uid como bot. Vai entrar no pct_bots da saúde do experimento.'
            : 'Marcar como não-bot. O scoring ignora este uid daqui pra frente.'}
          onConfirm={(pwd) => applyStatus(pending.uid, pending.status, pwd)}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}

// ── Orphan slugs section (collapsible) ────────────────────────────────────────

function OrphanSection({
  title,
  subtitle,
  icon,
  open,
  onToggle,
  buckets,
  showLastExperiment = false,
}: {
  title: string
  subtitle: string
  icon: React.ReactNode
  open: boolean
  onToggle: () => void
  buckets: OrphanBucket[]
  showLastExperiment?: boolean
}) {
  return (
    <div className="rounded-xl border border-[#1F2937] overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#111827] hover:bg-[#1a2234] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {icon}
          <span className="font-medium">{title}</span>
          <span className="text-gray-400">{subtitle}</span>
        </div>
        {open ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 border-t border-[#1F2937]">
                <th className="py-2 px-4 font-medium">sck_slug</th>
                <th className="py-2 px-4 font-medium text-right">Vendas</th>
                <th className="py-2 px-4 font-medium text-right">Faturamento</th>
                {showLastExperiment && <th className="py-2 px-4 font-medium">Último experimento</th>}
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.sckSlug} className="border-t border-[#1F2937]">
                  <td className="py-2 px-4 font-mono text-[11px] text-gray-300">{b.sckSlug}</td>
                  <td className="py-2 px-4 text-right text-gray-300">{b.count}</td>
                  <td className="py-2 px-4 text-right text-gray-300">{formatCurrency(b.receita)}</td>
                  {showLastExperiment && (
                    <td className="py-2 px-4 text-gray-400">
                      {b.lastExperimentName ?? '—'}
                      {b.lastExperimentEndedAt && (
                        <span className="text-gray-400 ml-1.5">· {formatDateBR(b.lastExperimentEndedAt.slice(0, 10))}</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ExperimentosClient({
  experiments,
  statsMap,
  orphanSales = [],
  inactiveSlugs = [],
  neverTestedSlugs = [],
}: Props) {
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [showNeverTested, setShowNeverTested] = useState(false)
  const [showOrphans, setShowOrphans] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ id: string; status: string; label: string } | null>(null)
  // Guarda o status junto pra montar o texto certo no modal de confirmação
  // (rascunho vs. experimento com histórico — ver AdminGateModal abaixo).
  const [pendingDelete, setPendingDelete] = useState<{ id: string; status: string } | null>(null)

  const activeExps   = experiments.filter((e) => e.status !== 'ended')
  const archivedExps = experiments.filter((e) => e.status === 'ended')

  async function executeStatusChange(id: string, status: string, pwd: string) {
    const res = await fetch('/api/experimentos', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pwd },
      body: JSON.stringify({ id, status }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      alert(json.error || 'Erro ao alterar status.')
      return
    }
    router.refresh()
  }

  async function executeDelete(id: string, pwd: string) {
    const res = await fetch('/api/experimentos', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pwd },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      alert(json.error || 'Erro ao excluir experimento.')
      return
    }
    router.refresh()
  }

  function handleStatusChange(id: string, status: string) {
    const labelMap: Record<string, string> = {
      active: 'Ativar experimento',
      paused: 'Pausar experimento',
      ended: 'Encerrar experimento',
    }
    setPendingAction({ id, status, label: labelMap[status] ?? 'Alterar status' })
  }

  function handleCreated() {
    setShowModal(false)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {activeExps.length} experimento{activeExps.length !== 1 ? 's' : ''}
          {archivedExps.length > 0 && (
            <span className="ml-1 text-gray-400">· {archivedExps.length} arquivado{archivedExps.length !== 1 ? 's' : ''}</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowManual(true)}
            className="flex items-center gap-1.5 bg-[#111827] border border-[#1F2937] hover:border-cyan-500/40 hover:text-cyan-400 text-gray-400 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <HelpCircle size={13} />
            Como configurar
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <Plus size={13} />
            Novo experimento
          </button>
        </div>
      </div>

      {/* Tabela principal — ativos, pausados, rascunhos */}
      {activeExps.length === 0 ? (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl py-20 text-center">
          <FlaskConical size={32} className="mx-auto mb-3 text-gray-400" />
          <p className="text-sm text-gray-500">Nenhum experimento ativo.</p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-4 text-cyan-400 text-sm hover:text-cyan-300 transition-colors cursor-pointer"
          >
            Criar primeiro experimento →
          </button>
        </div>
      ) : (
        <ExperimentsTable
          exps={activeExps}
          allExps={experiments}
          statsMap={statsMap}
          onStatusChange={handleStatusChange}
          onDelete={(id, status) => setPendingDelete({ id, status })}
          onUpdated={() => router.refresh()}
        />
      )}

      {/* Arquivados (encerrados) */}
      {archivedExps.length > 0 && (
        <div className="rounded-xl border border-[#1F2937] overflow-hidden">
          <button
            onClick={() => setShowArchived((x) => !x)}
            className="w-full flex items-center justify-between px-4 py-3 bg-[#111827] hover:bg-[#1a2234] transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Archive size={13} />
              <span className="font-medium">Arquivados</span>
              <span className="text-gray-400">{archivedExps.length} encerrado{archivedExps.length !== 1 ? 's' : ''}</span>
            </div>
            {showArchived ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
          </button>
          {showArchived && (
            <ExperimentsTable
              exps={archivedExps}
              allExps={experiments}
              statsMap={statsMap}
              onStatusChange={handleStatusChange}
              onDelete={(id, status) => setPendingDelete({ id, status })}
              onUpdated={() => router.refresh()}
            />
          )}
        </div>
      )}

      {/* Slugs sem teste ativo: já passaram por algum experimento mas hoje rodam soltos */}
      {inactiveSlugs.length > 0 && (
        <OrphanSection
          title="Slugs sem teste ativo"
          subtitle={`${inactiveSlugs.length} slug${inactiveSlugs.length !== 1 ? 's' : ''} · ${formatCurrency(inactiveSlugs.reduce((s, b) => s + b.receita, 0))}`}
          icon={<Archive size={13} className="text-amber-400" />}
          open={showInactive}
          onToggle={() => setShowInactive(x => !x)}
          buckets={inactiveSlugs}
          showLastExperiment
        />
      )}

      {/* Slugs nunca testados: nunca casaram com nenhuma variante de page exp */}
      {neverTestedSlugs.length > 0 && (
        <OrphanSection
          title="Slugs nunca testados"
          subtitle={`${neverTestedSlugs.length} slug${neverTestedSlugs.length !== 1 ? 's' : ''} · ${formatCurrency(neverTestedSlugs.reduce((s, b) => s + b.receita, 0))}`}
          icon={<HelpCircle size={13} className="text-slate-400" />}
          open={showNeverTested}
          onToggle={() => setShowNeverTested(x => !x)}
          buckets={neverTestedSlugs}
        />
      )}

      {/* Vendas órfãs: sck_slugs que não casam com NENHUMA variante de page ativa
          (antes era banner amarelo no topo; agora aba colapsável pra não atrapalhar) */}
      {orphanSales.length > 0 && (
        <OrphanSection
          title="Vendas sem variante ativa"
          subtitle={`${orphanSales.length} sck_slug${orphanSales.length !== 1 ? 's' : ''} · ${formatCurrency(orphanSales.reduce((s, o) => s + o.receita, 0))}`}
          icon={<AlertCircle size={13} className="text-yellow-400" />}
          open={showOrphans}
          onToggle={() => setShowOrphans(x => !x)}
          buckets={orphanSales.map(o => ({ sckSlug: o.sck_slug, count: o.count, receita: o.receita }))}
        />
      )}

      {/* Quarentena: uids marcados como suspeitos pelo score-bots cron */}
      <QuarantineSection />

      {/* Info box */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl px-5 py-4 space-y-1.5">
        <p className="text-xs text-gray-400 font-medium">Independência entre testes</p>
        <ul className="text-[11px] text-gray-500 space-y-1 list-disc list-inside">
          <li>Crie 3 experimentos com o mesmo slug (ex: <span className="font-mono text-gray-400">col</span>): um de <span className="text-cyan-400">página</span>, um de <span className="text-violet-400">checkout</span>, um de <span className="text-amber-400">order bump</span></li>
          <li>O Worker sorteia cada dimensão de forma independente usando <span className="font-mono text-gray-400">hash(uid × experimentId)</span> — sem correlação entre testes</li>
          <li>O redirect já chega com <span className="font-mono text-gray-400">?ck=&amp;ob=</span> na URL da página; o chtml compõe o slug <span className="font-mono text-gray-400">pagina_ckVALOR_obVALOR</span></li>
          <li>Parar ou ativar qualquer teste não afeta os outros — o Worker simplesmente omite o parâmetro ausente</li>
        </ul>
      </div>

      {showManual && <ManualModal onClose={() => setShowManual(false)} />}

      {showModal && (
        <NovoExperimentoModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
          experiments={experiments}
        />
      )}

      {pendingAction && (
        <AdminGateModal
          label={`${pendingAction.label}: confirme a senha de admin para prosseguir.`}
          onConfirm={(pwd) => {
            const { id, status } = pendingAction
            setPendingAction(null)
            executeStatusChange(id, status, pwd)
          }}
          onClose={() => setPendingAction(null)}
        />
      )}

      {pendingDelete && (
        <AdminGateModal
          label={pendingDelete.status === 'draft'
            ? 'Excluir rascunho permanentemente. Esta ação não pode ser desfeita.'
            : 'Excluir este experimento permanentemente, incluindo todo o histórico de variantes. Esta ação não pode ser desfeita.'}
          onConfirm={(pwd) => {
            const id = pendingDelete.id
            setPendingDelete(null)
            executeDelete(id, pwd)
          }}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
