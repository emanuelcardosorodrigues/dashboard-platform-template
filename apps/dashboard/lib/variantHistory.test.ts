import { describe, it, expect } from 'vitest'
import { buildVariantTimeline, type LinhasCruas } from './variantHistory'

const vazio: LinhasCruas = { impressoes: [], routeClicks: [], checkoutHits: [], vendas: [] }

describe('buildVariantTimeline', () => {
  it('sem dado → sem linha', () => {
    expect(buildVariantTimeline(vazio)).toEqual([])
  })

  it('visualizações contam page loads; visitantes contam uids distintos', () => {
    const t = buildVariantTimeline({
      ...vazio,
      impressoes: [
        { uid: 'u1', dia: '2026-07-12' },
        { uid: 'u1', dia: '2026-07-12' }, // mesmo visitante recarregou
        { uid: 'u2', dia: '2026-07-12' },
      ],
    })
    expect(t[0]).toMatchObject({ dia: '2026-07-12', visualizacoes: 3, visitantes: 2 })
  })

  it('connect rate = chegaram ÷ roteados, interseção NO MESMO DIA', () => {
    const t = buildVariantTimeline({
      ...vazio,
      impressoes: [{ uid: 'a', dia: '2026-07-12' }, { uid: 'b', dia: '2026-07-12' }],
      routeClicks: [
        { uid: 'a', dia: '2026-07-12' },
        { uid: 'b', dia: '2026-07-12' },
        { uid: 'c', dia: '2026-07-12' }, // roteado mas não chegou (perdeu no salto)
        { uid: 'd', dia: '2026-07-12' },
      ],
    })
    expect(t[0]).toMatchObject({ roteados: 4, chegaram: 2, connectRate: 50 })
  })

  it('sem clique roteado no dia → connectRate null (nunca 0% falso)', () => {
    const t = buildVariantTimeline({ ...vazio, impressoes: [{ uid: 'a', dia: '2026-07-10' }] })
    expect(t[0].connectRate).toBeNull()
    expect(t[0].roteados).toBe(0)
  })

  it('clique pro checkout só conta quem VIU esta variante', () => {
    const t = buildVariantTimeline({
      ...vazio,
      impressoes: [{ uid: 'a', dia: '2026-07-12' }, { uid: 'b', dia: '2026-07-12' }],
      checkoutHits: [
        { uid: 'a', dia: '2026-07-12' },        // viu e clicou ✓
        { uid: 'forasteiro', dia: '2026-07-12' }, // clicou mas não viu esta variante ✗
      ],
    })
    expect(t[0].cliquesCheckout).toBe(1)
  })

  it('clique sem uid (tráfego direto, sem cookie) NÃO entra — misturaria identidades', () => {
    const t = buildVariantTimeline({
      ...vazio,
      impressoes: [{ uid: 'a', dia: '2026-07-12' }],
      checkoutHits: [{ uid: null, dia: '2026-07-12' }, { uid: null, dia: '2026-07-12' }],
    })
    expect(t[0].cliquesCheckout).toBe(0)
  })

  it('vendas e receita somam por dia', () => {
    const t = buildVariantTimeline({
      ...vazio,
      vendas: [
        { dia: '2026-07-12', valor: 100 },
        { dia: '2026-07-12', valor: 250 },
      ],
    })
    expect(t[0]).toMatchObject({ vendas: 2, receita: 350 })
  })

  it('ordena do mais recente pro mais antigo', () => {
    const t = buildVariantTimeline({
      ...vazio,
      impressoes: [
        { uid: 'a', dia: '2026-07-10' },
        { uid: 'b', dia: '2026-07-12' },
        { uid: 'c', dia: '2026-07-11' },
      ],
    })
    expect(t.map((d) => d.dia)).toEqual(['2026-07-12', '2026-07-11', '2026-07-10'])
  })

  it('dia que só tem venda (sem impressão) ainda aparece — não some do histórico', () => {
    const t = buildVariantTimeline({ ...vazio, vendas: [{ dia: '2026-07-01', valor: 500 }] })
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ dia: '2026-07-01', vendas: 1, visualizacoes: 0 })
  })
})
