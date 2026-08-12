import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignVariant, activeNormalized, getBanditVariants } from '../src/ab.js'

// Conta a fração de uids sorteados pra primeira variante.
function fractionFirst(variants, n, expId = 'exp1') {
  let first = 0
  for (let i = 0; i < n; i++) {
    const v = assignVariant(`u${i}`, variants, expId)
    if (v === variants[0]) first++
  }
  return first / n
}

test('assignVariant honra precisão sub-1% (% 10000, não % 100)', () => {
  // 0,5% — sob o antigo % 100 isso colapsaria pra ~1% (1 bucket de 100).
  // Sob % 10000 = 50 buckets de 10000 = 0,5% de verdade.
  const variants = [{ name: 'A', weight: 0.005 }, { name: 'B', weight: 0.995 }]
  const frac = fractionFirst(variants, 200000)
  assert.ok(frac > 0.0035 && frac < 0.0065, `esperado ~0.005, obtido ${frac} (% 100 daria ~0.01)`)
})

test('assignVariant distribui ~ proporcional ao peso (33,35%)', () => {
  const variants = [{ name: 'A', weight: 0.3335 }, { name: 'B', weight: 0.6665 }]
  const frac = fractionFirst(variants, 50000)
  assert.ok(Math.abs(frac - 0.3335) < 0.01, `esperado ~0.3335, obtido ${frac}`)
})

test('activeNormalized filtra enabled===false e renormaliza proporcional', () => {
  const out = activeNormalized([
    { name: 'A', weight: 0.5 },
    { name: 'B', weight: 0.3 },
    { name: 'C', weight: 0.2, enabled: false },
  ])
  assert.equal(out.length, 2, 'variante desativada deve sair do pool')
  assert.equal(out.find(v => v.name === 'C'), undefined)
  // 0,5 e 0,3 → renormaliza pra 0,625 / 0,375 (mantém a razão 5:3)
  assert.ok(Math.abs(out[0].weight - 0.625) < 1e-9)
  assert.ok(Math.abs(out[1].weight - 0.375) < 1e-9)
})

test('activeNormalized trata variante sem campo enabled como ativa', () => {
  const out = activeNormalized([{ name: 'A', weight: 0.5 }, { name: 'B', weight: 0.5 }])
  assert.equal(out.length, 2)
  assert.ok(Math.abs(out[0].weight + out[1].weight - 1) < 1e-9)
})

test('activeNormalized: todas desativadas → fallback não-vazio (nunca fica sem variante)', () => {
  const out = activeNormalized([
    { name: 'A', weight: 0.5, enabled: false },
    { name: 'B', weight: 0.5, enabled: false },
  ])
  assert.equal(out.length, 2)
  const sum = out.reduce((s, v) => s + v.weight, 0)
  assert.ok(Math.abs(sum - 1) < 1e-9)
})

test('activeNormalized: soma de pesos zero → split uniforme', () => {
  const out = activeNormalized([{ name: 'A', weight: 0 }, { name: 'B', weight: 0 }])
  assert.ok(Math.abs(out[0].weight - 0.5) < 1e-9)
  assert.ok(Math.abs(out[1].weight - 0.5) < 1e-9)
})

test('getBanditVariants sem auto_optimize filtra desativada e renormaliza', async () => {
  const exp = {
    id: 'e1',
    auto_optimize: false,
    variants: [
      { name: 'A', slug: 'a', weight: 0.7 },
      { name: 'B', slug: 'b', weight: 0.3, enabled: false },
    ],
  }
  const out = await getBanditVariants(exp, {})
  assert.equal(out.length, 1, 'só a ativa deve sobrar')
  assert.equal(out[0].name, 'A')
  assert.ok(Math.abs(out[0].weight - 1) < 1e-9, 'a única ativa vira 100%')
})
