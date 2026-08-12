import { SchemaType } from '@google/generative-ai'

export const SUGESTOES_PROMPT_VERSION = 'sugestoes-v1'

export const sugestoesSchema = {
  type: SchemaType.OBJECT,
  properties: {
    sugestoes: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          tipo: {
            type: SchemaType.STRING,
            enum: ['escalar', 'pausar', 'novo_brief', 'lateralizar', 'congruencia_fix', 'vault_save'],
          },
          ad_id: { type: SchemaType.STRING, description: 'ad_id afetado (null se novo_brief sem origem específica)' },
          titulo: { type: SchemaType.STRING, description: 'Resumo de 1 linha pra UI da queue.' },
          motivo: { type: SchemaType.STRING, description: 'Por que a sugestão é proposta (citar métrica concreta).' },
          payload: {
            type: SchemaType.OBJECT,
            description: 'Detalhes acionáveis: novo orçamento sugerido, brief, etc.',
            properties: {
              budget_diff_pct: { type: SchemaType.NUMBER, description: 'Pra escalar/pausar: % de mudança no orçamento (+50, -100).' },
              brief: { type: SchemaType.STRING, description: 'Pra novo_brief/lateralizar: texto do brief sugerido.' },
              referencia_ad_id: { type: SchemaType.STRING, description: 'Pra lateralizar/novo_brief: ad que inspirou.' },
              observacao: { type: SchemaType.STRING },
            },
          },
        },
        required: ['tipo', 'titulo', 'motivo'],
      },
    },
  },
  required: ['sugestoes'],
} as const

export interface AdSummaryForSugestao {
  ad_id: string
  ad_name: string | null
  views_3seg: number
  body_rate: number | null // views_75pct / views_3seg
  cpa: number | null       // investimento / compras
  spend: number
  purchases: number
  one_belief_score: number | null
  hook_tipo: string[] | null
  angulo_copy: string[] | null
  resumo: string | null
}

export interface SugestoesPromptInput {
  workspace: { nome: string; one_belief: string | null; avatar_brief: string | null }
  cpa_alvo: number | null
  ads: AdSummaryForSugestao[]
}

export function buildSugestoesPrompt(input: SugestoesPromptInput): string {
  const { workspace, cpa_alvo, ads } = input
  return `Você é gestor sênior de tráfego pago + diretor de criação especializado em VSL/UGC.

# Cliente: ${workspace.nome}
## One Belief
${workspace.one_belief ?? '(não definido)'}
## Avatar
${workspace.avatar_brief ?? '(não definido)'}
## CPA alvo: ${cpa_alvo ?? 'não informado'}

# Snapshot do portfólio (últimos 7 dias agregado por ad)
\`\`\`json
${JSON.stringify(ads, null, 2)}
\`\`\`

# Sua tarefa
Gerar até 8 sugestões acionáveis para a cowork queue. Tipos válidos:

- **escalar**: ad com CPA < cpa_alvo E Body Rate forte (>8%) E one_belief_score ≥ 0.7. payload.budget_diff_pct = +30~+100.
- **pausar**: ad com CPA > 2× cpa_alvo OU spend > R$ 500 sem nenhuma compra. payload.budget_diff_pct = -100.
- **novo_brief**: gancho/ângulo de um ad top performer + variação. Sempre cita referencia_ad_id.
- **lateralizar**: mesmo ângulo mas formato visual diferente. Cita referencia_ad_id.
- **congruencia_fix**: ad com one_belief_score < 0.5 — reescrever pra alinhar.
- **vault_save**: padrão recorrente de hook/ângulo que vale salvar no mind-vault como aprendizado replicável.

Regras:
- NUNCA recomende escalar ad com one_belief_score < 0.7 (mesmo se CPA bom — não é o cliente certo).
- Toda sugestão tem que citar UMA métrica concreta no motivo (CPA real, Body Rate, score, etc.).
- Máximo 8 sugestões. Priorize as de maior impacto (maior spend afetado).
- Se o portfólio estiver saudável, retorne array vazio ou 1-2 vault_save.

Responda APENAS JSON conforme schema. Sem prefácio.`
}
