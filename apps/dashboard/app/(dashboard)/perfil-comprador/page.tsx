export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import { fetchQualificacao, fetchTransacoes, tipoDaTransacao, getDateRange } from '@/lib/supabase'
import PerfilCompradorClient from './PerfilCompradorClient'
import ComparisonHero from '@/components/cards/ComparisonHero'
import { computePeriodSummary } from '@/lib/periodSummary'
import { computeComparisonRange, parseCompareMode, formatComparisonLabel } from '@/lib/comparePeriods'

export default async function PerfilCompradorPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; funil?: string; conta?: string; cmp?: string; cmpDe?: string; cmpAte?: string }> }) {
  const { de = '', ate = '', funil = 'all', conta = 'all', cmp, cmpDe, cmpAte } = await searchParams
  const cmpMode = parseCompareMode(cmp)
  const cmpRange = computeComparisonRange(de, ate, cmpMode, cmpDe, cmpAte)
  const cmpLabel = cmpRange ? formatComparisonLabel(cmpMode, cmpRange) : ''
  return (
    <div className="flex flex-col h-full">
      <Header title="Perfil do Comprador" subtitle="Análise demográfica e comportamental" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Suspense fallback={<div className="bg-[#111827] border border-[#1F2937] rounded-xl h-96 animate-pulse" />}>
          <PerfilContent de={de} ate={ate} funil={funil} conta={conta} cmpFrom={cmpRange?.from} cmpTo={cmpRange?.to} cmpLabel={cmpLabel} />
        </Suspense>
      </div>
    </div>
  )
}

export interface BuyerRow {
  criativo: string
  sexo: string
  faixaEtaria: string
  faturamento: string
  quantoSobra: string
  tempoOdontologia: string
  especialidade: string
  tipoPessoa: string   // 'CPF' | 'CNPJ' | 'Não informado'
  motivoCompra: string
  tentouAntes: string
  comprouOb1: boolean
  comprouOb2: boolean
  comprouOb3: boolean
  data: string
  horaTs?: string
}

async function PerfilContent({ de, ate, funil, conta, cmpFrom, cmpTo, cmpLabel }: { de: string; ate: string; funil: string; conta: string; cmpFrom?: string; cmpTo?: string; cmpLabel?: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allTransacoes, qualRows] = await Promise.all([fetchTransacoes(), fetchQualificacao()])

  const transacoes = allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to)) && (t.valor_bruto || 0) > 1)
  const qualMap = new Map(qualRows.map((q) => [q.email.toLowerCase(), q]))

  // Per buyer: collect all products purchased (to know OBs).
  // Filtra vendas de teste / refunds (valor_bruto <= R$1) pra não marcar tags falsas.
  const obMap = new Map<string, { ob1: boolean; ob2: boolean; ob3: boolean; ob4: boolean }>()
  allTransacoes.forEach((t) => {
    if ((t.valor_bruto || 0) <= 1) return
    const email = t.email?.toLowerCase() ?? ''
    if (!obMap.has(email)) obMap.set(email, { ob1: false, ob2: false, ob3: false, ob4: false })
    const tipo = tipoDaTransacao(t)
    const entry = obMap.get(email)!
    if (tipo === 'ob1') entry.ob1 = true
    if (tipo === 'ob2') entry.ob2 = true
    if (tipo === 'ob3') entry.ob3 = true
    if (tipo === 'ob4') entry.ob4 = true
  })

  const seen = new Set<string>()
  const buyers: BuyerRow[] = []
  transacoes.forEach((t) => {
    const email = t.email?.toLowerCase() ?? ''
    if (!email || seen.has(email)) return
    seen.add(email)
    const qual = qualMap.get(email)
    const obs = obMap.get(email) ?? { ob1: false, ob2: false, ob3: false, ob4: false }
    buyers.push({
      criativo: t.criativo || '',
      sexo: qual?.sexo ?? '', faixaEtaria: qual?.faixa_etaria ?? '',
      faturamento: qual?.faturamento_declarado ?? '', quantoSobra: qual?.quanto_sobra ?? '',
      tempoOdontologia: qual?.tempo_odontologia ?? '', especialidade: qual?.especialidade ?? '',
      tipoPessoa: (() => {
        const digits = (qual?.cpf_cnpj ?? '').replace(/\D/g, '')
        if (digits.length === 11) return 'CPF'
        if (digits.length === 14) return 'CNPJ'
        return 'Não informado'
      })(),
      motivoCompra: qual?.motivo_compra ?? '',
      tentouAntes: qual?.tentou_antes ?? '',
      comprouOb1: obs.ob1, comprouOb2: obs.ob2, comprouOb3: obs.ob3,
      data: t.data ?? '',
      horaTs: t.hora_compra ?? t.created_at ?? undefined,
    })
  })

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
        metrics={['vendasFront', 'faturamento', 'ticketMedio', 'takeRateOB', 'compradoresPorDia', 'roas']}
      />
      <PerfilCompradorClient buyers={buyers} criativoLinks={{}} />
    </>
  )
}
