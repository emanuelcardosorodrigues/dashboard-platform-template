import { describe, it, expect } from 'vitest'
import { composeScore } from './botScore'

describe('composeScore', () => {
  it('cleared quando nenhum sinal', () => {
    const r = composeScore({})
    expect(r.score).toBe(0)
    expect(r.status).toBe('cleared')
  })

  it('worker hit sozinho = 40 → cleared (limítrofe)', () => {
    const r = composeScore({ worker: { hit: true, reason: 'ua_blocklist' } })
    expect(r.score).toBe(40)
    expect(r.status).toBe('cleared')
    expect(r.signals.worker_hit).toBe(true)
    expect(r.signals.worker_reason).toBe('ua_blocklist')
  })

  it('worker + clarity dead → suspect (60)', () => {
    const r = composeScore({
      worker: { hit: true, reason: 'rate_limit' },
      clarity: { deadClickRatio: 0.7, rageClicks: 1, totalClicks: 10 },
    })
    expect(r.score).toBe(60)
    expect(r.status).toBe('suspect')
  })

  it('worker + clarity dead + ga4 low → confirmed (80)', () => {
    const r = composeScore({
      worker: { hit: true },
      clarity: { deadClickRatio: 0.8, rageClicks: 0, totalClicks: 20 },
      ga4: { engagementRate: 0.02, sessions: 10 },
    })
    expect(r.score).toBe(80)
    expect(r.status).toBe('confirmed')
  })

  it('vturb signal ignorado quando vturbEnabled=false', () => {
    const r = composeScore({
      worker: { hit: true },
      vturb: { playRate: 0.01, totalViewed: 100 },
      vturbEnabled: false,
    })
    expect(r.score).toBe(40)
    expect(r.signals.vturb_skipped).toBe('experiment_has_no_player')
  })

  it('vturb signal aplica quando vturbEnabled=true', () => {
    const r = composeScore({
      worker: { hit: true },
      vturb: { playRate: 0.01, totalViewed: 100 },
      vturbEnabled: true,
    })
    expect(r.score).toBe(60)
    expect(r.signals.vturb_low_play_flag).toBe(true)
  })

  it('clarity ignora ruído com poucos cliques', () => {
    const r = composeScore({
      clarity: { deadClickRatio: 1.0, rageClicks: 100, totalClicks: 2 },
    })
    expect(r.score).toBe(0)
    expect(r.signals.clarity_dead_flag).toBeUndefined()
  })

  it('ga4 ignora com poucas sessions', () => {
    const r = composeScore({
      ga4: { engagementRate: 0.01, sessions: 1 },
    })
    expect(r.score).toBe(0)
    expect(r.signals.ga4_low_engagement_flag).toBeUndefined()
  })

  it('full stack confirmed (40+20+10+20+20 = 110, cap implícito)', () => {
    const r = composeScore({
      worker: { hit: true, reason: 'isUtmBot:right_column' },
      clarity: { deadClickRatio: 0.8, rageClicks: 5, totalClicks: 30 },
      ga4: { engagementRate: 0.01, sessions: 10 },
      vturb: { playRate: 0.01, totalViewed: 50 },
      vturbEnabled: true,
    })
    expect(r.score).toBe(110)
    expect(r.status).toBe('confirmed')
  })
})
