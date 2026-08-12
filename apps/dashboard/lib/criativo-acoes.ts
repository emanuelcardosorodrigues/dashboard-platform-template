/**
 * Executor de ações Meta a partir de sugestões aprovadas (ou ações ad-hoc).
 *
 * Fluxo:
 *   0. Watchdog: marca como timeout qualquer log 'running' > STALE_LOCK_MINUTES
 *   1. Lock soft: rejeita se houver 'running' pra esse ad_id (após cleanup)
 *   2. Insere row em criativo_acoes_log status='running'
 *   3. Chama Meta API (pause/scale)
 *   4. Atualiza row pra 'ok'+resultado ou 'failed'+error_message
 *   5. Se origem = sugestao, marca criativo_sugestoes.status='executed'
 *
 * Idempotência: caller deve verificar sugestao.status='approved' antes;
 * uma sugestão 'executed' não pode ser re-executada.
 *
 * Lock é por (workspace_id, ad_id) e expira em STALE_LOCK_MINUTES — janela
 * suficiente pra Meta API responder mesmo com retry e bem menor que cron
 * (10:20 vs ação ad-hoc humana). Não usa pg_advisory_lock porque o supabase
 * client não expõe transação manual; a contagem de 'running' faz o papel.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { pauseAd, activateAd, scaleAdBudget, scaleEntityBudget, MetaActionError } from './meta-actions'
import { saveNote, MindVaultError, type VaultKind } from './mind-vault'
import { log } from './log'

export const STALE_LOCK_MINUTES = 5

export class CriativoAcaoLockError extends Error {
  constructor(adId: string) {
    super(`ação em andamento para ad_id=${adId} (lock ativo)`)
    this.name = 'CriativoAcaoLockError'
  }
}

export type AcaoTipo = 'escalar' | 'pausar' | 'ativar' | 'vault_save'

export interface VaultNotePayload {
  title: string
  body: string
  tldr: string
  domains: string[]
  kind: VaultKind
  tags?: string[]
}

/**
 * Escopo da ação: define COMO interpretar `adId`.
 *  - 'criativo'  → adId é um AD; escalar resolve o adset dele (scaleAdBudget).
 *  - 'conjunto'  → adId é um ADSET; escalar mexe no orçamento do próprio adset.
 *  - 'campanha'  → adId é uma CAMPANHA (CBO); escalar mexe no orçamento dela.
 * pausar/ativar funcionam igual em qualquer escopo (status no id direto).
 */
export type AcaoEscopo = 'criativo' | 'conjunto' | 'campanha'

export interface ExecutarAcaoInput {
  workspaceId: string
  adId: string
  tipo: AcaoTipo
  escopo?: AcaoEscopo
  payload: {
    budget_diff_pct?: number
    new_daily_budget_cents?: number   // orçamento absoluto (UI "digite o novo valor")
    expected_old_cents?: number       // compare-and-set (mata stale-data/duplo-clique)
    motivo?: string
    vault_note?: VaultNotePayload
  }
  sugestaoId?: string | null
  executadoPor?: string | null
  dryRun?: boolean
}

export interface AcaoResult {
  logId: string | null
  status: 'ok' | 'failed' | 'dry-run'
  resultado?: Record<string, unknown>
  error?: string
}

async function cleanupStaleLocks(
  supa: SupabaseClient,
  workspaceId: string,
  adId: string
): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60_000).toISOString()
  const { data, error } = await supa
    .from('criativo_acoes_log')
    .update({
      status: 'failed',
      error_message: `timeout watchdog (>${STALE_LOCK_MINUTES}min em running)`,
      concluido_em: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('ad_id', adId)
    .eq('status', 'running')
    .lt('iniciado_em', cutoff)
    .select('id')
  if (error) {
    log.warn('cleanupStaleLocks falhou', { adId, msg: error.message })
    return 0
  }
  const n = (data ?? []).length
  if (n > 0) log.warn('watchdog matou locks zumbis', { adId, n })
  return n
}

async function ensureNoActiveLock(
  supa: SupabaseClient,
  workspaceId: string,
  adId: string
): Promise<void> {
  const { count, error } = await supa
    .from('criativo_acoes_log')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('ad_id', adId)
    .eq('status', 'running')
  if (error) throw new Error(`lock check falhou: ${error.message}`)
  if ((count ?? 0) > 0) throw new CriativoAcaoLockError(adId)
}

export async function executarAcao(
  supa: SupabaseClient,
  input: ExecutarAcaoInput
): Promise<AcaoResult> {
  if (input.dryRun) {
    return {
      logId: null,
      status: 'dry-run',
      resultado: { tipo: input.tipo, ad_id: input.adId, payload: input.payload },
    }
  }

  // 0. Watchdog + lock check
  await cleanupStaleLocks(supa, input.workspaceId, input.adId)
  await ensureNoActiveLock(supa, input.workspaceId, input.adId)

  // 1. Insere log running
  const { data: logRow, error: logErr } = await supa
    .from('criativo_acoes_log')
    .insert({
      workspace_id: input.workspaceId,
      sugestao_id: input.sugestaoId ?? null,
      ad_id: input.adId,
      tipo: input.tipo,
      payload: { ...input.payload, escopo: input.escopo ?? 'criativo' },
      executado_por: input.executadoPor ?? null,
      status: 'running',
    })
    .select('id')
    .single()
  if (logErr || !logRow) {
    // 23505 = violação do índice único parcial (0022): já existe uma ação
    // 'running' pra esse (workspace, ad) → é o lock atômico disparando.
    if ((logErr as { code?: string } | null)?.code === '23505') {
      throw new CriativoAcaoLockError(input.adId)
    }
    throw new Error(`falha gravando log: ${logErr?.message}`)
  }
  const logId = logRow.id as string

  // 2. Executa
  try {
    let resultado: Record<string, unknown>
    if (input.tipo === 'pausar') {
      resultado = await pauseAd(input.adId)
    } else if (input.tipo === 'ativar') {
      resultado = await activateAd(input.adId)
    } else if (input.tipo === 'escalar') {
      const { budget_diff_pct, new_daily_budget_cents, expected_old_cents } = input.payload
      if (budget_diff_pct == null && new_daily_budget_cents == null) {
        throw new Error('escalar requer payload.budget_diff_pct ou new_daily_budget_cents')
      }
      const escopo = input.escopo ?? 'criativo'
      if (escopo === 'conjunto' || escopo === 'campanha') {
        // adId já é a entidade com orçamento (adset/campanha).
        resultado = await scaleEntityBudget({
          entityId: input.adId,
          escopo,
          budget_diff_pct: budget_diff_pct ?? undefined,
          new_daily_budget_cents: new_daily_budget_cents ?? undefined,
          expected_old_cents: expected_old_cents ?? undefined,
        })
      } else {
        // criativo: resolve o adset do ad.
        resultado = await scaleAdBudget({
          adId: input.adId,
          budget_diff_pct: budget_diff_pct ?? undefined,
          new_daily_budget_cents: new_daily_budget_cents ?? undefined,
          expected_old_cents: expected_old_cents ?? undefined,
        })
      }
    } else if (input.tipo === 'vault_save') {
      const note = input.payload.vault_note
      if (!note) throw new Error('vault_save requer payload.vault_note')
      const saved = await saveNote(note)
      resultado = { vault_note_id: saved.id, title: note.title, kind: note.kind }
    } else {
      throw new Error(`tipo de ação desconhecido: ${input.tipo}`)
    }

    // 3. Marca ok
    await supa
      .from('criativo_acoes_log')
      .update({ status: 'ok', resultado, concluido_em: new Date().toISOString() })
      .eq('id', logId)

    if (input.sugestaoId) {
      await supa
        .from('criativo_sugestoes')
        .update({ status: 'executed' })
        .eq('id', input.sugestaoId)
        .eq('workspace_id', input.workspaceId)
    }

    return { logId, status: 'ok', resultado }
  } catch (err) {
    const msg =
      err instanceof MetaActionError || err instanceof MindVaultError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err)
    log.error('executarAcao failed', { adId: input.adId, tipo: input.tipo, msg })
    await supa
      .from('criativo_acoes_log')
      .update({ status: 'failed', error_message: msg, concluido_em: new Date().toISOString() })
      .eq('id', logId)
    return { logId, status: 'failed', error: msg }
  }
}
