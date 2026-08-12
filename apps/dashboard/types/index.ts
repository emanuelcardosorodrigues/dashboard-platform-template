// ─── KPI & Metrics ────────────────────────────────────────────────────────────

export interface KpiData {
  label: string
  value: number
  formatted: string
  delta?: number // percentage change vs previous period
  deltaFormatted?: string
  metricKey?: string // for semaphore
}

// ─── Daily Financial Data ─────────────────────────────────────────────────────

export interface DailyFinancial {
  date: string
  investimento: number
  faturamento: number
  lucro: number
  roas: number
  vendas: number
  ticketMedio: number
  // accumulated
  faturamentoAcumulado?: number
  investimentoAcumulado?: number
  lucroAcumulado?: number
}

// ─── Transações Hotmart ───────────────────────────────────────────────────────

export interface Transacao {
  data: string
  produto: string
  email: string
  nome: string
  valor: number
  status: string
  formaPagamento: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  cupom?: string
  parcelas?: number
  tipoOferta?: string // front/ob1/ob2/ob3
}

// ─── Métricas de Campanha / Criativos ─────────────────────────────────────────

export interface MetricaCampanha {
  data: string
  criativo: string
  tipo?: string // video/imagem
  investimento: number
  impressoes: number
  cliques: number
  views3s?: number
  views95?: number
  alcance?: number
  frequencia?: number
  ctr: number
  cpc: number
  cpm: number
  faturamento: number
  lucro: number
  roas: number
  cpa: number
  vendas: number
  hookRate?: number
  retencaoRate?: number
  cvrPagina?: number
  cvrCheckout?: number
  status?: string // ativo/pausado
}

// ─── Criativo Agregado ─────────────────────────────────────────────────────────

export interface CriativoAgregado {
  criativo: string
  tipo?: string
  investimento: number
  faturamento: number
  lucro: number
  roas: number                // BRUTO: faturamento / investimento (casa com Meta)
  roasLiquido?: number        // LÍQUIDO: receita líquida Hotmart (bruto − taxas) / investimento
  cpa: number
  ctr: number
  cpm: number
  cpc: number
  hookRate: number
  retencaoRate: number
  cvrPagina: number
  cvrCheckout: number
  conversaoCheckout: number
  txConversaoPagina: number
  vendas: number
  vendasFront?: number
  vendasOB1?: number
  vendasOB2?: number
  vendasOB3?: number
  vendasOB4?: number
  vendasUpsell?: number
  vendasDownsell?: number
  faturamentoUpsell?: number
  faturamentoDownsell?: number
  taxaUpsell?: number     // vendasUpsell / vendasFront * 100
  taxaDownsell?: number   // vendasDownsell / max(vendasFront - vendasUpsell, 0) * 100
  ticketMedio?: number    // combinado: faturamento total / vendasFront
  pctQualificados?: number
  semaforo?: 'green' | 'yellow' | 'red'
  status?: string
  link?: string
  alunosMentoria?: number
  impressoes?: number
  frequencia?: number
  alcance?: number
  views3s?: number
  views95?: number
  cliques?: number
  landingViews?: number
  checkouts?: number
  campaign_name?: string
  adset_name?: string
  convClique?: number
  ultimoDia?: string
  cpa24h?: number
  receitaMentoria?: number
  qualifCount?: number
  lucroTotal?: number
  roasTotal?: number
  // ── Métricas Tier A (Fase 3.4) — opcionais, surgem via seletor de colunas ──
  faturamentoFront?: number   // receita só do produto principal (front) no período
  faturamentoOB?: number      // receita dos order bumps (OB1..OB4) no período
  roasSoFront?: number        // faturamentoFront / investimento
  roas1oCheckout?: number     // (faturamentoFront + faturamentoOB) / investimento
  roasComUpsell?: number      // (front + OB + upsell) / investimento
  roasGeral?: number          // receita all-time do comprador (1º toque, fallback last-touch) / investimento
  rpc?: number                // receita por clique no link (faturamento / cliques)
  lpc?: number                // lucro por clique no link (lucro / cliques)
  cpaUpsell?: number          // investimento / vendasUpsell
  custoPorCheckout?: number   // investimento / checkouts
  convCorpo?: number          // vendasFront / views75 * 100 (conversão do corpo do criativo)
  comentarios?: number        // actions:comment do Meta — engajamento, não sentimento
  views75?: number            // views 75% do vídeo do anúncio (meta_ads.views_75pct)
  // ── Tier B (Fase 4) — cruzamento vTurb por criativo. undefined = sem match vTurb (n/d) ──
  vslViews?: number           // total_viewed da VSL (vTurb) atribuído ao criativo
  rpv?: number                // receita por view (faturamento / vslViews)
  lpv?: number                // lucro por view (lucro / vslViews)
  pctPlayRate?: number        // started / viewed * 100
  pctEngajamento?: number     // finished / started * 100
  pctConvPlay?: number        // conversions / started * 100
  pctVslClicou?: number       // clicked / started * 100 (clique no botão da VSL)
  custoPlay?: number          // investimento / started
  // ── Pitch (vTurb over_pitch — destravado ao capturar over/under pitch no sync) ──
  pctRetencaoPitch?: number   // over_pitch / started * 100 (chegou ao pitch)
  pctConvPitch?: number       // conversions / over_pitch * 100
  pctPitchClique?: number     // clicked / over_pitch * 100
  custoPorPitch?: number      // investimento / over_pitch
  pctRetencao1Min?: number    // alcançaram 60s / started * 100
  custoPor1Min?: number       // investimento / alcançaram 60s
  // ── Fase 8 — controle Meta (status real + dados pra pausar/escalar) ──
  statusMeta?: string                  // effective_status real do Meta (ACTIVE/PAUSED/...)
  adId?: string
  adsetId?: string
  campaignId?: string
  dailyBudgetCents?: number            // orçamento do conjunto (ABO)
  campaignDailyBudgetCents?: number    // orçamento da campanha (CBO)
}

// ─── Qualificação Compradores ──────────────────────────────────────────────────

export type Qualificacao = 'Qualificado' | 'Semi-qualificado' | 'Lead' | 'Sem ficha'

export interface CompradoresQualificado {
  nome: string
  email: string
  criativo: string
  qualificacao: Qualificacao
  whatsapp?: string
  instagram?: string
  sexo?: string
  faixaEtaria?: string
  faturamentoDeclarado?: string
  quantoSobra?: string
  tempoOdontologia?: string
  especialidade?: string
  tipoPessoa?: string // CPF/CNPJ
  motivoCompra?: string
  maiorDificuldade?: string
  medos?: string
  objetivos?: string
  valorSonho?: string
  tentouAntes?: string
  porqueNaoFuncionou?: string
  formado?: string
  resultadosDesejados?: string
  alunoMentoria?: boolean
  transacaoId?: string
}

// ─── Canal Último Toque ────────────────────────────────────────────────────────

export interface CanalUltimoToque {
  canal: string
  vendas: number
  faturamento: number
  pctTotal: number
  ticketMedio: number
  pctQualificados?: number
}

// ─── Primeiro Impacto ─────────────────────────────────────────────────────────

export interface PrimeiroImpacto {
  canal: string
  vendas: number
  faturamento: number
  pctTotal: number
}

// ─── Mentoria Alunos ──────────────────────────────────────────────────────────

export interface AlunoMentoria {
  nome: string
  email: string
  whatsapp?: string
  instagram?: string
  criativo: string
  qualificacao: string
  faturamentoDeclarado?: string
  especialidade?: string
}

// ─── Totais / KPIs Globais ─────────────────────────────────────────────────────

export interface Totais {
  faturamentoTotal: number
  investimentoTotal: number
  lucroBruto: number
  roas: number
  cpa: number
  compradores: number
  ticketMedio: number
  vendas: number
  // Semaphore metrics
  roasLiquido?: number
  ctr?: number
  cpc?: number
  cpm?: number
  taxaGancho?: number
  taxaRetencao?: number
  cvrCheckout?: number
  cvrPagina?: number
  taxaCarregamento?: number
  taxaPassagemCheckout?: number
  takeRateOB?: number
  frequencia?: number
}

// ─── Funil ────────────────────────────────────────────────────────────────────

export interface FunilEtapa {
  nome: string
  valor: number
  pctAnterior?: number
  thresholdVerde?: number // benchmark verde para essa taxa (ex: CTR=1.5, checkout=40)
  receita?: number        // R$ associado à etapa (faturamento) — Fase 5; undefined = sem R$
}

// ─── Vendas por Produto por Dia ───────────────────────────────────────────────

export interface VendasPorProdutoDia {
  date: string
  frontEnd: number
  ob1: number
  ob2: number
  ob3: number
  ob4: number
  upsell: number
  downsell: number
}

// ─── Semáforo ─────────────────────────────────────────────────────────────────

export type SemaforoColor = 'green' | 'yellow' | 'red'

export interface SemaforoItem {
  metricKey: string
  label: string
  value: number
  formatted: string
  color: SemaforoColor
  icon?: string
}

// ─── Date Range Filter ────────────────────────────────────────────────────────

export interface DateRange {
  from: string // YYYY-MM-DD
  to: string   // YYYY-MM-DD
}

// ─── Tabela Data ──────────────────────────────────────────────────────────────

export interface TableColumn<T> {
  key: keyof T
  label: string
  sortable?: boolean
  render?: (value: T[keyof T], row: T) => React.ReactNode
  align?: 'left' | 'center' | 'right'
}

// ─── Pagamento ────────────────────────────────────────────────────────────────

export interface PagamentoBreakdown {
  tipo: string // Pix, Cartão
  vendas: number
  faturamento: number
  pct: number
  parcelado?: number
  aVista?: number
}

// ─── Cupom ────────────────────────────────────────────────────────────────────

export interface CupomData {
  cupom: string
  vendas: number
  pctTotal: number
  ticketMedio: number
}

// ─── Distribuição ─────────────────────────────────────────────────────────────

export interface DistribuicaoItem {
  label: string
  count: number
  pct: number
}
