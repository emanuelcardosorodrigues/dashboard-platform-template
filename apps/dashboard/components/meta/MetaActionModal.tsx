'use client'

/**
 * Modal de confirmação pra ações de ESCRITA no Meta (mexe em dinheiro real).
 *
 * Princípios de segurança (mandato do usuário):
 *  - Confirmação EXPLÍCITA em toda ação (pausar/ativar/escalar).
 *  - Aumento de orçamento exige DIGITAR o novo valor (não tem botão +X%).
 *  - Lê o estado AO VIVO no Meta ao abrir (GET) → mostra orçamento/status reais
 *    e usa esse valor como `expected_old_cents` (compare-and-set: 409 se mudar).
 *  - Aviso NÃO-BLOQUEANTE quando o aumento passa de +30%.
 *  - CBO (orçamento na campanha, não no adset) → bloqueia com mensagem clara.
 *  - Teto absoluto (META_MAX_DAILY_BUDGET_CENTS) refletido na UI; servidor reforça.
 *  - Botão desabilitado enquanto a ação roda; uma linha por vez.
 *
 * A UI NÃO confia em si mesma: toda trava existe TAMBÉM no servidor
 * (meta-actions.ts / route.ts). Aqui é só pra evitar erro humano e dar clareza.
 */

import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { X, AlertTriangle, Loader2, Pause, Play, TrendingUp } from 'lucide-react'
import { parseReaisToCents } from '@/lib/meta-budget'

export type MetaActionKind = 'pausar' | 'ativar' | 'escalar'
export type MetaActionEscopo = 'criativo' | 'conjunto' | 'campanha'

export interface MetaActionTarget {
  /** id da entidade no Meta: ad (criativo), adset (conjunto) ou campanha. */
  adId: string
  nome: string
  escopo: MetaActionEscopo
}

const ENTIDADE_LABEL: Record<MetaActionEscopo, string> = {
  criativo: 'Anúncio',
  conjunto: 'Conjunto',
  campanha: 'Campanha',
}

interface LiveState {
  adId: string
  adsetId?: string      // só no escopo criativo
  campaignId?: string   // só no escopo criativo
  status: string
  daily_budget_cents: number | null
  is_cbo: boolean
  max_daily_budget_cents: number | null
}

interface Props {
  kind: MetaActionKind
  target: MetaActionTarget
  onClose: () => void
  onDone: (msg: string) => void
}

const BRL = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const KIND_META: Record<MetaActionKind, { titleBase: string; icon: typeof Pause; verb: string; tone: string }> = {
  pausar: { titleBase: 'Pausar', icon: Pause, verb: 'Pausar', tone: 'bg-amber-500 hover:bg-amber-600' },
  ativar: { titleBase: 'Ativar', icon: Play, verb: 'Ativar', tone: 'bg-emerald-500 hover:bg-emerald-600' },
  escalar: { titleBase: 'Aumentar orçamento', icon: TrendingUp, verb: 'Aplicar novo orçamento', tone: 'bg-cyan-500 hover:bg-cyan-600' },
}

export default function MetaActionModal({ kind, target, onClose, onDone }: Props) {
  const meta = KIND_META[kind]
  const Icon = meta.icon
  const entidade = ENTIDADE_LABEL[target.escopo]
  const titulo = kind === 'escalar' ? `Aumentar orçamento · ${entidade}` : `${meta.titleBase} ${entidade.toLowerCase()}`

  const [live, setLive] = useState<LiveState | null>(null)
  const [loadingLive, setLoadingLive] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Campo "novo orçamento" em reais (string pra deixar o usuário digitar livremente).
  const [novoReais, setNovoReais] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Lê estado ao vivo ao abrir (status + orçamento reais → compare-and-set).
  useEffect(() => {
    let alive = true
    setLoadingLive(true)
    setLoadError(null)
    fetch(`/api/criativos/ads/${encodeURIComponent(target.adId)}/action?escopo=${target.escopo}`, { method: 'GET' })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!alive) return
        if (!r.ok) { setLoadError(data?.error || `erro ${r.status}`); return }
        setLive(data as LiveState)
      })
      .catch((e) => { if (alive) setLoadError(String(e)) })
      .finally(() => { if (alive) setLoadingLive(false) })
    return () => { alive = false }
  }, [target.adId, target.escopo])

  const oldCents = live?.daily_budget_cents ?? null
  const novoCents = parseReaisToCents(novoReais)
  const deltaPct = oldCents != null && oldCents > 0 && novoCents != null
    ? ((novoCents - oldCents) / oldCents) * 100
    : null
  const tetoConfigurado = live != null && live.max_daily_budget_cents != null
  const excedeTeto = tetoConfigurado && novoCents != null && novoCents > live!.max_daily_budget_cents!
  const inputInvalido = novoReais.trim().length > 0 && novoCents == null
  const isAumentoGrande = deltaPct != null && deltaPct > 30

  const canSubmit = (() => {
    if (submitting || loadingLive || loadError) return false
    if (kind === 'escalar') {
      if (live?.is_cbo) return false
      if (!tetoConfigurado) return false // teto é pré-requisito (servidor é fail-closed)
      if (novoCents == null || excedeTeto) return false
      if (oldCents != null && novoCents === oldCents) return false
    }
    return true
  })()

  const submit = useCallback(async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const body: Record<string, unknown> = { tipo: kind, escopo: target.escopo }
      if (kind === 'escalar') {
        body.new_daily_budget_cents = novoCents
        if (oldCents != null) body.expected_old_cents = oldCents // compare-and-set
      }
      const r = await fetch(`/api/criativos/ads/${encodeURIComponent(target.adId)}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || data?.status === 'failed') {
        setSubmitError(data?.error || `erro ${r.status}`)
        setSubmitting(false)
        return
      }
      const okMsg =
        kind === 'pausar' ? `Anúncio pausado: ${target.nome}`
        : kind === 'ativar' ? `Anúncio ativado: ${target.nome}`
        : `Orçamento alterado para ${BRL(novoCents!)}: ${target.nome}`
      onDone(okMsg)
    } catch (e) {
      setSubmitError(String(e))
      setSubmitting(false)
    }
  }, [kind, novoCents, oldCents, target.adId, target.nome, onDone])

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#111827] border border-[#1F2937] rounded-2xl p-6 max-w-md w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <Icon size={16} className="text-cyan-400 shrink-0" />
            <h2 className="text-sm font-semibold text-white">{titulo}</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-gray-400 mb-4 truncate" title={target.nome}>
          <span className="text-gray-500">{entidade}:</span> {target.nome}
        </p>

        {/* Estado ao vivo */}
        {loadingLive ? (
          <div className="flex items-center gap-2 text-xs text-gray-500 py-6 justify-center">
            <Loader2 size={14} className="animate-spin" /> Lendo estado atual no Meta…
          </div>
        ) : loadError ? (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 text-xs text-rose-300">
            Não consegui ler o estado ao vivo: {loadError}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-[#1F2937] rounded-lg p-2.5">
                <p className="text-[10px] text-gray-500 mb-1">Status atual</p>
                <p className="text-sm font-semibold text-white">{live?.status ?? '—'}</p>
              </div>
              <div className="bg-[#1F2937] rounded-lg p-2.5">
                <p className="text-[10px] text-gray-500 mb-1">Orçamento diário</p>
                <p className="text-sm font-semibold text-white">
                  {live?.is_cbo
                    ? (target.escopo === 'campanha' ? 'ABO (conjuntos)' : 'CBO (campanha)')
                    : oldCents != null ? BRL(oldCents) : '—'}
                </p>
              </div>
            </div>

            {kind === 'escalar' && (
              live?.is_cbo ? (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-300 mb-4">
                  {target.escopo === 'campanha' ? (
                    <>Esta campanha usa <strong>ABO</strong> (orçamento nos conjuntos). Ajuste o orçamento direto nos <strong>Conjuntos</strong> desta campanha.</>
                  ) : (
                    <>Este conjunto usa <strong>CBO</strong> (orçamento na campanha). Não escalo CBO no conjunto — ajuste o orçamento na <strong>Campanha</strong>.</>
                  )}
                </div>
              ) : !tetoConfigurado ? (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 text-xs text-rose-300 mb-4">
                  Alteração de orçamento <strong>bloqueada</strong>: o teto de segurança não está configurado.
                  Defina <code className="text-rose-200">META_MAX_DAILY_BUDGET_CENTS</code> no servidor antes de
                  liberar alteração de orçamento.
                </div>
              ) : (
                <div className="mb-4">
                  <label className="block text-xs text-gray-400 mb-1.5">
                    Novo orçamento diário (digite o valor — em R$)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">R$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={novoReais}
                      onChange={(e) => setNovoReais(e.target.value)}
                      placeholder={oldCents != null ? (oldCents / 100).toFixed(2).replace('.', ',') : '0,00'}
                      autoFocus
                      className="w-full pl-9 pr-4 py-2 bg-[#1F2937] border border-[#374151] rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 tabular-nums"
                    />
                  </div>

                  {/* Input em formato inesperado */}
                  {inputInvalido && (
                    <div className="mt-2 flex items-start gap-1.5 text-xs text-rose-300">
                      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                      <span>Valor inválido. Use o formato R$ pt-BR (ex: 1.500,00 ou 1500).</span>
                    </div>
                  )}

                  {/* Δ vs atual */}
                  {novoCents != null && oldCents != null && (
                    <p className="mt-2 text-xs text-gray-400 tabular-nums">
                      {BRL(oldCents)} → <span className="text-white font-semibold">{BRL(novoCents)}</span>
                      {deltaPct != null && (
                        <span className={clsx('ml-2', deltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                          {deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(0)}%
                        </span>
                      )}
                    </p>
                  )}

                  {/* Aviso não-bloqueante >30% */}
                  {isAumentoGrande && !excedeTeto && (
                    <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-300">
                      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                      <span>Aumento de {deltaPct!.toFixed(0)}% (acima de 30%). Confira antes de confirmar.</span>
                    </div>
                  )}

                  {/* Teto absoluto — bloqueante */}
                  {excedeTeto && (
                    <div className="mt-2 flex items-start gap-1.5 text-xs text-rose-300">
                      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                      <span>Excede o teto de {BRL(live!.max_daily_budget_cents!)} (META_MAX_DAILY_BUDGET_CENTS).</span>
                    </div>
                  )}
                </div>
              )
            )}

            {(kind === 'pausar' || kind === 'ativar') && (
              <p className="text-xs text-gray-400 mb-4">
                Confirma {kind === 'pausar' ? 'pausar' : 'ativar'} {target.escopo === 'campanha' ? 'esta campanha' : target.escopo === 'conjunto' ? 'este conjunto' : 'este anúncio'} no Meta?
                {(target.escopo === 'campanha' || target.escopo === 'conjunto') && ' Afeta todos os anúncios dentro dele.'} A ação é registrada na auditoria.
              </p>
            )}
          </>
        )}

        {submitError && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 text-xs text-rose-300 mb-4">
            {submitError}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs rounded-lg text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className={clsx(
              'px-4 py-2 text-xs rounded-lg text-white font-medium transition-colors flex items-center gap-1.5',
              canSubmit ? meta.tone + ' cursor-pointer' : 'bg-[#1F2937] text-gray-400 cursor-not-allowed'
            )}
          >
            {submitting && <Loader2 size={13} className="animate-spin" />}
            {meta.verb}
          </button>
        </div>
      </div>
    </div>
  )
}
