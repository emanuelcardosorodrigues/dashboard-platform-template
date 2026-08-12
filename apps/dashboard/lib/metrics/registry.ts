/**
 * METRIC_REGISTRY — fonte única de verdade das métricas das tabelas de
 * Criativos / Campanhas / Conjuntos (Fase 3).
 *
 * Aqui ficam só os METADADOS de cada métrica (id, rótulo, grupo, descrição,
 * formato, escopo, default). O COMO RENDERIZAR (células ricas: semáforo, links,
 * cores) vive em buildColumns.tsx, indexado pelo mesmo `id`. Essa separação
 * mantém este arquivo sem JSX (importável em qualquer lugar) e o registry como
 * catálogo para o seletor de colunas, presets, filtros, CSV e tooltips.
 *
 * Alinhado à nota canônica do segundo cérebro "Mapa de métricas do funil DEMO".
 */

export type MetricScope = 'criativos' | 'campanhas' | 'conjuntos' | 'funil'

export type MetricGroup =
  | 'Identificação'
  | 'Retornos'
  | 'Conversões'
  | 'Custos'
  | 'Entrega'
  | 'Vendas'
  | 'Qualificação'
  | 'VSL'
  | 'Metadados'

export type MetricFormat =
  | 'currency'
  | 'currencyCompact'
  | 'percent'
  | 'roas'
  | 'integer'
  | 'decimal'
  | 'dateBR'
  | 'text'

export interface MetricDef {
  /** Chave no objeto da linha (CriativoAgregado). */
  id: string
  /** Rótulo da coluna. Para rótulo dinâmico (ex: nome do front-end por funil) ver `labelDynamic`. */
  label: string
  /** Rótulo resolvido em runtime no buildColumns (ex: 'frontEnd' → getFrontEndLabel(funil)). */
  labelDynamic?: 'frontEnd' | 'nome'
  group: MetricGroup
  /** Formato padrão da célula (ignorado quando há renderer custom em buildColumns). */
  format?: MetricFormat
  /** Texto do tooltip de ajuda (o que é + como calcula). */
  description?: string
  align?: 'left' | 'center' | 'right'
  sortable?: boolean
  /** Visível no preset "Tudo (legado)" — reproduz a tabela atual. */
  defaultVisible?: boolean
  /** Métrica que depende de cruzamento vTurb (Tier B). */
  requiresVturb?: boolean
  /** Escopos onde a métrica existe. Ausente = todos. */
  availableOn?: MetricScope[]
}

const ALL: MetricScope[] = ['criativos', 'campanhas', 'conjuntos']

/**
 * Catálogo. A ORDEM aqui é a ordem default das colunas (preset legado do Criativos).
 * Campanhas/Conjuntos usam um subconjunto via availableOn + seu próprio default.
 */
export const METRIC_REGISTRY: MetricDef[] = [
  // ── Identificação ─────────────────────────────────────────────────────────
  { id: 'semaforo', label: 'Status', group: 'Identificação', align: 'center', sortable: false, defaultVisible: true, availableOn: ALL, description: 'Verde = ROAS ≥ 1.5 · Amarelo = ROAS ≥ 1.0 · Vermelho = ROAS < 1.0' },
  { id: 'criativo', label: 'Criativo', labelDynamic: 'nome', group: 'Identificação', align: 'left', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Nome do criativo / campanha / conjunto' },

  // ── Custos / dinheiro investido ─────────────────────────────────────────────
  { id: 'investimento', label: 'Investimento', group: 'Custos', format: 'currencyCompact', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Total investido no período' },
  // ── Retornos ────────────────────────────────────────────────────────────────
  { id: 'faturamento', label: 'Faturamento', group: 'Retornos', format: 'currencyCompact', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Receita bruta total (front + OBs + upsell + downsell) atribuída no período' },
  { id: 'lucro', label: 'Lucro', group: 'Retornos', format: 'currencyCompact', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Faturamento − Investimento' },
  { id: 'roas', label: 'ROAS Bruto', group: 'Retornos', format: 'roas', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Faturamento bruto ÷ Investimento (mesmo numerador do Meta)' },
  { id: 'roasLiquido', label: 'ROAS Líq.', group: 'Retornos', format: 'roas', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Receita líquida Hotmart (bruto − taxas) ÷ Investimento' },
  { id: 'cpa', label: 'CPA', group: 'Custos', format: 'currency', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Custo por Aquisição (investimento ÷ vendas front)' },
  { id: 'cpa24h', label: 'CPA 24h', group: 'Custos', format: 'currency', align: 'right', sortable: true, defaultVisible: true, availableOn: ['criativos'], description: 'CPA no último dia ativo — investimento do dia ÷ vendas front do dia' },
  { id: 'ticketMedio', label: 'TM', group: 'Retornos', format: 'currency', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Ticket médio (faturamento ÷ vendas front)' },

  // ── Entrega ───────────────────────────────────────────────────────────────
  { id: 'ctr', label: 'CTR', group: 'Entrega', format: 'percent', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Click-Through Rate: cliques ÷ impressões' },
  { id: 'cpm', label: 'CPM', group: 'Custos', format: 'currency', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Custo por mil impressões' },
  { id: 'cpc', label: 'CPC', group: 'Custos', format: 'currency', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Custo por clique no link' },
  { id: 'hookRate', label: 'Hook Rate', group: 'Entrega', format: 'percent', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Views 3s ÷ Impressões — quanto do público foi fisgado' },
  { id: 'retencaoRate', label: 'Retenção 95%', group: 'Entrega', format: 'percent', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Views 95% ÷ Views 3s — quem assistiu quase tudo' },
  // Volume de comentários (actions:comment do Meta), NÃO sentimento — comentário negativo
  // conta igual. Pra ler o teor, use a extração de comentários (tem sentimento/objeção).
  { id: 'comentarios', label: 'Comentários', group: 'Entrega', format: 'integer', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Comentários no anúncio no período (actions:comment do Meta). Mede ENGAJAMENTO, não sentimento — um comentário negativo conta igual a um elogio.' },

  // ── Conversões / passagens ───────────────────────────────────────────────────
  { id: 'cvrPagina', label: 'Carregamento', group: 'Conversões', format: 'percent', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Landing views ÷ Cliques no link (connect rate)' },
  { id: 'cvrCheckout', label: 'Passagem Pág.', group: 'Conversões', format: 'percent', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Checkouts iniciados ÷ Landing views' },
  { id: 'conversaoCheckout', label: 'Conv. Checkout', group: 'Conversões', format: 'percent', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Vendas front ÷ Checkouts iniciados' },
  { id: 'convClique', label: 'Conv. Clique', group: 'Conversões', format: 'percent', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Vendas front ÷ Cliques no link — eficiência total do clique à compra' },
  { id: 'txConversaoPagina', label: 'Conv. Pág.', group: 'Conversões', format: 'percent', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Vendas front ÷ Landing views' },

  // ── Vendas ──────────────────────────────────────────────────────────────────
  { id: 'vendas', label: 'Vendas Hotmart', group: 'Vendas', format: 'integer', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Total de transações (front + OBs + upsell + downsell)' },
  { id: 'vendasFront', label: 'Vendas Front', labelDynamic: 'frontEnd', group: 'Vendas', format: 'integer', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Vendas do produto principal (front-end)' },
  { id: 'vendasOB1', label: 'OB1 Script', group: 'Vendas', format: 'integer', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Vendas do Order Bump 1 (Script Anti-Desconto)' },
  { id: 'vendasOB2', label: 'OB2 Tribut.', group: 'Vendas', format: 'integer', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Vendas do Order Bump 2 (Tributário)' },
  { id: 'vendasOB3', label: 'OB3 Protocolo', group: 'Vendas', format: 'integer', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Vendas do Order Bump 3 (Protocolo Dentista Parceiro)' },
  { id: 'vendasOB4', label: 'OB4 Manual', group: 'Vendas', format: 'integer', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Vendas do Order Bump 4 (Manual Lucro Oculto)' },
  { id: 'vendasUpsell', label: 'Upsell', group: 'Vendas', format: 'integer', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Vendas do upsell Implementação Lucro Oculto (atribuído por email)' },
  { id: 'vendasDownsell', label: 'Downsell', group: 'Vendas', format: 'integer', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Vendas do downsell Implementação Express Lucro Oculto (atribuído por email)' },
  { id: 'taxaUpsell', label: 'Conv. Upsell', group: 'Conversões', format: 'percent', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Vendas upsell ÷ vendas front' },
  { id: 'taxaDownsell', label: 'Conv. Downsell', group: 'Conversões', format: 'percent', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Vendas downsell ÷ (vendas front − vendas upsell)' },

  // ── Qualificação ─────────────────────────────────────────────────────────────
  { id: 'pctQualificados', label: '% Qualif.', group: 'Qualificação', format: 'percent', align: 'right', sortable: true, defaultVisible: true, availableOn: ['criativos'], description: 'Compradores Qualificados ÷ Vendas front (all-time, por email único)' },
  { id: 'alunosMentoria', label: 'Mentoria', group: 'Qualificação', format: 'integer', align: 'right', sortable: true, defaultVisible: true, availableOn: ['criativos'], description: 'Alunos do Programa de Aceleração que compraram via este criativo' },
  { id: 'receitaMentoria', label: 'Rec. Mentoria', group: 'Qualificação', format: 'currency', align: 'right', sortable: true, defaultVisible: true, availableOn: ['criativos'], description: 'Receita estimada da mentoria (alunos × preço configurado)' },
  { id: 'qualifCount', label: 'Qualif. #', group: 'Qualificação', format: 'integer', align: 'right', sortable: true, defaultVisible: true, availableOn: ['criativos'], description: 'Nº de compradores front com ficha de matrícula preenchida' },
  { id: 'lucroTotal', label: 'Lucro Total', group: 'Retornos', format: 'currencyCompact', align: 'right', sortable: true, defaultVisible: true, availableOn: ['criativos'], description: 'Lucro + receita estimada do Programa de Aceleração' },
  { id: 'roasTotal', label: 'ROAS Total', group: 'Retornos', format: 'roas', align: 'right', sortable: true, defaultVisible: true, availableOn: ['criativos'], description: 'ROAS incluindo receita do Programa de Aceleração' },

  // ── Metadados ─────────────────────────────────────────────────────────────────
  { id: 'ultimoDia', label: 'Último Dia', group: 'Metadados', format: 'dateBR', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Último dia com dados de anúncio registrados no Meta Ads' },

  // ── Tier A (Fase 3.4) — disponíveis via seletor de colunas; fora do preset legado ──
  { id: 'roasGeral', label: 'ROAS Geral', group: 'Retornos', format: 'roas', align: 'right', sortable: true, availableOn: ['criativos'], description: 'Receita ALL-TIME dos compradores deste criativo (1º toque; fallback last-touch) ÷ investimento do período. Cobertura ~55% por 1º toque — leia como tendência.' },
  { id: 'roasComUpsell', label: 'ROAS c/ Upsell', group: 'Retornos', format: 'roas', align: 'right', sortable: true, availableOn: ALL, description: 'Front + Order Bumps + Upsell ÷ investimento (no período)' },
  { id: 'roasSoFront', label: 'ROAS só Front', group: 'Retornos', format: 'roas', align: 'right', sortable: true, availableOn: ALL, description: 'Receita só do produto principal (front) ÷ investimento' },
  { id: 'roas1oCheckout', label: 'ROAS 1º Checkout', group: 'Retornos', format: 'roas', align: 'right', sortable: true, availableOn: ALL, description: 'Front + Order Bumps (primeira compra) ÷ investimento' },
  { id: 'faturamentoFront', label: 'Fat. Front', group: 'Retornos', format: 'currencyCompact', align: 'right', sortable: true, availableOn: ALL, description: 'Receita só do produto principal (front) no período' },
  { id: 'faturamentoOB', label: 'Fat. OB', group: 'Retornos', format: 'currencyCompact', align: 'right', sortable: true, availableOn: ALL, description: 'Receita dos order bumps (OB1..OB4) no período' },
  { id: 'rpc', label: 'RPC', group: 'Retornos', format: 'currency', align: 'right', sortable: true, availableOn: ALL, description: 'Receita por clique no link (faturamento ÷ cliques)' },
  { id: 'lpc', label: 'LPC', group: 'Retornos', format: 'currency', align: 'right', sortable: true, availableOn: ALL, description: 'Lucro por clique no link (lucro ÷ cliques)' },
  { id: 'cpaUpsell', label: 'CPA Upsell', group: 'Custos', format: 'currency', align: 'right', sortable: true, availableOn: ALL, description: 'Investimento ÷ vendas de upsell' },
  { id: 'custoPorCheckout', label: 'Custo/Checkout', group: 'Custos', format: 'currency', align: 'right', sortable: true, availableOn: ALL, description: 'Investimento ÷ checkouts iniciados' },
  // Estava no catálogo mas SEM defaultVisible — existia e ninguém via. Agora sai na tabela.
  { id: 'convCorpo', label: 'Conv. Body', group: 'Conversões', format: 'percent', align: 'right', sortable: true, defaultVisible: true, availableOn: ALL, description: 'Vendas front ÷ visualizações de 75% do vídeo. De quem assistiu até o fim, quantos compraram — isola a força do MIOLO do criativo (o gancho já é medido pelo Hook Rate). Criativo de imagem não tem: mostra "—".' },
  { id: 'views75', label: 'Views 75%', group: 'Entrega', format: 'integer', align: 'right', sortable: true, availableOn: ALL, description: 'Visualizações de 75% do vídeo do anúncio (Meta)' },
  { id: 'impressoes', label: 'Impressões', group: 'Entrega', format: 'integer', align: 'right', sortable: true, availableOn: ALL, description: 'Impressões (Meta)' },
  { id: 'frequencia', label: 'Frequência', group: 'Entrega', format: 'decimal', align: 'right', sortable: true, availableOn: ALL, description: 'Impressões ÷ alcance — média de vezes que cada pessoa viu o anúncio' },
  // ── Métricas cruas do Meta (Fase: colunas Meta) — disponíveis pra adicionar. ──
  { id: 'alcance', label: 'Alcance', group: 'Entrega', format: 'integer', align: 'right', sortable: true, availableOn: ALL, description: 'Pessoas únicas alcançadas (Meta)' },
  { id: 'cliques', label: 'Cliques no Link', group: 'Entrega', format: 'integer', align: 'right', sortable: true, availableOn: ALL, description: 'Cliques no link do anúncio (Meta)' },
  { id: 'landingViews', label: 'Views da Página', group: 'Entrega', format: 'integer', align: 'right', sortable: true, availableOn: ALL, description: 'Visualizações da página de destino / landing (Meta)' },
  { id: 'checkouts', label: 'Checkouts Iniciados', group: 'Conversões', format: 'integer', align: 'right', sortable: true, availableOn: ALL, description: 'Checkouts iniciados (Meta)' },
  { id: 'views3s', label: 'Views 3s', group: 'Entrega', format: 'integer', align: 'right', sortable: true, availableOn: ALL, description: 'Visualizações de 3s do vídeo do anúncio (Meta)' },
  { id: 'views95', label: 'Views 95%', group: 'Entrega', format: 'integer', align: 'right', sortable: true, availableOn: ALL, description: 'Visualizações de 95% do vídeo do anúncio (Meta)' },

  // ── Tier B (Fase 4) — vTurb por criativo. requiresVturb → n/d quando sem match. ──
  { id: 'vslViews', label: 'VSL Views', group: 'VSL', format: 'integer', align: 'right', sortable: true, requiresVturb: true, defaultVisible: true, availableOn: ['criativos'], description: 'Visualizações da VSL (vTurb) atribuídas ao criativo via utm_id/utm_content' },
  { id: 'rpv', label: 'RPV', group: 'VSL', format: 'currency', align: 'right', sortable: true, requiresVturb: true, availableOn: ['criativos'], description: 'Receita por view da VSL (faturamento ÷ views da VSL)' },
  { id: 'lpv', label: 'LPV', group: 'VSL', format: 'currency', align: 'right', sortable: true, requiresVturb: true, availableOn: ['criativos'], description: 'Lucro por view da VSL (lucro ÷ views da VSL)' },
  { id: 'pctPlayRate', label: '% Play Rate', group: 'VSL', format: 'percent', align: 'right', sortable: true, requiresVturb: true, availableOn: ['criativos'], description: 'Plays ÷ views da VSL' },
  { id: 'pctEngajamento', label: '% Engajamento', group: 'VSL', format: 'percent', align: 'right', sortable: true, requiresVturb: true, availableOn: ['criativos'], description: 'Assistiram até o fim ÷ plays da VSL' },
  { id: 'pctConvPlay', label: '% Conv. Play', group: 'VSL', format: 'percent', align: 'right', sortable: true, requiresVturb: true, availableOn: ['criativos'], description: 'Compras ÷ plays da VSL' },
  { id: 'pctVslClicou', label: '% Clicou (VSL)', group: 'VSL', format: 'percent', align: 'right', sortable: true, requiresVturb: true, availableOn: ['criativos'], description: 'Cliques no botão ÷ plays da VSL' },
  { id: 'custoPlay', label: 'Custo/Play', group: 'VSL', format: 'currency', align: 'right', sortable: true, requiresVturb: true, availableOn: ['criativos'], description: 'Investimento ÷ plays da VSL' },
  // ── Pitch (vTurb over_pitch — quem chegou ao momento da oferta no vídeo) ──
  { id: 'pctRetencaoPitch', label: '% Retenção até Pitch', group: 'VSL', format: 'percent', align: 'right', sortable: true, requiresVturb: true, defaultVisible: true, availableOn: ['criativos'], description: 'Chegaram ao pitch ÷ plays — quanto da audiência aguenta o vídeo até a oferta' },
  { id: 'pctConvPitch', label: '% Conv. Pitch', group: 'VSL', format: 'percent', align: 'right', sortable: true, requiresVturb: true, defaultVisible: true, availableOn: ['criativos'], description: 'Compras ÷ quem chegou ao pitch — poder de fechamento da oferta' },
  { id: 'pctPitchClique', label: '% Pitch→Clique', group: 'VSL', format: 'percent', align: 'right', sortable: true, requiresVturb: true, availableOn: ['criativos'], description: 'Cliques no botão ÷ quem chegou ao pitch' },
  { id: 'custoPorPitch', label: 'Custo/Pitch', group: 'VSL', format: 'currency', align: 'right', sortable: true, requiresVturb: true, availableOn: ['criativos'], description: 'Investimento ÷ quem chegou ao pitch' },
  { id: 'pctRetencao1Min', label: '% Retenção 1º min', group: 'VSL', format: 'percent', align: 'right', sortable: true, requiresVturb: true, availableOn: ['criativos'], description: 'Alcançaram 60s do vídeo ÷ plays (retenção do 1º minuto da VSL)' },
  { id: 'custoPor1Min', label: 'Custo/1º min', group: 'VSL', format: 'currency', align: 'right', sortable: true, requiresVturb: true, availableOn: ['criativos'], description: 'Investimento ÷ quem alcançou 60s do vídeo' },

  // ── Fase 8 — status real do Meta (sincronizado) ──
  { id: 'statusMeta', label: 'Status Meta', group: 'Identificação', align: 'center', sortable: true, availableOn: ['criativos'], description: 'Status real de entrega no Meta (Ativo/Pausado), da API. "—" se ainda não sincronizado.' },
]

export const METRIC_BY_ID: Record<string, MetricDef> = Object.fromEntries(
  METRIC_REGISTRY.map((m) => [m.id, m]),
)

/** IDs visíveis por padrão (preset "Tudo (legado)"), na ordem do registry, filtrados por escopo. */
export function defaultVisibleIds(scope: MetricScope): string[] {
  return METRIC_REGISTRY
    .filter((m) => m.defaultVisible && (!m.availableOn || m.availableOn.includes(scope)))
    .map((m) => m.id)
}

/** Métricas disponíveis num escopo (para o seletor de colunas). */
export function metricsForScope(scope: MetricScope): MetricDef[] {
  return METRIC_REGISTRY.filter((m) => !m.availableOn || m.availableOn.includes(scope))
}
