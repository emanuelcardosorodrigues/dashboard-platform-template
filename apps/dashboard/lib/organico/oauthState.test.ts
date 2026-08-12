import { describe, test, expect, beforeAll } from 'vitest'
import { newNonce, signState, verifyState } from './oauthState'

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-secret-oauth-state'
})

describe('oauth state (CSRF + workspace binding)', () => {
  test('round-trip válido devolve ws e nonce', () => {
    const nonce = newNonce()
    const state = signState('faafca5a-fb53-404f-8469-499d8869944c', nonce)
    const parsed = verifyState(state)
    expect(parsed?.ws).toBe('faafca5a-fb53-404f-8469-499d8869944c')
    expect(parsed?.nonce).toBe(nonce)
  })

  test('assinatura adulterada → null (falha fechado)', () => {
    const state = signState('ws-1', newNonce())
    expect(verifyState(state.slice(0, -2) + 'xx')).toBeNull()
  })

  test('payload adulterado → null', () => {
    const state = signState('ws-1', newNonce())
    const [payload, sig] = [state.slice(0, state.lastIndexOf('.')), state.slice(state.lastIndexOf('.') + 1)]
    const forged = Buffer.from(JSON.stringify({ ws: 'ws-EVIL', nonce: 'x', exp: Date.now() + 60000 })).toString('base64url')
    expect(verifyState(`${forged}.${sig}`)).toBeNull()
    expect(payload.length).toBeGreaterThan(0)
  })

  test('null/lixo → null', () => {
    expect(verifyState(null)).toBeNull()
    expect(verifyState('')).toBeNull()
    expect(verifyState('abc')).toBeNull()
    expect(verifyState('a.b')).toBeNull()
  })
})
