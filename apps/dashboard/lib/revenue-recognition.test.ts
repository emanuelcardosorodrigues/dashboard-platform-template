/**
 * Teste-trava de reconhecimento de receita (Fase 2 #11).
 * Boleto impresso (PURCHASE_BILLET_PRINTED) NÃO é pagamento confirmado e não
 * pode voltar pra lista de eventos que inserem transação como receita. Guarda
 * de fonte porque o array `approved` é local ao handler (não exportável) e a
 * rota importa infra do Next (custoso de montar em unit test).
 */
import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(__dirname, '..', 'app/api/webhook/hotmart/route.ts'), 'utf8')

describe('reconhecimento de receita — Hotmart (trava)', () => {
  test('a lista `approved` NÃO inclui PURCHASE_BILLET_PRINTED', () => {
    const m = src.match(/const approved = \[([^\]]*)\]/)
    expect(m, 'array `approved` deve existir').not.toBeNull()
    const lista = m![1]
    expect(lista, 'boleto impresso ≠ pago; não pode contar como receita').not.toContain('PURCHASE_BILLET_PRINTED')
    // sanidade: os eventos de pagamento confirmado continuam lá
    expect(lista).toContain('PURCHASE_APPROVED')
    expect(lista).toContain('PURCHASE_COMPLETE')
  })
})
