'use client'

import { useEffect, useState } from 'react'
import { Filter, Star, Clock, SlidersHorizontal, ChevronDown } from 'lucide-react'
import BottomSheet from '@/components/ui/BottomSheet'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import DateRangePicker from './DateRangePicker'
import ComparisonControl from './ComparisonControl'
import { useFunilOptions } from '@/lib/useFunis'
import { parseCompareMode, COMPARE_MODE_LABEL } from '@/lib/comparePeriods'
import { contaNomeCompleto, contaNomeCurto } from '@/lib/contas'
import {
  DATE_PRESETS as PRESETS,
  DEFAULT_PRESET_LABEL,
  DEFAULT_PRESET_STORAGE_KEY,
  findPreset,
  isValidPresetLabel,
} from '@/lib/datePresets'
import { useUserPrefs } from '@/components/layout/UserPrefsProvider'
import { saveDefaultPeriodoAction } from '@/app/actions/userPrefs'

// B4 — trunca no MEIO (padrão Polaris pro rótulo de filtro), preservando início e
// fim (período e último filtro continuam legíveis). CSS só faz ellipsis no fim.
function middleTruncate(s: string, max: number): string {
  if (s.length <= max) return s
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`
}

interface HeaderProps {
  title: string
  subtitle?: string
  accountOptions?: string[]
}

// F3 — resposta do /api/health/freshness (carimbo de frescor mobile).
interface FreshnessStamp { label: string; stale: boolean }
interface FreshnessResp {
  ok: boolean
  meta: FreshnessStamp | null
  vturb: FreshnessStamp | null
  organico: FreshnessStamp | null
}

// Nomes das contas Meta e lista de presets vivem em lib/ (fonte única, ver
// lib/contas.ts e lib/datePresets.ts). Antes eram cópias locais aqui e no
// visao-geral/page.tsx — divergiam, e o preset era inalcançável pelo servidor.

export default function Header({ title, subtitle, accountOptions }: HeaderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentFunil = searchParams.get('funil') ?? 'all'
  const funilOptions = useFunilOptions()
  const currentConta = searchParams.get('conta') ?? 'all'
  const fallback = findPreset(DEFAULT_PRESET_LABEL)!
  const currentDe = searchParams.get('de') ?? fallback.de()
  const currentAte = searchParams.get('ate') ?? fallback.ate()

  // ── Preset de período padrão: POR USUÁRIO, não por dispositivo ──────────────
  // A verdade é `users.default_filters.periodo`, que chega do layout como
  // promessa (UserPrefsProvider). O localStorage fica só como fallback de
  // PRIMEIRA CARGA — quando o servidor não tem preferência gravada, ou a leitura
  // falha. Antes ele era a única fonte: o PWA instalado tem storage próprio (no
  // iOS, separado do Safari), então o mesmo login via desktop em "Tudo" e via app
  // em "30d" mostrava números que diferiam quase 10x sem nenhum erro de conta.
  const { defaultPeriodoPromise } = useUserPrefs()
  const [defaultPreset, setDefaultPreset] = useState(DEFAULT_PRESET_LABEL)
  useEffect(() => {
    let alive = true
    let aplicado: string | null = null
    const local = (() => {
      try { return localStorage.getItem(DEFAULT_PRESET_STORAGE_KEY) } catch { return null }
    })()

    // Intervalo que ESTE efeito escreveu na URL. Sem guardar isto, a resposta do
    // servidor era barrada pela própria escrita otimista do fallback local — e
    // quem ganhava dependia de o `router.replace` já ter commitado a URL ou não.
    // Medido: a mesma página terminava em "30d" ou em "Tudo" conforme o timing.
    let nossoIntervalo: { de: string; ate: string } | null = null

    const aplicar = (label: string | null) => {
      if (!alive) return
      const def = isValidPresetLabel(label) ? label! : DEFAULT_PRESET_LABEL
      if (def === aplicado) return // já é o período vigente — não repete o replace
      // Lê a URL VIVA, não a capturada no mount: este callback pode rodar depois
      // de um round-trip de rede, e nesse meio-tempo o usuário pode ter escolhido
      // um funil ou um período. Partir do `searchParams` do mount descartaria a
      // escolha dele (`?funil=lps` virava `?de=…&ate=…`, sem o funil).
      const atual = new URLSearchParams(window.location.search)
      const temIntervalo = atual.has('de') || atual.has('ate')
      // Só sobrescreve intervalo que nós mesmos colocamos. Se veio de fora (link
      // compartilhado, ou o usuário escolhendo um período), a escolha dele manda.
      const eNosso = nossoIntervalo !== null
        && atual.get('de') === nossoIntervalo.de
        && atual.get('ate') === nossoIntervalo.ate
      if (temIntervalo && !eNosso) return
      aplicado = def
      setDefaultPreset(def)
      const p = findPreset(def) ?? fallback
      const de = p.de()
      const ate = p.ate()
      nossoIntervalo = { de, ate }
      atual.set('de', de)
      atual.set('ate', ate)
      router.replace(`${window.location.pathname}?${atual.toString()}`)
    }

    // 1) Aplica JÁ o que dá pra saber sem rede (preferência local, senão o padrão).
    //    Sem isto a página renderiza sem de/ate enquanto a sessão é buscada, e o
    //    servidor calcula os KPIs sobre a base INTEIRA antes de ser refeito.
    aplicar(local)

    // 2) A verdade é o servidor. Só reaplica se discordar do que já está valendo.
    //    `Promise.resolve` é obrigatório: o que o React entrega ao cliente é um
    //    THENABLE (só tem `.then`), não uma Promise — `promessa.then(...).catch(...)`
    //    lança "Cannot read properties of undefined (reading 'catch')" e derruba a
    //    página inteira no error boundary. Medido em 10/08/2026, no build de produção.
    if (defaultPeriodoPromise) {
      Promise.resolve(defaultPeriodoPromise)
        .then((servidor) => { if (servidor) aplicar(servidor) })
        .catch(() => { /* best-effort: o fallback local já foi aplicado */ })
    }
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function makeDefault(label: string) {
    // localStorage primeiro (resposta instantânea e fallback offline); a gravação
    // no servidor é o que faz o preset atravessar dispositivo.
    try { localStorage.setItem(DEFAULT_PRESET_STORAGE_KEY, label) } catch { /* ignore */ }
    setDefaultPreset(label)
    void saveDefaultPeriodoAction(label).catch(() => { /* best-effort: fica local */ })
  }

  // ── F3: carimbo de frescor (só mobile — no desktop o Sidebar já mostra o "atualizado às") ─
  // Fetch client LEVE a /api/health/freshness. Best-effort: qualquer falha deixa
  // `freshness` null e o carimbo simplesmente não aparece — nunca quebra o Header.
  // Gate por matchMedia pra não gastar request no desktop (o carimbo é md:hidden).
  const [freshness, setFreshness] = useState<FreshnessResp | null>(null)
  // B1 (Onda 2) — sheet de filtros no mobile. Desktop nunca abre (o cluster inline fica).
  const [sheetOpen, setSheetOpen] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.matchMedia('(max-width: 767px)').matches) return
    let alive = true
    fetch('/api/health/freshness', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && d.ok) setFreshness(d) })
      .catch(() => { /* best-effort: silêncio */ })
    return () => { alive = false }
  }, [])

  // Fontes presentes, na ordem Meta → vTurb → Orgânico (some quem não tem dado).
  const freshItems: Array<{ name: string; stamp: FreshnessStamp }> = []
  if (freshness) {
    const src: Array<[string, FreshnessStamp | null]> = [
      ['Meta', freshness.meta],
      ['vTurb', freshness.vturb],
      ['Orgânico', freshness.organico],
    ]
    for (const [name, stamp] of src) if (stamp) freshItems.push({ name, stamp })
  }
  const freshAria = freshItems.map((i) => `${i.name} ${i.stamp.label}${i.stamp.stale ? ' (atrasado)' : ''}`).join(', ')

  function setParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v === '') params.delete(k)
      else params.set(k, v)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  function isPresetActive(preset: typeof PRESETS[0]) {
    return currentDe === preset.de() && currentAte === preset.ate()
  }
  const activePreset = PRESETS.find(isPresetActive)

  // ── B4: rótulo de estado ativo (só mobile) ─────────────────────────────────
  // Polaris: qualifique cada filtro ("PLO", não "1 filtro"), agrupe por categoria,
  // trunque no meio. É só o RESUMO — o sheet que substitui os controles é Onda 2;
  // aqui os controles continuam existindo (mobile ainda filtra normalmente).
  const dm = (iso: string) => (iso?.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso)
  const periodLabel = activePreset?.label ?? `${dm(currentDe)}–${dm(currentAte)}`
  const funilLabel =
    currentFunil !== 'all'
      ? (funilOptions.find((o) => o.value === currentFunil)?.label ?? currentFunil.toUpperCase())
      : null
  const contaLabel =
    accountOptions && accountOptions.length > 1 && currentConta !== 'all'
      ? contaNomeCurto(currentConta)
      : null
  const cmpMode = parseCompareMode(searchParams.get('cmp'))
  const cmpLabel = cmpMode !== 'none' ? `vs ${COMPARE_MODE_LABEL[cmpMode]}` : null
  const filterSummary = [periodLabel, funilLabel, contaLabel, cmpLabel].filter(Boolean).join(' · ')

  return (
    // Mobile: altura automática + flex-wrap pros controles não serem cortados
    // (o wrapper do layout tem overflow-hidden); pl-14 abre espaço pro hambúrguer.
    // Desktop (md+): volta a ser barra de 64px numa linha só.
    <header className="min-h-16 md:h-16 bg-[#0A0F1E] border-b border-[#1F2937] flex flex-wrap items-center justify-between gap-y-2 px-4 pl-14 md:px-6 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] pb-2 md:pt-0 md:pb-0 shrink-0">
      <div>
        <h1 className="text-lg font-semibold text-white font-[family-name:var(--font-heading)]">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
        )}
      </div>
      {/* B1/B4 — no MOBILE o cluster de filtro vira uma PILL que abre o bottom-sheet;
          a pill mostra o resumo do estado ativo (Polaris). Desktop: cluster inline. */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label={`Filtros: ${filterSummary}. Toque para editar.`}
        className="md:hidden w-full flex items-center gap-2 rounded-lg bg-[#111827] border border-[#1F2937] px-3 py-2 text-left tap-target--body active:bg-[#131c2e] transition-colors"
      >
        <SlidersHorizontal size={15} className="shrink-0 text-cyan-400" />
        <span className="flex-1 text-xs text-gray-200 tabular-nums truncate">{middleTruncate(filterSummary, 40)}</span>
        <ChevronDown size={15} className="shrink-0 text-gray-500" />
      </button>
      {/* F3 — carimbo de frescor. Só mobile (md:hidden): no desktop o Sidebar já
          mostra "atualizado às HH:MM". Âmbar quando a fonte estoura o SLA (o
          endpoint /api/health/freshness calcula com os mesmos limiares do cron). */}
      {freshItems.length > 0 && (
        <div
          role="status"
          aria-label={`Frescor dos dados: ${freshAria}`}
          className="md:hidden w-full flex items-center gap-1.5 text-gray-500 -mt-1"
        >
          <Clock size={11} className="shrink-0" />
          <span className="text-[11px] tabular-nums flex flex-wrap items-center gap-x-1">
            {freshItems.map((i, idx) => (
              <span key={i.name} className="whitespace-nowrap">
                {idx > 0 && <span className="text-gray-700 mr-1">·</span>}
                <span className={i.stamp.stale ? 'text-amber-400' : 'text-gray-400'}>
                  {i.name} {i.stamp.label}
                </span>
              </span>
            ))}
          </span>
        </div>
      )}
      <div className="hidden md:flex flex-wrap items-center gap-x-3 gap-y-2 w-full md:w-auto">
        {/* Account filter — only shown when multiple accounts exist */}
        {accountOptions && accountOptions.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Conta</span>
            <select
              value={currentConta}
              onChange={(e) => setParams({ conta: e.target.value })}
              className="bg-[#111827] border border-[#1F2937] rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-cyan-500/50"
            >
              <option value="all">Todas</option>
              {accountOptions.map((id) => (
                <option key={id} value={id}>{contaNomeCompleto(id)}</option>
              ))}
            </select>
          </div>
        )}
        {/* Funil filter */}
        <div className="flex items-center gap-2">
          <Filter size={13} className="text-gray-500" />
          <div className="flex items-center rounded-lg bg-[#111827] border border-[#1F2937] overflow-hidden">
            {funilOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setParams({ funil: opt.value })}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  currentFunil === opt.value
                    ? 'bg-[#374151] text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date range */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Presets */}
          <div className="flex items-center rounded-lg bg-[#111827] border border-[#1F2937] overflow-hidden">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setParams({ de: p.de(), ate: p.ate() })}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  isPresetActive(p)
                    ? 'bg-cyan-500/20 text-cyan-400 border-x border-cyan-500/30'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Tornar o preset ativo o padrão (persiste no navegador) */}
          <button
            disabled={!activePreset}
            onClick={() => activePreset && makeDefault(activePreset.label)}
            title={
              !activePreset
                ? 'Selecione um preset para torná-lo padrão'
                : defaultPreset === activePreset.label
                  ? `"${activePreset.label}" é o preset padrão`
                  : `Tornar "${activePreset.label}" o preset padrão`
            }
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
              activePreset && defaultPreset === activePreset.label
                ? 'border-cyan-500/40 text-cyan-400 bg-cyan-500/10'
                : 'border-[#1F2937] text-gray-500 hover:text-white'
            }`}
          >
            <Star size={13} fill={activePreset && defaultPreset === activePreset.label ? 'currentColor' : 'none'} />
          </button>
          {/* Date inputs */}
          <DateRangePicker
            value={currentDe}
            onChange={(v) => setParams({ de: v })}
            ariaLabel="Data de início"
          />
          <span className="text-xs text-gray-500">até</span>
          <DateRangePicker
            value={currentAte}
            onChange={(v) => setParams({ ate: v })}
            ariaLabel="Data de fim"
          />
          <ComparisonControl />
        </div>
      </div>

      {/* B1 — sheet de filtros no mobile (o componente é md:hidden). Reusa os MESMOS
          handlers do cluster desktop (setParams/PRESETS/makeDefault/…) em alvos grandes. */}
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Filtros">
        <div className="space-y-5">
          {/* Período */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Período</h3>
              <button
                type="button"
                disabled={!activePreset}
                onClick={() => activePreset && makeDefault(activePreset.label)}
                className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border transition-colors disabled:opacity-40 ${
                  activePreset && defaultPreset === activePreset.label
                    ? 'border-cyan-500/40 text-cyan-400 bg-cyan-500/10'
                    : 'border-[#1F2937] text-gray-500'
                }`}
              >
                <Star size={12} fill={activePreset && defaultPreset === activePreset.label ? 'currentColor' : 'none'} /> padrão
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setParams({ de: p.de(), ate: p.ate() })}
                  className={`min-h-11 rounded-lg text-sm font-medium border transition-colors ${
                    isPresetActive(p)
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : 'bg-[#111827] text-gray-300 border-[#1F2937] active:bg-[#131c2e]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <DateRangePicker value={currentDe} onChange={(v) => setParams({ de: v })} ariaLabel="Data de início" />
              <span className="text-xs text-gray-500">até</span>
              <DateRangePicker value={currentAte} onChange={(v) => setParams({ ate: v })} ariaLabel="Data de fim" />
            </div>
          </section>

          {/* Funil */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Funil</h3>
            <div className="flex flex-wrap gap-2">
              {funilOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setParams({ funil: opt.value })}
                  className={`min-h-11 px-4 rounded-lg text-sm font-medium border transition-colors ${
                    currentFunil === opt.value
                      ? 'bg-[#374151] text-white border-[#4b5563]'
                      : 'bg-[#111827] text-gray-300 border-[#1F2937] active:bg-[#131c2e]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* Conta (só com múltiplas contas) */}
          {accountOptions && accountOptions.length > 1 && (
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Conta</h3>
              <select
                value={currentConta}
                onChange={(e) => setParams({ conta: e.target.value })}
                className="w-full min-h-11 bg-[#111827] border border-[#1F2937] rounded-lg px-3 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/50"
              >
                <option value="all">Todas</option>
                {accountOptions.map((id) => (
                  <option key={id} value={id}>{contaNomeCompleto(id)}</option>
                ))}
              </select>
            </section>
          )}

          {/* Comparação */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Comparação</h3>
            <ComparisonControl />
          </section>

          <button
            type="button"
            onClick={() => setSheetOpen(false)}
            className="w-full min-h-11 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-semibold active:bg-cyan-500/30 transition-colors"
          >
            Ver resultados
          </button>
        </div>
      </BottomSheet>
    </header>
  )
}
