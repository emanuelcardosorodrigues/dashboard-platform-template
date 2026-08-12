// Helpers compartilhados pra suite vitest do dashboard-nfse.
// Não importam do src/ (mantém testes isolados de mudanças de produção).

import { env } from 'cloudflare:test'

/**
 * Env base para os testes. Cada teste pode dar override:
 *   const e = makeEnv({ HOTMART_TOKEN: 'outro' })
 */
export function makeEnv(overrides = {}) {
  return {
    ...env,
    API_KEY: 'test-key',
    HOTMART_TOKEN: 'test-hmac-secret-32chars-minimum!!',
    ENVIRONMENT: 'staging',
    // Não setamos GOOGLE_*, RESEND_*, CERT_* — testes que precisarem dão override.
    ...overrides,
  }
}

/**
 * Garante o schema básico no D1 do test pool antes de cada describe.
 * Não usa as migrations reais pra evitar acoplar testes ao fs / migration runner.
 */
export async function setupSchema(targetEnv = env) {
  if (!targetEnv.DB) return
  // Tabelas só são criadas se não existirem — testes podem chamar várias vezes.
  await targetEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS notas (id INTEGER PRIMARY KEY AUTOINCREMENT, numero_rps TEXT, numero_nfse TEXT, doc_tomador TEXT, nome_tomador TEXT, email_tomador TEXT, valor REAL, status TEXT NOT NULL DEFAULT 'emitida', origem TEXT, hotmart_id TEXT, xml_completo TEXT, drive_file_id TEXT, drive_link TEXT, product_id TEXT, nome_produto TEXT, criado_em DATETIME DEFAULT (datetime('now')))`,
  )
  await targetEnv.DB.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_notas_hotmart_id ON notas(hotmart_id) WHERE hotmart_id IS NOT NULL`,
  )
  await targetEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS produtos (product_id TEXT PRIMARY KEY, nome TEXT NOT NULL, percentual REAL NOT NULL DEFAULT 25)`,
  )
  await targetEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)`,
  )
  await targetEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS drive_folders (path TEXT PRIMARY KEY, folder_id TEXT NOT NULL, criado_em DATETIME DEFAULT (datetime('now')))`,
  )
  await targetEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS webhook_log (id INTEGER PRIMARY KEY AUTOINCREMENT, evento TEXT, product_id TEXT, transaction_id TEXT, payload_json TEXT, resultado TEXT, mensagem TEXT, criado_em DATETIME DEFAULT (datetime('now')))`,
  )
  await targetEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, acao TEXT NOT NULL, ator TEXT, nota_id INTEGER, detalhes_json TEXT, criado_em DATETIME DEFAULT (datetime('now')))`,
  )
}

/**
 * Limpa todas as tabelas voláteis (preserva schema). Use em beforeEach.
 */
export async function resetDb(targetEnv = env) {
  if (!targetEnv.DB) return
  await targetEnv.DB.exec(`DELETE FROM notas`)
  await targetEnv.DB.exec(`DELETE FROM webhook_log`)
  await targetEnv.DB.exec(`DELETE FROM produtos`)
  await targetEnv.DB.exec(`DELETE FROM config`)
  await targetEnv.DB.exec(`DELETE FROM drive_folders`)
  // INSERT default que a migration 0002 faz
  await targetEnv.DB.prepare(
    `INSERT OR IGNORE INTO config (chave, valor) VALUES ('email_cliente_ativo', 'false')`,
  ).run()
}

/**
 * Insere produto pra fixture.
 */
export async function seedProduto(
  targetEnv,
  { product_id = '4528762', nome = 'Produto Teste', percentual = 25 } = {},
) {
  if (!targetEnv.DB) return
  await targetEnv.DB.prepare(
    `INSERT OR REPLACE INTO produtos (product_id, nome, percentual) VALUES (?,?,?)`,
  )
    .bind(product_id, nome, percentual)
    .run()
}

/**
 * Gera assinatura HMAC-SHA256 em hex sobre body+secret. Idêntico ao algoritmo
 * usado pelo handler (e ao que a Hotmart usa).
 */
export async function signHmac(body, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(body),
  )
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Constrói uma Request pro webhook Hotmart com assinatura HMAC já calculada.
 * Use `signatureOverride` pra forçar assinatura inválida nos testes.
 */
export async function makeHotmartRequest({
  payload,
  secret,
  signatureOverride,
  headerOverrides = {},
  url = 'http://example.com/webhook/hotmart',
  rawBody,
}) {
  const body = rawBody ?? JSON.stringify(payload)
  const signature =
    signatureOverride !== undefined
      ? signatureOverride
      : await signHmac(body, secret)
  const headers = {
    'Content-Type': 'application/json',
    ...(signature !== null ? { 'x-hotmart-signature': signature } : {}),
    ...headerOverrides,
  }
  return new Request(url, { method: 'POST', headers, body })
}

/**
 * Cria um payload PURCHASE_COMPLETE plausível (Hotmart-like).
 */
export function hotmartPurchasePayload(overrides = {}) {
  return {
    event: 'PURCHASE_COMPLETE',
    data: {
      buyer: {
        name: 'Cliente Teste',
        email: 'cliente@example.com',
        document: '12345678909',
      },
      product: { id: '4528762', name: 'Produto Teste' },
      purchase: {
        transaction: `HP${Date.now()}${Math.floor(Math.random() * 1000)}`,
        price: { value: 100 },
      },
    },
    ...overrides,
  }
}

/**
 * Mock simples de `fetch` global. Retorna uma função que devolve respostas
 * baseadas em matchers. Restore com `restoreFetch(originalFetch)`.
 *
 * Uso:
 *   const orig = globalThis.fetch
 *   globalThis.fetch = mockFetch([
 *     { match: (u) => u.includes('webiss'), response: { body: '...', status: 200 } },
 *   ])
 *   // ... testar
 *   globalThis.fetch = orig
 */
export function mockFetch(routes = []) {
  return async (url, opts) => {
    const u = typeof url === 'string' ? url : url.url
    for (const route of routes) {
      if (route.match(u, opts)) {
        if (typeof route.response === 'function') {
          return route.response(u, opts)
        }
        const r = route.response
        return new Response(r.body ?? '', {
          status: r.status ?? 200,
          headers: r.headers ?? {},
        })
      }
    }
    throw new Error(`mockFetch: rota não mapeada para ${u}`)
  }
}

/**
 * RPS XML mínimo (estrutura ABRASF 2.02) pra testes de assinatura.
 * Não é XML completamente válido p/ WebIss — só serve pra signEnveloped achar
 * o elemento `InfDeclaracaoPrestacaoServico` e `LoteRps` e inserir Signature.
 */
export const RPS_XML_FIXTURE = `<EnviarLoteRpsSincronoEnvio xmlns="http://www.abrasf.org.br/nfse.xsd"><LoteRps Id="lote1" versao="2.02"><NumeroLote>1</NumeroLote><CpfCnpj><Cnpj>00000000000000</Cnpj></CpfCnpj><InscricaoMunicipal>0000000</InscricaoMunicipal><QuantidadeRps>1</QuantidadeRps><ListaRps><Rps><InfDeclaracaoPrestacaoServico Id="rps1"><Rps><IdentificacaoRps><Numero>1</Numero><Serie>RPS</Serie><Tipo>1</Tipo></IdentificacaoRps><DataEmissao>2026-05-13T00:00:00</DataEmissao><Status>1</Status></Rps><Competencia>2026-05-13</Competencia><Servico><Valores><ValorServicos>100.00</ValorServicos><IssRetido>2</IssRetido></Valores><ItemListaServico>0802</ItemListaServico><Discriminacao>Teste</Discriminacao><CodigoMunicipio>0000000</CodigoMunicipio></Servico><Prestador><CpfCnpj><Cnpj>00000000000000</Cnpj></CpfCnpj><InscricaoMunicipal>0000000</InscricaoMunicipal></Prestador></InfDeclaracaoPrestacaoServico></Rps></ListaRps></LoteRps></EnviarLoteRpsSincronoEnvio>`
