/**
 * /organico/comentarios — Análises de Comentários. Determinístico (rankings,
 * palavras, gatilhos, sentimento) computado server-side; leitura qualitativa
 * (dores/dificuldades/oportunidades/desejos/dúvidas) vem do cache de IA. Escopo
 * por conta (AccountFilter) + período (FilterToggle), igual às outras abas.
 */
import Link from 'next/link'
import Header from '@/components/layout/Header'
import AccountFilter from '@/components/organico/AccountFilter'
import FilterToggle from '@/components/filters/FilterToggle'
import { Plug } from 'lucide-react'
import { fetchOrganicAccounts } from '@/lib/organico/queries'
import { resolveConta } from '@/lib/organico/conta'
import { resolveOrgRange, inRange, type OrgDateParams } from '@/lib/organico/dateFilter'
import {
  fetchComentarios, fetchTriggers, fetchCommentInsights,
  topAutores, topPosts, wordFreq, gatilhos, sentimentoNoTempo, normalizeTrigger,
} from '@/lib/organico/comentarios'
import ComentariosClient from './ComentariosClient'

export const dynamic = 'force-dynamic'

export default async function ComentariosPage({ searchParams }: { searchParams: Promise<{ conta?: string } & OrgDateParams> }) {
  const [yt, ig, tt] = await Promise.all([
    fetchOrganicAccounts('youtube'), fetchOrganicAccounts('instagram'), fetchOrganicAccounts('tiktok'),
  ])
  const accounts = [...yt, ...ig, ...tt]
  const sp = await searchParams
  const contaSel = await resolveConta(sp.conta, accounts.map((a) => a.external_id))
  const { de, ate } = resolveOrgRange(sp)

  const [todos, triggerList, insightsCache] = await Promise.all([
    fetchComentarios(), fetchTriggers(), fetchCommentInsights(),
  ])

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Análises de Comentários" subtitle="O que o público comenta — quem, o quê, dores, desejos e gatilhos" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-10 max-w-xl mx-auto mt-10 text-center">
            <Plug size={28} className="mx-auto text-gray-500 mb-3" />
            <h2 className="text-white font-semibold mb-1">Nenhuma conta conectada</h2>
            <p className="text-sm text-gray-400 mb-4">Conecte YouTube/Instagram em Admin → Projetos.</p>
            <Link href="/admin/projetos" className="inline-flex rounded-md bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-medium text-white">Admin → Projetos</Link>
          </div>
        </div>
      </div>
    )
  }

  // Escopo: conta selecionada + período.
  const rows = todos.filter((c) =>
    (!contaSel || c.account_external_id === contaSel) && inRange(c.published_at, de, ate))

  const confirmed = new Set(triggerList.map((w) => normalizeTrigger(w)))
  const sentCount = { positivo: 0, negativo: 0, neutro: 0 }
  let perguntas = 0
  for (const r of rows) {
    if (r.sentiment) sentCount[r.sentiment]++
    if (r.is_question) perguntas++
  }
  const autoresUnicos = new Set(rows.map((r) => r.author_handle).filter(Boolean)).size

  const kpis = {
    total: rows.length,
    autores: autoresUnicos,
    perguntasPct: rows.length ? Math.round((perguntas / rows.length) * 100) : 0,
    sentimentoLiquido: sentCount.positivo - sentCount.negativo,
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Análises de Comentários" subtitle="O que o público comenta — quem, o quê, dores, desejos e gatilhos de automação" />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <AccountFilter accounts={accounts} />
        <FilterToggle prefix="org" showFunil={false} />
        <ComentariosClient
          rows={rows.map((r) => ({
            id: r.id, autor: r.author_handle, texto: r.text ?? '', likes: r.like_count ?? 0,
            replies: r.reply_count ?? 0, data: r.published_at, sentiment: r.sentiment,
            themes: r.themes, pergunta: !!r.is_question,
            postTitulo: (r.post_title || '').slice(0, 80), postLink: r.post_permalink, postThumb: r.post_thumb,
          }))}
          kpis={kpis}
          autores={topAutores(rows)}
          posts={topPosts(rows)}
          palavras={wordFreq(rows, confirmed)}
          gatilhos={gatilhos(rows, confirmed)}
          sentSerie={sentimentoNoTempo(rows)}
          insights={insightsCache.insights}
          insightsComputedAt={insightsCache.computedAt}
          insightsAmostra={insightsCache.amostra}
        />
      </div>
    </div>
  )
}
