'use client'

/**
 * Calculadora Estratégica — cliente.
 *
 * Toda a álgebra vive em lib/calcEngine.ts (motor puro, testado contra as âncoras
 * publicadas do painel col-). Aqui só tem estado de slider, formatação e semáforo.
 *
 * TRÊS REGRAS QUE NÃO PODEM SER QUEBRADAS AQUI:
 *
 * 1. UMA JANELA SÓ. `de`/`ate` alimentam TODOS os drivers. "Puxar últimos X dias"
 *    reescreve a URL e o server component remonta este cliente (via `key`), então
 *    todo slider volta pro real de uma vez. Não existe CPM de 7 dias com ticket de 90.
 *
 * 2. SEM DADO ≠ ZERO. Baseline `null` significa que o denominador não existiu no
 *    recorte. O slider continua utilizável (é um simulador), mas o "atual" mostra
 *    SEM DADO em vez de fingir um zero. Saída `null` do motor idem.
 *
 * 3. LIGAR O VSL NÃO PODE MUDAR NENHUMA SAÍDA. O toggle DECOMPÕE a conversão de
 *    página em play rate × conversão do VSL; ao ligar, os dois campos são
 *    pré-preenchidos de modo que o produto seja exatamente a conversão atual.
 *    Se ligar mudasse o ROAS, o modelo estaria mentindo sobre o que o VSL faz.
 */

import { useCallback, useMemo, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Calculator, RotateCcw, Save, Trash2, Check } from 'lucide-react'
import Slider from '@/components/ui/Slider'
import { SugestoesCriativo } from '@/components/calculadora/SugestoesCriativo'
import { computeCalc, type CalcDrivers } from '@/lib/calcEngine'
import { getSemaforoColorForFunil, SEMAFORO_CSS, type ThresholdKey } from '@/lib/thresholds'
import { formatCurrency, formatNumber, formatPercent, formatRoas, daysAgoBR, todayBR } from '@/lib/formatters'
import { saveCalcPresetAction, deleteCalcPresetAction, type CalcPreset } from '@/app/actions/calcPresets'
import type { MetricaObjetivo, SugestoesPorMetrica } from '@/lib/calcSugestoes'

export interface CalcBaselines {
  cpm: number | null
  ctrPct: number | null
  connectPct: number | null
  convPagPct: number | null
  ticket: number | null
}

export interface CalcAmostra {
  impressoes: number
  cliques: number
  landingViews: number
  vendasFront: number
  investimento: number
  diasNoPeriodo: number
}

export interface FunilOpcao {
  slug: string
  nome: string
}

interface Props {
  de: string
  ate: string
  funil: string
  baselines: CalcBaselines
  amostra: CalcAmostra
  funilOpcoes: FunilOpcao[]
  sugestoes: Record<MetricaObjetivo, SugestoesPorMetrica>
  presets: CalcPreset[]
}

/** Default neutro pra quando o baseline não existe — o slider ainda serve pra simular. */
const FALLBACK = { cpm: 30, ctrPct: 1.5, connectPct: 80, convPagPct: 3, ticket: 60 }

const SEM_DADO = 'SEM DADO'

const METRICAS: Array<{ id: MetricaObjetivo; label: string }> = [
  { id: 'roas', label: 'ROAS' },
  { id: 'lucroPorPv', label: 'L/PV' },
  { id: 'ctr', label: 'CTR' },
  { id: 'convPag', label: 'Conversão de página' },
  { id: 'ticket', label: 'Ticket' },
]

const JANELAS = [7, 14, 30, 90]

export default function CalculadoraClient({
  de, ate, funil, baselines, amostra, funilOpcoes, sugestoes, presets,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const inicial = useMemo(
    () => ({
      cpm: baselines.cpm ?? FALLBACK.cpm,
      ctrPct: baselines.ctrPct ?? FALLBACK.ctrPct,
      connectPct: baselines.connectPct ?? FALLBACK.connectPct,
      convPagPct: baselines.convPagPct ?? FALLBACK.convPagPct,
      ticket: baselines.ticket ?? FALLBACK.ticket,
    }),
    [baselines],
  )

  const [d, setD] = useState(inicial)
  const [vslOn, setVslOn] = useState(false)
  const [playRatePct, setPlayRatePct] = useState(60)
  const [vslConvPct, setVslConvPct] = useState(5)
  const [backendOn, setBackendOn] = useState(false)
  const [backendPct, setBackendPct] = useState(1)
  const [backendLiquido, setBackendLiquido] = useState(3642)
  const [metrica, setMetrica] = useState<MetricaObjetivo>('roas')
  const [nomePreset, setNomePreset] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const set = <K extends keyof typeof d>(k: K) => (v: number) => setD((p) => ({ ...p, [k]: v }))

  /** Ligar o VSL pré-preenche play × conv = conversão atual, pra não mudar saída nenhuma. */
  const toggleVsl = useCallback(() => {
    setVslOn((on) => {
      if (!on) {
        const play = 60
        setPlayRatePct(play)
        setVslConvPct(play > 0 ? (d.convPagPct / play) * 100 : 0)
      }
      return !on
    })
  }, [d.convPagPct])

  const drivers: CalcDrivers = {
    cpm: d.cpm,
    ctrPct: d.ctrPct,
    connectPct: d.connectPct,
    convPagPct: d.convPagPct,
    ticket: d.ticket,
    vslOn,
    playRatePct,
    vslConvPct,
    ...(backendOn ? { backendPct, backendLiquido } : {}),
  }
  const r = computeCalc(drivers)

  const cor = (metric: ThresholdKey, valor: number | null) =>
    valor == null ? 'text-gray-500' : SEMAFORO_CSS[getSemaforoColorForFunil(metric, valor, funil, d.ticket)]

  const navegar = (patch: Record<string, string>) => {
    const p = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k)
    router.push(`${pathname}?${p.toString()}`)
  }

  const puxar = (dias: number) => navegar({ de: daysAgoBR(dias), ate: todayBR() })

  const restaurar = () => { setD(inicial); setVslOn(false); setBackendOn(false) }

  const configAtual = () => ({ drivers: d, vslOn, playRatePct, vslConvPct, backendOn, backendPct, backendLiquido, metrica, de, ate })

  const aplicarPreset = (p: CalcPreset) => {
    const c = p.config as ReturnType<typeof configAtual>
    if (c?.drivers) setD(c.drivers)
    setVslOn(!!c?.vslOn); setPlayRatePct(c?.playRatePct ?? 60); setVslConvPct(c?.vslConvPct ?? 5)
    setBackendOn(!!c?.backendOn); setBackendPct(c?.backendPct ?? 1); setBackendLiquido(c?.backendLiquido ?? 3642)
    if (c?.metrica) setMetrica(c.metrica)
    setAviso(`Predefinição "${p.nome}" aplicada.`)
  }

  const salvar = async () => {
    const nome = nomePreset.trim()
    if (!nome) { setAviso('Dê um nome à predefinição.'); return }
    setSalvando(true)
    const res = await saveCalcPresetAction(nome, funil === 'all' ? null : funil, configAtual())
    setSalvando(false)
    setAviso(res.ok ? `Predefinição "${nome}" salva.` : `Não deu pra salvar: ${res.error}`)
    if (res.ok) { setNomePreset(''); router.refresh() }
  }

  const apagar = async (nome: string) => {
    const res = await deleteCalcPresetAction(nome)
    setAviso(res.ok ? `Predefinição "${nome}" apagada.` : `Não deu pra apagar: ${res.error}`)
    if (res.ok) router.refresh()
  }

  const card = 'bg-[#111827] border border-[#1F2937] rounded-xl'

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* ── Controles de recorte ─────────────────────────────────────────── */}
      <div className={`${card} p-4`}>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <p className="mb-1.5 text-[11px] uppercase tracking-wider text-gray-500">Puxar últimos</p>
            <div className="flex flex-wrap gap-1.5">
              {JANELAS.map((n) => (
                <button key={n} type="button" onClick={() => puxar(n)}
                  className="rounded-lg border border-[#1F2937] bg-[#1F2937] px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-cyan-700 hover:text-white">
                  {n} dias
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] uppercase tracking-wider text-gray-500">Funil</p>
            <select value={funil} onChange={(e) => navegar({ funil: e.target.value })}
              className="rounded-lg border border-[#1F2937] bg-[#1F2937] px-3 py-1.5 text-xs text-gray-200">
              <option value="all">Todos</option>
              {funilOpcoes.map((f) => <option key={f.slug} value={f.slug}>{f.nome}</option>)}
            </select>
          </div>
          <button type="button" onClick={restaurar}
            className="flex items-center gap-1.5 rounded-lg border border-[#1F2937] px-3 py-1.5 text-xs text-gray-300 hover:text-white">
            <RotateCcw size={13} /> Restaurar valores atuais
          </button>
          <p className="ml-auto text-[11px] text-gray-500">
            Janela {de} → {ate} · {formatNumber(amostra.landingViews)} PV · {formatNumber(amostra.vendasFront)} vendas front
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* ── Alavancas ──────────────────────────────────────────────────── */}
        <div className={`${card} space-y-5 p-5 lg:col-span-3`}>
          <div className="flex items-center gap-2">
            <Calculator size={16} className="text-cyan-400" />
            <h2 className="text-sm font-semibold text-white">Alavancas</h2>
          </div>

          <Slider id="cpm" label="CPM" value={d.cpm} min={5} max={Math.max(60, (baselines.cpm ?? 0) * 2)} step={0.01}
            onChange={set('cpm')} format={formatCurrency} baseline={baselines.cpm ?? undefined}
            bandas={[{ ate: 35, cor: 'ok' }, { ate: 45, cor: 'warn' }, { ate: Math.max(60, (baselines.cpm ?? 0) * 2), cor: 'bad' }]}
            hint={baselines.cpm == null ? 'Sem impressões no recorte — SEM DADO' : 'Inclui o imposto Meta de 13,82%, igual ao resto do dashboard'} />

          <Slider id="ctr" label="CTR de link" value={d.ctrPct} min={0.1} max={Math.max(5, (baselines.ctrPct ?? 0) * 2)} step={0.01}
            onChange={set('ctrPct')} format={(v) => formatPercent(v, 2)} baseline={baselines.ctrPct ?? undefined}
            bandas={[{ ate: 1.0, cor: 'bad' }, { ate: 1.5, cor: 'warn' }, { ate: Math.max(5, (baselines.ctrPct ?? 0) * 2), cor: 'ok' }]} />

          <Slider id="connect" label="Carregamento (connect rate)" value={d.connectPct} min={30} max={99} step={0.1}
            onChange={set('connectPct')} format={(v) => formatPercent(v, 1)} baseline={baselines.connectPct ?? undefined}
            bandas={[{ ate: 70, cor: 'bad' }, { ate: 85, cor: 'warn' }, { ate: 99, cor: 'ok' }]} />

          <Slider id="convpag" label="Conversão de página" value={d.convPagPct} min={0.1}
            max={Math.max(15, (baselines.convPagPct ?? 0) * 2)} step={0.01} onChange={set('convPagPct')}
            format={(v) => formatPercent(v, 2)} baseline={baselines.convPagPct ?? undefined} disabled={vslOn}
            bandas={[{ ate: 1.5, cor: 'bad' }, { ate: 3, cor: 'warn' }, { ate: Math.max(15, (baselines.convPagPct ?? 0) * 2), cor: 'ok' }]}
            hint={vslOn ? 'Derivada do VSL: play rate × conversão do VSL' : undefined} />

          <Slider id="ticket" label="Ticket líq. / venda front" value={d.ticket} min={1}
            max={Math.max(200, (baselines.ticket ?? 0) * 2)} step={0.01} onChange={set('ticket')}
            format={formatCurrency} baseline={baselines.ticket ?? undefined}
            hint="Receita líquida (pós-taxa Hotmart) ÷ vendas do produto de entrada" />

          {/* VSL */}
          <div className="border-t border-[#1F2937] pt-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={vslOn} onChange={toggleVsl} className="accent-cyan-500" />
              <span className="text-sm font-medium text-gray-200">Adicionar VSL</span>
              <span className="text-[11px] text-gray-500">decompõe a conversão em play × conversão do vídeo</span>
            </label>
            {vslOn && (
              <div className="mt-4 space-y-5">
                <Slider id="play" label="Play rate" value={playRatePct} min={1} max={100} step={0.1}
                  onChange={setPlayRatePct} format={(v) => formatPercent(v, 1)} hint="Quem deu play ÷ quem viu a página" />
                <Slider id="vslconv" label="Conversão do VSL" value={vslConvPct} min={0.1} max={30} step={0.01}
                  onChange={setVslConvPct} format={(v) => formatPercent(v, 2)} hint="Compras ÷ plays" />
                <p className="text-[11px] text-gray-500">
                  Conversão de página resultante: <span className="font-mono text-gray-300">{formatPercent(r.convPagEfetiva, 2)}</span>
                </p>
              </div>
            )}
          </div>

          {/* Backend */}
          <div className="border-t border-[#1F2937] pt-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={backendOn} onChange={() => setBackendOn((b) => !b)} className="accent-cyan-500" />
              <span className="text-sm font-medium text-gray-200">Considerar backend</span>
              <span className="text-[11px] text-gray-500">entra num ROAS separado, nunca no principal</span>
            </label>
            {backendOn && (
              <div className="mt-4 space-y-5">
                <Slider id="backendpct" label="Conversão no backend" value={backendPct} min={0} max={5} step={0.001}
                  onChange={setBackendPct} format={(v) => formatPercent(v, 3)} hint="% das vendas front que viram venda de backend" />
                <label className="block">
                  <span className="text-xs text-gray-400">Líquido por venda de backend</span>
                  <input type="number" value={backendLiquido} min={0} step={1}
                    onChange={(e) => setBackendLiquido(Number(e.target.value) || 0)}
                    className="mt-1 w-40 rounded-lg border border-[#1F2937] bg-[#1F2937] px-3 py-1.5 font-mono text-sm text-gray-100" />
                </label>
              </div>
            )}
          </div>
        </div>

        {/* ── Saídas ─────────────────────────────────────────────────────── */}
        <div className="space-y-4 lg:col-span-2">
          <div className={`${card} p-5`}>
            <h2 className="mb-4 text-sm font-semibold text-white">Resultado</h2>
            <div className="grid grid-cols-2 gap-4">
              <Saida rotulo="CPA" valor={r.cpa} fmt={formatCurrency} classe={cor('cpa', r.cpa)} />
              <Saida rotulo="ROAS" valor={r.roas} fmt={formatRoas} classe={cor('roasLiquido', r.roas)} />
              <Saida rotulo="PRV" sub="receita por visualização" valor={r.prv} fmt={formatCurrency} classe="text-gray-100" />
              <Saida rotulo="L/PV" sub="lucro por visualização" valor={r.lucroPorPv} fmt={formatCurrency}
                classe={r.lucroPorPv == null ? 'text-gray-500' : r.lucroPorPv >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
            </div>
            <div className="mt-4 border-t border-[#1F2937] pt-3 text-[11px] text-gray-500">
              <p>Custo por visualização: <span className="font-mono text-gray-300">{r.custoPorPv == null ? SEM_DADO : formatCurrency(r.custoPorPv)}</span></p>
              {r.roasBackend != null && (
                <p className="mt-1">ROAS com backend: <span className="font-mono text-gray-300">{formatRoas(r.roasBackend)}</span></p>
              )}
              {r.lucroPorPv != null && amostra.landingViews > 0 && (
                <p className="mt-1">
                  No volume da janela ({formatNumber(amostra.landingViews)} PV):{' '}
                  <span className="font-mono text-gray-300">{formatCurrency(r.lucroPorPv * amostra.landingViews)}</span> de lucro
                </p>
              )}
            </div>
          </div>

          {/* Predefinições */}
          <div className={`${card} p-5`}>
            <h2 className="mb-3 text-sm font-semibold text-white">Predefinições</h2>
            <div className="flex gap-2">
              <input value={nomePreset} onChange={(e) => setNomePreset(e.target.value)} placeholder="nome do cenário" maxLength={60}
                className="min-w-0 flex-1 rounded-lg border border-[#1F2937] bg-[#1F2937] px-3 py-1.5 text-xs text-gray-100 placeholder:text-gray-600" />
              <button type="button" onClick={salvar} disabled={salvando}
                className="flex items-center gap-1.5 rounded-lg border border-cyan-800 bg-cyan-950 px-3 py-1.5 text-xs text-cyan-200 disabled:opacity-50">
                <Save size={13} /> Salvar
              </button>
            </div>
            {presets.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {presets.map((p) => (
                  <li key={p.nome} className="flex items-center gap-2">
                    <button type="button" onClick={() => aplicarPreset(p)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1 text-left text-xs text-gray-300 hover:bg-[#1F2937] hover:text-white">
                      <Check size={12} className="shrink-0 text-cyan-500" />
                      <span className="truncate">{p.nome}</span>
                      {p.funil && <span className="shrink-0 text-[10px] text-gray-600">{p.funil}</span>}
                    </button>
                    <button type="button" onClick={() => apagar(p.nome)} aria-label={`Apagar ${p.nome}`}
                      className="shrink-0 rounded p-1 text-gray-600 hover:text-rose-400">
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {aviso && <p className="mt-2 text-[11px] text-gray-400">{aviso}</p>}
          </div>
        </div>
      </div>

      {/* ── Métrica-objetivo + sugestões ──────────────────────────────────── */}
      <div className={`${card} p-5`}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-gray-500">Métrica-objetivo</span>
          {METRICAS.map((m) => (
            <button key={m.id} type="button" onClick={() => setMetrica(m.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                metrica === m.id ? 'bg-cyan-950 text-cyan-200 ring-1 ring-cyan-800' : 'bg-[#1F2937] text-gray-200 hover:text-white'
              }`}>
              {m.label}
            </button>
          ))}
        </div>
        <SugestoesCriativo data={sugestoes[metrica]} />
      </div>

      {/* ── Nota de vocabulário ───────────────────────────────────────────── */}
      <div className={`${card} p-4 text-[11px] leading-relaxed text-gray-500`}>
        <p>
          <b className="text-gray-400">PV</b> = visualizações de página ·{' '}
          <b className="text-gray-400">PRV</b> = receita por visualização ·{' '}
          <b className="text-gray-400">L/PV</b> = lucro por visualização. A sigla &quot;LPV&quot; é ambígua
          (significa Landing Page Views no Meta e Lucro por Visualização na economia do funil), por isso
          não aparece sozinha em lugar nenhum desta tela.
        </p>
        <p className="mt-1.5">
          O CPM aqui inclui o imposto Meta de 13,82% (<code className="text-gray-400">META_TAX_RATE</code>), que é a base
          usada por todo o resto do dashboard. Auditorias feitas sobre o gasto cru mostram CPM e CPA ~13,8% menores.
        </p>
      </div>
    </div>
  )
}

function Saida({ rotulo, sub, valor, fmt, classe }: {
  rotulo: string; sub?: string; valor: number | null; fmt: (n: number) => string; classe: string
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-500">{rotulo}</p>
      <p className={`font-mono text-2xl font-bold tabular-nums ${classe}`}>{valor == null ? SEM_DADO : fmt(valor)}</p>
      {sub && <p className="mt-0.5 text-[10px] text-gray-600">{sub}</p>}
    </div>
  )
}
