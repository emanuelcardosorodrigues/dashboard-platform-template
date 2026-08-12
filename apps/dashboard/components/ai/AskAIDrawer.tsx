'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { MessageCircle, Send, Sparkles, X, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'

interface Message {
  role: 'user' | 'assistant'
  text: string
  tokens?: { in: number | null; out: number | null }
}

const ROUTE_LABELS: Record<string, string> = {
  '/visao-geral': 'Visão Geral',
  '/calculadora': 'Calculadora Estratégica',
  '/criativos': 'Criativos',
  '/campanhas': 'Campanhas',
  '/qualificacao': 'Qualificação',
  '/funil': 'Funil',
  '/financeiro': 'Financeiro',
  '/comparacao': 'Comparação',
  '/perfil-comprador': 'Perfil do Comprador',
  '/voz-comprador': 'Voz do Comprador',
  '/analise-estrategica': 'Análise Estratégica',
  '/insights-ia': 'Insights IA',
  '/clarity': 'Clarity',
  '/experimentos': 'Experimentos',
  '/quizzes': 'Quizzes',
  '/saude-trafego': 'Saúde do Tráfego',
  '/notas-fiscais': 'Notas Fiscais',
}

export default function AskAIDrawer() {
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<'gemini' | 'claude'>('gemini')
  const [claudeOk, setClaudeOk] = useState(false)
  const [claudeModel, setClaudeModel] = useState('claude-opus-4-8')
  const [credits, setCredits] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  // Ao abrir: descobre o motor disponível (Claude?) + créditos restantes.
  useEffect(() => {
    if (!open) return
    fetch('/api/ai/ask')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return
        setClaudeOk(!!j.claude_available)
        if (!j.claude_available) setEngine('gemini')
        if (typeof j.credits === 'number') setCredits(j.credits)
      })
      .catch(() => {})
  }, [open])

  // F5 — abrir o drawer JÁ com uma pergunta preenchida a partir de uma anomalia.
  // O card "o que mudou" da MobileHome dispara `odin:ask` no clique do "Por quê?"
  // com a pergunta montada EM CÓDIGO (nunca por IA). Aqui só abrimos + injetamos
  // no textarea; o usuário revisa e envia. O recorte (de/ate/funil/conta) entra
  // sozinho porque o send() lê `searchParams` da URL atual no momento do envio.
  useEffect(() => {
    function onAsk(e: Event) {
      const detail = (e as CustomEvent<{ question?: string }>).detail
      const q = typeof detail?.question === 'string' ? detail.question.trim() : ''
      if (!q) return
      setQuestion(q)
      setOpen(true)
    }
    window.addEventListener('odin:ask', onAsk as EventListener)
    return () => window.removeEventListener('odin:ask', onAsk as EventListener)
  }, [])

  // Não montar em rotas de login.
  const hideOnRoutes = pathname.startsWith('/login') || pathname.includes('/notas-fiscais/login')
  if (hideOnRoutes) return null

  const spObj = (() => {
    const out: Record<string, string> = {}
    searchParams?.forEach((v, k) => { out[k] = v })
    return out
  })()

  const contextLabel = buildContextLabel(pathname, spObj)

  async function send() {
    const q = question.trim()
    if (!q || loading) return
    setError(null)
    const next = [...messages, { role: 'user' as const, text: q }]
    setMessages(next)
    setQuestion('')
    setLoading(true)
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: q,
          pathname,
          searchParams: spObj,
          history: next.slice(-6).map((m) => ({ role: m.role, text: m.text })),
          ...(engine === 'claude' && claudeOk ? { provider: 'claude', model: claudeModel } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Falha ao consultar IA')
        setMessages(next)
        return
      }
      if (typeof json.credits === 'number') setCredits(json.credits)
      setMessages([...next, {
        role: 'assistant',
        text: json.answer ?? '(sem resposta)',
        tokens: json.tokens,
      }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro de rede')
    } finally {
      setLoading(false)
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      send()
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Perguntar à IA"
        title="Perguntar à IA"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5.5rem)' }}
        className={clsx(
          'fixed right-4 md:!bottom-6 md:right-6 z-40 rounded-full p-3.5 shadow-lg shadow-indigo-900/50',
          'bg-gradient-to-br from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500',
          'text-white transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-400',
          open && 'opacity-0 pointer-events-none',
        )}
      >
        <Sparkles className="w-5 h-5" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="fixed top-0 right-0 z-50 h-full w-full sm:w-[440px] bg-[#0F172A] border-l border-[#1F2937] flex flex-col">
            <header className="flex items-center justify-between px-4 py-3 border-b border-[#1F2937] shrink-0">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-indigo-400" />
                <p className="text-sm font-semibold text-white">Perguntar à IA</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-[#1F2937]"
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="px-4 py-2 border-b border-[#1F2937] shrink-0 flex items-center justify-between gap-2 text-xs text-gray-500">
              <span className="truncate">{contextLabel}</span>
              {credits != null && (
                <span title="Créditos de IA restantes hoje" className="shrink-0 px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-300 tabular-nums">
                  {credits} créditos
                </span>
              )}
            </div>

            {claudeOk && (
              <div className="px-4 py-2 border-b border-[#1F2937] shrink-0 flex items-center gap-1.5">
                <button
                  onClick={() => setEngine('gemini')}
                  className={clsx('px-2 py-1 rounded-md text-[11px] border cursor-pointer', engine === 'gemini' ? 'bg-indigo-500/20 text-indigo-200 border-indigo-400/40' : 'bg-[#1F2937] text-gray-400 border-transparent hover:text-gray-200')}
                >
                  Gemini · grátis
                </button>
                <button
                  onClick={() => setEngine('claude')}
                  title="Claude pela sua assinatura (sem custo por token)"
                  className={clsx('px-2 py-1 rounded-md text-[11px] border cursor-pointer', engine === 'claude' ? 'bg-purple-500/20 text-purple-200 border-purple-400/40' : 'bg-[#1F2937] text-gray-400 border-transparent hover:text-gray-200')}
                >
                  Claude · assinatura
                </button>
                {engine === 'claude' && (
                  <select
                    value={claudeModel}
                    onChange={(e) => setClaudeModel(e.target.value)}
                    className="ml-auto bg-[#1F2937] text-gray-200 text-[11px] rounded-md px-2 py-1 border border-white/10 cursor-pointer"
                  >
                    <option value="claude-opus-4-8">Opus 4.8</option>
                    <option value="claude-sonnet-5">Sonnet 5</option>
                    <option value="claude-haiku-4-5">Haiku 4.5</option>
                  </select>
                )}
              </div>
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.length === 0 && !loading && (
                <div className="text-center text-gray-500 text-sm py-8">
                  <Sparkles className="w-8 h-8 text-indigo-400/40 mx-auto mb-3" />
                  <p>Pergunte sobre os dados da aba atual.</p>
                  <p className="text-xs mt-1 text-gray-400">Cmd/Ctrl + Enter pra enviar{credits != null ? ` · ${credits} créditos hoje` : ''}</p>
                </div>
              )}

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={clsx(
                    'rounded-lg p-3 text-sm whitespace-pre-wrap',
                    m.role === 'user'
                      ? 'bg-indigo-500/10 border border-indigo-500/30 text-indigo-100'
                      : 'bg-[#111827] border border-[#1F2937] text-gray-200',
                  )}
                >
                  {m.text}
                  {m.tokens && m.role === 'assistant' && (
                    <p className="text-[10px] text-gray-400 mt-2">
                      {(m.tokens.in ?? 0) + (m.tokens.out ?? 0)} tokens
                    </p>
                  )}
                </div>
              ))}

              {loading && (
                <div className="rounded-lg p-3 text-sm bg-[#111827] border border-[#1F2937] text-gray-400 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Pensando…
                </div>
              )}

              {error && (
                <div className="rounded-lg p-3 text-sm bg-rose-500/10 border border-rose-500/30 text-rose-300">
                  {error}
                </div>
              )}
            </div>

            <div className="border-t border-[#1F2937] px-3 py-3 shrink-0">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={onKey}
                placeholder="Qual criativo tem o pior ROAS no período?"
                rows={3}
                maxLength={1500}
                className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-indigo-500/50"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-gray-400">{question.length}/1500</span>
                <button
                  onClick={send}
                  disabled={loading || !question.trim()}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    loading || !question.trim()
                      ? 'bg-[#1F2937] text-gray-400 cursor-not-allowed'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white',
                  )}
                >
                  <Send className="w-3 h-3" />
                  Enviar
                </button>
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  )
}

function buildContextLabel(pathname: string, sp: Record<string, string>): string {
  const route = Object.entries(ROUTE_LABELS).find(([k]) => pathname.startsWith(k))?.[1] ?? pathname
  const bits: string[] = [`📍 ${route}`]
  if (sp.de && sp.ate) bits.push(`${sp.de} → ${sp.ate}`)
  if (sp.funil && sp.funil !== 'all') bits.push(`funil ${sp.funil}`)
  if (sp.conta && sp.conta !== 'all') bits.push(`conta ${sp.conta.slice(-4)}`)
  return bits.join(' · ')
}
