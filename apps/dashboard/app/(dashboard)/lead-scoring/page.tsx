export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import { fetchQualificacao, fetchLeadScoreConfigs, detectFunil, getDateRange } from '@/lib/supabase'
import { buildQuestions, configFromRow, summarizeLeads } from '@/lib/leadScore'
import LeadScoringClient from './LeadScoringClient'

interface SP {
  de?: string; ate?: string; funil?: string
  lDe?: string; lAte?: string; lFunil?: string; lUsarGeral?: string
}

export default async function LeadScoringPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  return (
    <div className="flex flex-col h-full">
      <Header title="Lead Scoring" subtitle="Monte o score por funil e calibre no alvo de conversão" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Suspense fallback={<div className="h-64 bg-[#111827] border border-[#1F2937] rounded-xl animate-pulse" />}>
          <Conteudo sp={sp} />
        </Suspense>
      </div>
    </div>
  )
}

async function Conteudo({ sp }: { sp: SP }) {
  const usarGeral = (sp.lUsarGeral ?? 'on') !== 'off'
  const efDe = usarGeral ? (sp.de ?? '') : (sp.lDe || sp.de || '')
  const efAte = usarGeral ? (sp.ate ?? '') : (sp.lAte || sp.ate || '')
  const efFunil = usarGeral ? (sp.funil ?? 'all') : (sp.lFunil || sp.funil || 'all')
  const { from, to } = getDateRange(efDe, efAte)
  const nf = !efFunil || efFunil === 'all' ? null : efFunil.replace(/-$/, '').toLowerCase()

  const [allQual, configs] = await Promise.all([fetchQualificacao(), fetchLeadScoreConfigs()])

  // Leads pontuáveis = quem preencheu a ficha; recorta por funil (criativo) e data (1ª compra).
  const rows = allQual.filter((r) => {
    if (!r.tem_ficha) return false
    if (nf && detectFunil(r.criativo || '') !== nf) return false
    const d = (r.data_primeira_compra || '').slice(0, 10)
    if (d) { if (from && d < from) return false; if (to && d > to) return false }
    return true
  })

  const config = configFromRow(efFunil, configs.find((c) => c.funil === efFunil))
  const questions = buildQuestions(rows)
  const summary = summarizeLeads(rows, config)

  return (
    <LeadScoringClient
      config={config}
      questions={questions}
      summary={summary}
      janela={{ de: from || '—', ate: to || '—', funil: efFunil }}
    />
  )
}
