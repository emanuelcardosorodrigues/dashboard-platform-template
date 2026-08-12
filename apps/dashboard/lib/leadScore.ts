/**
 * Lead Scoring CONFIGURÁVEL pelo gestor (decisão do Equipe): o usuário define,
 * por pergunta de múltipla escolha da ficha, quantos pontos cada alternativa vale.
 * O engine só aplica os pesos — determinístico, sem IA ([[feedback_hardcode_over_ai]]).
 * Alvo de conversão = uma coluna boolean da ficha (ex aluno_mentoria = comprou o
 * Programa Demonstrativo), configurável por funil. Calibração = taxa de conversão por tier.
 */
import type { SbQualificacao, SbLeadScoreConfig } from './supabase'

export interface LeadScoreConfig {
  funil: string
  weights: Record<string, Record<string, number>> // campo -> { alternativa: pontos }
  tierQuente: number
  tierMorno: number
  alvoColuna: string
}

// #16 — fonte única de defaults de negócio; importada em configFromRow e na rota
// PUT /api/lead-score-config (evita divergência silenciosa entre 3 locais).
export const DEFAULT_TIER_QUENTE  = 70
export const DEFAULT_TIER_MORNO   = 40
export const DEFAULT_ALVO_COLUNA  = 'aluno_mentoria'

export const defaultLeadConfig = (funil: string): LeadScoreConfig => ({
  funil, weights: {}, tierQuente: DEFAULT_TIER_QUENTE, tierMorno: DEFAULT_TIER_MORNO, alvoColuna: DEFAULT_ALVO_COLUNA,
})

export function configFromRow(funil: string, row?: SbLeadScoreConfig): LeadScoreConfig {
  if (!row) return defaultLeadConfig(funil)
  return {
    funil,
    weights: row.weights ?? {},
    tierQuente: row.tier_quente ?? DEFAULT_TIER_QUENTE,
    tierMorno: row.tier_morno ?? DEFAULT_TIER_MORNO,
    alvoColuna: row.alvo_coluna ?? DEFAULT_ALVO_COLUNA,
  }
}

// Campos da ficha tipicamente de múltipla escolha (domínio fechado). O builder
// ainda filtra por nº de alternativas distintas, então free-text que escapou some.
export const MC_CANDIDATE_FIELDS: { field: string; label: string }[] = [
  { field: 'faturamento_declarado', label: 'Faturamento declarado' },
  { field: 'quanto_sobra', label: 'Quanto sobra no fim do mês' },
  { field: 'valor_sonho', label: 'Faturamento dos sonhos' },
  { field: 'valor_sonho_mensal', label: 'Faturamento dos sonhos (mensal)' },
  { field: 'faixa_etaria', label: 'Faixa etária' },
  { field: 'tempo_odontologia', label: 'Tempo de odontologia' },
  { field: 'tipo_clinica', label: 'Tipo de clínica' },
  { field: 'num_cadeiras', label: 'Nº de cadeiras' },
  { field: 'tem_socio', label: 'Tem sócio' },
  { field: 'tem_filhos', label: 'Tem filhos' },
  { field: 'estado_civil', label: 'Estado civil' },
  { field: 'sexo', label: 'Sexo' },
  { field: 'voce_e', label: 'Você é' },
  { field: 'tentou_antes', label: 'Já tentou resolver antes' },
  { field: 'funcionou', label: 'Funcionou' },
  { field: 'como_conheceu', label: 'Como conheceu' },
  { field: 'emocao_fim_mes', label: 'Emoção no fim do mês' },
]

// Colunas boolean da ficha usáveis como alvo de conversão.
export const ALVO_OPTIONS: { col: string; label: string }[] = [
  { col: 'aluno_mentoria', label: 'Comprou o Programa Demonstrativo (aluno_mentoria)' },
  { col: 'comprou_calculadora', label: 'Comprou a Calculadora (front)' },
  { col: 'comprou_ob1_script', label: 'Comprou OB1 — Script Anti-Desconto' },
  { col: 'comprou_ob2_tributario', label: 'Comprou OB2 — Lucro Tributário' },
  { col: 'comprou_ob3_dentista', label: 'Comprou OB3 — Dentista Parceiro' },
]

export interface Question { field: string; label: string; options: string[] }

const val = (r: SbQualificacao, field: string): string => {
  const v = (r as unknown as Record<string, unknown>)[field]
  return v == null ? '' : String(v).trim()
}

/** Perguntas de múltipla escolha a partir dos dados reais (domínio fechado, 2..maxOptions). */
export function buildQuestions(rows: SbQualificacao[], maxOptions = 14): Question[] {
  const out: Question[] = []
  for (const { field, label } of MC_CANDIDATE_FIELDS) {
    const set = new Set<string>()
    for (const r of rows) { const v = val(r, field); if (v) set.add(v) }
    if (set.size >= 2 && set.size <= maxOptions) {
      out.push({ field, label, options: Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR')) })
    }
  }
  return out
}

/** Pontuação máxima possível = soma do maior peso de cada campo ponderado. */
export function maxScoreOf(weights: LeadScoreConfig['weights']): number {
  let max = 0
  for (const field of Object.keys(weights)) {
    const pts = Object.values(weights[field] ?? {})
    if (pts.length) max += Math.max(0, ...pts)
  }
  return max
}

/** Score 0–100 = soma dos pontos das alternativas marcadas ÷ máximo possível. */
export function scoreLead(r: SbQualificacao, cfg: LeadScoreConfig): number {
  const max = maxScoreOf(cfg.weights)
  if (max <= 0) return 0
  let sum = 0
  for (const field of Object.keys(cfg.weights)) {
    sum += cfg.weights[field]?.[val(r, field)] ?? 0
  }
  return Math.max(0, Math.min(100, Math.round((sum / max) * 100)))
}

export type Tier = 'quente' | 'morno' | 'frio'
export const TIERS: Tier[] = ['quente', 'morno', 'frio']

export function tierOf(score: number, cfg: LeadScoreConfig): Tier {
  // #6 — normaliza inversão: se o gestor gravou tierQuente < tierMorno (config inválida),
  // reordena para que o threshold maior seja sempre o de 'quente'. Configs válidas
  // (tierQuente >= tierMorno) não são afetadas.
  const efQuente = Math.max(cfg.tierQuente, cfg.tierMorno)
  const efMorno  = Math.min(cfg.tierQuente, cfg.tierMorno)
  if (score >= efQuente) return 'quente'
  if (score >= efMorno) return 'morno'
  return 'frio'
}

const isTrue = (v: unknown) => v === true || v === 'true' || v === 't'

export interface ScoredLead {
  email: string; nome: string; score: number; tier: Tier; convertido: boolean
  faturamento: string; criativo: string
}
export interface LeadSummary {
  scored: ScoredLead[]
  dist: Record<Tier, number>
  conv: Record<Tier, { total: number; convertidos: number; taxa: number }>
  alvoPositivos: number
  configurado: boolean
}

export function summarizeLeads(rows: SbQualificacao[], cfg: LeadScoreConfig): LeadSummary {
  const scored: ScoredLead[] = rows.map((r) => {
    const score = scoreLead(r, cfg)
    return {
      email: r.email ?? '', nome: r.nome ?? '',
      score, tier: tierOf(score, cfg),
      convertido: isTrue((r as unknown as Record<string, unknown>)[cfg.alvoColuna]),
      faturamento: val(r, 'faturamento_declarado'), criativo: val(r, 'criativo'),
    }
  })
  const dist: Record<Tier, number> = { quente: 0, morno: 0, frio: 0 }
  const conv: Record<Tier, { total: number; convertidos: number; taxa: number }> = {
    quente: { total: 0, convertidos: 0, taxa: 0 },
    morno: { total: 0, convertidos: 0, taxa: 0 },
    frio: { total: 0, convertidos: 0, taxa: 0 },
  }
  for (const s of scored) {
    dist[s.tier]++
    conv[s.tier].total++
    if (s.convertido) conv[s.tier].convertidos++
  }
  for (const t of TIERS) conv[t].taxa = conv[t].total > 0 ? (conv[t].convertidos / conv[t].total) * 100 : 0
  scored.sort((a, b) => b.score - a.score)
  return { scored, dist, conv, alvoPositivos: scored.filter((s) => s.convertido).length, configurado: maxScoreOf(cfg.weights) > 0 }
}
