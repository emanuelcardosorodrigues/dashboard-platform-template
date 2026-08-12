/**
 * Config dos filtros avançados da aba "Análise de Criativos" (/criativos-ia).
 * Mesma engine da aba Criativos (tableFilters/FilterBar), mas com as colunas do
 * `CriativoCard` (types/criativos).
 *
 * NORMALIZAÇÃO: os presets built-in (lib/tableFilters.builtinPresets) usam as
 * chaves do CriativoAgregado (`vendasFront`, `hookRate` em %). O CriativoCard
 * guarda `vendas` e `hook_rate`/`hold_rate`/`ctr` em FRAÇÃO (0–1). `augmentForFilter`
 * adiciona as chaves normalizadas (×100 e alias) SEM tocar nos campos originais
 * que o CriativoCard usa pra renderizar — assim presets e regras funcionam na
 * escala certa e o card continua exibindo certo.
 */
import type { FilterableColumn, AggregateSpec } from './tableFilters'
import { formatCurrency, formatPercent, formatRoas, formatCurrencyCompact } from './formatters'
import type { CriativoCard } from '@/types/criativos'

const num = (v: number) => String(v).replace('.', ',')
const cur = (v: number) => formatCurrency(v)
const pct = (v: number) => formatPercent(v)

/** Linha enriquecida pra filtrar: card + chaves normalizadas (não usadas pelo render). */
export type CardFilterRow = CriativoCard & {
  vendasFront: number
  hookRate?: number
  holdRate?: number
  ctrPct?: number
  cpc?: number
}

export function augmentForFilter(c: CriativoCard): CardFilterRow {
  return {
    ...c,
    vendasFront: c.vendas,
    hookRate: c.hook_rate == null ? undefined : c.hook_rate * 100,
    holdRate: c.hold_rate == null ? undefined : c.hold_rate * 100,
    ctrPct: c.ctr == null ? undefined : c.ctr * 100,
    cpc: c.cpc_link == null ? undefined : c.cpc_link,
  }
}

/** Colunas que o usuário pode filtrar com regras (FilterPanel). */
export const CARD_FILTER_COLUMNS: FilterableColumn[] = [
  { key: 'investimento', label: 'Gasto', kind: 'currency', format: cur },
  { key: 'roas', label: 'ROAS', kind: 'number', format: formatRoas },
  { key: 'cpa', label: 'CPA', kind: 'currency', format: cur },
  { key: 'receita', label: 'Receita', kind: 'currency', format: cur },
  { key: 'vendasFront', label: 'Vendas', kind: 'number', format: num },
  { key: 'impressoes', label: 'Impressões', kind: 'number', format: num },
  { key: 'hookRate', label: 'Hook Rate', kind: 'percent', format: pct },
  { key: 'holdRate', label: 'Hold Rate', kind: 'percent', format: pct },
  { key: 'ctrPct', label: 'CTR', kind: 'percent', format: pct },
  { key: 'cpm', label: 'CPM', kind: 'currency', format: cur },
  { key: 'cpc', label: 'CPC Link', kind: 'currency', format: cur },
]

/** Totais do rodapé (FilterFooter). */
export const CARD_AGGREGATES: AggregateSpec[] = [
  { key: 'investimento', label: 'Gasto', kind: 'sum', format: formatCurrencyCompact },
  { key: 'receita', label: 'Receita', kind: 'sum', format: formatCurrencyCompact },
  { key: 'vendasFront', label: 'Vendas', kind: 'sum', format: num },
  { key: 'impressoes', label: 'Impressões', kind: 'sum', format: num },
  { key: 'cpa', label: 'CPA médio', kind: 'ratio', numKey: 'investimento', denKey: 'vendasFront', format: cur },
  { key: 'roas', label: 'ROAS médio', kind: 'weighted_avg', weightKey: 'investimento', format: formatRoas },
]

/** Colunas exportadas no CSV. */
export const CARD_CSV_COLUMNS: { key: string; label: string }[] = [
  { key: 'ad_name', label: 'Criativo' },
  { key: 'investimento', label: 'Gasto (R$)' },
  { key: 'roas', label: 'ROAS' },
  { key: 'cpa', label: 'CPA (R$)' },
  { key: 'receita', label: 'Receita (R$)' },
  { key: 'vendasFront', label: 'Vendas' },
  { key: 'impressoes', label: 'Impressões' },
  { key: 'hookRate', label: 'Hook Rate (%)' },
  { key: 'holdRate', label: 'Hold Rate (%)' },
  { key: 'ctrPct', label: 'CTR (%)' },
  { key: 'cpm', label: 'CPM (R$)' },
  { key: 'cpc', label: 'CPC (R$)' },
  { key: 'fadiga_status', label: 'Fadiga' },
  { key: 'momento_funil', label: 'Momento funil' },
]
