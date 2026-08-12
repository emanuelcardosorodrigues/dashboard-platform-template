export const INSIGHTS_PROMPT_VERSION = 'v1'

export interface InsightPromptInput {
  data: string
  contexto: unknown
}

export function buildInsightsPrompt(input: InsightPromptInput): string {
  return `Você é analista sênior de performance digital especializado em infoprodutos de alto ticket.

Cliente: dashboard-demo — curso digital para dentistas (ticket médio R$ 1.500 a R$ 3.000, vendido via Hotmart, tráfego pago Meta Ads).
Dia analisado: ${input.data} (timezone UTC-3 Brasília).

Abaixo está o snapshot consolidado do dia (métricas Clarity sobre comportamento real do usuário + Meta Ads + vendas + qualificação dos leads):

\`\`\`json
${JSON.stringify(input.contexto, null, 2)}
\`\`\`

Sua tarefa: gerar um JSON estruturado com 4 campos.

1. **tldr** (2-3 frases): o que aconteceu hoje? Foque no sinal mais relevante — vendas, frustração na página, ROAS, qualificação. Direto ao ponto.

2. **alertas**: problemas que exigem atenção AGORA. Severidade alta = perda de dinheiro ou conversão em andamento (criativo com CPA disparando, página com rage clicks acima do normal, queda brusca em scroll depth). Para cada item: titulo curto, severidade (alta/media/baixa), métrica que motivou, descrição acionável.

3. **oportunidades**: padrões positivos a amplificar. Criativo com CPA muito abaixo da média, página com baixa frustração e alto engajamento, fonte de tráfego com alta qualificação. Para cada item: titulo, métrica, descrição.

4. **recomendacoes**: ações concretas pras próximas 24-48h. Seja específico — qual criativo escalar/pausar, qual página revisar, qual hipótese testar. Para cada item: titulo, descrição.

Regras:
- Máximo 4 itens por categoria.
- Não invente dados — só use o que está no JSON.
- Se a base de dados for insuficiente (ex: dia sem tráfego), diga isso no tldr e retorne arrays vazios.
- Seja específico com números: "CPA do criativo X subiu 40% para R$ 78" beats "CPA está alto".`
}
