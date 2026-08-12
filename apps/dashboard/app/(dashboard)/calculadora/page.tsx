export const dynamic = 'force-dynamic'

/**
 * Calculadora Estratégica — o "e se?" da operação.
 *
 * Este server component NÃO calcula economia nenhuma: ele só PUXA a verdade da
 * janela (drivers reais) e entrega pro cliente. Toda a álgebra vive em
 * lib/calcEngine.ts (motor puro, testado contra âncoras publicadas) e o ticket
 * vem de lib/ticketFunil.ts. Nada aqui é inventado — cada baseline sai de
 * computePeriodSummary/computeTicketFunil sobre o MESMO recorte.
 *
 * REGRA FIXA: uma janela só. `de`/`ate` alimentam TODOS os drivers (CPM, CTR,
 * carregamento, conversão de página e ticket). Não existe "CPM dos últimos 7
 * dias com ticket dos últimos 90" — misturar recortes produziria um cenário que
 * nunca existiu.
 *
 * SEM DADO ≠ ZERO. computePeriodSummary devolve 0 tanto pra "a taxa é zero"
 * quanto pra "não houve denominador". Aqui os dois casos são separados pelo
 * VOLUME (impressões/cliques/page views/vendas front): sem denominador, o driver
 * vai `null` e a UI escreve "SEM DADO" — nunca 0% nem traço mudo. Mesmo
 * precedente de lib/metrics/convBody.ts.
 */

import Header from '@/components/layout/Header'
import CalculadoraClient, { type CalcBaselines, type CalcAmostra, type FunilOpcao } from './CalculadoraClient'
import { fetchTransacoes, fetchMetaAds, fetchFunisConfig, filterByAccount } from '@/lib/supabase'
import { computePeriodSummary } from '@/lib/periodSummary'
import { computeTicketFunil } from '@/lib/ticketFunil'
import { computeSugestoes, type MetricaObjetivo, type SugestoesPorMetrica } from '@/lib/calcSugestoes'
import { fetchRotulosCriativo } from '@/lib/criativoAnalises'
import { listCalcPresets } from '@/app/actions/calcPresets'
import { daysAgoBR, todayBR } from '@/lib/formatters'

/** As 5 métricas-objetivo. Calculadas de uma vez no servidor: trocar a métrica ativa
 *  é decisão de UI, não motivo pra ida ao banco. `computeSugestoes` é função pura sobre
 *  arrays já carregados, então as 5 passadas custam CPU, não I/O. */
const METRICAS_OBJETIVO: MetricaObjetivo[] = ['roas', 'lucroPorPv', 'ctr', 'convPag', 'ticket']

/** Janela default quando a URL não traz `de`/`ate` (mesmo default do Header). */
const JANELA_PADRAO_DIAS = 30

export default async function CalculadoraPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; funil?: string; conta?: string }>
}) {
  const sp = await searchParams
  const de = sp.de || daysAgoBR(JANELA_PADRAO_DIAS)
  const ate = sp.ate || todayBR()
  const funil = sp.funil || 'all'
  const conta = sp.conta || 'all'

  const [summary, allTransacoes, allMeta, funis, rotulos, presets] = await Promise.all([
    computePeriodSummary(de, ate, funil, conta),
    fetchTransacoes(),
    fetchMetaAds(),
    fetchFunisConfig(),
    fetchRotulosCriativo(),
    listCalcPresets(),
  ])

  // Mesmo escopo de conta do computePeriodSummary — o meta_ads aqui serve pra
  // atribuir transação→funil (ad_id/criativo), então tem que ser o mesmo recorte.
  const ticketFunil = computeTicketFunil(allTransacoes, filterByAccount(allMeta, conta), {
    de,
    ate,
    funil,
    funis,
  })

  // Cada driver só vira número quando o SEU denominador existe no recorte.
  const baselines: CalcBaselines = {
    cpm: summary.impressoes > 0 ? summary.cpm : null,
    ctrPct: summary.impressoes > 0 ? summary.ctr : null,
    connectPct: summary.cliques > 0 ? summary.carregamento : null,
    convPagPct: summary.landingViews > 0 ? summary.convPagina : null,
    ticket: ticketFunil.semDado ? null : ticketFunil.ticket,
  }

  const amostra: CalcAmostra = {
    impressoes: summary.impressoes,
    cliques: summary.cliques,
    landingViews: summary.landingViews,
    vendasFront: ticketFunil.vendasFront,
    investimento: summary.investimento,
    diasNoPeriodo: summary.diasNoPeriodo,
  }

  // Sugestões de criativo por métrica-objetivo, todas no MESMO recorte dos drivers.
  // `rotulos` traz gancho/formato de criativo_analise; criativo sem análise sai sem
  // rótulo e a UI escreve SEM DADO — nunca um gancho inventado.
  const metaDoFunil = filterByAccount(allMeta, conta)
  const sugestoes = Object.fromEntries(
    METRICAS_OBJETIVO.map((m) => [
      m,
      computeSugestoes(allTransacoes, metaDoFunil, { de, ate, funil, funis, metrica: m, analises: rotulos }),
    ]),
  ) as Record<MetricaObjetivo, SugestoesPorMetrica>

  const funilOpcoes: FunilOpcao[] = funis
    .filter((f) => f.ativo !== false)
    .slice()
    .sort((a, b) => a.ordem - b.ordem)
    .map((f) => ({ slug: f.slug, nome: f.nome }))

  return (
    <div className="flex h-full flex-col">
      <Header title="Calculadora Estratégica" subtitle="Simulador de cenários" />
      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* key = assinatura da janela: puxar outro período (ou trocar de funil)
            REMONTA o cliente, então todo slider volta pro real e os baselines
            acompanham. É a materialização do "uma janela alimenta tudo". */}
        <CalculadoraClient
          key={`${de}|${ate}|${funil}|${conta}`}
          de={de}
          ate={ate}
          funil={funil}
          baselines={baselines}
          amostra={amostra}
          funilOpcoes={funilOpcoes}
          sugestoes={sugestoes}
          presets={presets}
        />
      </div>
    </div>
  )
}
