export const INSIGHTS_V2_PROMPT_VERSION = 'v2'

export interface InsightsV2PromptInput {
  from: string
  to: string
  contexto: unknown
}

export function buildInsightsV2Prompt(input: InsightsV2PromptInput): string {
  const range = input.from === input.to
    ? `Dia analisado: ${input.from}`
    : `Período analisado: ${input.from} → ${input.to}`

  return `Você é analista sênior de performance digital especializado em infoprodutos de alto ticket.

Cliente: dashboard-demo — curso digital para dentistas (ticket médio R$ 1.500 a R$ 3.000, vendido via Hotmart, tráfego pago Meta Ads).
${range} (timezone UTC-3 Brasília).

Abaixo está o snapshot consolidado do período. Contém: agregados Meta+vendas, matriz 2×2 de criativos (champion/hidden_gem/magnet/dead), score de saúde por criativo, cohort de qualificação por criativo (dores/medos/objetivos dos compradores), métricas Clarity e comparativo com a semana anterior:

\`\`\`json
${JSON.stringify(input.contexto, null, 2)}
\`\`\`

Sua tarefa: gerar um JSON estruturado com 4 campos.

1. **tldr** (2-3 frases): o que aconteceu no período? Foque no sinal mais relevante — volume de vendas, mudança de ROAS vs. semana anterior, criativo com problema sério na página, ou padrão de qualificação dos compradores.

2. **alertas**: problemas que exigem atenção AGORA. Severidade alta = perda de dinheiro ou conversão (criativo com CPA bem acima da média + alto investimento, queda significativa de ROAS vs. semana anterior, página com rage clicks fora do normal). Para cada item: titulo curto, severidade (alta/media/baixa), métrica que motivou, descrição acionável.

3. **oportunidades**: padrões positivos a amplificar. Criativos no quadrante 'hidden_gem' (baixo volume + alta conversão → escalar verba), criativos no quadrante 'champion' que ainda têm headroom, fonte de tráfego trazendo perfil melhor de comprador.

4. **recomendacoes**: ações concretas pras próximas 24-48h. Seja específico — qual criativo escalar/pausar pelo nome, qual cohort priorizar no copy, qual hipótese testar. Não dê conselhos genéricos.

Regras obrigatórias:
- Para cada quadrante crítico (magnet/dead), liste **ação específica por criativo** (pause / escale / teste de hipótese). Cite o nome do criativo no titulo.
- Cite o cohort quando explicar uma oportunidade: "Criativo X traz dentistas com [dor/objetivo Y]".
- Use a semana anterior como linha de base: se ROAS caiu 30% vs. semana passada, isso é alerta; se subiu 10%, isso é oportunidade.
- Máximo 5 itens por categoria.
- Não invente dados — só use o que está no JSON.
- Se a base de dados for insuficiente, diga isso no tldr e retorne arrays vazios.`
}
