import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import { fetchClarityMetrics, normalizeClarityRows } from './clarity'

beforeEach(() => { process.env.CLARITY_API_TOKEN = 'tok123' })
afterEach(() => { vi.restoreAllMocks() })

describe('fetchClarityMetrics', () => {
  test('chama API com Bearer + querystring correta', async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ metricName: 'Traffic', information: [] }],
    })
    vi.stubGlobal('fetch', mock)

    await fetchClarityMetrics({ numOfDays: 1, dimension1: 'URL' })

    const [url, init] = mock.mock.calls[0]
    expect(String(url)).toContain('numOfDays=1')
    expect(String(url)).toContain('dimension1=URL')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok123' })
  })

  test('lança erro em resposta não-OK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, text: async () => 'rate limit'
    }))
    await expect(fetchClarityMetrics({ numOfDays: 1 })).rejects.toThrow(/429/)
  })

  test('lança se CLARITY_API_TOKEN ausente', async () => {
    delete process.env.CLARITY_API_TOKEN
    await expect(fetchClarityMetrics({ numOfDays: 1 })).rejects.toThrow(/CLARITY_API_TOKEN/)
  })
})

describe('normalizeClarityRows', () => {
  test('agrega total em uma linha (dimensao_valor="*")', () => {
    const apiResponse = [
      { metricName: 'Traffic', information: [{
        totalSessionCount: '1000', totalBotSessionCount: '10', distinctUserCount: '900',
        pagesPerSessionPercentage: 3.5,
      }] },
      { metricName: 'ScrollDepth', information: [{ sessionsCount: '1000', averageScrollDepth: 67.2 }] },
      { metricName: 'EngagementTime', information: [{ sessionsCount: '1000', activeTime: '45', totalTime: '90' }] },
    ]
    const rows = normalizeClarityRows(apiResponse, { data: '2026-05-11', recorte: 'total', dimensao: '*' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      data: '2026-05-11', recorte: 'total', dimensao_valor: '*',
      sessions: 1000, pages_per_session: 3.5, scroll_depth_pct: 67.2,
      engagement_time_sec: 45, // activeTime preferido
    })
  })

  test('ignora métricas dimensionais automáticas (Browser, Device, OS) no recorte total', () => {
    const apiResponse = [
      { metricName: 'Traffic', information: [{ totalSessionCount: '500', pagesPerSessionPercentage: 1.5 }] },
      { metricName: 'Browser', information: [{ name: 'Chrome', sessionsCount: '300' }] },
      { metricName: 'Device', information: [{ name: 'Mobile', sessionsCount: '450' }] },
    ]
    const rows = normalizeClarityRows(apiResponse, { data: '2026-05-11', recorte: 'total', dimensao: '*' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ dimensao_valor: '*', sessions: 500 })
  })

  test('mapeia métricas de frustração e erros', () => {
    const apiResponse = [
      { metricName: 'RageClickCount', information: [{ subTotal: '12' }] },
      { metricName: 'DeadClickCount', information: [{ subTotal: '34' }] },
      { metricName: 'QuickbackClick', information: [{ subTotal: '5' }] },
      { metricName: 'ScriptErrorCount', information: [{ subTotal: '2' }] },
      { metricName: 'ErrorClickCount', information: [{ subTotal: '1' }] },
    ]
    const rows = normalizeClarityRows(apiResponse, { data: '2026-05-11', recorte: 'total', dimensao: '*' })
    expect(rows[0]).toMatchObject({
      rage_clicks: 12, dead_clicks: 34, quick_backs: 5, script_errors: 2, error_clicks: 1,
    })
  })

  test('recorte=url canonicaliza URLs (strip query) e agrega contadores', () => {
    const apiResponse = [
      { metricName: 'Traffic', information: [
        { Url: 'https://x.com/a/?utm=1', totalSessionCount: '10', pagesPerSessionPercentage: 2 },
        { Url: 'https://x.com/a/?utm=2', totalSessionCount: '5',  pagesPerSessionPercentage: 1 },
        { Url: 'https://x.com/b',         totalSessionCount: '3',  pagesPerSessionPercentage: 4 },
      ] },
      { metricName: 'RageClickCount', information: [
        { Url: 'https://x.com/a/?utm=1', subTotal: '7', sessionsCount: '10' },
        { Url: 'https://x.com/a/?utm=2', subTotal: '2', sessionsCount: '5' },
      ] },
    ]
    const rows = normalizeClarityRows(apiResponse, { data: '2026-05-11', recorte: 'url', dimensao: 'url' })
    expect(rows).toHaveLength(2)
    const a = rows.find((r) => r.dimensao_valor === 'https://x.com/a')!
    expect(a.sessions).toBe(15) // 10 + 5
    expect(a.rage_clicks).toBe(9) // 7 + 2
    // PPS ponderado: (2*10 + 1*5) / (10+5) = 25/15 ≈ 1.67
    expect(a.pages_per_session).toBeCloseTo(1.67, 1)
    const b = rows.find((r) => r.dimensao_valor === 'https://x.com/b')!
    expect(b.sessions).toBe(3)
  })

  test('recorte=device extrai por campo Device', () => {
    const apiResponse = [
      { metricName: 'Traffic', information: [
        { Device: 'Mobile', totalSessionCount: '200', pagesPerSessionPercentage: 1.2 },
        { Device: 'PC',     totalSessionCount: '50',  pagesPerSessionPercentage: 2.5 },
      ] },
    ]
    const rows = normalizeClarityRows(apiResponse, { data: '2026-05-11', recorte: 'device', dimensao: 'device' })
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.dimensao_valor === 'Mobile')?.sessions).toBe(200)
    expect(rows.find((r) => r.dimensao_valor === 'PC')?.sessions).toBe(50)
  })
})
