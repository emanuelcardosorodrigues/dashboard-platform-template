'use client'

import { useState, useEffect, useCallback } from 'react'
import { Captions, ChevronDown, RefreshCw, ExternalLink } from 'lucide-react'
import { clsx } from 'clsx'
import type { TranscricaoLink } from './page'

const IG_URL_RE = /instagram\.com\/(p|reels?|tv)\/[A-Za-z0-9_-]+/
const YT_URL_RE = /(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/

function parseUrls(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\n\s,]+/)
        .map((s) => s.trim())
        .filter((s) => IG_URL_RE.test(s) || YT_URL_RE.test(s))
    ),
  ]
}

function duracao(s: number | null): string {
  if (s === null) return ''
  const m = Math.floor(s / 60)
  const sec = String(Math.round(s % 60)).padStart(2, '0')
  return `${m}:${sec}`
}

function ttlLabel(expiresAt: string): string {
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000)
  if (days <= 0) return 'Expira hoje'
  return `Expira em ${days}d`
}

function urlLabel(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.replace('www.', '') + u.pathname.replace(/\/$/, '')
  } catch {
    return url
  }
}

interface Props {
  initialRows: TranscricaoLink[]
  hasPendingInitially: boolean
}

export default function TranscricoesClient({ initialRows, hasPendingInitially }: Props) {
  const [urls, setUrls] = useState('')
  const [rows, setRows] = useState<TranscricaoLink[]>(initialRows)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [polling, setPolling] = useState(hasPendingInitially)

  const detected = parseUrls(urls)

  // toast auto-dismiss (padrão CriativosClient.tsx)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  // polling enquanto há jobs pendentes
  useEffect(() => {
    if (!polling) return
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/transcricao/list', { cache: 'no-store' })
        if (!res.ok) return
        const { rows: fresh, hasPending } = await res.json()
        setRows(fresh)
        setPolling(hasPending)
      } catch {
        // silencioso — tenta de novo no próximo tick
      }
    }, 3000)
    return () => clearTimeout(t)
  }, [polling, rows])

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }, [])

  async function handleSubmit() {
    if (detected.length === 0 || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/transcricao/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: detected }),
      })
      const data = await res.json()
      if (!res.ok) { setToast(data.error ?? 'Erro ao enviar'); return }
      setUrls('')
      setPolling(true)
      // re-fetch imediato para mostrar as linhas pending
      const listRes = await fetch('/api/transcricao/list', { cache: 'no-store' })
      if (listRes.ok) {
        const { rows: fresh } = await listRes.json()
        setRows(fresh)
      }
      const msg = data.inserted > 0
        ? `${data.inserted} link(s) enviado(s) para transcrição`
        : 'Todos os links já estão em processamento'
      setToast(msg)
    } catch {
      setToast('Erro de conexão')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopyAll() {
    const ready = rows.filter((r) => r.status === 'ok' && r.transcricao)
    if (ready.length === 0) return
    const text = ready
      .map((r, i) => `[${i + 1}] ${r.url}\n\n${r.transcricao}`)
      .join('\n\n---\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setToast(`${ready.length} transcrição(ões) copiada(s)`)
    } catch {
      setToast('Erro ao copiar — tente usar o botão por linha')
    }
  }

  async function handleCopy(row: TranscricaoLink) {
    if (!row.transcricao) return
    try {
      await navigator.clipboard.writeText(row.transcricao)
      setToast('Copiado!')
    } catch {
      setToast('Erro ao copiar')
    }
  }

  async function handleSalvar(id: string) {
    // optimistic update imediato
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, salva: true, expires_at: '9999-12-31T00:00:00Z' } : r)))
    try {
      await fetch(`/api/transcricao/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'salvar' }),
      })
      setToast('Transcrição salva.')
    } catch {
      setToast('Erro ao salvar')
    }
  }

  async function handleExcluir(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
    try {
      await fetch(`/api/transcricao/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'excluir' }),
      })
    } catch {
      // silencioso — a row já foi removida do state
    }
  }

  const readyCount = rows.filter((r) => r.status === 'ok' && r.transcricao).length

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-white font-[Bricolage_Grotesque,sans-serif]">
            Transcrições de Links
          </h1>
          {readyCount > 0 && (
            <button
              onClick={handleCopyAll}
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              Copiar tudo ({readyCount})
            </button>
          )}
        </div>

        {/* Input */}
        <div className="space-y-2">
          <textarea
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder="Cole um link do Instagram ou YouTube por linha (reels, posts, vídeos, shorts)..."
            rows={4}
            className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-[#374151] transition-colors"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">
              {detected.length > 0 ? `${detected.length} link(s) detectado(s)` : ''}
            </span>
            <button
              onClick={handleSubmit}
              disabled={detected.length === 0 || submitting}
              className={clsx(
                'text-xs px-3 py-1.5 rounded-md transition-colors font-medium',
                detected.length === 0 || submitting
                  ? 'bg-[#1F2937] text-gray-600 cursor-not-allowed'
                  : 'bg-[#06B6D4] text-[#0A0F1E] hover:bg-[#0891b2]'
              )}
            >
              {submitting ? 'Enviando...' : `Transcrever${detected.length > 0 ? ` ${detected.length}` : ''}`}
            </button>
          </div>
        </div>

        {/* Lista de resultados */}
        {rows.length === 0 ? (
          <div className="py-20 text-center">
            <Captions size={24} className="mx-auto text-gray-700 mb-3" />
            <p className="text-sm text-gray-500 mb-1">Nenhuma transcrição ainda</p>
            <p className="text-xs text-gray-600">Cole links do Instagram acima e clique em Transcrever.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#1F2937]">
            {rows.map((row) => (
              <div key={row.id} className="py-3.5 space-y-2">

                {/* Linha 1: status dot + URL + metadados */}
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusDot status={row.status} />
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-1 min-w-0 truncate"
                  >
                    <SourceBadge source={row.source} />
                    {urlLabel(row.url)}
                    <ExternalLink size={10} className="shrink-0" />
                  </a>
                  {row.status === 'processing' && (
                    <span className="text-[11px] text-cyan-400 flex items-center gap-1">
                      <RefreshCw size={10} className="animate-spin" />
                      Transcrevendo...
                    </span>
                  )}
                  {row.status === 'pending' && (
                    <span className="text-[11px] text-gray-500">Aguardando</span>
                  )}
                  {row.status === 'failed' && (
                    <span className="text-[11px] text-rose-400">Falhou</span>
                  )}
                  {row.status === 'no_audio' && (
                    <span className="text-[11px] text-amber-400">Sem áudio</span>
                  )}
                  {row.status === 'ok' && row.duracao_s && (
                    <span className="text-[11px] text-gray-600">{duracao(row.duracao_s)}</span>
                  )}
                  {row.status === 'ok' && !row.salva && (
                    <span className="text-[11px] text-gray-600">{ttlLabel(row.expires_at)}</span>
                  )}
                  {row.status === 'ok' && row.salva && (
                    <span className="text-[11px] text-emerald-600">Salva</span>
                  )}
                </div>

                {/* Transcrição colapsável */}
                {row.status === 'ok' && row.transcricao && (
                  <button
                    className="text-left w-full group"
                    onClick={() => toggleExpanded(row.id)}
                  >
                    <p
                      className={clsx(
                        'text-xs text-gray-300 leading-relaxed',
                        !expanded.has(row.id) && 'line-clamp-2'
                      )}
                    >
                      {row.transcricao}
                    </p>
                    <ChevronDown
                      size={11}
                      className={clsx(
                        'text-gray-600 mt-1 transition-transform',
                        expanded.has(row.id) && 'rotate-180'
                      )}
                    />
                  </button>
                )}

                {/* Erro */}
                {row.status === 'failed' && row.ultimo_erro && (
                  <p className="text-[11px] text-rose-400/70 leading-relaxed">{row.ultimo_erro}</p>
                )}

                {/* Ações */}
                {(row.status === 'ok' || row.status === 'failed' || row.status === 'no_audio') && (
                  <div className="flex items-center gap-2 text-xs">
                    {row.status === 'ok' && row.transcricao && (
                      <>
                        <button
                          onClick={() => handleCopy(row)}
                          className="text-gray-400 hover:text-white transition-colors"
                        >
                          Copiar
                        </button>
                        <span className="text-gray-700">·</span>
                      </>
                    )}
                    {!row.salva && (
                      <>
                        <button
                          onClick={() => handleSalvar(row.id)}
                          className="text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          Salvar
                        </button>
                        <span className="text-gray-700">·</span>
                      </>
                    )}
                    {confirmDelId === row.id ? (
                      <>
                        <span className="text-rose-300">Confirmar exclusão?</span>
                        <button
                          onClick={() => { setConfirmDelId(null); handleExcluir(row.id) }}
                          className="text-rose-400 hover:text-rose-300 font-medium transition-colors"
                        >
                          Sim, excluir
                        </button>
                        <span className="text-gray-700">·</span>
                        <button
                          onClick={() => setConfirmDelId(null)}
                          className="text-gray-400 hover:text-white transition-colors"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmDelId(row.id)}
                        className="text-rose-400 hover:text-rose-300 transition-colors"
                      >
                        Excluir
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1F2937] border border-[#374151] text-white text-xs px-4 py-2.5 rounded-lg shadow-xl whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  )
}

function SourceBadge({ source }: { source: TranscricaoLink['source'] }) {
  const isYt = source === 'youtube'
  return (
    <span
      className={clsx(
        'shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide',
        isYt ? 'bg-red-500/15 text-red-400' : 'bg-fuchsia-500/15 text-fuchsia-400'
      )}
    >
      {isYt ? 'YT' : 'IG'}
    </span>
  )
}

function StatusDot({ status }: { status: TranscricaoLink['status'] }) {
  return (
    <span
      className={clsx(
        'inline-block w-2 h-2 rounded-full shrink-0',
        status === 'pending' && 'bg-gray-500',
        status === 'processing' && 'bg-cyan-400 animate-pulse',
        status === 'ok' && 'bg-emerald-400',
        status === 'failed' && 'bg-rose-500',
        status === 'no_audio' && 'bg-amber-400'
      )}
    />
  )
}
