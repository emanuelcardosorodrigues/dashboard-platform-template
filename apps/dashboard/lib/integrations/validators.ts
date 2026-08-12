/**
 * Validação "testar conexão" de credenciais por provider — faz uma chamada REAL
 * (leve) à API pra confirmar que o token funciona ANTES de o admin sair achando
 * que está tudo certo. Usado pela tela /admin/projetos (botão "Testar").
 *
 * Princípios:
 *  - chamada barata e somente-leitura (nada que mude estado);
 *  - timeout curto (não trava a UI);
 *  - mensagem clara em pt-BR (o que deu errado);
 *  - Clarity NÃO é testado de verdade (cota de 10 req/dia/projeto — só checa presença);
 *  - providers OAuth (youtube/instagram/tiktok) não passam por aqui (conectam por fluxo).
 */
import type { IntegrationProvider } from './credentials'

export interface ValidationResult {
  ok: boolean
  message: string
}

const TIMEOUT_MS = 12_000

async function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' })
  } finally {
    clearTimeout(t)
  }
}

type Secret = Record<string, string>

async function validateMeta(s: Secret): Promise<ValidationResult> {
  const token = s.accessToken?.trim()
  if (!token) return { ok: false, message: 'Access Token vazio.' }
  const res = await timedFetch(`https://graph.facebook.com/v20.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`)
  const json = await res.json().catch(() => ({})) as { id?: string; name?: string; error?: { message?: string } }
  if (json.id) return { ok: true, message: `Token OK${json.name ? ` (${json.name})` : ''}.` }
  return { ok: false, message: `Meta recusou: ${json.error?.message ?? `HTTP ${res.status}`}` }
}

async function validateVturb(s: Secret): Promise<ValidationResult> {
  const token = s.apiToken?.trim()
  if (!token) return { ok: false, message: 'API Token vazio.' }
  const res = await timedFetch('https://analytics.vturb.net/players/list?timezone=America/Sao_Paulo', {
    headers: { 'X-Api-Token': token, 'X-Api-Version': 'v1' },
  })
  if (res.ok) {
    const arr = await res.json().catch(() => null) as unknown
    const n = Array.isArray(arr) ? arr.length : 0
    return { ok: true, message: `Token OK (${n} player(s) visível(is)).` }
  }
  const body = await res.text().catch(() => '')
  return { ok: false, message: `vTurb recusou: HTTP ${res.status} ${body.slice(0, 120)}` }
}

async function validateHotmart(s: Secret): Promise<ValidationResult> {
  const clientId = s.clientId?.trim()
  const clientSecret = s.clientSecret?.trim()
  if (!clientId || !clientSecret) return { ok: false, message: 'Client ID/Secret vazios.' }
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await timedFetch('https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
  })
  const json = await res.json().catch(() => ({})) as { access_token?: string; error_description?: string }
  if (json.access_token) return { ok: true, message: 'Client ID/Secret OK (autenticou na Hotmart).' }
  return { ok: false, message: `Hotmart recusou: ${json.error_description ?? `HTTP ${res.status}`}. (O webhookToken não é testável aqui — é validado quando a Hotmart dispara.)` }
}

async function validateCloudflare(s: Secret): Promise<ValidationResult> {
  const token = s.apiToken?.trim()
  const accountId = s.accountId?.trim()
  if (!token) return { ok: false, message: 'API Token vazio.' }
  // /user/tokens/verify confirma o token sem precisar do accountId.
  const res = await timedFetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await res.json().catch(() => ({})) as { success?: boolean; errors?: { message?: string }[] }
  if (!json.success) return { ok: false, message: `Cloudflare recusou: ${json.errors?.[0]?.message ?? `HTTP ${res.status}`}` }
  if (!accountId) return { ok: true, message: 'Token OK (Account ID em branco — preencha p/ usar A/B e Quiz).' }
  const acc = await timedFetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const accJson = await acc.json().catch(() => ({})) as { success?: boolean }
  return accJson.success
    ? { ok: true, message: 'Token + Account ID OK.' }
    : { ok: false, message: 'Token OK, mas o Account ID não confere (ou o token não tem acesso a essa conta).' }
}

async function validateGa4(s: Secret): Promise<ValidationResult> {
  const propertyId = s.propertyId?.trim()
  const email = s.serviceAccountEmail?.trim()
  const key = s.privateKey?.trim()
  if (!propertyId || !/^\d+$/.test(propertyId)) return { ok: false, message: 'Property ID deve ser numérico.' }
  if (!email || !key) return { ok: false, message: 'Service account email e private key são obrigatórios.' }
  try {
    const { google } = await import('googleapis')
    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: email, private_key: key.replace(/\\n/g, '\n') },
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    })
    const client = await auth.getClient()
    const tok = await client.getAccessToken()
    if (!tok?.token) return { ok: false, message: 'Não obteve access token (cheque a private key).' }
    // runReport mínimo (1 métrica, ontem) confirma acesso à Property específica.
    const res = await timedFetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateRanges: [{ startDate: '1daysAgo', endDate: 'yesterday' }], metrics: [{ name: 'sessions' }] }),
    })
    if (res.ok) return { ok: true, message: 'Service account autenticou e acessa a Property.' }
    const body = await res.text().catch(() => '')
    return { ok: false, message: `GA4 recusou: HTTP ${res.status} — adicione ${email} como Viewer na Property. ${body.slice(0, 100)}` }
  } catch (e) {
    return { ok: false, message: `Falha na autenticação Google: ${(e as Error).message.slice(0, 150)}` }
  }
}

function validateClarity(s: Secret): ValidationResult {
  const token = s.apiToken?.trim()
  if (!token) return { ok: false, message: 'API Token vazio.' }
  // NÃO testa de verdade: o Data Export tem cota de 10 req/dia/projeto e um teste
  // gastaria 1. Confere só que o token tem cara de JWT/longo.
  if (token.length < 20) return { ok: false, message: 'Token curto demais — confira no Clarity (Settings → Data Export).' }
  return { ok: true, message: 'Token salvo (não testado p/ não gastar a cota de 10/dia do Clarity).' }
}

async function validateNfse(s: Secret): Promise<ValidationResult> {
  const workerUrl = s.workerUrl?.trim()
  const apiKey = s.apiKey?.trim()
  if (!workerUrl || !apiKey) return { ok: false, message: 'Worker URL e API Key são obrigatórios.' }
  if (!/^https?:\/\//.test(workerUrl)) return { ok: false, message: 'Worker URL inválida (precisa começar com http(s)://).' }
  try {
    const res = await timedFetch(workerUrl, { headers: { 'x-api-key': apiKey } })
    // Qualquer resposta HTTP (mesmo 404 de rota) prova que a URL responde.
    return { ok: true, message: `Worker responde (HTTP ${res.status}). A chave é validada nas operações.` }
  } catch (e) {
    return { ok: false, message: `Worker NFS-e inacessível: ${(e as Error).message.slice(0, 120)}` }
  }
}

/**
 * Valida a credencial de um provider com chamada real. `secret` são os campos
 * decifrados (ou recém-digitados antes de salvar). Providers OAuth e desconhecidos
 * retornam ok=true com aviso (não há token de form pra testar).
 */
export async function validateCredential(provider: IntegrationProvider, secret: Secret): Promise<ValidationResult> {
  try {
    switch (provider) {
      case 'meta': return await validateMeta(secret)
      case 'vturb': return await validateVturb(secret)
      case 'hotmart': return await validateHotmart(secret)
      case 'cloudflare': return await validateCloudflare(secret)
      case 'ga4': return await validateGa4(secret)
      case 'clarity': return validateClarity(secret)
      case 'nfse': return await validateNfse(secret)
      default: return { ok: true, message: 'Sem teste automático para esse provider.' }
    }
  } catch (e) {
    return { ok: false, message: `Erro no teste: ${(e as Error).message.slice(0, 180)}` }
  }
}
