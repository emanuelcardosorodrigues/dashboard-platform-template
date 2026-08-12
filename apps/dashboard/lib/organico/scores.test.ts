import { describe, test, expect } from 'vitest'
import { median, viewsPerDay, engagementRate, retentionPillar, computeScores, type ScorablePost } from './scores'

const NOW = new Date('2026-06-12T12:00:00Z').getTime()

function post(p: Partial<ScorablePost> & { id: string }): ScorablePost {
  return {
    platform: 'youtube', format: 'short',
    published_at: '2026-06-02T12:00:00Z', // 10 dias
    duration_seconds: 60, views: 1000, likes: 50, comments_count: 10,
    shares: 5, saves: null, apv: 60, completion_rate: null, avg_watch_time_s: null,
    ...p,
  }
}

describe('median', () => {
  test('ímpar/par/vazio', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('viewsPerDay (idade normalizada)', () => {
  test('1000 views em 10 dias = 100/dia', () => {
    expect(viewsPerDay(post({ id: 'a' }), NOW)).toBeCloseTo(100, 0)
  })
  test('post de hoje: idade mínima 1 dia (sem divisão por ~0)', () => {
    const p = post({ id: 'b', published_at: new Date(NOW - 3600_000).toISOString() })
    expect(viewsPerDay(p, NOW)).toBe(1000)
  })
  test('views null → null (gap honesto, não 0)', () => {
    expect(viewsPerDay(post({ id: 'c', views: null }), NOW)).toBeNull()
  })
})

describe('pilares', () => {
  test('engajamento = (likes+comments+shares+saves)/views', () => {
    expect(engagementRate(post({ id: 'a', saves: 35 }))).toBeCloseTo(0.1)
  })
  test('retenção prioriza APV; cai pra completion; depois watch/duração', () => {
    expect(retentionPillar(post({ id: 'a', apv: 55 }))).toBe(55)
    expect(retentionPillar(post({ id: 'b', apv: null, completion_rate: 40 }))).toBe(40)
    expect(retentionPillar(post({ id: 'c', apv: null, avg_watch_time_s: 30, duration_seconds: 60 }))).toBe(50)
    expect(retentionPillar(post({ id: 'd', apv: null }))).toBeNull()
  })
})

describe('computeScores', () => {
  test('outlier = views/dia ÷ mediana do cohort', () => {
    const posts = [
      post({ id: 'p1', views: 100 }),
      post({ id: 'p2', views: 100 }),
      post({ id: 'p3', views: 100 }),
      post({ id: 'p4', views: 100 }),
      post({ id: 'viral', views: 300 }),
    ]
    const scores = computeScores(posts, NOW)
    expect(scores.get('viral')!.outlier).toBe(3)
    expect(scores.get('p1')!.outlier).toBe(1)
  })

  test('cohort cai pra plataforma quando formato tem n<5', () => {
    const posts = [
      post({ id: 'l1', format: 'long', views: 100 }),
      post({ id: 's1' }), post({ id: 's2' }), post({ id: 's3' }),
      post({ id: 's4' }), post({ id: 's5' }),
    ]
    // 'long' só tem 1 → compara com a plataforma inteira, sem crash
    const scores = computeScores(posts, NOW)
    expect(scores.get('l1')!.outlier).not.toBeNull()
  })

  test('composite 100 = mediana; campeão acima de 150', () => {
    const posts = [
      post({ id: 'a', views: 100, likes: 5 }),
      post({ id: 'b', views: 100, likes: 5 }),
      post({ id: 'c', views: 100, likes: 5 }),
      post({ id: 'd', views: 100, likes: 5 }),
      post({ id: 'champ', views: 400, likes: 80, apv: 90 }),
    ]
    const scores = computeScores(posts, NOW)
    expect(scores.get('a')!.composite).toBeCloseTo(100, 0)
    expect(scores.get('champ')!.composite!).toBeGreaterThan(150)
  })

  test('post sem nenhuma métrica → scores null', () => {
    const posts = [
      post({ id: 'vazio', views: null, likes: null, comments_count: null, shares: null, apv: null }),
      post({ id: 'ok' }),
    ]
    const scores = computeScores(posts, NOW)
    expect(scores.get('vazio')).toEqual({ outlier: null, composite: null, viewsPerDay: null })
  })
})
