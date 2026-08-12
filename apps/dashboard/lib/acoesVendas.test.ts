import { describe, expect, it } from 'vitest'
import { diaSemana, horaCompra, classifyNaAcao, analyzeAcao, type SbAcaoVenda } from './acoesVendas'
import type { SbTransacao } from './supabase'

const acao = (p: Partial<SbAcaoVenda>): SbAcaoVenda => ({
  id: 'a1', nome: 'Lançamento X', tipo: 'lancamento_pago', data_inicio: '2026-06-01', data_fim: '2026-06-30',
  produtos_front: [], produtos_ob: [], produtos_upsell: [], produtos_downsell: [], metas: {},
  descricao: null, status: 'ativo', created_at: '2026-06-01', updated_at: '2026-06-01', ...p,
})
const tx = (p: Partial<SbTransacao>): SbTransacao => ({
  hotmart_id: 'h', data: '2026-06-10', nome: 'x', email: 'x@x.com', produto: 'A', valor_bruto: 100,
  valor_liquido_expert: 90, forma_pagamento: 'pix', parcelas: 1, criativo: 'cri-a',
  utm_medium_ultimo: '', utm_source_ultimo: '', utm_medium_primeiro: '', utm_source_primeiro: '', ...p,
})

describe('diaSemana / horaCompra', () => {
  it('2026-01-01 é quinta (getUTCDay=4)', () => expect(diaSemana('2026-01-01')).toBe(4))
  it('data inválida → null', () => expect(diaSemana('xx')).toBeNull())
  it('hora_compra "14:30:00" → 14', () => expect(horaCompra({ hora_compra: '14:30:00' })).toBe(14))
  it('sem hora → null', () => expect(horaCompra({ hora_compra: '', created_at: null })).toBeNull())
})

describe('classifyNaAcao', () => {
  it('com produtos cadastrados respeita os arrays', () => {
    const a = acao({ produtos_front: ['A'], produtos_ob: ['B'] })
    expect(classifyNaAcao(a, 'A')).toBe('front')
    expect(classifyNaAcao(a, 'B')).toBe('ob')
    expect(classifyNaAcao(a, 'Z')).toBeNull() // fora da ação
  })
})

describe('analyzeAcao', () => {
  const a = acao({ produtos_front: ['A'], produtos_ob: ['B'], metas: { vendas: 4 } })
  const transacoes = [
    tx({ produto: 'A', valor_bruto: 100, data: '2026-06-10', criativo: 'cri-a', hora_compra: '09:00:00' }),
    tx({ produto: 'A', valor_bruto: 100, data: '2026-06-10', criativo: 'cri-a', hora_compra: '09:30:00' }),
    tx({ produto: 'B', valor_bruto: 50, data: '2026-06-10' }),
    tx({ produto: 'A', valor_bruto: 100, data: '2026-07-01' }), // fora da janela
    tx({ produto: 'Z', valor_bruto: 100, data: '2026-06-10' }), // fora da ação
  ]
  const r = analyzeAcao(a, transacoes)

  it('vendasFront só conta A na janela', () => expect(r.vendasFront).toBe(2))
  it('faturamento front = 200, ticket 100', () => {
    expect(r.faturamentoFront).toBe(200)
    expect(r.ticketMedio).toBe(100)
  })
  it('take rate OB = 1/2 = 50%', () => expect(r.takeRateOB).toBe(50))
  it('receita líquida = soma dos líquidos por transação (canônico)', () => {
    // 3 transações na janela: 100, 100 (>97, vídeo 2.49) e 50 (≤97, vídeo 0.30)
    // 100 → 100 − (8.9 + 1 + 2.49) = 87.61 (×2) ; 50 → 50 − (4.45 + 1 + 0.30) = 44.25
    expect(r.receitaLiquida).toBeCloseTo(87.61 * 2 + 44.25, 2) // 219.47
  })
  it('top criativos: cri-a com 2 vendas + receita líquida canônica', () => {
    expect(r.topCriativos[0].criativo).toBe('cri-a')
    expect(r.topCriativos[0].vendas).toBe(2)
    // cri-a: 2 × front de 100 (>97) → líquido 87.61 cada = 175.22
    expect(r.topCriativos[0].receita).toBeCloseTo(87.61 * 2, 2)
  })
  it('por hora: 2 vendas às 9h', () => expect(r.porHora[9].vendas).toBe(2))
  it('meta vendas 4 → atual 2, 50%', () => {
    const m = r.metas.find((x) => x.key === 'vendas')!
    expect(m.atual).toBe(2)
    expect(m.pct).toBe(50)
  })
})
