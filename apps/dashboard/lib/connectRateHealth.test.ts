import { describe, it, expect } from 'vitest'
import { reconcileConnectStreams, type StreamRow } from './connectRateHealth'

const OPTS = { minSample: 35, floorPct: 50, viewsFloor: 5 }
const row = (p: Partial<StreamRow>): StreamRow =>
  ({ experimentId: 'e', name: 'exp', routed: 0, landed: 0, views: 0, ...p })

describe('reconcileConnectStreams', () => {
  it('streams saudáveis (roteados ≥ views ≥ landed, rate alto) → sem issue', () => {
    const issues = reconcileConnectStreams([row({ routed: 100, landed: 92, views: 93 })], OPTS)
    expect(issues).toEqual([])
  })

  it('views sem nenhum clique roteado → roteamento-parado', () => {
    const issues = reconcileConnectStreams([row({ name: 'LPS', routed: 0, landed: 0, views: 40 })], OPTS)
    expect(issues).toHaveLength(1)
    expect(issues[0].kind).toBe('roteamento-parado')
    expect(issues[0].name).toBe('LPS')
  })

  it('trickle de views (≤ viewsFloor) sem cliques NÃO alarma (evita ruído)', () => {
    expect(reconcileConnectStreams([row({ routed: 0, views: 3 })], OPTS)).toEqual([])
  })

  it('muitos roteados mas quase ninguém chega → beacon-suspeito', () => {
    const issues = reconcileConnectStreams([row({ name: 'COL', routed: 80, landed: 10, views: 12 })], OPTS)
    expect(issues).toHaveLength(1)
    expect(issues[0].kind).toBe('beacon-suspeito')
    expect(issues[0].detalhe).toContain('13%')
  })

  it('connect rate baixo MAS amostra pequena → NÃO alarma (seria ruído)', () => {
    // 2 roteados, 0 landed = 0%, mas n=2 não é sinal — a trava de amostra vale aqui também.
    expect(reconcileConnectStreams([row({ routed: 2, landed: 0, views: 0 })], OPTS)).toEqual([])
  })

  it('connect rate no piso exato não alarma; só abaixo', () => {
    expect(reconcileConnectStreams([row({ routed: 40, landed: 20, views: 20 })], OPTS)).toEqual([]) // 50% == piso
    expect(reconcileConnectStreams([row({ routed: 40, landed: 19, views: 19 })], OPTS)).toHaveLength(1) // 47,5%
  })

  it('acha issues em múltiplos experimentos de uma vez', () => {
    const issues = reconcileConnectStreams([
      row({ experimentId: 'a', name: 'A', routed: 100, landed: 95, views: 96 }), // ok
      row({ experimentId: 'b', name: 'B', routed: 0, landed: 0, views: 50 }),     // roteamento parado
      row({ experimentId: 'c', name: 'C', routed: 60, landed: 6, views: 8 }),     // beacon suspeito
    ], OPTS)
    expect(issues.map((i) => i.experimentId).sort()).toEqual(['b', 'c'])
  })
})
