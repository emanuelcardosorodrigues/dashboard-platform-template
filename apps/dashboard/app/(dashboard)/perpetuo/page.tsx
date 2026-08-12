export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import { computePeriodSummary } from '@/lib/periodSummary'
import { fetchFunisConfig, fetchMetaAds, fetchTransacoes, fetchQualificacao, fetchExperiments, filterByAccount, filterByFunil, filterTransacoesByFunil, getDateRange } from '@/lib/supabase'
import { aggregateBy } from '@/lib/adsAggregation'
import { buildPerpetuoDetalhes } from '@/lib/perpetuoDetalhes'
import { DEFAULT_FUNIS } from '@/lib/funisConfig'
import PerpetuoClient from './PerpetuoClient'

// UTC-3 (Brasília) — mesmo padrão do resto do dashboard.
function brazilDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000)
  d.setUTCDate(d.getUTCDate() - offsetDays)
  return d.toISOString().slice(0, 10)
}

/**
 * Aba "Perpétuo" (Track B) — funil perpétuo em node-graph (React Flow).
 * SKELETON B-P1: renderiza os nós do funil (tráfego → produto → upsell, order bumps
 * pendurados) com métricas REAIS de computePeriodSummary. Editor (arrastar/inserir/
 * apagar + salvar layout), painéis da bolinha e o modal do nó vêm em B-P2/B-P3/B-P4.
 */
/**
 * PERF: a página devolve o shell (Header + moldura) SEM esperar dado — o mapa entra
 * por streaming via <Suspense>. Antes tudo era `await` antes do JSX, e com o layout
 * já não bloqueando, esse await virava o TTFB inteiro da rota (medido 5,3s).
 */
export default async function PerpetuoPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; funil?: string; conta?: string }>
}) {
  const sp = await searchParams
  const de = sp.de || brazilDateStr(30)
  const ate = sp.ate || brazilDateStr(0)
  const conta = sp.conta ?? 'all'
  const funilSlug = sp.funil && sp.funil !== 'all' ? sp.funil.replace(/-$/, '') : 'col'

  return (
    <div className="flex flex-col h-full">
      <Header title="Perpétuo" subtitle="Funil perpétuo — mapa de nós" />
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<PerpetuoSkeleton />}>
          <PerpetuoData de={de} ate={ate} conta={conta} funilSlug={funilSlug} />
        </Suspense>
      </div>
    </div>
  )
}

function PerpetuoSkeleton() {
  return (
    <div className="h-full w-full bg-[#0a0f1e] flex items-center justify-center">
      <div className="flex items-center gap-3 text-white/40 text-sm">
        <span className="h-4 w-4 rounded-full border-2 border-purple-400/40 border-t-purple-400 animate-spin" />
        Montando o mapa do funil…
      </div>
    </div>
  )
}

async function PerpetuoData({
  de, ate, conta, funilSlug,
}: { de: string; ate: string; conta: string; funilSlug: string }) {
  const funis = await fetchFunisConfig().catch(() => DEFAULT_FUNIS)
  const lista = funis.length ? funis : DEFAULT_FUNIS
  const funilCfg = lista.find((f) => f.slug === funilSlug) ?? lista[0]
  // Convenção de token do dashboard: col/dpl/lps com traço; plo sem.
  const funilParam = funilCfg.slug === 'plo' ? 'plo' : `${funilCfg.slug}-`

  const summary = await computePeriodSummary(de, ate, funilParam, conta)

  // B-P3: dados dos 4 níveis pro "expandir" — MESMA engine/atribuição do /campanhas
  // (aggregateBy extraída). fetchMetaAds/fetchTransacoes são cache()d por request,
  // então não há fetch dobrado com o computePeriodSummary acima.
  const { from, to } = getDateRange(de, ate)
  const [allRows, allTransacoes, qualRows, experimentos] = await Promise.all([fetchMetaAds(), fetchTransacoes(), fetchQualificacao(), fetchExperiments().catch(() => [])])
  const qualMap = new Map(qualRows.map((q) => [q.email.toLowerCase(), q]))
  const accountFiltered = filterByAccount(allRows, conta)
  const rows = filterByFunil(
    accountFiltered.filter((r) => (!from || r.data >= from) && (!to || r.data <= to)),
    funilCfg.slug, lista,
  )
  const transacoes = filterTransacoesByFunil(
    allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to)) && (t.valor_bruto || 0) > 1),
    funilCfg.slug, accountFiltered, lista,
  )
  const allForAttribution = filterByFunil(accountFiltered, funilCfg.slug, lista)
  const campanhas = aggregateBy(rows, allForAttribution, transacoes, 'campaign_name')
  const conjuntos = aggregateBy(rows, allForAttribution, transacoes, 'adset_name')
  const anuncios = aggregateBy(rows, allForAttribution, transacoes, 'ad_name')

  // B-P4: detalhes do funil pro modal do nó (série/origem/página/esteira/hora/dia)
  const detalhes = buildPerpetuoDetalhes(transacoes, summary, qualMap)

  return (
    <PerpetuoClient
      funilSlug={funilCfg.slug}
      funilNome={funilCfg.nome}
      cor={funilCfg.cor ?? '#8b5cf6'}
      temUpsell={funilCfg.produtos.some((p) => p.papel === 'upsell')}
      temOb={funilCfg.produtos.some((p) => p.papel === 'ob')}
      summary={summary}
      campanhas={campanhas}
      conjuntos={conjuntos}
      anuncios={anuncios}
      detalhes={detalhes}
      experimentos={experimentos}
    />
  )
}
