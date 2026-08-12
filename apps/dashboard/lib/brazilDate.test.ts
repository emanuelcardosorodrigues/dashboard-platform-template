import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { brazilDateStr } from './brazilDate'

describe('brazilDateStr', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  test('retorna hoje em UTC-3', () => {
    vi.setSystemTime(new Date('2026-05-12T02:00:00Z')) // ainda 11/05 em Brasília
    expect(brazilDateStr(0)).toBe('2026-05-11')
  })

  test('retorna ontem com offset=1', () => {
    vi.setSystemTime(new Date('2026-05-12T15:00:00Z'))
    expect(brazilDateStr(1)).toBe('2026-05-11')
  })

  test('retorna hoje (Brasília) quando UTC está no mesmo dia tarde', () => {
    vi.setSystemTime(new Date('2026-05-12T20:00:00Z')) // 17h em Brasília
    expect(brazilDateStr(0)).toBe('2026-05-12')
  })
})
