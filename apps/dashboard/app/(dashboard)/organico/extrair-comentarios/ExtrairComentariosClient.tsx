'use client'

/**
 * Extrair Comentários — cola URLs de vídeos YT → extrai TODOS os comentários
 * (+ replies) → baixa CSV/XLSX. O processamento é dirigido DAQUI: loop
 * sequencial de POST /process (um chunk por chamada, um vídeo por vez) com
 * progresso na tela. Interrupção nunca perde progresso (cursor no banco):
 * quota/falha/aba fechada → botão Continuar retoma.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { MessagesSquare, RefreshCw, ExternalLink, Download, Play } from 'lucide-react'
import { clsx } from 'clsx'
import type { ExtracaoRow } from './page'
import {
  downloadComentariosCsv,
  downloadComentariosXlsx,
  downloadComentariosMultiCsv,
  downloadComentariosMultiXlsx,
  type ComentarioExportRow,
  type ExtracaoComComentarios,
} from '@/lib/exportComentarios'

const YT_HINT_RE = /(youtube\.com|youtu\.be)/

function parseUrls(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\n\s,]+/)
        .map((s) => s.trim())
        .filter((s) => YT_HINT_RE.test(s))
    ),
  ]
}

function ttlLabel(expiresAt: string): string {
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000)
  if (days <= 0) return 'Expira hoje'
  return `Expira em ${days}d`
}

function leaseAtiva(leaseUntil: string | null): boolean {
  return !!leaseUntil && new Date(leaseUntil).getTime() > Date.now()
}

interface Props {
  initialRows: ExtracaoRow[]
}

export default function ExtrairComentariosClient({ initialRows }: Props) {
  const [urls, setUrls] = useState('')
  const [rows, setRows] = useState<ExtracaoRow[]>(initialRows)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // ids sendo dirigidos POR ESTA ABA (progresso vem da resposta do /process)
  const [driving, setDriving] = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState<string | null>(null)
  // seleção pro export combinado (checkbox por linha)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [multiProgress, setMultiProgress] = useState<string | null>(null)
  const drivingRef = useRef(driving)
  drivingRef.current = driving

  const detected = parseUrls(urls)

  // toast auto-dismiss (padrão CriativosClient.tsx)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch('/api/extracao-comentarios/list', { cache: 'no-store' })
      if (!res.ok) return
      const { rows: fresh } = await res.json()
      setRows(fresh)
    } catch {
      // silencioso
    }
  }, [])

  // polling leve: reflete progresso de OUTRA aba (esta aba atualiza via /process)
  const hasForeignActive = rows.some(
    (r) => (r.status === 'pending' || r.status === 'processing') && !driving.has(r.id)
  )
  useEffect(() => {
    if (!hasForeignActive) return
    const t = setTimeout(refreshList, 5000)
    return () => clearTimeout(t)
  }, [hasForeignActive, rows, refreshList])

  function patchRow(id: string, patch: Partial<ExtracaoRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  /** Dirige UMA extração até estado terminal (ou quota/falha). */
  const drive = useCallback(async (id: string) => {
    setDriving((prev) => new Set(prev).add(id))
    try {
      for (;;) {
        const res = await fetch('/api/extracao-comentarios/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        })
        const data = await res.json()
        if (!res.ok) {
          if (res.status === 409) setToast('Essa extração já está rodando em outra aba')
          else setToast(data.error ?? 'Erro ao processar')
          break
        }
        patchRow(id, {
          status: data.status,
          comments_count: data.commentsCount ?? 0,
          ...(data.phase ? { phase: data.phase } : {}),
        })
        if (data.done || data.status === 'quota') break
        if (data.status === 'failed') break
      }
    } catch {
      setToast('Erro de conexão — o progresso ficou salvo, clique em Continuar')
    } finally {
      setDriving((prev) => {
        const n = new Set(prev)
        n.delete(id)
        return n
      })
      refreshList()
    }
  }, [refreshList])

  /** Fila sequencial: um vídeo por vez (cortesia com a quota da API). */
  const driveQueue = useCallback(async (ids: string[]) => {
    for (const id of ids) {
      if (drivingRef.current.has(id)) continue
      await drive(id)
    }
  }, [drive])

  async function handleSubmit() {
    if (detected.length === 0 || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/extracao-comentarios/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: detected }),
      })
      const data = await res.json()
      if (!res.ok) { setToast(data.error ?? 'Erro ao enviar'); return }
      setUrls('')
      await refreshList()
      const partes = [
        data.inserted > 0 ? `${data.inserted} vídeo(s) na fila` : null,
        data.resumable > 0 ? `${data.resumable} retomado(s)` : null,
        data.skipped > 0 ? `${data.skipped} já concluído(s)` : null,
        data.failed > 0 ? `${data.failed} indisponível(is)` : null,
        data.dropped > 0 ? `${data.dropped} além do limite de 10 (reenvie)` : null,
        data.invalid > 0 ? `${data.invalid} URL(s) inválida(s)` : null,
      ].filter(Boolean)
      setToast(partes.join(' · ') || 'Nada a fazer')
      if (Array.isArray(data.ids) && data.ids.length > 0) void driveQueue(data.ids)
    } catch {
      setToast('Erro de conexão')
    } finally {
      setSubmitting(false)
    }
  }

  /** Busca TODOS os comentários de uma extração (keyset paginado). */
  async function fetchTodosComentarios(id: string): Promise<ComentarioExportRow[] | null> {
    const all: ComentarioExportRow[] = []
    let after = 0
    for (;;) {
      const res = await fetch(
        `/api/extracao-comentarios/${id}/rows?after_id=${after}&limit=2000`,
        { cache: 'no-store' },
      )
      if (!res.ok) return null
      const { rows: chunk, nextAfterId } = await res.json()
      all.push(...chunk)
      if (!nextAfterId) break
      after = nextAfterId
    }
    return all
  }

  async function handleDownload(row: ExtracaoRow, formato: 'csv' | 'xlsx') {
    if (downloading) return
    setDownloading(row.id)
    try {
      const all = await fetchTodosComentarios(row.id)
      if (all === null) { setToast('Erro ao buscar comentários'); return }
      if (all.length === 0) { setToast('Nenhum comentário pra exportar'); return }
      if (formato === 'xlsx' && all.length > 20000) {
        setToast(`${all.length.toLocaleString('pt-BR')} comentários — XLSX pode demorar; prefira CSV da próxima vez`)
      }
      const meta = {
        videoId: row.video_id,
        videoTitle: row.video_title,
        channelTitle: row.channel_title,
        url: row.url,
      }
      if (formato === 'csv') downloadComentariosCsv(meta, all)
      else downloadComentariosXlsx(meta, all)
    } catch {
      setToast('Erro ao gerar o arquivo')
    } finally {
      setDownloading(null)
    }
  }

  // ── Export combinado (seleção por checkbox) ──
  const exportaveis = rows.filter((r) => r.comments_count > 0)
  const selecionadas = exportaveis.filter((r) => selected.has(r.id))
  const todasSelecionadas = exportaveis.length > 0 && selecionadas.length === exportaveis.length

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function toggleSelectAll() {
    setSelected(todasSelecionadas ? new Set() : new Set(exportaveis.map((r) => r.id)))
  }

  async function handleDownloadMulti(formato: 'csv' | 'xlsx') {
    if (downloading || selecionadas.length === 0) return
    setDownloading('multi')
    try {
      const itens: ExtracaoComComentarios[] = []
      for (let i = 0; i < selecionadas.length; i++) {
        const row = selecionadas[i]
        setMultiProgress(`${i + 1}/${selecionadas.length}`)
        const all = await fetchTodosComentarios(row.id)
        if (all === null) { setToast(`Erro ao buscar comentários de "${row.video_title ?? row.video_id}"`); return }
        itens.push({
          meta: { videoId: row.video_id, videoTitle: row.video_title, channelTitle: row.channel_title, url: row.url },
          rows: all,
        })
      }
      const total = itens.reduce((s, it) => s + it.rows.length, 0)
      if (total === 0) { setToast('Nenhum comentário nas extrações selecionadas'); return }
      if (formato === 'xlsx' && total > 20000) {
        setToast(`${total.toLocaleString('pt-BR')} comentários — XLSX pode demorar; prefira CSV da próxima vez`)
      }
      if (formato === 'csv') downloadComentariosMultiCsv(itens)
      else downloadComentariosMultiXlsx(itens)
    } catch {
      setToast('Erro ao gerar o arquivo combinado')
    } finally {
      setDownloading(null)
      setMultiProgress(null)
    }
  }

  async function handleSalvar(id: string) {
    patchRow(id, { salva: true, expires_at: '9999-12-31T00:00:00Z' })
    try {
      await fetch(`/api/extracao-comentarios/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'salvar' }),
      })
      setToast('Extração salva — não expira mais.')
    } catch {
      setToast('Erro ao salvar')
    }
  }

  async function handleExcluir(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
    try {
      await fetch(`/api/extracao-comentarios/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'excluir' }),
      })
    } catch {
      // silencioso — a row já saiu do state
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Input */}
        <div className="space-y-2">
          <textarea
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder="Cole uma URL de vídeo do YouTube por linha (watch, youtu.be, shorts, live)..."
            rows={4}
            className="w-full bg-[#111827] border border-[#1F2937] rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-[#374151] transition-colors"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">
              {detected.length > 0 ? `${detected.length} URL(s) detectada(s) · máx. 10 vídeos por vez` : ''}
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
              {submitting ? 'Enviando...' : `Extrair${detected.length > 0 ? ` ${Math.min(detected.length, 10)}` : ''}`}
            </button>
          </div>
        </div>

        {/* Histórico */}
        {rows.length === 0 ? (
          <div className="py-20 text-center">
            <MessagesSquare size={24} className="mx-auto text-gray-700 mb-3" />
            <p className="text-sm text-gray-500 mb-1">Nenhuma extração ainda</p>
            <p className="text-xs text-gray-600">Cole URLs de vídeos do YouTube acima e clique em Extrair.</p>
          </div>
        ) : (
          <>
            {/* Barra de seleção — export combinado de vários vídeos numa planilha */}
            {exportaveis.length > 0 && (
              <div className="flex items-center gap-3 flex-wrap rounded-lg bg-[#111827] border border-[#1F2937] px-3 py-2">
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={todasSelecionadas}
                    onChange={toggleSelectAll}
                    className="accent-cyan-500 cursor-pointer"
                  />
                  Selecionar todos ({exportaveis.length})
                </label>
                <span className="text-xs text-gray-600">
                  {selecionadas.length > 0
                    ? `${selecionadas.length} vídeo(s) → uma planilha só (coluna "Vídeo" identifica cada um)`
                    : 'Marque os vídeos pra baixar tudo numa planilha só'}
                </span>
                {selecionadas.length > 0 && (
                  <span className="ml-auto flex items-center gap-2 text-xs">
                    {downloading === 'multi' && (
                      <span className="text-gray-500 flex items-center gap-1">
                        <RefreshCw size={10} className="animate-spin" /> {multiProgress ?? '…'}
                      </span>
                    )}
                    <button
                      onClick={() => void handleDownloadMulti('csv')}
                      disabled={downloading !== null}
                      className="flex items-center gap-1 rounded-md bg-[#06B6D4] text-[#0A0F1E] font-medium px-2.5 py-1 hover:bg-[#0891b2] transition-colors disabled:opacity-50"
                    >
                      <Download size={11} /> CSV ({selecionadas.length})
                    </button>
                    <button
                      onClick={() => void handleDownloadMulti('xlsx')}
                      disabled={downloading !== null}
                      className="flex items-center gap-1 rounded-md bg-[#06B6D4] text-[#0A0F1E] font-medium px-2.5 py-1 hover:bg-[#0891b2] transition-colors disabled:opacity-50"
                    >
                      <Download size={11} /> XLSX ({selecionadas.length})
                    </button>
                  </span>
                )}
              </div>
            )}
            <div className="divide-y divide-[#1F2937]">
              {rows.map((row) => (
                <ExtracaoItem
                  key={row.id}
                  row={row}
                  drivingHere={driving.has(row.id)}
                  downloading={downloading === row.id}
                  selectable={row.comments_count > 0}
                  checked={selected.has(row.id)}
                  onToggleSelect={() => toggleSelect(row.id)}
                  onContinuar={() => void driveQueue([row.id])}
                  onDownload={(f) => void handleDownload(row, f)}
                  onSalvar={() => void handleSalvar(row.id)}
                  onExcluir={() => void handleExcluir(row.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1F2937] border border-[#374151] text-white text-xs px-4 py-2.5 rounded-lg shadow-xl">
          {toast}
        </div>
      )}
    </div>
  )
}

function ExtracaoItem({
  row, drivingHere, downloading, selectable, checked, onToggleSelect,
  onContinuar, onDownload, onSalvar, onExcluir,
}: {
  row: ExtracaoRow
  drivingHere: boolean
  downloading: boolean
  selectable: boolean
  checked: boolean
  onToggleSelect: () => void
  onContinuar: () => void
  onDownload: (formato: 'csv' | 'xlsx') => void
  onSalvar: () => void
  onExcluir: () => void
}) {
  const [confirmDel, setConfirmDel] = useState(false)
  const ativa = drivingHere || (row.status === 'processing' && leaseAtiva(row.lease_until))
  // 'processing' sem ninguém processando = pausada (aba fechada no meio)
  const pausada = row.status === 'processing' && !ativa
  const podeContinuar = pausada || row.status === 'quota' || row.status === 'failed' || row.status === 'pending'
  const temComentarios = row.comments_count > 0
  const parcial = temComentarios && row.status !== 'done'
  const pct = row.expected_comments && row.expected_comments > 0
    ? Math.min(99, Math.round((row.comments_count / row.expected_comments) * 100))
    : null

  return (
    <div className="py-3.5 space-y-2">
      <div className="flex items-start gap-3">
        {/* checkbox do export combinado — só quando há comentários pra exportar */}
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggleSelect}
          disabled={!selectable}
          title={selectable ? 'Incluir na planilha combinada' : 'Sem comentários pra exportar'}
          className="mt-2 shrink-0 accent-cyan-500 cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {row.thumbnail_url && (
          <img
            src={row.thumbnail_url}
            alt=""
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            className="w-16 h-9 rounded object-cover shrink-0 mt-0.5 border border-[#1F2937]"
          />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusDot status={row.status} ativa={ativa} />
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-300 hover:text-white transition-colors flex items-center gap-1 min-w-0 truncate font-medium"
              title={row.video_title ?? row.url}
            >
              <span className="truncate">{row.video_title ?? row.url}</span>
              <ExternalLink size={10} className="shrink-0" />
            </a>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            {row.channel_title && <span className="text-gray-500">{row.channel_title}</span>}

            {ativa && (
              <span className="text-cyan-400 flex items-center gap-1">
                <RefreshCw size={10} className="animate-spin" />
                {row.phase === 'threads' ? 'Extraindo comentários' : 'Buscando respostas'}
                {' · '}{row.comments_count.toLocaleString('pt-BR')}
                {pct !== null && ` (${pct}%)`}
              </span>
            )}
            {row.status === 'pending' && !ativa && <span className="text-gray-500">Na fila</span>}
            {pausada && <span className="text-amber-400">Pausada — clique em Continuar</span>}
            {row.status === 'quota' && (
              <span className="text-amber-400">Quota da API esgotada — Continuar amanhã</span>
            )}
            {row.status === 'failed' && <span className="text-rose-400">Falhou</span>}
            {row.status === 'comments_disabled' && (
              <span className="text-amber-400">Comentários desativados no vídeo</span>
            )}
            {row.status === 'done' && (
              <span className="text-emerald-400">
                {row.comments_count.toLocaleString('pt-BR')} comentários
                {row.expected_comments ? ` de ~${row.expected_comments.toLocaleString('pt-BR')}` : ''}
              </span>
            )}
            {row.status === 'done' && !row.salva && (
              <span className="text-gray-600">{ttlLabel(row.expires_at)}</span>
            )}
            {row.salva && <span className="text-emerald-600">Salva</span>}
          </div>

          {/* Barra de progresso enquanto ativa */}
          {ativa && pct !== null && (
            <div className="h-1 rounded-full bg-[#1F2937] overflow-hidden">
              <div
                className="h-full bg-cyan-500/70 rounded-full transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          {/* Erro */}
          {(row.status === 'failed' || row.status === 'quota') && row.ultimo_erro && (
            <p className="text-[11px] text-rose-400/70 leading-relaxed">{row.ultimo_erro}</p>
          )}

          {/* Ações */}
          {!ativa && (
            <div className="flex items-center gap-2 text-xs flex-wrap">
              {podeContinuar && (
                <>
                  <button
                    onClick={onContinuar}
                    className="text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
                  >
                    <Play size={10} />
                    {row.status === 'failed' ? 'Tentar de novo' : 'Continuar'}
                  </button>
                  <span className="text-gray-700">·</span>
                </>
              )}
              {temComentarios && (
                <>
                  <button
                    onClick={() => onDownload('csv')}
                    disabled={downloading}
                    className="text-gray-300 hover:text-white transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    <Download size={10} />
                    CSV{parcial ? ' (parcial)' : ''}
                  </button>
                  <button
                    onClick={() => onDownload('xlsx')}
                    disabled={downloading}
                    className="text-gray-300 hover:text-white transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    <Download size={10} />
                    XLSX{parcial ? ' (parcial)' : ''}
                  </button>
                  {downloading && (
                    <span className="text-gray-500 flex items-center gap-1">
                      <RefreshCw size={10} className="animate-spin" /> preparando…
                    </span>
                  )}
                  <span className="text-gray-700">·</span>
                </>
              )}
              {row.status === 'done' && !row.salva && (
                <>
                  <button onClick={onSalvar} className="text-emerald-400 hover:text-emerald-300 transition-colors">
                    Salvar
                  </button>
                  <span className="text-gray-700">·</span>
                </>
              )}
              {confirmDel ? (
                <>
                  <span className="text-rose-300">Confirmar exclusão?</span>
                  <button onClick={onExcluir} className="text-rose-400 hover:text-rose-300 font-medium transition-colors">
                    Sim, excluir
                  </button>
                  <span className="text-gray-700">·</span>
                  <button onClick={() => setConfirmDel(false)} className="text-gray-400 hover:text-white transition-colors">
                    Cancelar
                  </button>
                </>
              ) : (
                <button onClick={() => setConfirmDel(true)} className="text-rose-400 hover:text-rose-300 transition-colors">
                  Excluir
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusDot({ status, ativa }: { status: ExtracaoRow['status']; ativa: boolean }) {
  return (
    <span
      className={clsx(
        'inline-block w-2 h-2 rounded-full shrink-0',
        ativa && 'bg-cyan-400 animate-pulse',
        !ativa && status === 'pending' && 'bg-gray-500',
        !ativa && status === 'processing' && 'bg-amber-400', // pausada
        !ativa && status === 'done' && 'bg-emerald-400',
        !ativa && status === 'failed' && 'bg-rose-500',
        !ativa && (status === 'quota' || status === 'comments_disabled') && 'bg-amber-400'
      )}
    />
  )
}
