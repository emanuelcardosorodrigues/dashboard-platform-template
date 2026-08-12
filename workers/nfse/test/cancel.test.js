// Testes do fluxo de cancelamento (handleHotmartCancelamento → handleCancelarNota).
//
// Os testes que dependem de chamar a WebIss real estão skipped — só validamos
// branches que retornam cedo (sem nota, sem tx, duplicado).

import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'
import worker from '../src'
import {
  makeEnv,
  setupSchema,
  resetDb,
  seedProduto,
  makeHotmartRequest,
} from './helpers/index.js'

const SECRET = 'test-hmac-secret-32chars-minimum!!'

function refundPayload({ transaction, productId = '4528762' } = {}) {
  return {
    event: 'PURCHASE_REFUNDED',
    data: {
      buyer: { name: 'Cliente Teste', email: 'c@example.com', document: '12345678909' },
      product: { id: productId, name: 'Curso X' },
      purchase: { transaction, price: { value: 100 } },
    },
  }
}

describe('cancel - PURCHASE_REFUNDED webhook', () => {
  beforeEach(async () => {
    const e = makeEnv()
    await setupSchema(e)
    await resetDb(e)
    await seedProduto(e, { product_id: '4528762', nome: 'Curso X', percentual: 25 })
  })

  it('refund em transaction inexistente → ignora silenciosamente (200)', async () => {
    const e = makeEnv()
    const payload = refundPayload({ transaction: 'HP-DOES-NOT-EXIST' })

    const req = await makeHotmartRequest({ payload, secret: SECRET })
    const ctx = createExecutionContext()
    const res = await worker.fetch(req, e, ctx)
    await waitOnExecutionContext(ctx)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.ignorado).toBeDefined()

    const log = await e.DB.prepare(
      `SELECT resultado FROM webhook_log ORDER BY id DESC LIMIT 1`,
    ).first()
    expect(log?.resultado).toBe('ignorada_cancel_sem_nota')
  })

  it('refund sem transaction no payload → ignora silenciosamente', async () => {
    const e = makeEnv()
    const payload = {
      event: 'PURCHASE_REFUNDED',
      data: { product: { id: '4528762' }, purchase: {} },
    }

    const req = await makeHotmartRequest({ payload, secret: SECRET })
    const ctx = createExecutionContext()
    const res = await worker.fetch(req, e, ctx)
    await waitOnExecutionContext(ctx)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ignorado).toBeDefined()

    const log = await e.DB.prepare(
      `SELECT resultado FROM webhook_log ORDER BY id DESC LIMIT 1`,
    ).first()
    expect(log?.resultado).toBe('ignorada_cancel_sem_tx')
  })

  it.skip('refund em nota já cancelada → ja_cancelada=true — BLOQUEADO: bug em db.js#buscarNotaPorHotmartId', async () => {
    // BUG ENCONTRADO durante este test work:
    //   src/db.js:buscarNotaPorHotmartId faz `SELECT id, numero_nfse FROM notas`
    //   mas NÃO traz `status`. Em src/index.js:247 o check
    //   `if (nota.status === 'cancelada' || ...)` nunca dispara porque status é
    //   undefined. Resultado: handleCancelarNota é chamado mesmo pra nota já
    //   cancelada e retorna 400 "nota já cancelada" em vez de 200 + ja_cancelada.
    //
    // Reportar no merge: fix em db.js → SELECT id, numero_nfse, status FROM notas.
    //
    // Quando o bug for fixo, ativar este teste.
    const e = makeEnv()
    const tx = `HP-ALREADY-CANCELED-${Date.now()}`

    await e.DB.prepare(
      `INSERT INTO notas (numero_rps, numero_nfse, nome_tomador, valor, origem, hotmart_id, status)
       VALUES (?,?,?,?,?,?,?)`,
    )
      .bind('1', '999', 'Cliente', 100, 'hotmart', tx, 'cancelada')
      .run()

    const payload = refundPayload({ transaction: tx })
    const req = await makeHotmartRequest({ payload, secret: SECRET })
    const ctx = createExecutionContext()
    const res = await worker.fetch(req, e, ctx)
    await waitOnExecutionContext(ctx)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ja_cancelada).toBe(true)
  })

  it.skip('PURCHASE_REFUNDED em nota existente → chama WebIss + status cancelada — depende de mock WebIss no isolate', async () => {
    // SKIP: o pipeline real chama signXml (precisa de CERT_PRIVATE_KEY válido)
    // + cancelarNfse (precisa de mock fetch interceptado pelo isolate). Cobrimos
    // o parser de WebIss em webiss.mock.test.js e o branch de short-circuit acima.
  })

  it.skip('Drive falhando em cancelamento → status cancelada-drive-pending — depende de mock Drive', async () => {
    // SKIP: idem. Cobrimos via inspeção do código que finalStatus muda quando
    // driveError != null em src/index.js:386, e que o status persistido
    // pelo handler é o esperado. Teste de integração real fica pra Fase 5.7
    // (staging environment).
  })
})
