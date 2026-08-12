import { describe, expect, it } from 'vitest'
import { produtoToTipo, produtoToFunil, filterTransacoesByFunil, diaSeguinteYmd } from './supabase'
import type { SbTransacao } from './supabase'

describe('produtoToTipo — classificação de produto Hotmart', () => {
  describe('Protocolo Lucro Oculto (front PLO/COL — bug-raiz histórico)', () => {
    it('classifica como frontEnd em campanha COL', () => {
      expect(produtoToTipo('Protocolo Lucro Oculto', 'col-001-pv02')).toBe('frontEnd')
    })

    it('classifica como frontEnd em campanha PLO', () => {
      expect(produtoToTipo('Protocolo Lucro Oculto', 'plo-h01-v3')).toBe('frontEnd')
    })

    it('classifica como frontEnd mesmo sem criativo informado', () => {
      expect(produtoToTipo('Protocolo Lucro Oculto', '')).toBe('frontEnd')
    })

    it('classifica como frontEnd em criativo do funil DPL (override pra DPL não muda — PLO ≠ DPL produto)', () => {
      expect(produtoToTipo('Protocolo Lucro Oculto', 'dpl-x01')).toBe('frontEnd')
    })
  })

  describe('Protocolo Dentista Parceiro — front no DPL, OB3 nos demais', () => {
    it('é frontEnd quando criativo é DPL (dpl-)', () => {
      expect(produtoToTipo('Protocolo Dentista Parceiro', 'dpl-h01')).toBe('frontEnd')
    })

    it('é frontEnd quando criativo é DPL (dpl_)', () => {
      expect(produtoToTipo('Protocolo Dentista Parceiro', 'dpl_h01')).toBe('frontEnd')
    })

    it('é OB3 em campanha COL', () => {
      expect(produtoToTipo('Protocolo Dentista Parceiro', 'col-002-pv01')).toBe('ob3')
    })

    it('é OB3 em campanha PLO', () => {
      expect(produtoToTipo('Protocolo Dentista Parceiro', 'plo-h03')).toBe('ob3')
    })
  })

  describe('Produto Demonstrativo — front COL', () => {
    it('é frontEnd em qualquer campanha', () => {
      expect(produtoToTipo('Produto Demonstrativo', 'col-001')).toBe('frontEnd')
      expect(produtoToTipo('Produto Demonstrativo', 'dpl-x')).toBe('frontEnd')
      expect(produtoToTipo('Produto Demonstrativo', '')).toBe('frontEnd')
    })
    it('Imersão Lucro Clínico (front LPS) é frontEnd', () => {
      expect(produtoToTipo('Imersão Lucro Clínico', '')).toBe('frontEnd')
    })
  })

  describe('Order bumps por nome explícito', () => {
    it('Script Anti-Desconto → OB1', () => {
      expect(produtoToTipo('Script Anti-Desconto', 'col-001')).toBe('ob1')
      expect(produtoToTipo('Script Anti-Desconto', 'dpl-x')).toBe('ob1')
    })

    it('Lucro Tributário Express → OB2', () => {
      expect(produtoToTipo('Lucro Tributário Express', 'col-001')).toBe('ob2')
      expect(produtoToTipo('Tributário Express', '')).toBe('ob2')
    })

    it('Manual Lucro Oculto → OB4 (não confundir com Protocolo Lucro Oculto)', () => {
      expect(produtoToTipo('Manual Lucro Oculto', 'col-001')).toBe('ob4')
      expect(produtoToTipo('Manual Lucro Oculto', 'dpl-x')).toBe('ob4')
    })
  })

  describe('Fallback — produto desconhecido', () => {
    it('vira frontEnd (conservador) sem quebrar CPA', () => {
      expect(produtoToTipo('Produto Misterioso', 'col-x')).toBe('frontEnd')
    })

    it('vazio também vira frontEnd', () => {
      expect(produtoToTipo('', '')).toBe('frontEnd')
    })
  })

  describe('Sensibilidade a case e variações', () => {
    it('é case-insensitive', () => {
      expect(produtoToTipo('PROTOCOLO LUCRO OCULTO', 'COL-001')).toBe('frontEnd')
      expect(produtoToTipo('protocolo dentista parceiro', 'DPL_H01')).toBe('frontEnd')
    })

    it('aceita "DPL-" e "DPL_" como prefixo de criativo DPL', () => {
      expect(produtoToTipo('Protocolo Dentista Parceiro', 'DPL-001')).toBe('frontEnd')
      expect(produtoToTipo('Protocolo Dentista Parceiro', 'DPL_001')).toBe('frontEnd')
    })
  })

  describe('Upsell e downsell PLO — vendas pós-compra Hotmart', () => {
    it('Implementação LucroOculto (sem espaço, sem criativo) → upsell', () => {
      expect(produtoToTipo('Implementação LucroOculto', '')).toBe('upsell')
    })
    it('Implementação Lucro Oculto (com espaço, qualquer criativo) → upsell', () => {
      expect(produtoToTipo('Implementação Lucro Oculto', 'col-001')).toBe('upsell')
    })
    it('Implementação Express Lucro Oculto → downsell (NÃO upsell)', () => {
      expect(produtoToTipo('Implementação Express Lucro Oculto', '')).toBe('downsell')
    })
    it('Implementação Express LucroOculto (sem espaço) → downsell', () => {
      expect(produtoToTipo('Implementação Express LucroOculto', '')).toBe('downsell')
    })
    it('IMPLEMENTAÇÃO EXPRESS LUCRO OCULTO (maiúsculas) → downsell', () => {
      expect(produtoToTipo('IMPLEMENTAÇÃO EXPRESS LUCRO OCULTO', '')).toBe('downsell')
    })
  })
})

describe('produtoToFunil — mapeamento produto → funil canônico', () => {
  it('Protocolo Lucro Oculto → plo', () => {
    expect(produtoToFunil('Protocolo Lucro Oculto', '')).toBe('plo')
  })
  it('Implementação LucroOculto (upsell) → plo', () => {
    expect(produtoToFunil('Implementação LucroOculto', '')).toBe('plo')
  })
  it('Implementação Express Lucro Oculto (downsell) → plo', () => {
    expect(produtoToFunil('Implementação Express Lucro Oculto', '')).toBe('plo')
  })
  it('Manual Lucro Oculto (OB4) → null (não amarra a funil específico)', () => {
    expect(produtoToFunil('Manual Lucro Oculto', '')).toBe(null)
  })
  it('Produto Demonstrativo → col', () => {
    expect(produtoToFunil('Produto Demonstrativo', '')).toBe('col')
  })
  it('Protocolo Dentista Parceiro com criativo DPL → dpl', () => {
    expect(produtoToFunil('Protocolo Dentista Parceiro', 'dpl-h01')).toBe('dpl')
  })
  it('Protocolo Dentista Parceiro sem criativo DPL → null (OB3 em outros funis)', () => {
    expect(produtoToFunil('Protocolo Dentista Parceiro', 'col-001')).toBe(null)
  })
  it('Script Anti-Desconto (OB1) → null (ambíguo; resolvido por email/default)', () => {
    expect(produtoToFunil('Script Anti-Desconto', '')).toBe(null)
  })
  it('Imersão Lucro Clínico (front) → lps', () => {
    expect(produtoToFunil('Imersão Lucro Clínico', '')).toBe('lps')
  })
})

describe('filterTransacoesByFunil — 3º fallback via produtoToFunil', () => {
  const mkTx = (over: Partial<SbTransacao>): SbTransacao => ({
    transaction_id: 'tx_test', data: '2026-05-01', email: 'a@b.c',
    valor_bruto: 100, valor_liquido_expert: 87,
    produto: '', criativo: null, ad_id: null,
    utm_source_ultimo: null, utm_medium_ultimo: null, utm_campaign_ultimo: null,
    utm_term_ultimo: null, utm_content_ultimo: null,
    utm_source_primeiro: null, utm_medium_primeiro: null, utm_campaign_primeiro: null,
    utm_term_primeiro: null, utm_content_primeiro: null,
    ...over,
  } as SbTransacao)

  it('compra de upsell PLO sem criativo é incluída no filtro plo via produto', () => {
    const rows = [
      mkTx({ produto: 'Implementação LucroOculto', criativo: undefined }),
      mkTx({ produto: 'Algum produto qualquer', criativo: 'dpl-h01' }),
    ]
    const filtered = filterTransacoesByFunil(rows, 'plo')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].produto).toBe('Implementação LucroOculto')
  })

  it('compra de downsell PLO sem criativo é incluída no filtro plo', () => {
    const rows = [
      mkTx({ produto: 'Implementação Express Lucro Oculto', criativo: undefined }),
    ]
    expect(filterTransacoesByFunil(rows, 'plo')).toHaveLength(1)
  })

  it('upsell PLO NÃO entra no filtro dpl', () => {
    const rows = [
      mkTx({ produto: 'Implementação LucroOculto', criativo: undefined }),
    ]
    expect(filterTransacoesByFunil(rows, 'dpl')).toHaveLength(0)
  })

  it('compra front com criativo plo continua passando (primário)', () => {
    const rows = [mkTx({ produto: 'Protocolo Lucro Oculto', criativo: 'plo-h01' })]
    expect(filterTransacoesByFunil(rows, 'plo')).toHaveLength(1)
  })

  it('funil all retorna tudo sem filtrar', () => {
    const rows = [
      mkTx({ produto: 'Implementação LucroOculto', criativo: undefined }),
      mkTx({ produto: 'Script Anti-Desconto', criativo: 'col-001' }),
    ]
    expect(filterTransacoesByFunil(rows, 'all')).toHaveLength(2)
  })

  it("dropdown manda 'col-' (com traço) e ainda casa o funil col", () => {
    const rows = [mkTx({ produto: 'Produto Demonstrativo', criativo: undefined })]
    expect(filterTransacoesByFunil(rows, 'col-')).toHaveLength(1)
  })

  it('compra orgânica COL inteira (front + order bumps sem criativo) entra toda no col', () => {
    // Mesma compra/email: front Calculadora (col) + 3 order bumps sem criativo.
    const rows = [
      mkTx({ email: 'ester@x.com', produto: 'Produto Demonstrativo', criativo: undefined }),
      mkTx({ email: 'ester@x.com', produto: 'Script ANTI-Desconto', criativo: undefined }),
      mkTx({ email: 'ester@x.com', produto: 'Lucro Tributário Express', criativo: undefined }),
      mkTx({ email: 'ester@x.com', produto: 'Protocolo Dentista Parceiro Lucrativo', criativo: undefined }),
    ]
    expect(filterTransacoesByFunil(rows, 'col-')).toHaveLength(4)
  })

  it('order bump herda o funil do front da MESMA compra (não cai no default COL)', () => {
    // Comprador entrou por um front PLO (criativo plo) e levou um Script como bump sem criativo.
    const rows = [
      mkTx({ email: 'joao@x.com', produto: 'Protocolo Lucro Oculto', criativo: 'demo-plo-vid-01' }),
      mkTx({ email: 'joao@x.com', produto: 'Script ANTI-Desconto', criativo: undefined }),
    ]
    expect(filterTransacoesByFunil(rows, 'plo')).toHaveLength(2)
    expect(filterTransacoesByFunil(rows, 'col')).toHaveLength(0)
  })

  it('LPS: criativo com token lps (não no início) é detectado', () => {
    const rows = [mkTx({ produto: 'Imersão Lucro Clínico', criativo: 'demo-lps-vid-01' })]
    expect(filterTransacoesByFunil(rows, 'lps-')).toHaveLength(1)
  })
})

describe('diaSeguinteYmd (#14 — boundary de fim de dia exclusivo)', () => {
  it('avança um dia, inclusive em viradas de mês e ano', () => {
    expect(diaSeguinteYmd('2026-07-02')).toBe('2026-07-03')
    expect(diaSeguinteYmd('2026-06-30')).toBe('2026-07-01')
    expect(diaSeguinteYmd('2026-12-31')).toBe('2027-01-01')
    expect(diaSeguinteYmd('2028-02-28')).toBe('2028-02-29') // bissexto
  })
})
