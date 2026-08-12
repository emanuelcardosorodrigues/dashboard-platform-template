import { describe, test, expect } from 'vitest'
import { validateCredential } from './validators'

describe('validateCredential — guardas de campo vazio (sem chamada de rede)', () => {
  test('meta sem token → erro claro', async () => {
    const r = await validateCredential('meta', {})
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/vazio/i)
  })

  test('hotmart sem client id/secret → erro', async () => {
    const r = await validateCredential('hotmart', { clientId: '', clientSecret: '' })
    expect(r.ok).toBe(false)
  })

  test('ga4 com property não-numérico → erro', async () => {
    const r = await validateCredential('ga4', { propertyId: 'abc', serviceAccountEmail: 'x@y.z', privateKey: 'k' })
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/numérico/i)
  })

  test('clarity: não faz chamada (cota) e aceita token longo', async () => {
    const ok = await validateCredential('clarity', { apiToken: 'x'.repeat(40) })
    expect(ok.ok).toBe(true)
    expect(ok.message).toMatch(/cota/i)
    const bad = await validateCredential('clarity', { apiToken: 'curto' })
    expect(bad.ok).toBe(false)
  })

  test('nfse com URL inválida → erro', async () => {
    const r = await validateCredential('nfse', { workerUrl: 'ftp://x', apiKey: 'k' })
    expect(r.ok).toBe(false)
  })

  test('provider OAuth (youtube) → ok sem teste automático', async () => {
    const r = await validateCredential('youtube', {})
    expect(r.ok).toBe(true)
  })
})
