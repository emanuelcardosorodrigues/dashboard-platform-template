export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import { fetchQualificacao, fetchTransacoes, scoreQualificacao, getDateRange } from '@/lib/supabase'
import type { AlunoMentoria, CompradoresQualificado } from '@/types'
import QualificacaoClient from './QualificacaoClient'
import ComparisonHero from '@/components/cards/ComparisonHero'
import { computePeriodSummary } from '@/lib/periodSummary'
import { computeComparisonRange, parseCompareMode, formatComparisonLabel } from '@/lib/comparePeriods'

export default async function QualificacaoPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; funil?: string; conta?: string; cmp?: string; cmpDe?: string; cmpAte?: string }> }) {
  const { de = '', ate = '', funil = 'all', conta = 'all', cmp, cmpDe, cmpAte } = await searchParams
  const cmpMode = parseCompareMode(cmp)
  const cmpRange = computeComparisonRange(de, ate, cmpMode, cmpDe, cmpAte)
  const cmpLabel = cmpRange ? formatComparisonLabel(cmpMode, cmpRange) : ''
  return (
    <div className="flex flex-col h-full">
      <Header title="Qualificação" subtitle="Análise de qualificação de leads e compradores" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Suspense fallback={<div className="bg-[#111827] border border-[#1F2937] rounded-xl h-96 animate-pulse" />}>
          <QualificacaoContent de={de} ate={ate} funil={funil} conta={conta} cmpFrom={cmpRange?.from} cmpTo={cmpRange?.to} cmpLabel={cmpLabel} />
        </Suspense>
      </div>
    </div>
  )
}

async function QualificacaoContent({ de, ate, funil, conta, cmpFrom, cmpTo, cmpLabel }: { de: string; ate: string; funil: string; conta: string; cmpFrom?: string; cmpTo?: string; cmpLabel?: string }) {
  const { from, to } = getDateRange(de, ate)
  const [allTransacoes, qualRows] = await Promise.all([fetchTransacoes(), fetchQualificacao()])

  const transacoes = allTransacoes.filter((t) => (!from || (t.data && t.data >= from)) && (!to || (t.data && t.data <= to)) && (t.valor_bruto || 0) > 1)
  const qualMap = new Map(qualRows.map((q) => [q.email.toLowerCase(), q]))

  const compradores: CompradoresQualificado[] = transacoes
    .filter((t) => t.nome)
    .map((t) => {
      const qual = qualMap.get(t.email?.toLowerCase() ?? '')
      return {
        nome: t.nome, email: t.email, criativo: t.criativo || '',
        qualificacao: scoreQualificacao(qual),
        whatsapp: qual?.whatsapp,
        instagram: qual?.instagram,
        sexo: qual?.sexo, faixaEtaria: qual?.faixa_etaria,
        faturamentoDeclarado: qual?.faturamento_declarado, quantoSobra: qual?.quanto_sobra,
        tempoOdontologia: qual?.tempo_odontologia, especialidade: qual?.especialidade,
        tipoPessoa: qual?.tipo_clinica, maiorDificuldade: qual?.maior_dificuldade,
        medos: qual?.medos, objetivos: qual?.objetivos,
        valorSonho: qual?.valor_sonho_mensal, tentouAntes: qual?.tentou_antes,
        porqueNaoFuncionou: qual?.por_que_nao_funcionou, alunoMentoria: Boolean(qual?.aluno_mentoria),
      }
    })

  const byCriativo: Record<string, { qualificados: number; semi: number; leads: number; total: number }> = {}
  compradores.forEach((c) => {
    const key = c.criativo || 'Sem criativo'
    if (!byCriativo[key]) byCriativo[key] = { qualificados: 0, semi: 0, leads: 0, total: 0 }
    byCriativo[key].total++
    if (c.qualificacao === 'Qualificado') byCriativo[key].qualificados++
    else if (c.qualificacao === 'Semi-qualificado') byCriativo[key].semi++
    else byCriativo[key].leads++
  })

  const alunos: AlunoMentoria[] = compradores
    .filter((c) => c.alunoMentoria)
    .map((c) => ({
      nome: c.nome,
      email: c.email,
      whatsapp: c.whatsapp,
      instagram: c.instagram,
      criativo: c.criativo,
      qualificacao: c.qualificacao,
      faturamentoDeclarado: c.faturamentoDeclarado,
      especialidade: c.especialidade,
    }))

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
      <QualificacaoClient
        compradores={compradores}
        alunos={alunos}
        byCriativo={byCriativo}
        stats={{
          totalComFicha: compradores.filter((c) => c.qualificacao !== 'Sem ficha').length,
          totalQualificados: compradores.filter((c) => c.qualificacao === 'Qualificado').length,
          totalSemi: compradores.filter((c) => c.qualificacao === 'Semi-qualificado').length,
          totalLeads: compradores.filter((c) => c.qualificacao === 'Lead').length,
          totalMentoria: alunos.length,
        }}
        criativoLinks={{}}
      />
    </>
  )
}
