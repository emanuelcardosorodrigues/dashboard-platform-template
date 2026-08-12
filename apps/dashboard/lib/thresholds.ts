import type { SemaforoColor } from '@/types'

// CPA agora é semáforo RELATIVO ao ticket FE quando disponível:
//   verde ≤ 40% do ticket FE | amarelo 40-70% | vermelho ≥ 70%
// Fallback absoluto abaixo serve só pra quando ticketFE não está disponível.
export const CPA_TICKET_RATIO = { verde: 0.40, amarelo: 0.70 } as const

export const THRESHOLDS = {
  roasLiquido:          { verde: 1.5,  amarelo: 1.0  },  // ROAS (maior = melhor)
  cpa:                  { verde: 50,   amarelo: 100  },  // FALLBACK absoluto (sem ticketFE) — INVERTED
  ctr:                  { verde: 1.5,  amarelo: 1.0  },  // CTR % (maior = melhor) — verde≥1.5, amarelo≥1.0, vermelho<1.0
  cpc:                  { verde: 2.0,  amarelo: 5.0  },  // CPC em R$ (menor = melhor) — INVERTED
  cpm:                  { verde: 35,   amarelo: 45   },  // CPM em R$ (menor = melhor) — INVERTED
  taxaCarregamento:     { verde: 85,   amarelo: 70   },  // Landing/Cliques % (maior = melhor)
  taxaPassagemCheckout: { verde: 30,   amarelo: 15   },  // Checkout/Landing % (maior = melhor)
  cvrPagina:            { verde: 10,   amarelo: 4    },  // Carregamento pág % (maior = melhor)
  cvrCheckout:          { verde: 40,   amarelo: 22   },  // Vendas/Checkout % (maior = melhor)
  txConversaoPagina:    { verde: 3,    amarelo: 1.5  },  // Vendas/Landing % (maior = melhor)
  txConversaoClique:    { verde: 1.0,  amarelo: 0.5  },  // Vendas/Cliques % (maior = melhor)
  taxaGancho:           { verde: 30,   amarelo: 15   },  // Hook rate % (maior = melhor)
  taxaRetencao:         { verde: 15,   amarelo: 8    },  // Retenção 95% % (maior = melhor)
  takeRateOB:           { verde: 20,   amarelo: 10   },  // Take rate OBs % (maior = melhor)
} as const

export type ThresholdKey = keyof typeof THRESHOLDS

// Metrics where LOWER is BETTER
const INVERTED: ThresholdKey[] = ['cpa', 'cpc', 'cpm']

export function getSemaforoColor(metric: ThresholdKey, value: number): SemaforoColor {
  return getSemaforoColorForFunil(metric, value)
}

/**
 * Calcula a cor do semáforo.
 *
 * Para CPA, quando `ticketFE > 0` é fornecido, usa o critério RELATIVO:
 *   verde ≤ 40% do ticket | amarelo 40-70% | vermelho ≥ 70%
 * Sem `ticketFE` (ou ≤ 0), cai no fallback absoluto de `THRESHOLDS.cpa`.
 *
 * O argumento `funil` é mantido por compatibilidade — não influencia mais o CPA
 * (override por funil foi removido em favor da razão sobre o ticket).
 */
export function getSemaforoColorForFunil(
  metric: ThresholdKey,
  value: number,
  funil?: string,
  ticketFE?: number,
): SemaforoColor {
  void funil
  // Zero or negative always means no data — never show as green
  if (value <= 0) return 'red'

  if (metric === 'cpa' && ticketFE && ticketFE > 0) {
    const ratio = value / ticketFE
    if (ratio <= CPA_TICKET_RATIO.verde)   return 'green'
    if (ratio <  CPA_TICKET_RATIO.amarelo) return 'yellow'
    return 'red'
  }

  const t = THRESHOLDS[metric]
  if (INVERTED.includes(metric)) {
    if (value <= t.verde) return 'green'
    if (value <= t.amarelo) return 'yellow'
    return 'red'
  }
  if (value >= t.verde) return 'green'
  if (value >= t.amarelo) return 'yellow'
  return 'red'
}

export const SEMAFORO_CSS: Record<SemaforoColor, string> = {
  green: 'text-emerald-400',
  yellow: 'text-amber-400',
  red: 'text-rose-500',
}

export const SEMAFORO_BG: Record<SemaforoColor, string> = {
  green: 'bg-emerald-400/10',
  yellow: 'bg-amber-400/10',
  red: 'bg-rose-500/10',
}

export const SEMAFORO_BORDER: Record<SemaforoColor, string> = {
  green: 'border-emerald-400/30',
  yellow: 'border-amber-400/30',
  red: 'border-rose-500/30',
}

export const SEMAFORO_DOT_COLOR: Record<SemaforoColor, string> = {
  green: '#10B981',
  yellow: '#F59E0B',
  red: '#F43F5E',
}

// --- Clarity (Microsoft Clarity Data Export) ---
// Para frustração (rage/dead/quick-back) e erros: MENOR é melhor (INVERTIDO).
// Para engajamento (scroll/tempo): MAIOR é melhor.
// Valores conservadores; revisitar após 1ª semana de dados reais em produção.
export const CLARITY_THRESHOLDS = {
  rage_clicks_pct:  { verde: 1,  amarelo: 3  },   // % sessions com rage  — INVERTED
  dead_clicks_pct:  { verde: 5,  amarelo: 10 },   // % sessions com dead  — INVERTED
  quick_back_pct:   { verde: 10, amarelo: 20 },   // % sessions com qb    — INVERTED
  scroll_depth_pct: { verde: 70, amarelo: 50 },   // % scroll médio       — MAIOR=melhor
  engagement_sec:   { verde: 60, amarelo: 30 },   // seg engajamento médio — MAIOR=melhor
} as const

export type ClarityThresholdKey = keyof typeof CLARITY_THRESHOLDS

const CLARITY_INVERTED: ClarityThresholdKey[] = [
  'rage_clicks_pct', 'dead_clicks_pct', 'quick_back_pct',
]

export function getClarityColor(metric: ClarityThresholdKey, value: number): SemaforoColor {
  const t = CLARITY_THRESHOLDS[metric]
  if (CLARITY_INVERTED.includes(metric)) {
    if (value <= t.verde) return 'green'
    if (value <= t.amarelo) return 'yellow'
    return 'red'
  }
  if (value >= t.verde) return 'green'
  if (value >= t.amarelo) return 'yellow'
  return 'red'
}

// ═══════════════════════════════════════════════════════════════════════════
// ORGÂNICO — semáforo por métrica × FORMATO de plataforma (área Orgânico).
// Defaults de benchmarks publicados 2024-2026 (Socialinsider/Metricool/Rival
// IQ/Buffer/YouTube Studio) — RECALIBRAR com percentis próprios (P25/P50/P75)
// após 30-60 dias de dados. Valores em %, exceto onde anotado.
// ═══════════════════════════════════════════════════════════════════════════

export type OrganicFormatKey =
  | 'youtube_long' | 'youtube_short' | 'reel' | 'feed' | 'carousel' | 'tiktok' | 'story'

interface OrganicThreshold { verde: number; amarelo: number; inverted?: boolean }

export const ORGANIC_THRESHOLDS: Record<string, Partial<Record<OrganicFormatKey, OrganicThreshold>>> = {
  // CTR de impressões de thumbnail (YT Studio: metade dos canais entre 2-10%)
  ctrImpressions: { youtube_long: { verde: 6, amarelo: 3 }, youtube_short: { verde: 6, amarelo: 3 } },
  // % média assistida (APV)
  apv: { youtube_long: { verde: 50, amarelo: 35 }, youtube_short: { verde: 75, amarelo: 60 } },
  // engaged views ÷ views (proxy de viewed-vs-swiped dos Shorts)
  viewedVsSwiped: { youtube_short: { verde: 70, amarelo: 60 } },
  // inscritos ganhos ÷ views (educacional chega a 1-3%)
  subsPerView: { youtube_long: { verde: 0.5, amarelo: 0.2 }, youtube_short: { verde: 0.3, amarelo: 0.1 } },
  // completion (TikTok full_video_watched_rate; depende de duração — média)
  completionRate: { tiktok: { verde: 50, amarelo: 35 } },
  // engajamento ÷ views (likes+comments+shares+saves)
  engajamentoRate: {
    reel: { verde: 6, amarelo: 3 }, feed: { verde: 4, amarelo: 2 }, carousel: { verde: 4, amarelo: 2 },
    tiktok: { verde: 6, amarelo: 3 }, youtube_long: { verde: 5, amarelo: 2.5 }, youtube_short: { verde: 5, amarelo: 2.5 },
  },
  // saves ÷ alcance (ou views como proxy quando reach ausente)
  savesRate: { reel: { verde: 0.7, amarelo: 0.3 }, feed: { verde: 0.7, amarelo: 0.3 }, carousel: { verde: 0.9, amarelo: 0.4 } },
  // shares ÷ alcance/views (o que o algoritmo mais pondera)
  sharesRate: {
    reel: { verde: 1, amarelo: 0.4 }, feed: { verde: 0.6, amarelo: 0.25 }, carousel: { verde: 0.6, amarelo: 0.25 },
    tiktok: { verde: 1, amarelo: 0.3 }, youtube_short: { verde: 0.8, amarelo: 0.3 }, youtube_long: { verde: 0.5, amarelo: 0.2 },
  },
  // follows/subs ÷ alcance (descoberta → seguidor)
  followsRate: { reel: { verde: 0.1, amarelo: 0.03 }, feed: { verde: 0.08, amarelo: 0.03 }, carousel: { verde: 0.08, amarelo: 0.03 }, tiktok: { verde: 0.3, amarelo: 0.06 } },
  // skip rate dos Reels (% que pulou <3s) — INVERTIDA (menor = melhor)
  skipRate: { reel: { verde: 30, amarelo: 45, inverted: true } },
  // stories
  storyCompletion: { story: { verde: 70, amarelo: 55 } },
  storyExitPrimeiroFrame: { story: { verde: 15, amarelo: 25, inverted: true } },
}

/** Semáforo orgânico: null quando não há threshold pro formato OU valor ausente
 *  (render neutro — regra "nunca zero/cor falsa"). */
export function getOrganicSemaforo(
  metricId: string,
  formatKey: OrganicFormatKey,
  value: number | null | undefined,
): SemaforoColor | null {
  if (value == null || !Number.isFinite(value)) return null
  const t = ORGANIC_THRESHOLDS[metricId]?.[formatKey]
  if (!t) return null
  if (t.inverted) {
    if (value <= t.verde) return 'green'
    if (value <= t.amarelo) return 'yellow'
    return 'red'
  }
  if (value >= t.verde) return 'green'
  if (value >= t.amarelo) return 'yellow'
  return 'red'
}

/** Mapeia plataforma+formato do organic_posts pra chave de threshold. */
export function organicFormatKey(platform: string, format: string | null): OrganicFormatKey {
  if (platform === 'youtube') return format === 'short' ? 'youtube_short' : 'youtube_long'
  if (platform === 'tiktok') return 'tiktok'
  if (format === 'feed') return 'feed'
  if (format === 'carousel') return 'carousel'
  return 'reel'
}
