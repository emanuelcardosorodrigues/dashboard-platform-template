export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import { fetchQualificacao, fetchTransacoes, getDateRange } from '@/lib/supabase'
import type { CompradoresQualificado } from '@/types'
import VozCompradorClient from './VozCompradorClient'
import ComparisonHero from '@/components/cards/ComparisonHero'
import { computePeriodSummary } from '@/lib/periodSummary'
import { computeComparisonRange, parseCompareMode, formatComparisonLabel } from '@/lib/comparePeriods'

function normalizeName(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export default async function VozCompradorPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; funil?: string; conta?: string; cmp?: string; cmpDe?: string; cmpAte?: string }> }) {
  const { de = '', ate = '', funil = 'all', conta = 'all', cmp, cmpDe, cmpAte } = await searchParams
  const cmpMode = parseCompareMode(cmp)
  const cmpRange = computeComparisonRange(de, ate, cmpMode, cmpDe, cmpAte)
  const cmpLabel = cmpRange ? formatComparisonLabel(cmpMode, cmpRange) : ''
  return (
    <div className="flex flex-col h-full">
      <Header title="Voz do Comprador" subtitle="Respostas qualitativas e frequência de dores" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Suspense fallback={<div className="bg-[#111827] border border-[#1F2937] rounded-xl h-96 animate-pulse" />}>
          <VozContent de={de} ate={ate} funil={funil} conta={conta} cmpFrom={cmpRange?.from} cmpTo={cmpRange?.to} cmpLabel={cmpLabel} />
        </Suspense>
      </div>
    </div>
  )
}

async function VozContent({ de, ate, funil, conta, cmpFrom, cmpTo, cmpLabel }: { de: string; ate: string; funil: string; conta: string; cmpFrom?: string; cmpTo?: string; cmpLabel?: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allTransacoes, qualRows] = await Promise.all([fetchTransacoes(), fetchQualificacao()])

  // Filter by transacoes date (buyers in this period)
  const transacoes = allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to)) && (t.valor_bruto || 0) > 1)
  const emailsInPeriod = new Set(transacoes.map((t) => t.email?.toLowerCase()).filter(Boolean))
  const qualMap = new Map(qualRows.map((q) => [q.email.toLowerCase(), q]))
  const qualByName = new Map<string, (typeof qualRows)[number]>()

  qualRows.forEach((q) => {
    const key = normalizeName(q.nome)
    if (!key) return
    const current = qualByName.get(key)
    if (!current) {
      qualByName.set(key, q)
      return
    }

    const currentScore = Number(Boolean(current.whatsapp)) + Number(Boolean(current.tem_ficha))
    const nextScore = Number(Boolean(q.whatsapp)) + Number(Boolean(q.tem_ficha))
    if (nextScore > currentScore) {
      qualByName.set(key, q)
    }
  })

  const compradores: CompradoresQualificado[] = Array.from(emailsInPeriod)
    .map((email) => {
      const t = transacoes.find((x) => x.email?.toLowerCase() === email)
      if (!t) return null
      const q = qualMap.get(email!) ?? qualByName.get(normalizeName(t.nome))
      return {
        nome: t.nome, email: t.email, criativo: t.criativo || '',
        qualificacao: q?.tem_ficha ? ('Qualificado' as const) : ('Sem ficha' as const),
        whatsapp: q?.whatsapp,
        instagram: q?.instagram,
        sexo: q?.sexo, faixaEtaria: q?.faixa_etaria,
        faturamentoDeclarado: q?.faturamento_declarado,
        maiorDificuldade: q?.maior_dificuldade,
        medos: q?.medos, objetivos: q?.objetivos,
        valorSonho: q?.valor_sonho_mensal,
        tentouAntes: q?.tentou_antes,
        porqueNaoFuncionou: q?.por_que_nao_funcionou,
      }
    })
    .filter(Boolean) as CompradoresQualificado[]

  const [current, previous] = await Promise.all([
    computePeriodSummary(de, ate, funil, conta),
    (cmpFrom && cmpTo) ? computePeriodSummary(cmpFrom, cmpTo, funil, conta) : null,
  ])

  return (
    <>
      <ComparisonHero
        current={current}
        previous={previous}
        cmpLabel={cmpLabel}
        metrics={['vendasFront', 'faturamento', 'ticketMedio', 'compradoresPorDia', 'roas', 'cpa']}
      />
      <VozCompradorClient compradores={compradores} />
    </>
  )
}
