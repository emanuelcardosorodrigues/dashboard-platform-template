/**
 * Composite bot score cross-source — Fase 3 do plano whimsical-seeking-lemon.
 *
 * Score 0–100 por UID combinando sinais de 4 fontes:
 *   - Worker (UA blocklist, CF score, rate-limit, fingerprint, isUtmBot) — +40
 *   - Clarity (dead clicks ratio + rage clicks)                            — +20/+10
 *   - GA4 (engagement rate, sessions)                                       — +20
 *   - vTurb (play rate, condicional por experiment.vturb_enabled)           — +20
 *
 * Threshold:
 *   - score ≥ 50 → status='suspect' (entra fila de revisão humana)
 *   - score ≥ 80 → status='confirmed' (auto-quarentena, sai das analytics)
 *
 * Função pura: testável sem mocks de DB/API.
 */

export interface WorkerSignal {
  /** Algum dos Layer 1-5 detectou? */
  hit: boolean
  /** Razão (UA, rate, fingerprint, utm_right_column, paid_meta_no_template, etc) */
  reason?: string
}

export interface ClaritySignal {
  /** Razão dead_clicks / total clicks (0..1) */
  deadClickRatio: number
  /** Quantidade absoluta de rage clicks */
  rageClicks: number
  /** Total de cliques (denominador) */
  totalClicks?: number
}

export interface GA4Signal {
  /** Taxa de engajamento (0..1) — GA4 engagedSessions/sessions */
  engagementRate: number
  /** Sessões absolutas */
  sessions: number
}

export interface VturbSignal {
  /** Taxa de play (0..1) — vTurb total_started / total_viewed */
  playRate: number
  /** Total de visualizações (denominador) */
  totalViewed?: number
}

export interface ComposeScoreInput {
  worker?: WorkerSignal
  clarity?: ClaritySignal
  ga4?: GA4Signal
  vturb?: VturbSignal
  /** Só pesa o sinal vTurb quando true (flag por experimento) */
  vturbEnabled?: boolean
}

export interface BotScoreResult {
  score: number
  signals: Record<string, unknown>
  status: 'suspect' | 'confirmed' | 'cleared'
}

/**
 * Compõe score 0-100 + signals jsonb + status sugerido.
 *
 * Status thresholds:
 *   score < 50  → cleared (não vai pra bot_uids)
 *   50 ≤ score < 80 → suspect (entra fila revisão humana)
 *   score ≥ 80 → confirmed (auto-quarentena)
 */
export function composeScore(input: ComposeScoreInput): BotScoreResult {
  let score = 0
  const signals: Record<string, unknown> = {}

  // Worker — sinal mais forte (já tem certeza, foi um dos 5 layers)
  if (input.worker?.hit) {
    score += 40
    signals.worker_hit = true
    if (input.worker.reason) signals.worker_reason = input.worker.reason
  }

  // Clarity — dead clicks (humano raramente clica em vazio) + rage clicks (humano frustrado)
  if (input.clarity) {
    const { deadClickRatio, rageClicks, totalClicks } = input.clarity
    signals.clarity_dead_ratio = deadClickRatio
    signals.clarity_rage = rageClicks
    if (totalClicks !== undefined) signals.clarity_total_clicks = totalClicks

    // Só pesa se tem volume mínimo (5 cliques) — abaixo disso é ruído
    if (totalClicks === undefined || totalClicks >= 5) {
      if (deadClickRatio > 0.5) {
        score += 20
        signals.clarity_dead_flag = true
      }
      if (rageClicks > 3) {
        score += 10
        signals.clarity_rage_flag = true
      }
    }
  }

  // GA4 — engagement baixo com volume mínimo de sessões
  if (input.ga4) {
    const { engagementRate, sessions } = input.ga4
    signals.ga4_engagement = engagementRate
    signals.ga4_sessions = sessions

    if (sessions >= 3 && engagementRate < 0.05) {
      score += 20
      signals.ga4_low_engagement_flag = true
    }
  }

  // vTurb — só se experiment tem player ativo (condicional)
  if (input.vturb && input.vturbEnabled) {
    const { playRate, totalViewed } = input.vturb
    signals.vturb_play_rate = playRate
    if (totalViewed !== undefined) signals.vturb_total_viewed = totalViewed

    // Mínimo de 5 visualizações pra evitar ruído
    if ((totalViewed === undefined || totalViewed >= 5) && playRate < 0.05) {
      score += 20
      signals.vturb_low_play_flag = true
    }
  } else if (input.vturb && !input.vturbEnabled) {
    signals.vturb_skipped = 'experiment_has_no_player'
  }

  // Status final
  let status: BotScoreResult['status'] = 'cleared'
  if (score >= 80) status = 'confirmed'
  else if (score >= 50) status = 'suspect'

  return { score, signals, status }
}

/**
 * Utility: extrai um worker_reason legível das colunas do impressions row.
 * O Worker não escreve essa info hoje — placeholder pra quando Phase 6 adicionar.
 */
export function workerSignalFromImpression(imp: { worker_bot_reason?: string }): WorkerSignal {
  if (imp.worker_bot_reason) {
    return { hit: true, reason: imp.worker_bot_reason }
  }
  return { hit: false }
}
