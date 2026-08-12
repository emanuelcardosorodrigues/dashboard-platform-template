import { describe, test, expect } from 'vitest'
import { computeOrganicInsights, type CorrPost, type CorrProfileDay, type CorrComment } from './correlations'

const NOW = new Date('2026-06-12T12:00:00Z').getTime()

function p(over: Partial<CorrPost> & { id: string }): CorrPost {
  return {
    platform: 'youtube', format: 'short', published_at: '2026-05-01T12:00:00Z',
    duration_seconds: 60, views: 1000, apv: 50, completion_rate: null,
    likes: 50, comments_count: 10, shares: 5, saves: 5, tema: null, traffic_sources: null,
    ...over,
  }
}

describe('computeOrganicInsights — guardas de amostra', () => {
  test('poucos posts (<8) → não conclui nada de duração/dia', () => {
    const posts = Array.from({ length: 4 }, (_, i) => p({ id: `x${i}` }))
    const ins = computeOrganicInsights(posts, [], [], NOW)
    expect(ins.find((i) => i.id === 'duracao-retencao')).toBeUndefined()
    expect(ins.find((i) => i.id === 'melhor-dia')).toBeUndefined()
  })
})

describe('duração × retenção', () => {
  test('dispara com faixas distintas (8+ posts)', () => {
    const posts = [
      ...Array.from({ length: 4 }, (_, i) => p({ id: `s${i}`, duration_seconds: 20, apv: 80 })),
      ...Array.from({ length: 4 }, (_, i) => p({ id: `l${i}`, duration_seconds: 600, apv: 30 })),
    ]
    const ins = computeOrganicInsights(posts, [], [], NOW)
    const d = ins.find((i) => i.id === 'duracao-retencao')
    expect(d).toBeDefined()
    expect(d!.titulo).toContain('≤35s')
  })
})

describe('fadiga de tema', () => {
  test('dispara quando views/dia caem ≥30% (6+ posts do tema)', () => {
    const posts = [
      ...Array.from({ length: 3 }, (_, i) => p({ id: `a${i}`, tema: 'implante', published_at: '2026-03-01T12:00:00Z', views: 9000 })),
      ...Array.from({ length: 3 }, (_, i) => p({ id: `b${i}`, tema: 'implante', published_at: '2026-06-01T12:00:00Z', views: 600 })),
    ]
    const ins = computeOrganicInsights(posts, [], [], NOW)
    expect(ins.find((i) => i.id === 'fadiga-implante')).toBeDefined()
  })

  test('NÃO dispara com menos de 6 posts do tema', () => {
    const posts = Array.from({ length: 5 }, (_, i) => p({ id: `a${i}`, tema: 'implante' }))
    const ins = computeOrganicInsights(posts, [], [], NOW)
    expect(ins.find((i) => i.id === 'fadiga-implante')).toBeUndefined()
  })
})

describe('saúde de distribuição YouTube', () => {
  test('flag quando descoberta <20% e anúncio >50%', () => {
    const posts = [p({ id: 'y1', traffic_sources: { ADVERTISING: 900, RELATED_VIDEO: 50, EXT_URL: 50 } })]
    const ins = computeOrganicInsights(posts, [], [], NOW)
    expect(ins.find((i) => i.id === 'distribuicao-yt')).toBeDefined()
  })

  test('canal saudável (descoberta alta) não dispara', () => {
    const posts = [p({ id: 'y1', traffic_sources: { RELATED_VIDEO: 600, YT_SEARCH: 300, ADVERTISING: 100 } })]
    const ins = computeOrganicInsights(posts, [], [], NOW)
    expect(ins.find((i) => i.id === 'distribuicao-yt')).toBeUndefined()
  })
})

describe('cadência semanal', () => {
  test('dispara quando semanas com 3+ posts crescem mais', () => {
    const posts: CorrPost[] = []
    const profile: CorrProfileDay[] = []
    // 2 semanas CHEIAS (3+ posts, ganho alto): 01-03/06 e 08-10/06
    for (const wk of [['2026-06-01', '2026-06-02', '2026-06-03'], ['2026-06-08', '2026-06-09', '2026-06-10']]) {
      wk.forEach((date, i) => {
        posts.push(p({ id: `c${date}-${i}`, published_at: `${date}T12:00:00Z` }))
        profile.push({ date, follows: 50, unfollows: 0, subs_gained: null, subs_lost: null })
      })
    }
    // 2 semanas FRACAS (1 post, ganho baixo): 12/05 e 19/05
    for (const date of ['2026-05-12', '2026-05-19']) {
      posts.push(p({ id: `w${date}`, published_at: `${date}T12:00:00Z` }))
      profile.push({ date, follows: 4, unfollows: 0, subs_gained: null, subs_lost: null })
    }
    // padding pra passar MIN_DIAS
    for (let d = 1; d <= 12; d++) profile.push({ date: `2026-04-${String(d).padStart(2, '0')}`, follows: 1, unfollows: 0, subs_gained: null, subs_lost: null })
    const ins = computeOrganicInsights(posts, profile, [], NOW)
    expect(ins.find((i) => i.id === 'cadencia')).toBeDefined()
  })
})

describe('comentários × top quartil', () => {
  test('tema dominante nos posts top de views', () => {
    const posts = Array.from({ length: 8 }, (_, i) => p({ id: `q${i}`, views: (8 - i) * 1000 }))
    const comments: CorrComment[] = [
      { post_id: 'q0', themes: ['interesse_compra'] },
      { post_id: 'q0', themes: ['interesse_compra'] },
      { post_id: 'q1', themes: ['interesse_compra'] },
    ]
    const ins = computeOrganicInsights(posts, [], comments, NOW)
    expect(ins.find((i) => i.id === 'comentarios-top')).toBeDefined()
  })
})
