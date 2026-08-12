export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import { fetchQuizzes, fetchQuizSessions, fetchQuizFunnel, fetchTransacoes, detectFunil } from '@/lib/supabase'
import QuizzesClient from './QuizzesClient'

export default async function QuizzesPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; funil?: string; qDe?: string; qAte?: string; qFunil?: string; qUsarGeral?: string }> }) {
  const sp = await searchParams
  const { de = '', ate = '' } = sp
  // Filtro próprio da aba (FilterToggle prefix="q"): ON = filtro geral, OFF = exclusivo.
  const usarGeral = (sp.qUsarGeral ?? 'on') !== 'off'
  const efDe = usarGeral ? de : (sp.qDe || de)
  const efAte = usarGeral ? ate : (sp.qAte || ate)
  const efFunil = usarGeral ? (sp.funil ?? 'all') : (sp.qFunil || sp.funil || 'all')
  return (
    <div className="flex flex-col h-full">
      <Header
        title="Quizzes"
        subtitle="Quiz interativo — example.com/q/{slug}"
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Suspense fallback={<div className="bg-[#111827] border border-[#1F2937] rounded-xl h-64 animate-pulse" />}>
          <QuizzesContent de={efDe} ate={efAte} funil={efFunil} />
        </Suspense>
      </div>
    </div>
  )
}

// Data Brasília (YYYY-MM-DD) de um timestamp UTC — pra casar com o filtro de data do header.
function brDay(ts: string | null | undefined): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

async function QuizzesContent({ de, ate, funil }: { de: string; ate: string; funil: string }) {
  const [allQuizzes, allSessions, allFunnel, allTransacoes] = await Promise.all([
    fetchQuizzes(),
    fetchQuizSessions(),
    fetchQuizFunnel(),
    fetchTransacoes(),
  ])

  // Filtro de funil próprio (FilterToggle prefix="q"): mantém só os quizzes do funil
  // selecionado (detectFunil do slug, ex "col-q02" → col). 'col-' do header vira 'col'.
  const nf = !funil || funil === 'all' ? null : funil.replace(/-$/, '').toLowerCase()
  const quizzes = nf ? allQuizzes.filter((q) => detectFunil(q.slug) === nf) : allQuizzes

  // Filtro de data único pra toda a aba (params de/ate do header). Vazio = tudo.
  const sessions = allSessions.filter((s) => {
    const d = brDay(s.started_at)
    return (!de || d >= de) && (!ate || d <= ate)
  })
  const funnel = allFunnel.filter((r) => (!de || r.day >= de) && (!ate || r.day <= ate))
  const transacoes = allTransacoes.filter((t) => {
    const d = (t.data || brDay(t.created_at) || '').slice(0, 10)
    return (!de || d >= de) && (!ate || d <= ate)
  })

  // sessionsBySlug — totais de sessões (uniqueness garantido pela PK uid+slug em quiz_sessions)
  const sessionsBySlug: Record<string, { total: number; completed: number; lastStarted: string | null }> = {}
  for (const s of sessions) {
    const slot = sessionsBySlug[s.quiz_slug] ?? { total: 0, completed: 0, lastStarted: null }
    slot.total++
    if (s.completed_at) slot.completed++
    if (!slot.lastStarted || s.started_at > slot.lastStarted) slot.lastStarted = s.started_at
    sessionsBySlug[s.quiz_slug] = slot
  }

  // salesBySlug — venda atribuída quando transacoes.sck_slug === quiz.slug.
  // sck_slug é o índice 0 do SCK (ex: "q/col-q02"), enquanto quiz_quizzes.slug é "col-q02".
  // Removemos o prefixo "q/" pra bater com o slug canônico.
  const salesBySlug: Record<string, { count: number; revenue: number }> = {}
  for (const t of transacoes) {
    const slug = t.sck_slug?.trim().replace(/^q\//, '')
    if (!slug) continue
    const slot = salesBySlug[slug] ?? { count: 0, revenue: 0 }
    slot.count++
    slot.revenue += Number(t.valor_bruto) || 0
    salesBySlug[slug] = slot
  }

  // funnelBySlug — agrega por step_id usando a ordem canônica do quiz_quizzes.config.steps.
  // Bots/eventos com step_index desordenado (ex: q_perfil reportado em step_index=6 por crawler
  // que dispara onclicks em ordem de HTML) eram mostrados como linhas extras na ordem errada.
  // Agora: ignoramos o step_index do evento e usamos o índice canônico da config do quiz.
  const funnelBySlug: Record<
    string,
    { step_index: number; step_id: string; views: number; answers: number; dropouts: number; completions: number; checkout_clicks: number }[]
  > = {}
  const canonicalIdxBySlug: Record<string, Record<string, number>> = {}
  for (const q of quizzes) {
    const steps = q.config?.steps ?? []
    const idxMap: Record<string, number> = {}
    steps.forEach((s, i) => { idxMap[s.id] = i })
    canonicalIdxBySlug[q.slug] = idxMap
  }
  const tmp: Record<string, Record<string, { step_id: string; step_index: number; views: number; answers: number; dropouts: number; completions: number; checkout_clicks: number }>> = {}
  for (const row of funnel) {
    if (!tmp[row.quiz_slug]) tmp[row.quiz_slug] = {}
    const canonical = canonicalIdxBySlug[row.quiz_slug]?.[row.step_id]
    // Step_id fora da config (eventos complete/dropout com step null, renomeado ou lixo de bot)
    // virava uma "etapa fantasma" no fim do funil — descarta.
    if (canonical === undefined) continue
    const step_index = canonical
    const key = row.step_id
    const cur = tmp[row.quiz_slug][key] ?? { step_index, step_id: row.step_id, views: 0, answers: 0, dropouts: 0, completions: 0, checkout_clicks: 0 }
    cur.views += row.views
    cur.answers += row.answers
    cur.dropouts += row.dropouts
    cur.completions += row.completions
    cur.checkout_clicks += row.checkout_clicks
    tmp[row.quiz_slug][key] = cur
  }
  for (const slug of Object.keys(tmp)) {
    funnelBySlug[slug] = Object.values(tmp[slug]).sort((a, b) => a.step_index - b.step_index)
  }

  // checkoutClicksBySlug — cliques no botão de checkout (evento checkout_click, cai na etapa "oferta").
  const checkoutClicksBySlug: Record<string, number> = {}
  for (const slug of Object.keys(funnelBySlug)) {
    checkoutClicksBySlug[slug] = funnelBySlug[slug].reduce((s, f) => s + f.checkout_clicks, 0)
  }

  // utmsBySlug — distribuição de UTMs (source / campaign / content) das sessões por quiz
  const utmsBySlug: Record<string, { source: Record<string, number>; medium: Record<string, number>; campaign: Record<string, number>; content: Record<string, number> }> = {}
  for (const s of sessions) {
    const slug = s.quiz_slug
    if (!utmsBySlug[slug]) utmsBySlug[slug] = { source: {}, medium: {}, campaign: {}, content: {} }
    const u = (s.utms ?? {}) as Record<string, string | undefined>
    const dims: Array<['source' | 'medium' | 'campaign' | 'content', string]> = [
      ['source',   u.utm_source   || '(direct)'],
      ['medium',   u.utm_medium   || '(none)'],
      ['campaign', u.utm_campaign || '(none)'],
      ['content',  u.utm_content  || '(none)'],
    ]
    for (const [dim, val] of dims) {
      utmsBySlug[slug][dim][val] = (utmsBySlug[slug][dim][val] ?? 0) + 1
    }
  }

  return (
    <QuizzesClient
      quizzes={quizzes}
      sessionsBySlug={sessionsBySlug}
      salesBySlug={salesBySlug}
      funnelBySlug={funnelBySlug}
      utmsBySlug={utmsBySlug}
      checkoutClicksBySlug={checkoutClicksBySlug}
    />
  )
}
