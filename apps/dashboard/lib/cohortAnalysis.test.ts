import { describe, it, expect } from 'vitest'
import { cohortByCreative } from './cohortAnalysis'
import type { SbQualificacao, SbTransacao } from './supabase'

function t(over: Partial<SbTransacao>): SbTransacao {
  return {
    hotmart_id: 'h', data: '2026-05-01', nome: '', email: '', produto: 'p',
    valor_bruto: 0, valor_liquido_expert: 0, forma_pagamento: 'PIX', parcelas: 1,
    criativo: 'c', ad_id: null,
    utm_medium_ultimo: '', utm_source_ultimo: '',
    utm_medium_primeiro: '', utm_source_primeiro: '',
    ...over,
  }
}

function q(over: Partial<SbQualificacao>): SbQualificacao {
  return {
    email: '', nome: '', whatsapp: '', sexo: '', faixa_etaria: '',
    estado_civil: '', tem_filhos: '', tipo_clinica: '', faturamento_declarado: '',
    num_cadeiras: '', tempo_odontologia: '', especialidade: '', como_conheceu: '',
    maior_dificuldade: '', medos: '', objetivos: '', o_que_falta: '',
    unica_coisa_incomoda: '', motivo_compra: '', o_que_impediu: '',
    instagram: '', tentou_antes: '', funcionou: '', por_que_nao_funcionou: '',
    emocao_fim_mes: '', valor_sonho_mensal: '', quanto_sobra: '', tem_socio: '',
    cpf_cnpj: '', tem_ficha: true,
    ...over,
  }
}

describe('cohortByCreative', () => {
  it('liga transação ↔ qualificação por email (case-insensitive)', () => {
    const trans = [
      t({ email: 'A@x.com', ad_id: 'AD1', valor_bruto: 1000 }),
      t({ email: 'b@x.com', ad_id: 'AD1', valor_bruto: 2000 }),
    ]
    const fichas = [
      q({ email: 'a@x.com', maior_dificuldade: 'baixo faturamento', medos: 'não dar certo', faturamento_declarado: 'até 20k' }),
      q({ email: 'b@x.com', maior_dificuldade: 'baixo faturamento', medos: 'investir e perder' }),
    ]
    const out = cohortByCreative(trans, fichas)
    const ad1 = out.get('AD1')!
    expect(ad1.n_compradores).toBe(2)
    expect(ad1.n_fichas).toBe(2)
    // ticket = líquido POR transação FE / nº FE (canônico):
    // 1000→907.51 + 2000→1818.51 = 2726.02 ; /2 = 1363.01
    expect(ad1.ticket_medio).toBeCloseTo(1363.01, 2)
    expect(ad1.top_dores[0]).toBe('baixo faturamento (2x)')
    expect(ad1.top_medos).toContain('não dar certo (1x)')
    expect(ad1.top_faturamento[0]).toBe('até 20k (1x)')
  })

  it('agrupa por criativo quando ad_id é null', () => {
    const trans = [
      t({ email: 'a@x.com', ad_id: null, criativo: 'col-pv02' }),
      t({ email: 'b@x.com', ad_id: null, criativo: 'col-pv02' }),
    ]
    const out = cohortByCreative(trans, [])
    expect(out.get('col-pv02')?.n_compradores).toBe(2)
  })

  it('comprador sem ficha não conta como n_fichas', () => {
    const out = cohortByCreative(
      [t({ email: 'x@x.com', ad_id: 'AD' })],
      [],
    )
    expect(out.get('AD')?.n_compradores).toBe(1)
    expect(out.get('AD')?.n_fichas).toBe(0)
  })

  it('emails vazios são ignorados pelo lookup', () => {
    const out = cohortByCreative(
      [t({ email: '', ad_id: 'AD' })],
      [q({ email: '', maior_dificuldade: 'X' })],
    )
    expect(out.get('AD')?.n_fichas).toBe(0)
  })

  it('top values retorna até 3 no mais comum primeiro', () => {
    const fichas = [
      q({ email: 'a@x.com', maior_dificuldade: 'A' }),
      q({ email: 'b@x.com', maior_dificuldade: 'A' }),
      q({ email: 'c@x.com', maior_dificuldade: 'B' }),
    ]
    const out = cohortByCreative(
      [
        t({ email: 'a@x.com', ad_id: 'X' }),
        t({ email: 'b@x.com', ad_id: 'X' }),
        t({ email: 'c@x.com', ad_id: 'X' }),
      ],
      fichas,
    )
    const x = out.get('X')!
    expect(x.top_dores[0]).toBe('A (2x)')
    expect(x.top_dores[1]).toBe('B (1x)')
  })
})
