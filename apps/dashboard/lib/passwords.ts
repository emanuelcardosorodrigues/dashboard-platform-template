/**
 * Hash + verify de senhas via Argon2id.
 *
 * Roda só em Node runtime (server actions, API routes, scripts). NUNCA importe
 * isso no middleware Edge — `@node-rs/argon2` é binário nativo.
 */
import { hash, verify } from '@node-rs/argon2'

// Defaults conservadores: memCost 19MiB, timeCost 2, paralelism 1, hashLen 32.
// Custo ≈ 30-80ms por hash em hardware Vercel. Não inflar até precisar.
const ARGON_OPTS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
}

export async function hashPassword(plaintext: string): Promise<string> {
  if (!plaintext || plaintext.length < 8) {
    throw new Error('Senha precisa ter ao menos 8 caracteres')
  }
  if (plaintext.length > 256) {
    throw new Error('Senha muito longa')
  }
  return hash(plaintext, ARGON_OPTS)
}

export async function verifyPassword(hashStored: string, plaintext: string): Promise<boolean> {
  if (!hashStored || !plaintext) return false
  try {
    return await verify(hashStored, plaintext)
  } catch {
    return false
  }
}

// Gera senha temporária legível (admin copia e entrega ao user no onboarding).
// 12 caracteres do alfabeto sem ambiguidade visual.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz'

export function generateTempPassword(length = 12): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return out
}
