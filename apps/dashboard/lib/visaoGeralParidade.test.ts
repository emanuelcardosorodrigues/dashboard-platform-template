/**
 * PARIDADE MOBILE ↔ DESKTOP da /visao-geral.
 *
 * A regra do dono: onde as duas telas mostram a mesma métrica, o RÓTULO tem que
 * ser o mesmo e o NÚMERO tem que ser o mesmo. Este arquivo é o que impede a
 * regressão de voltar, em três camadas:
 *
 *  1. NÚMERO — o núcleo compartilhado (computeVisaoGeralCore) é conferido contra
 *     uma cópia LITERAL das fórmulas que o KpiSection do desktop tinha antes do
 *     refactor. Se o desktop mudar de valor, isto quebra.
 *  2. RÓTULO — KPI_LABEL é conferido contra os textos que o desktop renderizava
 *     em literal, e o código da tela é lido para garantir que os dois lados
 *     consomem a constante, não uma string solta.
 *  3. CONTROLE NEGATIVO — os rótulos e baldes errados da versão anterior do
 *     mobile não podem existir em lugar nenhum do arquivo da tela.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeVisaoGeralCore, KPI_LABEL } from './visaoGeral'
import { liquidoHotmartTransacoes } from './hotmartFees'
import { tipoDaTransacao, produtoToTipo, filterTransacoesByFunil, type SbTransacao, type SbMetaAds } from './supabase'
import { DEFAULT_FUNIS } from './funisConfig'
import { receitaPorOrigemRows, buildMobileHome } from './mobileHome'

const PAGINA = join(__dirname, '..', 'app', '(dashboard)', 'visao-geral', 'page.tsx')
const fonte = readFileSync(PAGINA, 'utf8')
// A montagem do mobile mudou de arquivo; o varredor de rótulo proibido tem que
// olhar os DOIS, senão ele deixa de detectar o que diz detectar.
const fonteMobile = readFileSync(join(__dirname, 'mobileHome.ts'), 'utf8')

function t(partial: Partial<SbTransacao>): SbTransacao {
  return {
    hotmart_id: 'h1',
    data: '2026-06-01',
    nome: 'x',
    email: 'x@x.com',
    produto: 'Produto Demonstrativo',
    valor_bruto: 100,
    valor_liquido_expert: 90,
    forma_pagamento: 'pix',
    parcelas: 1,
    criativo: '',
    utm_medium_ultimo: '',
    utm_source_ultimo: '',
    utm_medium_primeiro: '',
    utm_source_primeiro: '',
    ...partial,
  }
}

function m(partial: Partial<SbMetaAds>): SbMetaAds {
  return {
    data: '2026-06-01', criativo: '', ad_name: '', ad_id: '', campaign_name: '', adset_name: '',
    investimento: 0, impressoes: 0, alcance: 0, views_3seg: 0, views_95pct: 0, cliques_link: 0,
    landing_views: 0, checkouts: 0, compras: 0, valor_compras: 0, preview_url: null,
    ...partial,
  }
}

/**
 * Cópia LITERAL do bloco de contas que vivia no KpiSection antes do refactor.
 * Não importa nada de lib/visaoGeral — é o oráculo independente. Se alguém mudar
 * o núcleo e o desktop passar a mostrar outro número, este teste acusa.
 */
function kpiSectionAntigo(transacoes: SbTransacao[], metaAds: SbMetaAds[]) {
  const faturamento = transacoes.reduce((s, x) => s + (x.valor_bruto || 0), 0)
  const numVendas = transacoes.length
  const investimento = metaAds.reduce((s, r) => s + (r.investimento || 0), 0)
  const frontEndVendas = transacoes.filter(
    (x) => tipoDaTransacao(x) === 'frontEnd',
  ).length
  const faturamentoLiquido = liquidoHotmartTransacoes(transacoes.map((x) => x.valor_bruto || 0))
  return {
    faturamento,
    numVendas,
    investimento,
    frontEndVendas,
    faturamentoLiquido,
    lucroBruto: faturamento - investimento,
    lucroLiquido01: faturamentoLiquido - investimento,
    roasBruto: investimento > 0 ? faturamento / investimento : 0,
    roasLiquido: investimento > 0 ? faturamentoLiquido / investimento : 0,
    cpa: frontEndVendas > 0 ? investimento / frontEndVendas : 0,
    ticketFE: frontEndVendas > 0 ? faturamento / frontEndVendas : 0,
  }
}

/** Recorte usado nos testes de montagem da Home mobile (mesmo input dos dois lados). */
const RECORTE_MOBILE = {
  transacoes: [
    t({ hotmart_id: 'a', ad_id: '1201', criativo: 'demo-col-vid-04', valor_bruto: 1970 }),
    t({ hotmart_id: 'b', produto: 'Manual Lucro Oculto', valor_bruto: 470 }),
    t({ hotmart_id: 'c', valor_bruto: 8000 }),
  ],
  metaAds: [m({ ad_id: '1201', account_id: '111111111111111', investimento: 1234.56 })],
  allMeta: [m({ ad_id: '1201', account_id: '111111111111111', ad_name: 'demo-col-vid-04' })],
  funis: DEFAULT_FUNIS,
}

const RECORTES: Array<[string, SbTransacao[], SbMetaAds[]]> = [
  [
    'mix realista (front + order bump + venda sem anúncio)',
    [
      t({ hotmart_id: 'a', ad_id: '1201', criativo: 'demo-col-vid-04', valor_bruto: 197 }),
      t({ hotmart_id: 'b', produto: 'Manual Lucro Oculto', valor_bruto: 47 }),
      t({ hotmart_id: 'c', produto: 'Imersão Lucro Clínico!', criativo: 'demo-lps-vid-01', valor_bruto: 1 }),
      t({ hotmart_id: 'd', valor_bruto: 8000 }),
    ],
    [m({ investimento: 1234.56, account_id: '111111111111111' })],
  ],
  ['recorte vazio', [], []],
  ['sem investimento (ROAS/CPA indefinidos)', [t({ hotmart_id: 'a', valor_bruto: 500 })], []],
  ['sem venda, só gasto', [], [m({ investimento: 900 })]],
]

describe('1. NÚMERO — o núcleo compartilhado reproduz o KpiSection do desktop', () => {
  for (const [nome, transacoes, metaAds] of RECORTES) {
    it(`${nome}: toda métrica homônima bate`, () => {
      const core = computeVisaoGeralCore(transacoes, metaAds)
      const antigo = kpiSectionAntigo(transacoes, metaAds)
      expect(core.faturamento).toBe(antigo.faturamento)
      expect(core.numVendas).toBe(antigo.numVendas)
      expect(core.investimento).toBe(antigo.investimento)
      expect(core.frontEndVendas).toBe(antigo.frontEndVendas)
      expect(core.receitaLiquida).toBe(antigo.faturamentoLiquido)
      expect(core.lucroBruto).toBe(antigo.lucroBruto)
      expect(core.lucroLiquido01).toBe(antigo.lucroLiquido01)
      expect(core.roasBruto).toBe(antigo.roasBruto)
      expect(core.roasLiquido).toBe(antigo.roasLiquido)
      expect(core.cpa).toBe(antigo.cpa)
      expect(core.ticketFE).toBe(antigo.ticketFE)
    })
  }

  it('o card que o mobile chamava de "Lucro" É o Lucro Líquido 01, e ele difere do Bruto', () => {
    const [, transacoes, metaAds] = RECORTES[0]
    const core = computeVisaoGeralCore(transacoes, metaAds)
    // CONTROLE NEGATIVO: se os dois fossem iguais, o teste de rótulo não provaria nada.
    expect(core.lucroLiquido01).not.toBe(core.lucroBruto)
    expect(core.lucroLiquido01).toBeLessThan(core.lucroBruto)
  })
})

describe('2. RÓTULO — a constante é a mesma dos dois lados', () => {
  // Textos EXATOS que o KpiSection do desktop renderizava em literal antes do
  // refactor. Mudar qualquer um destes muda a tela do dono — é regressão.
  const DESKTOP_HOJE = {
    faturamento: 'Faturamento Total',
    investimento: 'Investimento',
    lucroBruto: 'Lucro Bruto',
    lucroLiquido01: 'Lucro Líquido 01',
    roasBruto: 'ROAS Bruto',
    roasLiquido: 'ROAS Líq.',
    cpa: 'CPA',
    compradores: 'Compradores',
  }

  it('KPI_LABEL não mexeu em nenhum rótulo do desktop', () => {
    expect({ ...KPI_LABEL }).toEqual(DESKTOP_HOJE)
  })

  it('os KpiCards do desktop consomem a constante, não literais', () => {
    for (const chave of Object.keys(DESKTOP_HOJE)) {
      expect(fonte).toContain(`label={KPI_LABEL.${chave}}`)
    }
  })

  // Os testes abaixo eram scan de SUBSTRING no page.tsx. Uma rodada de mutação em
  // 10/08/2026 mostrou que isso não prova nada: dava pra trocar o número dentro do
  // card e a asserção de substring continuava verde. Agora a montagem mobile é uma
  // função pura (buildMobileHome) e o que se afirma é o VALOR que vai para a tela.
  it('os cards do mobile saem com os rótulos do desktop', () => {
    const r = buildMobileHome({ ...RECORTE_MOBILE, funil: 'all', from: null })
    expect(r.kpis.map((k) => k.label)).toEqual([
      DESKTOP_HOJE.faturamento, DESKTOP_HOJE.investimento, DESKTOP_HOJE.lucroLiquido01,
    ])
    expect(r.stats.map((s) => s.label)).toEqual([
      DESKTOP_HOJE.roasLiquido, DESKTOP_HOJE.roasBruto, DESKTOP_HOJE.cpa, DESKTOP_HOJE.compradores,
    ])
  })

  it('as duas telas calculam pelo MESMO núcleo — valor a valor', () => {
    const { transacoes, metaAds } = RECORTE_MOBILE
    const mobile = buildMobileHome({ ...RECORTE_MOBILE, funil: 'all', from: null }).core
    const desktop = computeVisaoGeralCore(transacoes, metaAds)
    const oraculo = kpiSectionAntigo(transacoes, metaAds)
    expect(mobile).toEqual(desktop)
    expect(mobile.faturamento).toBe(oraculo.faturamento)
    expect(mobile.investimento).toBe(oraculo.investimento)
    expect(mobile.lucroLiquido01).toBe(oraculo.lucroLiquido01)
    expect(mobile.roasLiquido).toBe(oraculo.roasLiquido)
    expect(mobile.cpa).toBe(oraculo.cpa)
  })

  it('o número de cada card do mobile é o do núcleo, não um vizinho parecido', () => {
    const r = buildMobileHome({ ...RECORTE_MOBILE, funil: 'all', from: null })
    const total = (k: string) => r.kpis.find((x) => x.key === k)!.total
    expect(total('faturamento')).toBe(r.core.faturamento)
    expect(total('investimento')).toBe(r.core.investimento)
    expect(total('lucro')).toBe(r.core.lucroLiquido01)
    // CONTROLE NEGATIVO: os vizinhos plausíveis que a mutação conseguiu injetar.
    expect(total('lucro')).not.toBe(r.core.lucroBruto)
    expect(total('investimento')).not.toBe(r.core.investimento * 2)
    expect(total('faturamento')).not.toBe(r.core.receitaLiquida)
  })
})

describe('4. DIVERGÊNCIA RESIDUAL (documentada, não corrigida) — ordem do filtro > R$1', () => {
  // O KpiSection (e a Home mobile, que segue ele) aplica `valor_bruto > 1` DEPOIS
  // do filtro de funil; o OrigemSection do desktop aplica ANTES. Isso muda a
  // herança de funil por email dentro de filterTransacoesByFunil: uma venda de
  // R$1 do front do LPS que é descartada cedo deixa de ensinar o funil para o
  // order bump do mesmo comprador.
  //
  // Não dá para corrigir sem mexer no desktop, e mexer no desktop é regressão por
  // definição neste trabalho. Este teste existe para o defeito ficar VISÍVEL e
  // medido — no banco há 111 transações ≤ R$1 nos últimos 30 dias (08/08/2026),
  // 108 delas com email repetido em vendas maiores, então a condição é real.
  const A = t({ hotmart_id: 'A', email: 'e@x.com', produto: 'Imersão Lucro Clínico!', sck_slug: 'lps-pv06', valor_bruto: 1 })
  const B = t({ hotmart_id: 'B', email: 'e@x.com', produto: 'Manual Lucro Oculto', valor_bruto: 47 })

  const ordemKpiEMobile = filterTransacoesByFunil([A, B], 'lps', [], DEFAULT_FUNIS).filter((x) => (x.valor_bruto || 0) > 1)
  const ordemOrigemDesktop = filterTransacoesByFunil([A, B].filter((x) => (x.valor_bruto || 0) > 1), 'lps', [], DEFAULT_FUNIS)

  it('a ordem do filtro muda o conjunto quando um funil está selecionado', () => {
    expect(ordemKpiEMobile.map((x) => x.hotmart_id)).toEqual(['B'])
    expect(ordemOrigemDesktop.map((x) => x.hotmart_id)).toEqual([])
  })

  it('com funil "all" (o padrão da tela) as duas ordens coincidem', () => {
    const a = filterTransacoesByFunil([A, B], 'all', [], DEFAULT_FUNIS).filter((x) => (x.valor_bruto || 0) > 1)
    const b = filterTransacoesByFunil([A, B].filter((x) => (x.valor_bruto || 0) > 1), 'all', [], DEFAULT_FUNIS)
    expect(a.map((x) => x.hotmart_id)).toEqual(b.map((x) => x.hotmart_id))
  })

  it('a Home mobile segue o KpiSection, para o breakdown fechar com o próprio card', () => {
    const core = computeVisaoGeralCore(ordemKpiEMobile, [])
    expect(receitaPorOrigemRows(ordemKpiEMobile).reduce((s, r) => s + r.value, 0)).toBe(core.faturamento)
  })
})

describe('3. CONTROLE NEGATIVO — os rótulos errados sumiram da tela', () => {
  const PROIBIDOS = [
    "label: 'Lucro'",          // era o Lucro Líquido 01 chamado de "Lucro"
    "label: 'Faturamento'",    // era o Faturamento Total chamado de "Faturamento"
    "label: 'Valor Gasto'",    // era o Investimento chamado de "Valor Gasto"
    "'Orgânico / sem conta'",  // o balde que roubava o significado de "Orgânico"
    'MOBILE_ACCOUNT_NAMES',    // mapa de contas paralelo ao do Header
    "'__none__'",              // a chave do balde não-atribuído
  ]
  for (const proibido of PROIBIDOS) {
    it(`nem page.tsx nem lib/mobileHome.ts contêm ${proibido}`, () => {
      expect(fonte, 'page.tsx').not.toContain(proibido)
      expect(fonteMobile, 'lib/mobileHome.ts').not.toContain(proibido)
    })
  }

  it('o rótulo do card de lucro do mobile não é o do Lucro Bruto', () => {
    expect(KPI_LABEL.lucroLiquido01).not.toBe(KPI_LABEL.lucroBruto)
    expect(KPI_LABEL.lucroLiquido01).not.toBe('Lucro')
  })
})

describe('5. O núcleo classifica produto por ID, como o desktop da main faz', () => {
  // Este bloco existe por causa de um quase-acidente real: o núcleo nasceu numa
  // branch anterior à migração para `tipoDaTransacao` e, no merge, ia levar o
  // desktop de volta a classificar por NOME — desfazendo, calado, a correção do
  // `produto_id`. A troca da chamada não bastava: uma rodada de mutação mostrou
  // que NENHUM teste travava isso. Agora trava.
  //
  // O caso discrimina de propósito: a regra casa por ID e diz "order bump". Sem o
  // id, nenhuma regra casa e `classificarProduto` cai no fallback conservador
  // ('frontEnd') — então a venda vira comprador que não existe e o CPA despenca.
  const funisPorId: typeof DEFAULT_FUNIS = [{
    slug: 'col', nome: 'COL', ordem: 1, ativo: true,
    produtos: [{ match: '8204315', por: 'id', papel: 'ob', ordemOb: 1 }],
    campanhas: { habilitado: true, tokens: ['col'], campos: ['ad_name'] },
  }]
  const renomeado = t({
    hotmart_id: 'ob',
    produto: 'Nome Trocado Na Hotmart Ontem',
    produto_id: '8204315',
    valor_bruto: 47,
  })
  const gasto = [m({ investimento: 100 })]

  it('order bump identificado por ID NÃO conta como comprador', () => {
    const core = computeVisaoGeralCore([renomeado], gasto, funisPorId)
    expect(core.frontEndVendas).toBe(0)
    expect(core.cpa).toBe(0)
  })

  it('CONTROLE NEGATIVO: classificar por nome inflaria o comprador e o CPA', () => {
    // É exatamente o que `produtoToTipo(nome, criativo)` devolveria — o fallback
    // 'frontEnd' transforma um order bump renomeado em venda de front.
    const porNome = produtoToTipo(renomeado.produto || '', renomeado.criativo || '', funisPorId)
    expect(porNome).toBe('frontEnd')
    const porId = tipoDaTransacao(renomeado, funisPorId)
    expect(porId).toBe('ob1')
    expect(porId).not.toBe(porNome)
  })

  it('mobile e desktop classificam IGUAL — inclusive na limitação herdada', () => {
    // Nenhum dos dois repassa a config de funis do banco ao núcleo: o KpiSection
    // da main chama `tipoDaTransacao(t)` sem `funis`, então cai em DEFAULT_FUNIS.
    // A Home mobile faz o MESMO, de propósito. Passar a config só de um lado faria
    // as duas telas divergirem no recorte em que a config do banco difere do
    // default — que é exatamente o defeito que este PR existe para matar.
    // (Ligar a config nos DOIS é melhoria legítima; muda o desktop, então é outra
    // conversa e outra decisão.)
    const r = buildMobileHome({
      transacoes: [renomeado], metaAds: gasto, allMeta: [], funis: funisPorId,
      funil: 'all', from: null,
    })
    const desktop = computeVisaoGeralCore([renomeado], gasto)
    expect(r.core).toEqual(desktop)
    expect(r.stats.find((s) => s.label === KPI_LABEL.compradores)!.value)
      .toBe(desktop.frontEndVendas.toLocaleString('pt-BR'))
  })
})
