export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import { fetchGa4TopPages } from '@/lib/ga4'
import { fetchTransacoes, fetchExperiments, fetchImpressionUids, fetchClarityDailyRange, fetchCheckoutHits, getDateRange } from '@/lib/supabase'
import { buildPageAnalysis } from '@/lib/paginas'
import { todayBR, daysAgoBR } from '@/lib/formatters'
import AnalisePaginasClient from './AnalisePaginasClient'

interface SP {
  de?: string; ate?: string; funil?: string; conta?: string
  pDe?: string; pAte?: string; pFunil?: string; pUsarGeral?: string
}

export default async function AnalisePaginasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  return (
    <div className="flex flex-col h-full">
      <Header title="Análise de Páginas" subtitle="Diagnóstico de conversão por página — landing & quizzes" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Suspense fallback={<div className="h-64 bg-[#111827] border border-[#1F2937] rounded-xl animate-pulse" />}>
          <Conteudo sp={sp} />
        </Suspense>
      </div>
    </div>
  )
}

async function Conteudo({ sp }: { sp: SP }) {
  // Resolve filtro efetivo: usa o geral (de/ate/funil) ou o próprio da aba (pDe/pAte/pFunil).
  const usarGeral = (sp.pUsarGeral ?? 'on') !== 'off'
  const efDe = usarGeral ? (sp.de ?? '') : (sp.pDe || sp.de || '')
  const efAte = usarGeral ? (sp.ate ?? '') : (sp.pAte || sp.ate || '')
  const efFunil = usarGeral ? (sp.funil ?? 'all') : (sp.pFunil || sp.funil || 'all')
  const { from, to } = getDateRange(efDe, efAte)
  const start = from || daysAgoBR(30)
  const end = to || todayBR()

  // TODA fonte usa a MESMA janela [start, end] — a mesma que o cabeçalho anuncia ao usuário.
  // Antes, GA4/Clarity respeitavam a janela mas impressões, cliques e vendas vinham "desde
  // sempre": o rótulo dizia 30 dias e as razões misturavam períodos (numerador de 30d sobre
  // denominador de meses → passagem e conversão saíam menores que a real, encolhendo com o
  // tempo). Numerador e denominador de cada razão têm que morar na mesma janela.
  const [gaRes, txRes, expRes, uidRes, clarRes, hitRes] = await Promise.allSettled([
    fetchGa4TopPages(start, end, 1000), // retorna [] se GA4 não configurado no projeto ativo
    fetchTransacoes(),
    fetchExperiments(),
    fetchImpressionUids(start, end),
    fetchClarityDailyRange(start, end),
    fetchCheckoutHits(start, end),
  ])

  if (txRes.status === 'rejected') {
    return <ErroBanner msg={`Falha ao carregar transações (fonte de vendas): ${String(txRes.reason).slice(0, 160)}`} />
  }

  const gaPages = gaRes.status === 'fulfilled' ? gaRes.value : []
  const experiments = expRes.status === 'fulfilled' ? expRes.value : []
  const impressionUids = uidRes.status === 'fulfilled' ? uidRes.value : []
  const clarityRows = clarRes.status === 'fulfilled' ? clarRes.value : []
  const checkoutHits = hitRes.status === 'fulfilled' ? hitRes.value : []
  ;([['experimentos', expRes], ['UIDs A/B', uidRes], ['Clarity', clarRes]] as const).forEach(([label, r]) => {
    if (r.status === 'rejected') console.error(`[AnalisePaginas] falha ao buscar ${label}:`, r.reason)
  })
  // Vendas na mesma janela [start, end] das demais fontes (não mais "desde sempre" quando
  // o filtro está vazio — senão a conversão dividia vendas de meses pela base de 30 dias).
  const transacoes = txRes.value.filter((t) => {
    const d = (t.data || '').slice(0, 10)
    return d >= start && d <= end
  })

  const result = buildPageAnalysis({ gaPages, transacoes, experiments, impressionUids, clarityRows, checkoutHits, funil: efFunil })

  return (
    <AnalisePaginasClient
      result={result}
      janela={{ de: start, ate: end, funil: efFunil }}
      ga4Ok={gaRes.status === 'fulfilled'}
      expOk={expRes.status === 'fulfilled'}
      uidOk={uidRes.status === 'fulfilled'}
      clarOk={clarRes.status === 'fulfilled'}
    />
  )
}

function ErroBanner({ msg }: { msg: string }) {
  return (
    <div className="bg-[#111827] border border-red-900/50 rounded-xl p-6 text-center">
      <p className="text-lg font-medium text-rose-400 mb-2">Erro ao montar a análise</p>
      <p className="text-sm text-gray-400 break-all">{msg}</p>
    </div>
  )
}
