import { describe, test, expect, beforeAll } from 'vitest'
import { encryptSecret, decryptSecret, credentialsEncryptionReady } from './secrets'

// Master key fixa de teste (32 bytes base64) — NÃO é a de produção.
const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

describe('secrets — AES-256-GCM round-trip', () => {
  beforeAll(() => { process.env.CREDENTIALS_MASTER_KEY = TEST_KEY })

  test('cifra e decifra de volta o mesmo objeto', () => {
    const payload = { token: 'abc123', accountIds: ['1', '2'], n: 42 }
    const enc = encryptSecret(payload)
    expect(enc.ciphertext).toBeTruthy()
    expect(enc.iv).toBeTruthy()
    expect(enc.authTag).toBeTruthy()
    // ciphertext não contém o segredo em claro
    expect(Buffer.from(enc.ciphertext, 'base64').toString('utf8')).not.toContain('abc123')
    const dec = decryptSecret<typeof payload>(enc)
    expect(dec).toEqual(payload)
  })

  test('IV aleatório → mesmo payload gera ciphertext diferente', () => {
    const p = { token: 'x' }
    expect(encryptSecret(p).ciphertext).not.toBe(encryptSecret(p).ciphertext)
  })

  test('adulteração do ciphertext faz o decrypt lançar (integridade GCM)', () => {
    const enc = encryptSecret({ token: 'y' })
    const tampered = { ...enc, ciphertext: Buffer.from('lixo-adulterado').toString('base64') }
    expect(() => decryptSecret(tampered)).toThrow()
  })

  test('credentialsEncryptionReady reflete a presença da key', () => {
    expect(credentialsEncryptionReady()).toBe(true)
    const saved = process.env.CREDENTIALS_MASTER_KEY
    delete process.env.CREDENTIALS_MASTER_KEY
    expect(credentialsEncryptionReady()).toBe(false)
    process.env.CREDENTIALS_MASTER_KEY = saved
  })
})
