/**
 * Prompt Gemini pra análise contextualizada de um experimento.
 * Fase 7 do plano — combina sinais cross-source num insight acionável.
 */

export interface ExperimentHealthContext {
  experiment: {
    name: string
    type: 'page' | 'checkout' | 'ob'
    entry_path: string
    variants: Array<{ slug: string; weight: number }>
    started_at: string
    auto_optimize?: boolean
    champion_variant?: string | null
  }
  health: {
    pct_bots: number
    clarity_rage_pct: number | null
    uids_24h: number
  }
  stats: Array<{
    variant: string
    imp: number
    conv: number
    cr: number
    bayes_prob_wins?: number
  }>
  meetsMinSample: boolean
  minSampleNeeded: number
}

export function experimentHealthPrompt(ctx: ExperimentHealthContext): string {
  return `Você é o analista sênior de A/B testing da Empresa Exemplo. Analise o experimento abaixo e retorne uma recomendação acionável em português do Brasil, em no máximo 5 parágrafos curtos.

# Experimento
Nome: ${ctx.experiment.name}
Tipo: ${ctx.experiment.type}
Path: ${ctx.experiment.entry_path}
Iniciado em: ${ctx.experiment.started_at}
Bandit auto-otimizar: ${ctx.experiment.auto_optimize ? 'ON' : 'OFF'}
Variante campeã (lock): ${ctx.experiment.champion_variant ?? 'nenhuma'}

# Saúde dos dados
% de bots confirmados: ${(ctx.health.pct_bots * 100).toFixed(1)}%
% rage clicks (Clarity, 7d): ${ctx.health.clarity_rage_pct != null ? (ctx.health.clarity_rage_pct * 100).toFixed(2) + '%' : 'sem dados'}
UIDs únicos 24h: ${ctx.health.uids_24h}

# Sample size
Amostra suficiente: ${ctx.meetsMinSample ? 'SIM' : 'NÃO'}
Mínimo necessário por variante: ${ctx.minSampleNeeded}

# Performance por variante
${ctx.stats.map(s => `- ${s.variant}: ${s.imp} imp, ${s.conv} conv, CR ${(s.cr * 100).toFixed(2)}%, P(vence) ${s.bayes_prob_wins != null ? (s.bayes_prob_wins * 100).toFixed(0) + '%' : 'N/A'}`).join('\n')}

# Tarefa
Retorne em 5 parágrafos:
1. **Status atual** — em 1 linha, "saudável", "amostra insuficiente", "alta contaminação por bots", ou "decisão pronta".
2. **Diagnóstico de saúde** — % bots crítico? rage clicks altos? volume baixo? Cite NÚMEROS específicos.
3. **Variante recomendada** — se amostra OK, qual variante e por quê. Se não, "esperar X impressões".
4. **Ação concreta** — Pausar / Manter / Promover variante X / Subir orçamento / Investigar bots. Uma ação clara.
5. **Próxima checagem** — em quantos dias revisitar.

Tom: direto, técnico, sem floreio. Cite o nome da variante (não "A", "B" — use o slug real). Se houver flags vermelhos (% bots > 30% OU sample insuficiente com Bayesian alta confiança), AVISE explicitamente que decisão prematura é arriscada.`
}
