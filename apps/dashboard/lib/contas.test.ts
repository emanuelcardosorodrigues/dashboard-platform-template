import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONTAS_META, CONTA_SEM_ID, contaNomeCompleto, contaNomeCurto } from './contas'

/**
 * Ids que TÊM gasto no meta_ads do DEMO (medido em 08/08/2026 via SQL, ordenados
 * por gasto). As quatro precisam ter nome — as duas últimas apareciam como
 * "Conta ••••1661" / "Conta ••••3927". Os nomes vieram da API do Meta.
 */
const CONTAS_COM_GASTO: Array<[string, string]> = [
  ['111111111111111', 'APS | DEMO - Conta 02'],
  ['222222222222222', 'APS | DEMO - Conta 03'],
  ['333333333333333', 'APS | DEMO - Conta 04'],
  ['444444444444444', 'APS | DEMO - Conta 05'],
]

describe('contas Meta — nome para toda conta com gasto', () => {
  for (const [id, nome] of CONTAS_COM_GASTO) {
    it(`${id} => ${nome}`, () => {
      expect(contaNomeCompleto(id)).toBe(nome)
      expect(CONTAS_META[id]).toBe(nome)
    })
  }

  it('CONTROLE NEGATIVO: nenhuma delas cai mais no fallback mascarado', () => {
    for (const [id] of CONTAS_COM_GASTO) {
      expect(contaNomeCompleto(id)).not.toContain('••••')
      expect(contaNomeCurto(id)).not.toContain('••••')
    }
    // O fallback continua existindo — para id que realmente não conhecemos.
    expect(contaNomeCompleto('999888777666555')).toBe('Conta ••••6555')
  })

  it('o rótulo curto tira só o prefixo do Meta', () => {
    expect(contaNomeCurto('333333333333333')).toBe('Conta 04')
    expect(contaNomeCurto('444444444444444')).toBe('Conta 05')
  })

  it('linha sem account_id vira "Conta não identificada", nunca "Orgânico"', () => {
    for (const vazio of ['', null, undefined, CONTA_SEM_ID]) {
      expect(contaNomeCompleto(vazio)).toBe('Conta não identificada')
      expect(contaNomeCompleto(vazio)).not.toContain('Orgânico')
    }
  })
})

describe('fonte única — Header e Home mobile leem do mesmo mapa', () => {
  const raiz = join(__dirname, '..')
  const header = readFileSync(join(raiz, 'components', 'layout', 'Header.tsx'), 'utf8')
  const pagina = readFileSync(join(raiz, 'app', '(dashboard)', 'visao-geral', 'page.tsx'), 'utf8')

  it('nenhum dos dois arquivos declara um mapa próprio de contas', () => {
    for (const [arquivo, fonte] of [['Header.tsx', header], ['page.tsx', pagina]] as const) {
      expect(fonte, arquivo).not.toContain('ACCOUNT_NAMES: Record<string, string>')
      expect(fonte, arquivo).not.toContain("'APS | DEMO - Conta")
    }
  })

  it('os dois usam os helpers de lib/contas', () => {
    expect(header).toContain("from '@/lib/contas'")
    expect(pagina).toContain("from '@/lib/contas'")
  })
})
