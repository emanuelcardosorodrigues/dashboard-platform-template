/**
 * Catálogo de colunas filtráveis + specs de agregação + colunas CSV
 * compartilhados entre Criativos, Campanhas e Conjuntos.
 *
 * Mantém um vocabulário único pra:
 *   • dropdown do FilterPanel
 *   • chips
 *   • presets built-in
 *   • totais do rodapé
 *   • export CSV
 */

import type { FilterableColumn, AggregateSpec } from './tableFilters'
import { formatCurrency, formatPercent, formatRoas, formatCurrencyCompact } from './formatters'

const num = (v: number) => String(v).replace('.', ',')
const cur = (v: number) => formatCurrency(v)
const pct = (v: number) => formatPercent(v)

/** Colunas que o usuário pode filtrar com regras. */
export const ADS_FILTER_COLUMNS: FilterableColumn[] = [
  // Volume / dinheiro
  { key: 'investimento',     label: 'Investimento',   kind: 'currency', format: cur },
  { key: 'faturamento',      label: 'Faturamento',    kind: 'currency', format: cur },
  { key: 'lucro',            label: 'Lucro',          kind: 'currency', format: cur },
  { key: 'lucroTotal',       label: 'Lucro Total',    kind: 'currency', format: cur },
  { key: 'ticketMedio',      label: 'Ticket Médio',   kind: 'currency', format: cur },
  { key: 'receitaMentoria',  label: 'Rec. Mentoria',  kind: 'currency', format: cur },

  // Eficiência
  { key: 'roas',             label: 'ROAS',           kind: 'number', format: formatRoas },
  { key: 'roasTotal',        label: 'ROAS Total',     kind: 'number', format: formatRoas },
  { key: 'cpa',              label: 'CPA',            kind: 'currency', format: cur },
  { key: 'cpa24h',           label: 'CPA 24h',        kind: 'currency', format: cur },
  { key: 'cpc',              label: 'CPC',            kind: 'currency', format: cur },
  { key: 'cpm',              label: 'CPM',            kind: 'currency', format: cur },

  // Funnel rates
  { key: 'ctr',                label: 'CTR',                  kind: 'percent', format: pct },
  { key: 'hookRate',           label: 'Hook Rate',            kind: 'percent', format: pct },
  { key: 'retencaoRate',       label: 'Retenção 95%',         kind: 'percent', format: pct },
  { key: 'cvrPagina',          label: 'Carregamento',         kind: 'percent', format: pct },
  { key: 'cvrCheckout',        label: 'Passagem Pág.',        kind: 'percent', format: pct },
  { key: 'conversaoCheckout',  label: 'Conv. Checkout',       kind: 'percent', format: pct },
  { key: 'convClique',         label: 'Conv. Clique',         kind: 'percent', format: pct },
  { key: 'txConversaoPagina',  label: 'Conv. Pág.',           kind: 'percent', format: pct },
  { key: 'pctQualificados',    label: '% Qualificados',       kind: 'percent', format: pct },

  // Vendas
  { key: 'vendas',         label: 'Vendas Hotmart', kind: 'number', format: num },
  { key: 'vendasFront',    label: 'Vendas Front',   kind: 'number', format: num },
  { key: 'vendasOB1',      label: 'OB1 Script',     kind: 'number', format: num },
  { key: 'vendasOB2',      label: 'OB2 Tribut.',    kind: 'number', format: num },
  { key: 'vendasOB3',      label: 'OB3 Protocolo',  kind: 'number', format: num },
  { key: 'vendasOB4',      label: 'OB4 Manual',     kind: 'number', format: num },
  { key: 'qualifCount',    label: 'Qualif. #',      kind: 'number', format: num },
  { key: 'alunosMentoria', label: 'Mentoria',       kind: 'number', format: num },

  // Tráfego cru
  { key: 'impressoes',   label: 'Impressões',    kind: 'number', format: num },
  { key: 'cliques',      label: 'Cliques',       kind: 'number', format: num },
  { key: 'landingViews', label: 'Landing views', kind: 'number', format: num },
  { key: 'checkouts',    label: 'Checkouts',     kind: 'number', format: num },
  { key: 'views3s',      label: 'Views 3s',      kind: 'number', format: num },
]

/** Totais no rodapé — somas absolutas + médias ponderadas pra taxas. */
export const ADS_AGGREGATES: AggregateSpec[] = [
  { key: 'investimento', label: 'Investimento', kind: 'sum',           format: formatCurrencyCompact },
  { key: 'faturamento',  label: 'Faturamento',  kind: 'sum',           format: formatCurrencyCompact },
  { key: 'lucro',        label: 'Lucro',        kind: 'sum',           format: formatCurrencyCompact },
  { key: 'vendasFront',  label: 'Vendas Front', kind: 'sum',           format: num },
  { key: 'cpa',          label: 'CPA médio',    kind: 'ratio',         numKey: 'investimento', denKey: 'vendasFront', format: cur },
  { key: 'roas',         label: 'ROAS médio',   kind: 'weighted_avg',  weightKey: 'investimento', format: formatRoas },
  { key: 'ctr',          label: 'CTR médio',    kind: 'weighted_avg',  weightKey: 'impressoes',   format: pct },
]

/** Colunas exportadas no CSV. */
export const ADS_CSV_COLUMNS: { key: string; label: string }[] = [
  { key: 'criativo',          label: 'Nome' },
  { key: 'campaign_name',     label: 'Campanha' },
  { key: 'adset_name',        label: 'Conjunto' },
  { key: 'tipo',              label: 'Tipo' },
  { key: 'status',            label: 'Status' },
  { key: 'investimento',      label: 'Investimento (R$)' },
  { key: 'faturamento',       label: 'Faturamento (R$)' },
  { key: 'lucro',             label: 'Lucro (R$)' },
  { key: 'roas',              label: 'ROAS' },
  { key: 'cpa',               label: 'CPA (R$)' },
  { key: 'ticketMedio',       label: 'Ticket Médio (R$)' },
  { key: 'ctr',               label: 'CTR (%)' },
  { key: 'cpm',               label: 'CPM (R$)' },
  { key: 'cpc',               label: 'CPC (R$)' },
  { key: 'hookRate',          label: 'Hook Rate (%)' },
  { key: 'retencaoRate',      label: 'Retenção 95% (%)' },
  { key: 'cvrPagina',         label: 'Carregamento (%)' },
  { key: 'cvrCheckout',       label: 'Passagem Pág. (%)' },
  { key: 'conversaoCheckout', label: 'Conv. Checkout (%)' },
  { key: 'convClique',        label: 'Conv. Clique (%)' },
  { key: 'txConversaoPagina', label: 'Conv. Pág. (%)' },
  { key: 'vendas',            label: 'Vendas Hotmart' },
  { key: 'vendasFront',       label: 'Vendas Front' },
  { key: 'vendasOB1',         label: 'OB1' },
  { key: 'vendasOB2',         label: 'OB2' },
  { key: 'vendasOB3',         label: 'OB3' },
  { key: 'vendasOB4',         label: 'OB4' },
  { key: 'pctQualificados',   label: '% Qualificados' },
  { key: 'qualifCount',       label: 'Qualif. #' },
  { key: 'alunosMentoria',    label: 'Mentoria' },
  { key: 'receitaMentoria',   label: 'Rec. Mentoria (R$)' },
  { key: 'lucroTotal',        label: 'Lucro Total (R$)' },
  { key: 'roasTotal',         label: 'ROAS Total' },
  { key: 'impressoes',        label: 'Impressões' },
  { key: 'cliques',           label: 'Cliques' },
  { key: 'landingViews',      label: 'Landing views' },
  { key: 'checkouts',         label: 'Checkouts' },
  { key: 'views3s',           label: 'Views 3s' },
  { key: 'ultimoDia',         label: 'Último Dia' },
]
