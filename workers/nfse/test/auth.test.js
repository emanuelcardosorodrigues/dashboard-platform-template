// Testes da camada de auth do webhook Hotmart.
//
// Estes testes cobrem o ESTADO PÓS-REFATOR descrito no plano (seções 3.1, 3.2, 3.3):
//   - HMAC obrigatório, sem fallback hottok
//   - Comparação timing-safe via crypto.subtle.verify
//   - Case-insensitive (toLowerCase)
//   - Validação de formato hex 64-char antes de processar
//   - Boot-time guard para HOTMART_TOKEN ausente (503)
//
// Alguns cenários estão marcados com `it.skip` quando dependem de mudanças que
// ainda não estão no src/ (ver lista no PR).

import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import worker from '../src'
import {
  makeEnv,
  setupSchema,
  resetDb,
  signHmac,
  makeHotmartRequest,
  hotmartPurchasePayload,
} from './helpers/index.js'

const SECRET = 'test-hmac-secret-32chars-minimum!!'

describe('auth - HMAC Hotmart webhook', () => {
  beforeEach(async () => {
    const e = makeEnv()
    await setupSchema(e)
    await resetDb(e)
  })

  it('HMAC válido passa do gate de auth (não retorna 401)', async () => {
    const e = makeEnv()
    // Evento ignorado pra não rodar o pipeline completo (que precisaria de
    // mocks de WebIss, Drive etc). Resposta 200 + ignorado confirma que o
    // gate de auth foi passado.
    const payload = { event: 'NOOP_EVENT_FOR_AUTH_TEST' }
    const req = await makeHotmartRequest({ payload, secret: SECRET })
    const ctx = createExecutionContext()
    const res = await worker.fetch(req, e, ctx)
    await waitOnExecutionContext(ctx)
    expect(res.status).not.toBe(401)
  })

  it('HMAC inválido (deadbeef) retorna 401 e grava auth_fail_hmac', async () => {
    const e = makeEnv()
    const payload = hotmartPurchasePayload()
    const req = await makeHotmartRequest({
      payload,
      secret: SECRET,
      signatureOverride: 'deadbeef'.repeat(8), // 64 hex chars, formato OK mas valor errado
    })
    const ctx = createExecutionContext()
    const res = await worker.fetch(req, e, ctx)
    await waitOnExecutionContext(ctx)
    expect(res.status).toBe(401)

    const log = await e.DB.prepare(
      `SELECT resultado FROM webhook_log ORDER BY id DESC LIMIT 1`,
    ).first()
    expect(log?.resultado).toBe('auth_fail_hmac')
  })

  it.skip('HMAC em maiúsculas aceita (case-insensitive) — depende do refator 3.1', async () => {
    // Estado-alvo: signature.toLowerCase() antes de comparar.
    // Estado atual (src/index.js linha 89): hex === normalized é case-sensitive ⇒ 401.
    // Ativar este teste quando o refator 3.1 aterrissar no src/.
    const e = makeEnv()
    const payload = { event: 'NOOP_EVENT' }
    const body = JSON.stringify(payload)
    const sig = await signHmac(body, SECRET)
    const req = await makeHotmartRequest({
      payload,
      secret: SECRET,
      signatureOverride: sig.toUpperCase(),
      rawBody: body,
    })
    const ctx = createExecutionContext()
    const res = await worker.fetch(req, e, ctx)
    await waitOnExecutionContext(ctx)
    expect(res.status).not.toBe(401)
  })

  it('Header x-hotmart-signature ausente → 401 + auth_fail_hmac_missing', async () => {
    const e = makeEnv()
    const req = new Request('http://example.com/webhook/hotmart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'PURCHASE_COMPLETE' }),
    })
    const ctx = createExecutionContext()
    const res = await worker.fetch(req, e, ctx)
    await waitOnExecutionContext(ctx)

    // Estado-alvo (3.2): sem fallback hottok → 401 sempre que não há HMAC.
    // Estado atual: também 401 (porque não enviamos x-hotmart-hottok).
    expect(res.status).toBe(401)

    const log = await e.DB.prepare(
      `SELECT resultado FROM webhook_log ORDER BY id DESC LIMIT 1`,
    ).first()
    // No estado pós-refator é exatamente auth_fail_hmac_missing.
    expect(['auth_fail_hmac_missing', 'auth_fail_hottok']).toContain(
      log?.resultado,
    )
  })

  it('Formato inválido (não-hex, tamanho errado) → 401', async () => {
    const e = makeEnv()
    const cases = [
      'xyz123', // muito curto
      'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', // 64 chars não-hex
      'a'.repeat(63), // hex mas tamanho errado
      'a'.repeat(65),
    ]
    for (const bad of cases) {
      const payload = hotmartPurchasePayload()
      const req = await makeHotmartRequest({
        payload,
        secret: SECRET,
        signatureOverride: bad,
      })
      const ctx = createExecutionContext()
      const res = await worker.fetch(req, e, ctx)
      await waitOnExecutionContext(ctx)
      expect(res.status).toBe(401)
    }
  })

  it.skip('Secret ausente em env → 503 (boot-time guard) — depende do guard da 3.3', async () => {
    // Requer src/index.js implementar: if (!env.HOTMART_TOKEN || token.length<16) return 503
    const e = makeEnv({ HOTMART_TOKEN: '' })
    const payload = hotmartPurchasePayload()
    const req = await makeHotmartRequest({ payload, secret: SECRET })
    const ctx = createExecutionContext()
    const res = await worker.fetch(req, e, ctx)
    await waitOnExecutionContext(ctx)
    expect(res.status).toBe(503)
  })

  it.skip('Body grande (>1MB) é rejeitado early — depende de guard explícito', async () => {
    // Requer src/index.js implementar: if (request.headers.get('content-length') > LIMIT) return 413
    // Sem o guard, o body é lido inteiro antes de ser rejeitado.
    const e = makeEnv()
    const bigBody = JSON.stringify({ event: 'X', pad: 'a'.repeat(2 * 1024 * 1024) })
    const sig = await signHmac(bigBody, SECRET)
    const req = new Request('http://example.com/webhook/hotmart', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hotmart-signature': sig,
        'content-length': String(bigBody.length),
      },
      body: bigBody,
    })
    const ctx = createExecutionContext()
    const res = await worker.fetch(req, e, ctx)
    await waitOnExecutionContext(ctx)
    expect(res.status).toBe(413)
  })

  it('Prefixo sha256= é stripped antes da comparação', async () => {
    const e = makeEnv()
    const payload = { event: 'NOOP_EVENT' }
    const body = JSON.stringify(payload)
    const sig = await signHmac(body, SECRET)
    const req = await makeHotmartRequest({
      payload,
      secret: SECRET,
      signatureOverride: `sha256=${sig}`,
      rawBody: body,
    })
    const ctx = createExecutionContext()
    const res = await worker.fetch(req, e, ctx)
    await waitOnExecutionContext(ctx)
    expect(res.status).not.toBe(401)
  })

  it('Body vazio sem signature válida → 401', async () => {
    const e = makeEnv()
    const req = new Request('http://example.com/webhook/hotmart', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hotmart-signature': 'a'.repeat(64),
      },
      body: '',
    })
    const ctx = createExecutionContext()
    const res = await worker.fetch(req, e, ctx)
    await waitOnExecutionContext(ctx)
    expect(res.status).toBe(401)
  })

  it.skip('Múltiplas assinaturas no header (sep. vírgula) — só primeira usada — ambíguo, decidir depois', async () => {
    // Hotmart docs não mencionam multi-sig. Comportamento esperado não está
    // definido no plano. Marcado skip pra resolver durante review.
  })

  it('Assinatura com bytes nulos (%00 URL-encoded) → 401', async () => {
    // Header HTTP não pode conter \x00 literal (Request constructor rejeita).
    // Hotmart nunca mandaria bytes nulos crus — mas alguém testando manualmente
    // poderia URL-encoded. Validamos que o handler trata como assinatura inválida.
    const e = makeEnv()
    const payload = hotmartPurchasePayload()
    const req = await makeHotmartRequest({
      payload,
      secret: SECRET,
      // %00 fica como string literal "%00" — caractere ASCII normal, mas formato hex inválido.
      signatureOverride: 'a'.repeat(30) + '%00%00' + 'a'.repeat(28),
    })
    const ctx = createExecutionContext()
    const res = await worker.fetch(req, e, ctx)
    await waitOnExecutionContext(ctx)
    expect(res.status).toBe(401)
  })

  it.skip('crypto.subtle.verify é chamado (timing-safe) — depende do refator 3.1', async () => {
    // Requer que src/index.js use crypto.subtle.verify em vez de hex===normalized.
    // Quando o refator aterrissar, este spy confirma que a função timing-safe
    // está no caminho de execução.
    const verifySpy = vi.spyOn(crypto.subtle, 'verify')
    const e = makeEnv()
    const payload = hotmartPurchasePayload()
    const req = await makeHotmartRequest({ payload, secret: SECRET })
    const ctx = createExecutionContext()
    await worker.fetch(req, e, ctx)
    await waitOnExecutionContext(ctx)
    expect(verifySpy).toHaveBeenCalled()
    verifySpy.mockRestore()
  })
})
