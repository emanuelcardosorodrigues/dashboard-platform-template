/**
 * Teste-trava de isolamento multi-tenant (Fase 2 #1/#2/#3).
 * Varre o fonte pra garantir que queries de tabelas com workspace_id NUNCA
 * voltem a rodar sem filtrar por tenant. Se alguém remover o `.eq('workspace_id'`
 * dessas queries, este teste quebra ANTES de vazar dado entre projetos.
 *
 * É um teste de FONTE (não de runtime) de propósito: essas queries dependem de
 * banco/cookie e não têm cobertura de integração; a trava aqui é barata e direta.
 */
import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function src(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8')
}

/** Extrai o bloco de uma query `.from('<tabela>')` até o `.select(...)` seguinte + ~6 linhas. */
function queryBlock(source: string, tabela: string): string {
  const idx = source.indexOf(`.from('${tabela}')`)
  expect(idx, `query .from('${tabela}') deve existir`).toBeGreaterThan(-1)
  return source.slice(idx, idx + 600)
}

describe('isolamento multi-tenant (trava de regressão)', () => {
  test('criativo_analise filtra por workspace_id (F2 #1)', () => {
    const bloco = queryBlock(src('lib/criativos.ts'), 'criativo_analise')
    expect(bloco, 'criativo_analise sem filtro de tenant → vaza análise/transcrição entre projetos').toContain(".eq('workspace_id'")
  })

  test('config filtra por workspace_id (F2 #2/#3)', () => {
    const bloco = queryBlock(src('lib/supabase.ts'), 'config')
    expect(bloco, 'config sem filtro de tenant → tenants compartilham preco_mentoria etc.').toContain(".eq('workspace_id'")
  })

  test('perpetuo_graphs filtra por workspace_id (B-P0)', () => {
    const bloco = queryBlock(src('lib/perpetuoGraph.ts'), 'perpetuo_graphs')
    expect(bloco, 'perpetuo_graphs sem filtro de tenant → um funil carrega o layout de outro projeto').toContain(".eq('workspace_id'")
  })

  test('_configCore recebe workspaceId (cache particionado por tenant)', () => {
    const s = src('lib/supabase.ts')
    // a chave de cache foi bumpada de v1 (global) → v2 (por-workspace)
    expect(s).toContain('sb-config-core-v2')
    expect(s).not.toContain('sb-config-core-v1')
  })
})
