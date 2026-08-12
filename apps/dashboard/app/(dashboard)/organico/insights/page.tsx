/**
 * /organico/insights — a pré-análise que o dashboard cospe pronto.
 * Insights determinísticos (correlações com guarda de amostra) + rollup de
 * comentários (sentimento, temas, perguntas). Sem IA na superfície: só conclusões.
 */
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { Plug, AlertTriangle, TrendingUp, Info, MessageSquare } from 'lucide-react'
import {
  fetchOrganicAccounts, fetchOrganicInsights, fetchCommentSummary,
} from '@/lib/organico/queries'
import { TEMAS_COMENTARIO } from '@/lib/organico/taxonomiaComentarios'

export const dynamic = 'force-dynamic'

const SEV = {
  alta: { icon: AlertTriangle, cls: 'border-rose-500/30 bg-rose-500/[0.06]', dot: 'text-rose-400' },
  media: { icon: TrendingUp, cls: 'border-amber-500/30 bg-amber-500/[0.05]', dot: 'text-amber-400' },
  info: { icon: Info, cls: 'border-blue-500/20 bg-blue-500/[0.04]', dot: 'text-blue-400' },
} as const

const SENTIMENT_CLS: Record<string, string> = {
  positivo: 'text-emerald-300', negativo: 'text-rose-300', neutro: 'text-gray-400',
}

export default async function InsightsOrganicoPage() {
  const [yt, ig, tt] = await Promise.all([
    fetchOrganicAccounts('youtube'), fetchOrganicAccounts('instagram'), fetchOrganicAccounts('tiktok'),
  ])
  if (yt.length + ig.length + tt.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Insights IA — Orgânico" subtitle="Conclusões automáticas sobre o que funciona" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-10 max-w-xl mx-auto mt-10 text-center">
            <Plug size={28} className="mx-auto text-gray-500 mb-3" />
            <h2 className="text-white font-semibold mb-1">Nenhuma conta conectada</h2>
            <p className="text-sm text-gray-400 mb-4">Os insights aparecem após alguns dias de dados das contas conectadas.</p>
            <Link href="/admin/projetos" className="inline-flex rounded-md bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-medium text-white">Admin → Projetos</Link>
          </div>
        </div>
      </div>
    )
  }

  const [{ insights, computedAt }, comments] = await Promise.all([
    fetchOrganicInsights(), fetchCommentSummary(),
  ])
  const temasOrdenados = Object.entries(comments.porTema).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const totalSent = Object.values(comments.porSentimento).reduce((s, v) => s + v, 0)

  return (
    <div className="flex flex-col h-full">
      <Header title="Insights IA — Orgânico" subtitle="O que o dashboard concluiu sozinho — sem você caçar" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Padrões detectados</h2>
          {insights.length === 0 ? (
            <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-6 text-sm text-gray-500">
              Ainda sem amostra suficiente pra concluir com segurança. Os insights aparecem conforme os posts acumulam
              (mínimo ~8 posts ou 14 dias por análise) e o cron diário recalcula. {computedAt && <span className="text-gray-600">Último cálculo: {new Date(computedAt).toLocaleString('pt-BR')}.</span>}
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {insights.map((ins) => {
                const sev = SEV[ins.severity]
                const Icon = sev.icon
                return (
                  <div key={ins.id} className={`rounded-xl border p-4 ${sev.cls}`}>
                    <div className="flex items-start gap-2.5">
                      <Icon size={16} className={`${sev.dot} mt-0.5 shrink-0`} />
                      <div>
                        <h3 className="text-sm font-semibold text-white">{ins.titulo}</h3>
                        <p className="text-xs text-gray-400 mt-1">{ins.evidencia}</p>
                        <p className="text-xs text-gray-300 mt-1.5"><span className="text-gray-500">Ação:</span> {ins.recomendacao}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Rollup de comentários */}
        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <MessageSquare size={14} /> Comentários ({comments.total} analisados)
          </h2>
          {comments.total === 0 ? (
            <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-6 text-sm text-gray-500">
              Sem comentários analisados ainda — a coleta e a classificação (com vocabulário fixo) rodam diariamente.
            </div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
                <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Sentimento</h3>
                {(['positivo', 'neutro', 'negativo'] as const).map((s) => {
                  const v = comments.porSentimento[s] ?? 0
                  const pc = totalSent > 0 ? (v / totalSent) * 100 : 0
                  return (
                    <div key={s} className="mb-2">
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className={SENTIMENT_CLS[s]}>{s}</span>
                        <span className="text-gray-400">{v} ({pc.toFixed(0)}%)</span>
                      </div>
                      <div className="h-1.5 rounded bg-white/5 overflow-hidden">
                        <div className={`h-full rounded ${s === 'positivo' ? 'bg-emerald-400' : s === 'negativo' ? 'bg-rose-400' : 'bg-gray-500'}`} style={{ width: `${pc}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
                <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Temas mais comentados</h3>
                <div className="space-y-1.5">
                  {temasOrdenados.map(([t, v]) => (
                    <div key={t} className="flex justify-between text-xs">
                      <span className="text-gray-300">{TEMAS_COMENTARIO[t]?.label ?? t}</span>
                      <span className="text-gray-500">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4 flex flex-col justify-center items-center text-center">
                <p className="text-3xl font-bold text-white">{comments.perguntas}</p>
                <p className="text-xs text-gray-500 mt-1">perguntas nos comentários</p>
                <p className="text-[11px] text-gray-600 mt-2">Oportunidades de resposta — engajamento na 1ª hora pesa na distribuição.</p>
              </div>
            </div>
          )}
        </section>

        <p className="text-[11px] text-gray-600">
          Padrões são calculados de forma determinística (sem IA) com guarda de amostra mínima — nada é exibido sem base.
          A classificação de comentários e de ganchos/estrutura usa IA restrita a um vocabulário fixo.
          {computedAt && <> Recalculado diariamente · último: {new Date(computedAt).toLocaleString('pt-BR')}.</>}
        </p>
      </div>
    </div>
  )
}
