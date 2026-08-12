import { describe, it, expect } from 'vitest'
import { convBodyPct, convBodyFrac, MIN_VIEWS_75_CONV_BODY } from './convBody'

describe('convBodyPct — vendas ÷ views 75%', () => {
  it('vídeo com denominador suficiente → taxa real', () => {
    // caso real: demo-col-vid-04-react_ugc-laila_01 — 45 compras / 1032 views75
    expect(convBodyPct(45, 1032)).toBeCloseTo(4.36, 1)
  })

  // A TRAVA: anúncio de IMAGEM tem views75 residual e a razão explodia.
  // demo-lps-img-02 tinha 7 compras / 1 view75 = 700% na tabela.
  it('anúncio de imagem (views75 residual) → undefined, NUNCA 700%', () => {
    expect(convBodyPct(7, 1)).toBeUndefined()
    expect(convBodyPct(7, 0)).toBeUndefined()
  })

  it('logo abaixo do piso ainda é imensurável', () => {
    expect(convBodyPct(2, MIN_VIEWS_75_CONV_BODY - 1)).toBeUndefined()
  })

  it('no piso exato já vale', () => {
    expect(convBodyPct(3, MIN_VIEWS_75_CONV_BODY)).toBeCloseTo(10, 5)
  })

  it('zero venda com denominador bom é 0% de verdade (não é falta de dado)', () => {
    expect(convBodyPct(0, 500)).toBe(0)
  })

  it('nunca devolve % maior que 100 por denominador minúsculo', () => {
    const r = convBodyPct(7, 1)
    expect(r === undefined || r <= 100).toBe(true)
  })
})

describe('convBodyFrac — versão 0–1 pro card', () => {
  it('devolve fração', () => {
    expect(convBodyFrac(45, 1032)).toBeCloseTo(0.0436, 3)
  })
  it('imensurável → null (o card mostra "—")', () => {
    expect(convBodyFrac(7, 1)).toBeNull()
  })
})
