'use client'

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import {
  Loader2,
  Plus,
  Send,
  Trash2,
  MessageSquare,
  AlertTriangle,
  RefreshCw,
  X,
  ChevronDown,
  Search,
  Check,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react'

interface OkAdOption {
  ad_id: string
  ad_name: string | null
  one_belief_score: number | null
  thumbnail_url: string | null
}

interface ChatListItem {
  id: string
  scope: 'creative' | 'portfolio'
  ad_id: string | null
  titulo: string
  total_mensagens: number
  updated_at: string
}

interface PersistedTurn {
  role: 'user' | 'model'
  content: string
  at: string
  modelo?: string | null
  tokens_input?: number | null
  tokens_output?: number | null
}

interface ChatDetail {
  id: string
  scope: 'creative' | 'portfolio'
  ad_id: string | null
  user_email: string | null
  mensagens: PersistedTurn[]
  created_at: string
  updated_at: string
}

const CLAUDE_MODEL_OPTIONS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
]

// Perguntas sugeridas por escopo — clicar preenche o composer.
const SUGESTOES: Record<'creative' | 'portfolio', string[]> = {
  portfolio: [
    'O que está funcionando melhor?',
    'Quais criativos devo escalar?',
    'Onde estou perdendo dinheiro?',
  ],
  creative: [
    'Como melhorar o hook?',
    'Devo escalar este criativo?',
    'Sugira 3 variações de abertura',
  ],
}

export default function ChatsTab({ portfolioAdIds }: { portfolioAdIds?: string[] }) {
  const router = useRouter()
  const filterCount = portfolioAdIds?.length ?? 0
  // A-F5: motor do chat. 'claude' só aparece se o bridge da assinatura estiver ligado.
  const [claudeOk, setClaudeOk] = useState(false)
  const [engine, setEngine] = useState<'gemini' | 'claude'>('gemini')
  const [claudeModel, setClaudeModel] = useState('claude-opus-4-8')
  const [aiUsage, setAiUsage] = useState<{ used: number; quota: number } | null>(null)
  const [streaming, setStreaming] = useState<string | null>(null)
  const [streamThinking, setStreamThinking] = useState(false)
  const [chats, setChats] = useState<ChatListItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeChat, setActiveChat] = useState<ChatDetail | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingChat, setLoadingChat] = useState(false)
  const [sending, setSending] = useState(false)
  const [composer, setComposer] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  async function loadChats() {
    setLoadingList(true)
    setErr(null)
    try {
      const res = await fetch('/api/criativos/chats?limit=50')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setChats(json.chats ?? [])
      const ok = !!json.claude_available
      setClaudeOk(ok)
      if (!ok) setEngine('gemini')
      setAiUsage(json.ai_usage ?? null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingList(false)
    }
  }

  async function loadChat(id: string) {
    setLoadingChat(true)
    setActiveId(id)
    setErr(null)
    try {
      const res = await fetch(`/api/criativos/chats/${id}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setActiveChat(json)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setActiveChat(null)
    } finally {
      setLoadingChat(false)
    }
  }

  async function criarChat(payload: { scope: 'creative' | 'portfolio'; ad_id: string | null; mensagem: string }) {
    setCreating(true)
    setErr(null)
    try {
      // escopa o contexto do portfólio ao conjunto filtrado + escolhe o motor
      const useClaude = engine === 'claude' && claudeOk
      const withFilter = {
        ...payload,
        ...(payload.scope === 'portfolio' && filterCount > 0 ? { ad_ids: portfolioAdIds } : {}),
        ...(useClaude ? { provider: 'claude', model: claudeModel } : {}),
      }
      const res = await fetch('/api/criativos/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withFilter),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setModalOpen(false)
      await loadChats()
      await loadChat(json.id)
      if (json.tags_applied) router.refresh() // Equipe aplicou tag → atualiza a grade
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  async function enviar() {
    if (!activeId || !composer.trim() || sending) return
    setSending(true)
    setErr(null)
    const mensagem = composer.trim()
    setComposer('')

    // optimistic update
    const userTurn: PersistedTurn = { role: 'user', content: mensagem, at: new Date().toISOString() }
    if (activeChat) setActiveChat({ ...activeChat, mensagens: [...activeChat.mensagens, userTurn] })

    try {
      // Claude → streaming (SSE, token a token). Gemini → append normal.
      if (engine === 'claude' && claudeOk && activeChat) {
        setStreaming('')
        setStreamThinking(true)
        const sBody: { mensagem: string; model: string; ad_ids?: string[] } = { mensagem, model: claudeModel }
        if (activeChat.scope === 'portfolio' && filterCount > 0) sBody.ad_ids = portfolioAdIds
        const res = await fetch(`/api/criativos/chats/${activeId}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sBody),
        })
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error ?? `HTTP ${res.status}`)
        }
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        let acc = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let nl: number
          while ((nl = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, nl)
            buf = buf.slice(nl + 2)
            const line = chunk.replace(/^data:\s?/, '').trim()
            if (!line) continue
            let ev: Record<string, unknown>
            try { ev = JSON.parse(line) } catch { continue }
            if (typeof ev.delta === 'string') { setStreamThinking(false); acc += ev.delta; setStreaming(acc) }
            else if (ev.thinking) setStreamThinking(true)
            else if (typeof ev.error === 'string') setErr(ev.error)
          }
        }
        await loadChat(activeId)
        await loadChats()
      } else {
        const appendBody: { mensagem: string; ad_ids?: string[]; provider?: string; model?: string } = { mensagem }
        if (activeChat?.scope === 'portfolio' && filterCount > 0) appendBody.ad_ids = portfolioAdIds
        const res = await fetch(`/api/criativos/chats/${activeId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(appendBody),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
        await loadChat(activeId)
        await loadChats() // pra atualizar timestamp/contagem na sidebar
        if (json.tags_applied) router.refresh() // Equipe aplicou tag → atualiza a grade
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      // remove o turn otimista
      if (activeChat) setActiveChat({ ...activeChat, mensagens: activeChat.mensagens })
    } finally {
      setSending(false)
      setStreaming(null)
      setStreamThinking(false)
    }
  }

  async function apagar(id: string) {
    if (!confirm('Apagar este chat?')) return
    setErr(null)
    try {
      const res = await fetch(`/api/criativos/chats/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (activeId === id) {
        setActiveId(null)
        setActiveChat(null)
      }
      await loadChats()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    loadChats()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeChat?.mensagens.length, streaming])

  return (
    <>
    {modalOpen && (
      <CreateChatModal
        creating={creating}
        onCancel={() => setModalOpen(false)}
        onCreate={criarChat}
      />
    )}
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 min-h-[60vh]">
      <aside className="bg-[#111827] border border-[#1F2937] rounded-xl p-3 space-y-3 flex flex-col">
        <button
          onClick={() => setModalOpen(true)}
          disabled={creating}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 cursor-pointer disabled:opacity-50"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Novo chat
        </button>

        {claudeOk && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => setEngine('gemini')}
                className={clsx(
                  'px-2 py-1.5 rounded-md text-[11px] border cursor-pointer',
                  engine === 'gemini'
                    ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40'
                    : 'bg-[#1F2937] text-gray-400 border-transparent hover:text-gray-200'
                )}
              >
                Gemini · grátis
              </button>
              <button
                onClick={() => setEngine('claude')}
                title="Claude pela sua assinatura (sem custo por token)"
                className={clsx(
                  'px-2 py-1.5 rounded-md text-[11px] border cursor-pointer',
                  engine === 'claude'
                    ? 'bg-purple-500/20 text-purple-200 border-purple-500/40'
                    : 'bg-[#1F2937] text-gray-400 border-transparent hover:text-gray-200'
                )}
              >
                Claude · assinatura
              </button>
            </div>
            {engine === 'claude' && (
              <select
                value={claudeModel}
                onChange={(e) => setClaudeModel(e.target.value)}
                className="w-full bg-[#1F2937] text-gray-200 text-[11px] rounded-md px-2 py-1.5 border border-white/10 cursor-pointer"
              >
                {CLAUDE_MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            )}
          </div>
        )}

        <div className="flex items-center justify-between text-[10px] text-gray-500 uppercase tracking-wide">
          <span>Histórico</span>
          <button onClick={loadChats} disabled={loadingList} className="text-gray-500 hover:text-cyan-300 p-1 cursor-pointer disabled:opacity-50">
            <RefreshCw size={11} className={clsx(loadingList && 'animate-spin')} />
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto space-y-1 -mr-1 pr-1">
          {loadingList && chats.length === 0 ? (
            <li className="h-12 bg-[#1F2937] rounded-md animate-pulse" />
          ) : chats.length === 0 ? (
            <li className="text-xs text-gray-500 text-center py-4">Nenhum chat ainda.</li>
          ) : (
            chats.map((c) => (
              <li
                key={c.id}
                className={clsx(
                  'rounded-md cursor-pointer group',
                  activeId === c.id ? 'bg-cyan-500/10' : 'hover:bg-[#1F2937]'
                )}
              >
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <button onClick={() => loadChat(c.id)} className="flex-1 min-w-0 text-left cursor-pointer">
                    <div className="flex items-center gap-1.5">
                      <MessageSquare size={11} className="shrink-0 text-gray-500" />
                      <span className={clsx('text-xs truncate', activeId === c.id ? 'text-cyan-300' : 'text-gray-300')}>
                        {c.titulo}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-2">
                      <span className="uppercase tracking-wide">{c.scope}</span>
                      <span>·</span>
                      <span>{c.total_mensagens} msgs</span>
                    </div>
                  </button>
                  <button
                    onClick={() => apagar(c.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-rose-400 cursor-pointer p-1"
                    title="Apagar"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </aside>

      <section className="bg-[#111827] border border-[#1F2937] rounded-xl flex flex-col min-h-[60vh]">
        {err && (
          <div className="m-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 px-3 py-2 text-xs flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            {err}
          </div>
        )}

        {!activeId ? (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm p-8 text-center">
            Selecione um chat à esquerda ou clique em <span className="text-cyan-300 mx-1">Novo chat</span>.
          </div>
        ) : loadingChat && !activeChat ? (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : activeChat ? (
          <>
            <header className="border-b border-[#1F2937] px-4 py-3 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded-md bg-cyan-500/10 text-cyan-300">
                {activeChat.scope}
              </span>
              {activeChat.ad_id && (
                <span className="text-[10px] font-mono text-gray-500 px-2 py-1 rounded-md bg-black/30">
                  {activeChat.ad_id}
                </span>
              )}
              {activeChat.scope === 'portfolio' && filterCount > 0 && (
                <span
                  title="As próximas mensagens usam apenas os anúncios visíveis na tela (filtros/tags)"
                  className="text-[10px] px-2 py-1 rounded-md bg-purple-500/15 text-purple-300 flex items-center gap-1"
                >
                  <Search size={10} /> filtrado: {filterCount}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2 text-[10px] text-gray-500">
                {aiUsage && (
                  <span
                    title="Créditos de IA restantes hoje (limite diário)"
                    className="px-2 py-1 rounded-md bg-purple-500/10 text-purple-300 tabular-nums"
                  >
                    {Math.max(0, aiUsage.quota - aiUsage.used)} créditos
                  </span>
                )}
                <span>{activeChat.mensagens.length} mensagens</span>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {activeChat.mensagens.map((m, i) => (
                <ChatBubble key={i} role={m.role} content={m.content} msgKey={`${activeId}-${i}`} />
              ))}
              {streaming !== null ? (
                <div className="flex flex-col items-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed bg-[#1F2937] text-gray-100">
                    {streaming ? (
                      <>
                        {renderMessage(streaming)}
                        <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-purple-300/70 animate-pulse align-middle" />
                      </>
                    ) : (
                      <span className="text-gray-400 flex items-center gap-2">
                        <Loader2 size={12} className="animate-spin" /> Claude pensando…
                      </span>
                    )}
                  </div>
                </div>
              ) : sending ? (
                <div className="flex justify-start">
                  <div className="bg-[#1F2937] text-gray-400 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin" />
                    {engine === 'claude' && claudeOk ? 'Claude' : 'Gemini'} pensando…
                  </div>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>

            {!composer.trim() && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-1">
                {(SUGESTOES[activeChat.scope] ?? []).map((s) => (
                  <button
                    key={s}
                    onClick={() => setComposer(s)}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-[#1F2937] text-gray-300 hover:text-white border border-white/5 hover:border-purple-400/30"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div className="border-t border-[#1F2937] p-3 flex items-end gap-2">
              <textarea
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    enviar()
                  }
                }}
                rows={2}
                placeholder="Pergunte algo… (⌘+Enter pra enviar)"
                disabled={sending}
                className="flex-1 bg-[#1F2937] text-gray-100 text-sm rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-50"
              />
              <button
                onClick={enviar}
                disabled={sending || !composer.trim()}
                className="px-3 py-2 rounded-lg bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Enviar
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
    </>
  )
}

function CreateChatModal({
  creating,
  onCancel,
  onCreate,
}: {
  creating: boolean
  onCancel: () => void
  onCreate: (payload: { scope: 'creative' | 'portfolio'; ad_id: string | null; mensagem: string }) => void
}) {
  const [scope, setScope] = useState<'creative' | 'portfolio'>('portfolio')
  const [adId, setAdId] = useState('')
  const [mensagem, setMensagem] = useState('O que está funcionando no portfólio?')

  const [okAds, setOkAds] = useState<OkAdOption[]>([])
  const [loadingAds, setLoadingAds] = useState(false)
  const [adsLoaded, setAdsLoaded] = useState(false)
  const [adsError, setAdsError] = useState<string | null>(null)
  const [adFilter, setAdFilter] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const canSubmit =
    !creating &&
    mensagem.trim().length > 0 &&
    (scope === 'portfolio' || adId.trim().length > 0)

  function submit() {
    if (!canSubmit) return
    onCreate({
      scope,
      ad_id: scope === 'creative' ? adId.trim() : null,
      mensagem: mensagem.trim(),
    })
  }

  // fetch on-demand quando o usuario escolhe scope=creative pela 1a vez
  useEffect(() => {
    if (scope !== 'creative' || adsLoaded || loadingAds) return
    let canceled = false
    setLoadingAds(true)
    setAdsError(null)
    ;(async () => {
      try {
        const res = await fetch('/api/criativos/analise?status=ok&limit=200')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        const rows = Array.isArray(json.rows) ? json.rows : []
        if (canceled) return
        setOkAds(
          rows.map((r: Record<string, unknown>) => ({
            ad_id: String(r.ad_id ?? ''),
            ad_name: (r.ad_name as string | null) ?? null,
            one_belief_score: (r.one_belief_score as number | null) ?? null,
            thumbnail_url: (r.thumbnail_url as string | null) ?? null,
          }))
        )
        setAdsLoaded(true)
      } catch (e) {
        if (canceled) return
        setAdsError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!canceled) setLoadingAds(false)
      }
    })()
    return () => {
      canceled = true
    }
  }, [scope, adsLoaded, loadingAds])

  // Esc fecha o picker (sem fechar o modal — modal trata Esc nativamente se quiser)
  useEffect(() => {
    if (!pickerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setPickerOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pickerOpen])

  // auto-focus no input de busca quando abre
  useEffect(() => {
    if (pickerOpen) {
      // microtask pra garantir que o input ja existe
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }, [pickerOpen])

  const selectedAd = adId ? okAds.find((a) => a.ad_id === adId) ?? null : null

  const normalized = adFilter.trim().toLowerCase()
  const filteredAds = normalized
    ? okAds.filter(
        (a) =>
          a.ad_id.toLowerCase().includes(normalized) ||
          (a.ad_name?.toLowerCase().includes(normalized) ?? false)
      )
    : okAds

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-[#0F172A] border border-[#1F2937] rounded-xl w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-[#1F2937]">
          <h2 className="text-sm font-medium text-gray-100">Novo chat</h2>
          <button
            onClick={onCancel}
            className="text-gray-500 hover:text-gray-200 cursor-pointer"
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-gray-500 mb-2">
              Escopo
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setScope('portfolio')}
                className={clsx(
                  'px-3 py-2 rounded-lg text-xs cursor-pointer border',
                  scope === 'portfolio'
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                    : 'bg-[#1F2937] text-gray-400 border-transparent hover:text-gray-200'
                )}
              >
                Portfólio (geral)
              </button>
              <button
                onClick={() => setScope('creative')}
                className={clsx(
                  'px-3 py-2 rounded-lg text-xs cursor-pointer border',
                  scope === 'creative'
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                    : 'bg-[#1F2937] text-gray-400 border-transparent hover:text-gray-200'
                )}
              >
                Criativo (1 ad)
              </button>
            </div>
          </div>

          {scope === 'creative' && (
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-gray-500 mb-2">
                Criativo
              </label>

              {adsError ? (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 px-3 py-2 text-xs flex items-start gap-2">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  <span>Falha ao carregar criativos: {adsError}</span>
                </div>
              ) : (
                <AdPicker
                  loading={loadingAds}
                  ads={okAds}
                  filteredAds={filteredAds}
                  selectedAd={selectedAd}
                  selectedAdId={adId}
                  open={pickerOpen}
                  onOpen={() => setPickerOpen(true)}
                  onClose={() => setPickerOpen(false)}
                  filter={adFilter}
                  onFilterChange={setAdFilter}
                  onSelect={(a) => {
                    setAdId(a.ad_id)
                    setPickerOpen(false)
                    setAdFilter('')
                  }}
                  searchInputRef={searchInputRef}
                />
              )}
              <p className="text-[10px] text-gray-500 mt-1">
                Só lista ads com análise OK em [[criativo_analise]].
              </p>
            </div>
          )}

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-gray-500 mb-2">
              Primeira pergunta
            </label>
            <textarea
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  submit()
                }
              }}
              rows={3}
              autoFocus={scope === 'portfolio'}
              className="w-full bg-[#1F2937] text-gray-100 text-sm rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            />
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#1F2937]">
          <button
            onClick={onCancel}
            disabled={creating}
            className="px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-200 cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg text-xs bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 cursor-pointer disabled:opacity-50 flex items-center gap-2"
          >
            {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Criar chat
          </button>
        </footer>
      </div>
    </div>
  )
}

function AdPicker({
  loading,
  ads,
  filteredAds,
  selectedAd,
  selectedAdId,
  open,
  onOpen,
  onClose,
  filter,
  onFilterChange,
  onSelect,
  searchInputRef,
}: {
  loading: boolean
  ads: OkAdOption[]
  filteredAds: OkAdOption[]
  selectedAd: OkAdOption | null
  selectedAdId: string
  open: boolean
  onOpen: () => void
  onClose: () => void
  filter: string
  onFilterChange: (v: string) => void
  onSelect: (ad: OkAdOption) => void
  searchInputRef: RefObject<HTMLInputElement | null>
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? onClose() : onOpen())}
        className="w-full bg-[#1F2937] text-left text-sm rounded-lg px-3 py-2 flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 cursor-pointer"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <div className="flex-1 min-w-0">
          {selectedAd ? (
            <>
              <div className="text-gray-100 truncate">
                {selectedAd.ad_name ?? <span className="text-gray-500">(sem nome)</span>}
              </div>
              <div className="font-mono text-[10px] text-gray-500 truncate">{selectedAd.ad_id}</div>
            </>
          ) : selectedAdId ? (
            // ad_id setado mas nao encontrado na lista (raro — paginacao)
            <div className="font-mono text-xs text-gray-100 truncate">{selectedAdId}</div>
          ) : (
            <span className="text-gray-500">
              {loading ? 'Carregando criativos…' : 'Selecionar criativo…'}
            </span>
          )}
        </div>
        {loading ? (
          <Loader2 size={14} className="shrink-0 text-gray-500 animate-spin" />
        ) : (
          <ChevronDown
            size={14}
            className={clsx('shrink-0 text-gray-500 transition-transform', open && 'rotate-180')}
          />
        )}
      </button>

      {open && (
        <>
          {/* overlay invisivel pra click-fora */}
          <div className="fixed inset-0 z-10" onClick={onClose} />
          <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-[#111827] border border-[#1F2937] rounded-lg shadow-2xl overflow-hidden">
            <div className="p-2 border-b border-[#1F2937]">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  ref={searchInputRef}
                  value={filter}
                  onChange={(e) => onFilterChange(e.target.value)}
                  placeholder="Buscar por nome ou ad_id…"
                  className="w-full bg-[#1F2937] text-gray-100 text-xs rounded-md pl-7 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                />
              </div>
            </div>

            <ul
              role="listbox"
              className="max-h-64 overflow-y-auto"
            >
              {loading ? (
                <li className="px-3 py-4 text-xs text-gray-500 text-center flex items-center justify-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> Carregando criativos…
                </li>
              ) : ads.length === 0 ? (
                <li className="px-3 py-4 text-xs text-gray-500 text-center">
                  Nenhum ad com análise OK ainda. Use o botão Catchup na aba Análise.
                </li>
              ) : filteredAds.length === 0 ? (
                <li className="px-3 py-4 text-xs text-gray-500 text-center">Nada encontrado.</li>
              ) : (
                filteredAds.map((a) => {
                  const isActive = a.ad_id === selectedAdId
                  return (
                    <li key={a.ad_id} role="option" aria-selected={isActive}>
                      <button
                        type="button"
                        onClick={() => onSelect(a)}
                        className={clsx(
                          'w-full text-left px-2.5 py-2 flex items-center gap-2.5 cursor-pointer',
                          isActive ? 'bg-cyan-500/15' : 'hover:bg-[#1F2937]'
                        )}
                      >
                        {/* thumbnail */}
                        <div className="shrink-0 w-8 h-8 rounded-md bg-[#1F2937] overflow-hidden flex items-center justify-center">
                          {a.thumbnail_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={a.thumbnail_url}
                              alt=""
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <MessageSquare size={12} className="text-gray-400" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div
                            className={clsx(
                              'text-xs truncate',
                              isActive ? 'text-cyan-300' : 'text-gray-100'
                            )}
                          >
                            {a.ad_name ?? <span className="text-gray-500">(sem nome)</span>}
                          </div>
                          <div className="font-mono text-[10px] text-gray-500 truncate">{a.ad_id}</div>
                        </div>

                        <ScoreBadge score={a.one_belief_score} />
                        {isActive && <Check size={12} className="shrink-0 text-cyan-300" />}
                      </button>
                    </li>
                  )
                })
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) {
    return (
      <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1F2937] text-gray-500">
        —
      </span>
    )
  }
  // 0.70+ emerald, 0.50+ amber, abaixo rose
  const tone =
    score >= 0.7
      ? 'bg-emerald-500/15 text-emerald-300'
      : score >= 0.5
      ? 'bg-amber-500/15 text-amber-300'
      : 'bg-rose-500/15 text-rose-300'
  return (
    <span className={clsx('shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded', tone)}>
      {score.toFixed(2)}
    </span>
  )
}

function ChatBubble({ role, content, msgKey }: { role: 'user' | 'model'; content: string; msgKey: string }) {
  const isUser = role === 'user'
  return (
    <div className={clsx('flex flex-col', isUser ? 'items-end' : 'items-start')}>
      <div
        className={clsx(
          'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed',
          isUser
            ? 'bg-purple-500/20 text-purple-50 rounded-br-sm'
            : 'bg-[#1F2937] text-gray-100 rounded-bl-sm'
        )}
      >
        {renderMessage(content)}
      </div>
      {!isUser && <Feedback msgKey={msgKey} />}
    </div>
  )
}

// 👍/👎 por mensagem — guardado local (privado do usuário; sinal pra afinar prompts).
function Feedback({ msgKey }: { msgKey: string }) {
  const [v, setV] = useState<'up' | 'down' | null>(null)
  useEffect(() => {
    try {
      const s = localStorage.getItem(`fb:${msgKey}`)
      if (s === 'up' || s === 'down') setV(s)
    } catch { /* ignore */ }
  }, [msgKey])
  const set = (val: 'up' | 'down') => {
    const nv = v === val ? null : val
    setV(nv)
    try {
      if (nv) localStorage.setItem(`fb:${msgKey}`, nv)
      else localStorage.removeItem(`fb:${msgKey}`)
    } catch { /* ignore */ }
  }
  return (
    <div className="flex items-center gap-1 mt-1 ml-1">
      <button onClick={() => set('up')} title="Útil" className={clsx('p-0.5 rounded cursor-pointer', v === 'up' ? 'text-emerald-400' : 'text-gray-600 hover:text-gray-300')}>
        <ThumbsUp size={12} />
      </button>
      <button onClick={() => set('down')} title="Não útil" className={clsx('p-0.5 rounded cursor-pointer', v === 'down' ? 'text-rose-400' : 'text-gray-600 hover:text-gray-300')}>
        <ThumbsDown size={12} />
      </button>
    </div>
  )
}

/**
 * Markdown light: **bold**, listas com `- ` e quebras de linha. Nada de XSS
 * porque só montamos ReactNodes — não inserimos HTML.
 */
/** Realça números (R$, %, inteiros) numa cor de destaque — a análise "salta". */
function highlightNumbers(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(R\$\s?[\d.,]+|\d[\d.,]*\s?%|\b\d[\d.,]*\b)/g
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <span key={`${keyBase}-n${i++}`} className="text-cyan-300 font-medium tabular-nums">{m[0]}</span>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out.length ? out : [text]
}

function renderLight(text: string): ReactNode[] {
  return text.split('\n').map((line, lineIdx) => {
    const trimmed = line.replace(/^\s*[-•]\s+/, '')
    const isBullet = trimmed !== line
    const parts: ReactNode[] = []
    let last = 0
    const re = /\*\*([^*]+)\*\*/g
    let m: RegExpExecArray | null
    while ((m = re.exec(trimmed)) !== null) {
      if (m.index > last) parts.push(...highlightNumbers(trimmed.slice(last, m.index), `p-${lineIdx}-${last}`))
      parts.push(<strong key={`b-${lineIdx}-${m.index}`}>{highlightNumbers(m[1], `s-${lineIdx}-${m.index}`)}</strong>)
      last = m.index + m[0].length
    }
    if (last < trimmed.length) parts.push(...highlightNumbers(trimmed.slice(last), `t-${lineIdx}-${last}`))

    return (
      <span key={lineIdx} className="block">
        {isBullet ? <span className="text-purple-400/70 mr-1">•</span> : null}
        {parts.length > 0 ? parts : highlightNumbers(trimmed, `w-${lineIdx}`)}
      </span>
    )
  })
}

const CHART_COLORS = ['#a78bfa', '#22d3ee', '#34d399', '#f59e0b', '#f472b6', '#60a5fa']

/** Gráfico embutido na resposta (bloco ```chart {json}). JSON quebrado → texto. */
function ChatChart({ raw }: { raw: string }) {
  let spec: { tipo?: string; titulo?: string; dados?: { nome: string; valor: number }[] } | null = null
  try { spec = JSON.parse(raw.trim()) } catch { spec = null }
  const dados = Array.isArray(spec?.dados)
    ? spec!.dados
        .filter((d) => d && typeof d.nome === 'string' && Number.isFinite(Number(d.valor)))
        .map((d) => ({ nome: d.nome, valor: Number(d.valor) }))
        .slice(0, 8)
    : []
  if (!dados.length) {
    return <pre className="text-[11px] text-gray-400 bg-black/30 rounded p-2 my-2 overflow-x-auto whitespace-pre-wrap">{raw.trim()}</pre>
  }
  const tipo = spec?.tipo === 'line' ? 'line' : spec?.tipo === 'pie' ? 'pie' : 'bar'
  const axis = { fill: '#94a3b8', fontSize: 10 }
  const tip = { backgroundColor: '#0f1420', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 12 }
  return (
    <div className="my-2 rounded-lg border border-white/10 bg-[#0f1420] p-2">
      {spec?.titulo && <div className="text-[11px] text-white/60 mb-1 px-1">{spec.titulo}</div>}
      <ResponsiveContainer width="100%" height={200}>
        {tipo === 'pie' ? (
          <PieChart>
            <Pie data={dados} dataKey="valor" nameKey="nome" cx="50%" cy="50%" outerRadius={70}>
              {dados.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={tip} />
          </PieChart>
        ) : tipo === 'line' ? (
          <LineChart data={dados}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2536" />
            <XAxis dataKey="nome" tick={axis} />
            <YAxis tick={axis} width={44} />
            <Tooltip contentStyle={tip} />
            <Line dataKey="valor" stroke="#22d3ee" strokeWidth={2} dot={false} />
          </LineChart>
        ) : (
          <BarChart data={dados}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2536" />
            <XAxis dataKey="nome" tick={axis} />
            <YAxis tick={axis} width={44} />
            <Tooltip contentStyle={tip} />
            <Bar dataKey="valor" fill="#a78bfa" radius={[3, 3, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

/** Renderiza a mensagem: texto (renderLight) + gráficos embutidos (```chart). */
function renderMessage(content: string): ReactNode {
  const re = /```chart\s*([\s\S]*?)```/g
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) out.push(<div key={`t${i}`}>{renderLight(content.slice(last, m.index))}</div>)
    out.push(<ChatChart key={`c${i}`} raw={m[1]} />)
    last = m.index + m[0].length
    i++
  }
  if (out.length === 0) return renderLight(content)
  if (last < content.length) out.push(<div key={`t${i}`}>{renderLight(content.slice(last))}</div>)
  return out
}
