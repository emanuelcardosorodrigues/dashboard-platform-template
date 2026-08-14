import { describe, expect, it } from 'vitest'
import {
  buildCreativePerformanceHistory,
  performanceMetricValue,
  type PerformanceHistoryMetric,
  type PerformanceMetaRow,
  type PerformanceTransactionRow,
} from './creativePerformanceHistory'

function meta(overrides: Partial<PerformanceMetaRow>): PerformanceMetaRow {
  return {
    data: '2026-08-01', ad_id: 'ad-a', criativo: 'Criativo A',
    impressoes: 0, cliques_link: 0, views_3seg: 0, views_75pct: 0, views_95pct: 0, investimento: 0,
    ...overrides,
  }
}

function trans(overrides: Partial<PerformanceTransactionRow>): PerformanceTransactionRow {
  return {
    data: '2026-08-01', ad_id: 'ad-a', criativo: 'Criativo A', produto: 'Produto Demonstrativo', produto_id: null,
    ...overrides,
  }
}

function graph(history: ReturnType<typeof buildCreativePerformanceHistory>, metric: PerformanceHistoryMetric) {
  return history.metrics[metric]
}

function options(top: number) {
  return { topByMetric: { hook_rate: top, conv_body: top, cpc_link: top, hold_rate: top } }
}

describe('buildCreativePerformanceHistory', () => {
  it('calcula cada série diária com as fórmulas dos cards e preserva null sem denominador', () => {
    const history = buildCreativePerformanceHistory(
      [
        meta({ data: '2026-08-01', impressoes: 100, views_3seg: 50, views_75pct: 40, cliques_link: 10, investimento: 20 }),
        // views75 abaixo do piso: Conv. Body é imensurável neste DIA, embora o
        // agregado do período tenha amostra suficiente.
        meta({ data: '2026-08-02', impressoes: 50, views_3seg: 20, views_75pct: 20, cliques_link: 0, investimento: 5 }),
      ],
      [
        // ad_id vence nome divergente, exatamente como aggregateCreatives.
        trans({ data: '2026-08-01', criativo: 'Nome antigo' }),
        // Sem ad_id, o fallback pelo nome do criativo funciona.
        trans({ data: '2026-08-02', ad_id: null, criativo: 'Criativo A' }),
      ],
      { ...options(10), days: ['2026-08-01', '2026-08-02', '2026-08-03'] },
    )

    expect(graph(history, 'hook_rate').series[0].points).toEqual([
      { date: '2026-08-01', value: 0.5 },
      { date: '2026-08-02', value: 0.4 },
      { date: '2026-08-03', value: null },
    ])
    expect(graph(history, 'cpc_link').series[0].points).toEqual([
      { date: '2026-08-01', value: 2 },
      { date: '2026-08-02', value: null },
      { date: '2026-08-03', value: null },
    ])
    expect(graph(history, 'conv_body').series[0].points).toEqual([
      { date: '2026-08-01', value: 1 / 40 },
      { date: '2026-08-02', value: null },
      { date: '2026-08-03', value: null },
    ])
  })

  it('mantém o fallback views95 do Hold Rate usado pelos cards', () => {
    const history = buildCreativePerformanceHistory(
      [meta({ impressoes: 100, views_75pct: 0, views_95pct: 25 })], [],
      { ...options(1), days: ['2026-08-01'] },
    )
    expect(graph(history, 'hold_rate').series[0].points[0].value).toBe(0.25)
  })

  it('ranqueia Top X de forma independente por métrica e CPC em ordem crescente', () => {
    const history = buildCreativePerformanceHistory(
      [
        meta({ ad_id: 'a', criativo: 'A', impressoes: 100, views_3seg: 90, views_75pct: 80, cliques_link: 10, investimento: 100 }),
        meta({ ad_id: 'b', criativo: 'B', impressoes: 100, views_3seg: 80, views_75pct: 90, cliques_link: 100, investimento: 100 }),
      ],
      [
        trans({ ad_id: 'a', criativo: 'A' }), trans({ ad_id: 'a', criativo: 'A' }),
        trans({ ad_id: 'b', criativo: 'B' }), trans({ ad_id: 'b', criativo: 'B' }), trans({ ad_id: 'b', criativo: 'B' }),
      ],
      { ...options(1), days: ['2026-08-01'] },
    )

    expect(graph(history, 'hook_rate').series.map((s) => s.name)).toEqual(['A'])
    expect(graph(history, 'conv_body').series.map((s) => s.name)).toEqual(['B'])
    expect(graph(history, 'cpc_link').series.map((s) => s.name)).toEqual(['B'])
    expect(graph(history, 'hold_rate').series.map((s) => s.name)).toEqual(['B'])
  })

  it('aceita limites Top X diferentes para cada métrica', () => {
    const history = buildCreativePerformanceHistory(
      [
        meta({ ad_id: 'a', criativo: 'A', impressoes: 100, views_3seg: 90, views_75pct: 80, cliques_link: 10, investimento: 100 }),
        meta({ ad_id: 'b', criativo: 'B', impressoes: 100, views_3seg: 80, views_75pct: 90, cliques_link: 100, investimento: 100 }),
      ],
      [
        trans({ ad_id: 'a', criativo: 'A' }), trans({ ad_id: 'a', criativo: 'A' }),
        trans({ ad_id: 'b', criativo: 'B' }), trans({ ad_id: 'b', criativo: 'B' }), trans({ ad_id: 'b', criativo: 'B' }),
      ],
      {
        days: ['2026-08-01'],
        topByMetric: { hook_rate: 1, conv_body: 1, cpc_link: 2, hold_rate: 1 },
      },
    )
    expect(graph(history, 'hook_rate').series).toHaveLength(1)
    expect(graph(history, 'cpc_link').series.map((s) => s.name)).toEqual(['B', 'A'])
  })

  it('ranqueia taxas pela razão das somas, não pela média das taxas diárias', () => {
    const history = buildCreativePerformanceHistory(
      [
        meta({ data: '2026-08-01', criativo: 'A', impressoes: 10, views_3seg: 10 }),
        meta({ data: '2026-08-02', criativo: 'A', impressoes: 90, views_3seg: 0 }),
        meta({ data: '2026-08-01', ad_id: 'b', criativo: 'B', impressoes: 10, views_3seg: 2 }),
      ], [],
      { ...options(1), days: ['2026-08-01', '2026-08-02'] },
    )
    // A: 10/100 = 10%; B: 2/10 = 20%. Média simples dos dias de A daria 50% e estaria errada.
    expect(graph(history, 'hook_rate').series.map((s) => s.name)).toEqual(['B'])
  })

  it('desempata pela maior base e, por fim, pelo nome', () => {
    const history = buildCreativePerformanceHistory(
      [
        meta({ ad_id: 'a', criativo: 'Zulu', impressoes: 10, views_3seg: 5 }),
        meta({ ad_id: 'b', criativo: 'Beta', impressoes: 100, views_3seg: 50 }),
        meta({ ad_id: 'c', criativo: 'Alfa', impressoes: 100, views_3seg: 50 }),
      ], [],
      { ...options(3), days: ['2026-08-01'] },
    )
    expect(graph(history, 'hook_rate').series.map((s) => s.name)).toEqual(['Alfa', 'Beta', 'Zulu'])
  })

  it('não inclui transações não-front-end nem criativos fora do recorte Meta', () => {
    const history = buildCreativePerformanceHistory(
      [meta({ impressoes: 100, views_75pct: 50 })],
      [
        trans({ produto: 'Script ANTI-Desconto' }),
        trans({ ad_id: 'desconhecido', criativo: 'Não exibido' }),
      ],
      { ...options(10), days: ['2026-08-01'] },
    )
    // Sem venda front-end, a taxa válida é 0% (não null, pois há base suficiente).
    expect(graph(history, 'conv_body').series[0].points[0].value).toBe(0)
    expect(graph(history, 'conv_body').series).toHaveLength(1)
  })
})

describe('performanceMetricValue', () => {
  it('retorna null quando o denominador não existe', () => {
    const empty = {
      impressoes: 0, cliquesLink: 0, views3seg: 0, views75pct: 0,
      views95pct: 0, investimento: 10, vendasFront: 0,
    }
    expect(performanceMetricValue('hook_rate', empty)).toBeNull()
    expect(performanceMetricValue('conv_body', empty)).toBeNull()
    expect(performanceMetricValue('cpc_link', empty)).toBeNull()
    expect(performanceMetricValue('hold_rate', empty)).toBeNull()
  })
})
