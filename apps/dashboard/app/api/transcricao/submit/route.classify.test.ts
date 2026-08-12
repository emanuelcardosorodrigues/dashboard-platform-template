/**
 * Regressão da classificação de URL no submit de Transcrições (Fase 5).
 * Reimplementa as regex/normalização do route (mantidas em sincronia) — o route
 * importa infra do Next (cookies/supabase) cara de montar em unit test.
 */
import { describe, test, expect } from 'vitest'

const IG_URL_RE = /instagram\.com\/(p|reels?|tv)\/[A-Za-z0-9_-]+/
const YT_URL_RE = /(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/

function classifyUrl(u: string): { source: 'instagram' | 'youtube'; url: string } | null {
  if (IG_URL_RE.test(u)) return { source: 'instagram', url: u }
  const m = u.match(YT_URL_RE)
  if (m) return { source: 'youtube', url: `https://www.youtube.com/watch?v=${m[1]}` }
  return null
}

describe('classifyUrl — Transcrições (IG ∪ YT)', () => {
  test('Instagram continua intocado (reel/post/tv)', () => {
    expect(classifyUrl('https://www.instagram.com/reel/ABC123/')?.source).toBe('instagram')
    expect(classifyUrl('https://instagram.com/p/xYz_9/')?.source).toBe('instagram')
    // URL do IG NÃO é normalizada (mantém a original)
    expect(classifyUrl('https://www.instagram.com/reel/ABC123/')?.url).toBe('https://www.instagram.com/reel/ABC123/')
  })

  test('YouTube em todos os formatos → source youtube + URL canônica', () => {
    const canon = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    for (const u of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?t=30',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ&feature=share',
    ]) {
      const c = classifyUrl(u)
      expect(c?.source).toBe('youtube')
      expect(c?.url).toBe(canon) // dedup por URL passa a funcionar
    }
  })

  test('lixo → null', () => {
    expect(classifyUrl('https://tiktok.com/@x/video/1')).toBeNull()
    expect(classifyUrl('texto solto')).toBeNull()
    expect(classifyUrl('https://youtube.com/watch?v=curto')).toBeNull()
  })
})
