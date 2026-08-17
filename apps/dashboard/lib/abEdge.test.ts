import { describe, expect, test, beforeEach } from 'vitest'
import { edgeForWorkspace, __resetEdgeCache } from './abEdge'

const WS_A = 'ws-aaaaaaaa'
const WS_B = 'ws-bbbbbbbb'
const WS_C = 'ws-cccccccc'

const MAP = JSON.stringify({
  [WS_A]: { account_id: 'acc-a', api_token: 'tk-a', kv_namespace_id: 'kv-a', d1_database_id: 'd1-a' },
  [WS_B]: { account_id: 'acc-b', api_token: 'tk-b', kv_namespace_id: 'kv-b', d1_database_id: 'd1-b' },
})

describe('borda A/B por workspace (independência de conta)', () => {
  beforeEach(() => __resetEdgeCache())

  test('cada workspace resolve a SUA conta — nunca a de outro', () => {
    const a = edgeForWorkspace(WS_A, { AB_EDGE_ACCOUNTS: MAP })
    const b = edgeForWorkspace(WS_B, { AB_EDGE_ACCOUNTS: MAP })
    expect(a).toEqual({ accountId: 'acc-a', apiToken: 'tk-a', kvNamespaceId: 'kv-a', d1DatabaseId: 'd1-a' })
    expect(b?.accountId).toBe('acc-b')
    expect(b?.accountId).not.toBe(a?.accountId)
  })

  test('workspace sem entrada no mapa → null (pula; NÃO usa conta de outro)', () => {
    expect(edgeForWorkspace(WS_C, { AB_EDGE_ACCOUNTS: MAP })).toBeNull()
  })

  test('env presente mas malformado → null (nunca cai no legado)', () => {
    expect(edgeForWorkspace(WS_A, { AB_EDGE_ACCOUNTS: '{lixo', CLOUDFLARE_ACCOUNT_ID: 'acc-legado', CLOUDFLARE_API_TOKEN: 't', AB_KV_NAMESPACE_ID: 'k' })).toBeNull()
  })

  test('sem AB_EDGE_ACCOUNTS → legado de conta única (compat pré-migração)', () => {
    const e = edgeForWorkspace(WS_B, { CLOUDFLARE_ACCOUNT_ID: 'acc-legado', CLOUDFLARE_API_TOKEN: 'tk', AB_KV_NAMESPACE_ID: 'kv', D1_DATABASE_ID: 'd1' })
    expect(e).toEqual({ accountId: 'acc-legado', apiToken: 'tk', kvNamespaceId: 'kv', d1DatabaseId: 'd1' })
  })

  test('sem env nenhum → null', () => {
    expect(edgeForWorkspace(WS_A, {})).toBeNull()
  })
})
