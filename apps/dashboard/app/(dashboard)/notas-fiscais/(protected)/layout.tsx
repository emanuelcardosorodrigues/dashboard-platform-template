import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

// Token de sessão: "${sessionId}.${issuedAtMs}.${sigHex}", único por login e
// assinado com SESSION_SECRET (ver login/actions.ts::createSessionToken).
// Substitui a antiga comparação estática com NFSE_SESSION_TOKEN cru.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8h — igual ao maxAge do cookie

async function isValidSessionToken(token: string, secret: string): Promise<boolean> {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [sessionId, issuedAtRaw, sigHex] = parts
  if (!sessionId || !/^\d+$/.test(issuedAtRaw) || !/^[0-9a-f]+$/i.test(sigHex)) return false

  const issuedAt = Number(issuedAtRaw)
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > SESSION_TTL_MS) return false

  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    )
    const sig = new Uint8Array(sigHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
    return await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(`${sessionId}.${issuedAtRaw}`))
  } catch {
    return false
  }
}

export default async function NotasFiscaisProtectedLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies()
  const token = store.get('nfse_auth')?.value
  const secret = process.env.SESSION_SECRET

  if (!token || !secret || !(await isValidSessionToken(token, secret))) {
    redirect('/notas-fiscais/login')
  }

  return <>{children}</>
}
