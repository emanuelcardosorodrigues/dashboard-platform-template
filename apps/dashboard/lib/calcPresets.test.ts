/**
 * Teste-trava de isolamento das predefinições da Calculadora (S8).
 *
 * Por que teste de FONTE e não de runtime: RLS não isola usuário neste app — o servidor
 * fala com o Supabase via service_role, que bypassa policy por design do Postgres. A
 * migration 0066 liga RLS deny-all só pra barrar a chave anon. Quem de fato impede um
 * usuário de ver preset de outro (ou um projeto de ver preset de outro projeto) é o
 * filtro `workspace_id` + `owner_user` em TODA query de app/actions/calcPresets.ts.
 *
 * Se alguém remover um dos dois filtros, ou acrescentar uma query nova sem eles, este
 * teste quebra ANTES de vazar. Mesmo padrão de lib/tenant-isolation.test.ts.
 */
import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FONTE = 'app/actions/calcPresets.ts'

function src(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8')
}

/** Blocos que começam em cada `.from('calc_presets')` e vão até ~700 chars depois. */
function blocosDaTabela(source: string, tabela: string): string[] {
  const alvo = `.from('${tabela}')`
  const out: string[] = []
  let i = source.indexOf(alvo)
  while (i !== -1) {
    out.push(source.slice(i, i + 700))
    i = source.indexOf(alvo, i + 1)
  }
  return out
}

describe('isolamento das predefinições da Calculadora (trava de regressão)', () => {
  const fonte = src(FONTE)
  const blocos = blocosDaTabela(fonte, 'calc_presets')

  test('existem exatamente 3 queries em calc_presets (listar, salvar, apagar)', () => {
    // Trava deliberada: query NOVA obriga a passar por aqui e provar que filtra.
    expect(
      blocos.length,
      'query nova em calc_presets? acrescente a asserção de filtro antes de subir o número',
    ).toBe(3)
  })

  test('a query de LEITURA filtra por workspace_id E por owner_user', () => {
    const leitura = blocos.find((b) => b.includes('.select('))
    expect(leitura, "deve existir uma query com .select() em calc_presets").toBeDefined()
    expect(leitura, 'select sem filtro de tenant → preset de um projeto aparece em outro').toContain(
      ".eq('workspace_id'",
    )
    expect(leitura, 'select sem filtro de dono → usuário vê preset de outro usuário').toContain(
      ".eq('owner_user'",
    )
  })

  test('a query de EXCLUSÃO filtra por workspace_id E por owner_user', () => {
    const del = blocos.find((b) => b.includes('.delete('))
    expect(del, 'deve existir uma query com .delete() em calc_presets').toBeDefined()
    expect(del, 'delete sem filtro de tenant → apaga preset de outro projeto').toContain(
      ".eq('workspace_id'",
    )
    expect(del, 'delete sem filtro de dono → apaga preset de outro usuário').toContain(
      ".eq('owner_user'",
    )
  })

  test('a ESCRITA carimba workspace_id e owner_user no payload e no onConflict', () => {
    const up = blocos.find((b) => b.includes('.upsert('))
    expect(up, 'deve existir uma query com .upsert() em calc_presets').toBeDefined()
    expect(up, 'upsert sem workspace_id → preset nasce órfão de projeto').toContain('workspace_id:')
    expect(up, 'upsert sem owner_user → preset nasce sem dono').toContain('owner_user:')
    // onConflict tem que casar com a unique da migration 0066, senão o upsert
    // sobrescreve preset de OUTRO dono/projeto que tenha o mesmo nome.
    expect(up, 'onConflict divergente da unique (workspace_id, owner_user, nome)').toContain(
      "onConflict: 'workspace_id,owner_user,nome'",
    )
  })

  test('todo caminho passa pelo guard de escopo (sessão + workspace ativo)', () => {
    expect(fonte).toContain('async function escopo(')
    // Cada action pública tem que pedir o escopo antes de tocar no banco.
    const acoes = ['listCalcPresets', 'saveCalcPresetAction', 'deleteCalcPresetAction']
    for (const a of acoes) {
      const i = fonte.indexOf(`export async function ${a}`)
      expect(i, `action ${a} deve existir`).toBeGreaterThan(-1)
      const corpo = fonte.slice(i, fonte.indexOf('.from(', i))
      expect(corpo, `${a} deve resolver o escopo antes de consultar o banco`).toContain('await escopo()')
    }
  })

  test('não existe query em calc_presets fora de app/actions/calcPresets.ts', () => {
    // Centralizar é o que torna a trava acima suficiente.
    for (const rel of ['lib/supabase.ts', 'lib/sessions.ts', 'app/actions/columnPresets.ts']) {
      expect(src(rel), `${rel} não deve consultar calc_presets direto`).not.toContain("from('calc_presets')")
    }
  })
})
