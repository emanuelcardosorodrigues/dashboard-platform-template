import { describe, it, expect } from 'vitest'
import { aggregateClarityRows } from './ClarityTable'
import type { SbClarityDaily } from '@/lib/supabase'

function row(overrides: Partial<SbClarityDaily>): SbClarityDaily {
  return {
    data: '2026-05-01',
    recorte: 'url',
    dimensao_valor: '/foo',
    sessions: 0,
    pages_per_session: null,
    total_pageviews: null,
    scroll_depth_pct: null,
    engagement_time_sec: null,
    dead_clicks: null,
    rage_clicks: null,
    quick_backs: null,
    excessive_scroll: null,
    script_errors: null,
    error_clicks: null,
    raw_json: null,
    synced_at: '2026-05-01T10:00:00Z',
    ...overrides,
  }
}

describe('aggregateClarityRows', () => {
  it('soma contadores e tira média ponderada por sessions', () => {
    const rows: SbClarityDaily[] = [
      row({
        data: '2026-05-01',
        sessions: 100,
        rage_clicks: 5,
        scroll_depth_pct: 60,
        engagement_time_sec: 30,
        pages_per_session: 2,
      }),
      row({
        data: '2026-05-02',
        sessions: 200,
        rage_clicks: 4,
        scroll_depth_pct: 30,
        engagement_time_sec: 60,
        pages_per_session: 4,
      }),
    ]
    const out = aggregateClarityRows(rows)
    expect(out).toHaveLength(1)
    expect(out[0].sessions).toBe(300)
    expect(out[0].rage_clicks).toBe(9)
    // média ponderada de scroll = (60*100 + 30*200) / 300 = 40
    expect(out[0].scroll_depth_pct).toBe(40)
    // engagement = (30*100 + 60*200) / 300 = 50
    expect(out[0].engagement_time_sec).toBe(50)
    // pages/sess = (2*100 + 4*200) / 300 = 3.333...
    expect(out[0].pages_per_session).toBeCloseTo(3.333, 2)
  })

  it('separa por (recorte, dimensao_valor)', () => {
    const rows: SbClarityDaily[] = [
      row({ recorte: 'url', dimensao_valor: '/a', sessions: 10 }),
      row({ recorte: 'url', dimensao_valor: '/b', sessions: 20 }),
      row({ recorte: 'device', dimensao_valor: 'desktop', sessions: 30 }),
    ]
    const out = aggregateClarityRows(rows)
    expect(out).toHaveLength(3)
    expect(out[0].sessions).toBe(30) // ordenado desc
  })

  it('lida com nulls sem explodir', () => {
    const out = aggregateClarityRows([
      row({ sessions: null, scroll_depth_pct: null }),
      row({ sessions: 50, scroll_depth_pct: 40 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sessions).toBe(50)
    expect(out[0].scroll_depth_pct).toBe(40)
  })

  it('retorna [] quando input vazio', () => {
    expect(aggregateClarityRows([])).toEqual([])
  })
})
