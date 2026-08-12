import { describe, it, expect } from 'vitest'
import {
  isTestSale,
  normalizeValorBruto,
  parseSck,
  parseDateBR,
  parseHoraBR,
  saleFromHistoryItem,
  HOTMART_REVENUE_STATUSES,
} from './hotmartSync'

// ─────────────────────────────────────────────────────────────────────────────
// TRAVA DE REGRESSÃO — o bug que motivou este módulo.
//
// O webhook descartava `valorBruto <= 1` como "teste" e devolvia 200. Isso comeu
// 48 vendas reais de R$1,00 (campanhas de reativação de 04, 06 e 20-21/07/2026)
// sem rastro. Se alguém reintroduzir qualquer descarte por VALOR, estes testes
// quebram.
// ─────────────────────────────────────────────────────────────────────────────
describe('isTestSale — descarte por marcador, NUNCA por valor', () => {
  it('NÃO descarta venda real de R$1,00 (o bug de 21/07/2026)', () => {
    expect(isTestSale({
      transaction: 'HP0449013473',
      productId: 7080012,
      productName: 'Programa Demonstrativo de Aceleração de Clínicas',
    })).toBe(false)
  })

  it('NÃO descarta venda de R$1 da Imersão (24 vendas em 20/07)', () => {
    expect(isTestSale({ transaction: 'HP2896986834', productName: 'Imersão Lucro Clínico!' })).toBe(false)
  })

  it('NÃO descarta venda de valor zero/centavos — valor é irrelevante aqui', () => {
    expect(isTestSale({ transaction: 'HP1234567890', productName: 'Produto Demonstrativo' })).toBe(false)
  })

  it('descarta a transação de teste canônica da Hotmart', () => {
    expect(isTestSale({ transaction: 'HP16015479281022' })).toBe(true)
  })

  it('descarta pelo nome do produto de teste do painel', () => {
    expect(isTestSale({ transaction: 'HP999', productName: 'Produto test postback2' })).toBe(true)
    expect(isTestSale({ transaction: 'HP999', productName: 'PRODUTO TEST POSTBACK' })).toBe(true)
  })

  it('descarta product.id === 0 (payload sintético)', () => {
    expect(isTestSale({ transaction: 'HP999', productId: 0, productName: 'Qualquer' })).toBe(true)
  })

  it('product.id ausente não é sinal de teste', () => {
    expect(isTestSale({ transaction: 'HP999', productName: 'Produto Demonstrativo' })).toBe(false)
  })
})

describe('normalizeValorBruto', () => {
  it('HOTMART_INSTALLMENTS traz a PARCELA → multiplica pelo nº de parcelas', () => {
    expect(normalizeValorBruto(100, 'HOTMART_INSTALLMENTS', 3)).toBe(300)
  })
  it('parcela única não multiplica mesmo em HOTMART_INSTALLMENTS', () => {
    expect(normalizeValorBruto(100, 'HOTMART_INSTALLMENTS', 1)).toBe(100)
  })
  it('cartão parcelado já vem com o total', () => {
    expect(normalizeValorBruto(297, 'CREDIT_CARD', 12)).toBe(297)
  })
  it('preserva R$1 intacto', () => {
    expect(normalizeValorBruto(1, 'PIX', 1)).toBe(1)
  })
})

describe('parseSck', () => {
  const real = 'lps-pv06-alunos-calculadora-col-1real|direto|0|0|0|0|0|lps-pv06-alunos-calculadora-col-1real|0|0|0|0|0|0'

  it('extrai o slug da página e zera os campos "0"', () => {
    const p = parseSck(real)
    expect(p.pageSlug).toBe('lps-pv06-alunos-calculadora-col-1real')
    expect(p.utmSource).toBe('direto')
    expect(p.utmMedium).toBe('')
    expect(p.adId).toBe('')
  })

  it('lê ad_id do último impacto (índice 6) e do primeiro (índice 13)', () => {
    const p = parseSck('slug|meta|pago-metaads|camp|criativo|x|123456|slug|meta|pago-metaads|camp|cri1|y|999888')
    expect(p.adId).toBe('123456')
    expect(p.adIdPrim).toBe('999888')
    expect(p.utmMedium).toBe('pago-metaads')
  })

  it('sck vazio devolve todos os campos vazios', () => {
    const p = parseSck('')
    expect(p.adId).toBe('')
    expect(p.pageSlug).toBe('')
    expect(p.utmMedium).toBe('')
  })

  it('trata "null" e "0" como ausência', () => {
    const p = parseSck('0|null|0|0|0|0|null')
    expect(p.pageSlug).toBe('')
    expect(p.utmSource).toBe('')
    expect(p.adId).toBe('')
  })
})

describe('datas em UTC-3', () => {
  // 1784553637000 = 20/07/2026 (order_date real da HP0449013473)
  it('converte order_date para a data de Brasília', () => {
    expect(parseDateBR(1784553637000)).toBe('2026-07-20')
  })
  it('undefined → null (nunca "hoje")', () => {
    expect(parseDateBR(undefined)).toBeNull()
    expect(parseHoraBR(undefined)).toBeNull()
  })
  it('hora sai em HH:MM zero-padded', () => {
    expect(parseHoraBR(1784553637000)).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('saleFromHistoryItem', () => {
  const item = {
    buyer: { name: 'Alex F Barreira', email: 'ALEX@UOL.com.br' },
    product: { id: 7080012, name: 'Programa Demonstrativo de Aceleração de Clínicas' },
    purchase: {
      transaction: 'HP0449013473',
      order_date: 1784553637000,
      status: 'APPROVED',
      price: { value: 1 },
      payment: { type: 'PIX', installments_number: 1 },
    },
  }

  it('normaliza o item da sales/history preservando o R$1', () => {
    const s = saleFromHistoryItem(item, 'slug|direto')
    expect(s.transaction).toBe('HP0449013473')
    expect(s.priceValue).toBe(1)
    expect(s.parcelas).toBe(1)
    expect(s.productName).toBe('Programa Demonstrativo de Aceleração de Clínicas')
    expect(s.rawSck).toBe('slug|direto')
  })

  it('comissão vem NULL — sales/history não devolve (≠ zero)', () => {
    expect(saleFromHistoryItem(item, '').valorLiquidoExpert).toBeNull()
  })

  it('parcelas ausente cai em 1, não em 0', () => {
    const s = saleFromHistoryItem({ purchase: { transaction: 'X' } }, '')
    expect(s.parcelas).toBe(1)
  })
})

describe('HOTMART_REVENUE_STATUSES', () => {
  it('conta APPROVED e COMPLETE', () => {
    expect(HOTMART_REVENUE_STATUSES.has('APPROVED')).toBe(true)
    expect(HOTMART_REVENUE_STATUSES.has('COMPLETE')).toBe(true)
  })
  it('não conta estorno/cancelamento', () => {
    for (const s of ['REFUNDED', 'CHARGEBACK', 'CANCELLED', 'EXPIRED', 'PROTESTED']) {
      expect(HOTMART_REVENUE_STATUSES.has(s)).toBe(false)
    }
  })
})
