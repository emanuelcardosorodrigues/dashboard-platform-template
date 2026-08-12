/**
 * Cifragem de credenciais em repouso (AES-256-GCM).
 *
 * Cada credencial de integração de um projeto (token Meta, vTurb, Hotmart, etc.)
 * é guardada CIFRADA na tabela `workspace_credentials` e só é decifrada sob
 * demanda, dentro da factory de integrações, no servidor. Espelha o padrão
 * systemd-creds da VPS do Chefe (cifra em repouso, decifra como variável sob
 * demanda) adaptado ao Vercel: a master key vive em `CREDENTIALS_MASTER_KEY`
 * (env, tratada com o mesmo rigor de SESSION_SECRET — nunca logar plaintext).
 *
 * Formato persistido: ciphertext/iv/auth_tag em base64. GCM dá confidencialidade
 * + integridade (auth tag detecta adulteração → decrypt lança).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12 // recomendado p/ GCM

export interface EncryptedSecret {
  ciphertext: string // base64
  iv: string         // base64
  authTag: string    // base64
}

function masterKey(): Buffer {
  const raw = process.env.CREDENTIALS_MASTER_KEY
  if (!raw) throw new Error('CREDENTIALS_MASTER_KEY ausente')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(`CREDENTIALS_MASTER_KEY deve ter 32 bytes (base64); tem ${key.length}`)
  }
  return key
}

/** Cifra um objeto de segredos (JSON) → {ciphertext, iv, authTag} base64. */
export function encryptSecret(payload: Record<string, unknown>): EncryptedSecret {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, masterKey(), iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    ciphertext: enc.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

/** Decifra {ciphertext, iv, authTag} → objeto. Lança se a master key ou o tag não baterem. */
export function decryptSecret<T = Record<string, unknown>>(enc: EncryptedSecret): T {
  const decipher = createDecipheriv(ALGO, masterKey(), Buffer.from(enc.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(enc.authTag, 'base64'))
  const dec = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(dec.toString('utf8')) as T
}

/** True se a master key está configurada (sem expor o valor). */
export function credentialsEncryptionReady(): boolean {
  try { masterKey(); return true } catch { return false }
}
