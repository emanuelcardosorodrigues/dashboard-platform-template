export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import { fetchTransacoes, fetchMetaAds, fetchFunisConfig, getDateRange, filterByFunil, filterByAccount, filterTransacoesByFunil } from '@/lib/supabase'
import type { FunilConfig } from '@/lib/funisConfig'
import FinanceiroClient from './FinanceiroClient'
import { computePeriodSummary, type PeriodSummary } from '@/lib/periodSummary'
import { computeComparisonRange, parseCompareMode, formatComparisonLabel } from '@/lib/comparePeriods'
import { computeTicketFunil } from '@/lib/ticketFunil'

export type TransacaoLeve = {
  data: string
  produto: string
  valor_bruto: number
  utm_medium: string
  forma_pagamento: string
  criativo: string
  comprador: string  // chave de comprador único (email, fallback hotmart_id) p/ ticket médio
}

export default async function FinanceiroPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; funil?: string; conta?: string; cmp?: string; cmpDe?: string; cmpAte?: string }> }) {
  const { de = '', ate = '', funil = 'all', conta = 'all', cmp, cmpDe, cmpAte } = await searchParams
  const cmpMode = parseCompareMode(cmp)
  const cmpRange = computeComparisonRange(de, ate, cmpMode, cmpDe, cmpAte)
  const cmpLabel = cmpRange ? formatComparisonLabel(cmpMode, cmpRange) : ''
  return (
    <div className="flex flex-col h-full">
      <Header title="Financeiro" subtitle="P&L diário e análise de receitas" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Suspense fallback={<div className="bg-[#111827] border border-[#1F2937] rounded-xl h-96 animate-pulse" />}>
          <FinanceiroContent de={de} ate={ate} funil={funil} conta={conta} cmpFrom={cmpRange?.from} cmpTo={cmpRange?.to} cmpLabel={cmpLabel} />
        </Suspense>
      </div>
    </div>
  )
}

async function FinanceiroContent({ de, ate, funil, conta, cmpFrom, cmpTo, cmpLabel }: { de: string; ate: string; funil: string; conta: string; cmpFrom?: string; cmpTo?: string; cmpLabel?: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allTransacoes, allMeta, funis] = await Promise.all([fetchTransacoes(), fetchMetaAds(), fetchFunisConfig()])
  const accountFiltered = filterByAccount(allMeta, conta)
  const previousSummary: PeriodSummary | null = (cmpFrom && cmpTo)
    ? await computePeriodSummary(cmpFrom, cmpTo, funil, conta)
    : null

  const dateFilteredTransacoes = allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to)))
  const transacoes = filterTransacoesByFunil(dateFilteredTransacoes, funil, accountFiltered, funis).filter((t) => (t.valor_bruto || 0) > 1)
  const metaAds = filterByFunil(accountFiltered.filter((r) => (!from || r.data >= from) && (!to || r.data <= to)), funil, funis)

  // Contribuição de cada produto pro ticket médio (S3) — `transacoes` já está no MESMO
  // recorte (data + funil + valor_bruto>1) usado pra montar `transacoesLeves`/byProduct
  // no client, então opts fica vazio (sem refiltrar de novo). Independe do segmento de
  // canal (Pago/Orgânico/...) selecionado no client — é o funil INTEIRO (blended).
  // `funil` e `funis` são obrigatórios: sem eles o serviço entra em modo "todos os
  // funis" e o papel do produto sai da régua global em vez do papel DENTRO deste funil.
  const ticketFunil = computeTicketFunil(transacoes, accountFiltered, { funil, funis })

  // Lean transacoes for client
  const transacoesLeves: TransacaoLeve[] = transacoes.map((t) => ({
    data: t.data || '',
    produto: t.produto || '',
    valor_bruto: t.valor_bruto || 0,
    utm_medium: t.utm_medium_ultimo || t.utm_medium_primeiro || 'Direto',
    forma_pagamento: t.forma_pagamento || '',
    criativo: t.criativo || '',
    comprador: (t.email || t.hotmart_id || '').toLowerCase().trim(),
  }))

  // Pre-compute investimento by date from meta_ads (not canal-filtered)
  const investimentoByDate: Record<string, number> = {}
  metaAds.forEach((r) => {
    const date = r.data?.slice(0, 10)
    if (!date) return
    investimentoByDate[date] = (investimentoByDate[date] || 0) + (r.investimento || 0)
  })

  return (
    <FinanceiroClient
      transacoes={transacoesLeves}
      investimentoByDate={investimentoByDate}
      funil={funil}
      funis={funis}
      previousSummary={previousSummary}
      cmpLabel={cmpLabel}
      ticketFunil={ticketFunil}
    />
  )
}
