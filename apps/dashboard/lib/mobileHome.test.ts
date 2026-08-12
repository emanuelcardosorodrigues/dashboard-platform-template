/**
 * Testes das correções numéricas da HOME MOBILE.
 *
 * Cada bloco tem CONTROLE NEGATIVO: além de provar que o valor certo aparece,
 * prova que o valor ERRADO da versão anterior não aparece mais. Sem isso um
 * teste passa por acidente e a regressão volta calada.
 */

import { describe, expect, it } from 'vitest'
import {
  receitaPorOrigemRows,
  buildContaResolver,
  gastoPorConta,
  lucroPorConta,
  gastoPorFunilRows,
  serieDiaria,
  buildMobileHome,
  GASTO_OUTROS_LABEL,
} from './mobileHome'
import { aggregateByOrigem } from './origem'
import { liquidoHotmartVenda } from './hotmartFees'
import { DEFAULT_FUNIS } from './funisConfig'
import { KPI_LABEL } from './visaoGeral'
import { CONTA_SEM_ID } from './contas'
import { filterByFunil, type SbTransacao, type SbMetaAds } from './supabase'

// ─── Fábricas ─────────────────────────────────────────────────────────────────

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
    data: '2026-06-01',
    criativo: '',
    ad_name: '',
    ad_id: '',
    campaign_name: '',
    adset_name: '',
    investimento: 0,
    impressoes: 0,
    alcance: 0,
    views_3seg: 0,
    views_95pct: 0,
    cliques_link: 0,
    landing_views: 0,
    checkouts: 0,
    compras: 0,
    valor_compras: 0,
    preview_url: null,
    ...partial,
  }
}

const CONTA_02 = '111111111111111'
const CONTA_03 = '222222222222222'

// ─── 1. Receita por origem (o balde "Orgânico / sem conta") ───────────────────

describe('receitaPorOrigemRows — mesma classificação do bloco de origem do desktop', () => {
  // Reproduz em miniatura o recorte medido em 08/08/2026: a maior parte da
  // receita não tem ad_id nem criativo (order bump, upsell, venda de WhatsApp),
  // e a versão antiga jogava TUDO isso num balde chamado "Orgânico".
  const transacoes = [
    t({ hotmart_id: 'a', ad_id: '1201', criativo: 'demo-col-vid-04', valor_bruto: 1000 }),
    t({ hotmart_id: 'b', valor_bruto: 5000, produto: 'Manual Lucro Oculto' }), // order bump, sem UTM
    t({ hotmart_id: 'c', valor_bruto: 3000, utm_medium_ultimo: 'whatsapp' }),
    t({ hotmart_id: 'd', valor_bruto: 200, utm_medium_ultimo: 'organico-instagram' }),
  ]

  it('devolve exatamente as linhas do agregador que o desktop usa', () => {
    const mobile = receitaPorOrigemRows(transacoes)
    const desktop = aggregateByOrigem(transacoes)
    expect(mobile).toEqual(desktop.map((r) => ({ label: r.label, value: r.faturamentoBruto })))
  })

  it('"Orgânico" quer dizer orgânico: R$ 200, não os R$ 5.000 sem atribuição', () => {
    const rows = receitaPorOrigemRows(transacoes)
    const organico = rows.find((r) => r.label === 'Orgânico')
    expect(organico?.value).toBe(200)
    // CONTROLE NEGATIVO — o valor do balde antigo (tudo sem ad_id/criativo).
    expect(organico?.value).not.toBe(5000)
    expect(organico?.value).not.toBe(8000)
  })

  it('nenhum rótulo diz "Orgânico / sem conta" e o total fecha com o faturamento', () => {
    const rows = receitaPorOrigemRows(transacoes)
    expect(rows.map((r) => r.label)).not.toContain('Orgânico / sem conta')
    expect(rows.reduce((s, r) => s + r.value, 0)).toBe(9200)
  })

  it('a venda sem UTM nenhuma cai em "Direto", que é o default do desktop', () => {
    const rows = receitaPorOrigemRows(transacoes)
    expect(rows.find((r) => r.label === 'Direto')?.value).toBe(5000)
  })
})

// ─── 2. Lucro por conta ───────────────────────────────────────────────────────

describe('lucroPorConta — o não-atribuído nunca vira linha de lucro', () => {
  const allMeta = [
    m({ ad_id: '1201', account_id: CONTA_02, ad_name: 'demo-col-vid-04' }),
    m({ ad_id: '1301', account_id: CONTA_03, ad_name: 'demo-plo-vid-01' }),
  ]
  const metaAds = [
    m({ ad_id: '1201', account_id: CONTA_02, investimento: 1000 }),
    m({ ad_id: '1301', account_id: CONTA_03, investimento: 500 }),
  ]
  const transacoes = [
    t({ hotmart_id: 'a', ad_id: '1201', valor_bruto: 1000 }),
    t({ hotmart_id: 'b', ad_id: '1301', valor_bruto: 400 }),
    // Sem anúncio de origem: era isto que virava "+R$ 7,7k de lucro" do nada.
    t({ hotmart_id: 'c', valor_bruto: 8000 }),
  ]

  const r = lucroPorConta(transacoes, metaAds, allMeta)

  it('só existem linhas de contas de anúncio reais', () => {
    expect(r.rows.map((x) => x.label).sort()).toEqual(['Conta 02', 'Conta 03'])
  })

  it('CONTROLE NEGATIVO: nenhuma linha "Orgânico / sem conta", nenhum lucro fantasma', () => {
    expect(r.rows.map((x) => x.label)).not.toContain('Orgânico / sem conta')
    // O balde antigo receberia os R$ 8.000 brutos e ZERO gasto.
    const fantasma = liquidoHotmartVenda(8000)
    expect(r.rows.some((x) => Math.abs(x.value - fantasma) < 0.01)).toBe(false)
  })

  it('a receita sem anúncio é declarada, não descartada', () => {
    expect(r.receitaNaoAtribuida).toBeCloseTo(liquidoHotmartVenda(8000), 6)
    expect(r.vendasNaoAtribuidas).toBe(1)
  })

  it('conta com receita atribuída maior que o gasto NÃO aparece no vermelho', () => {
    const c02 = r.rows.find((x) => x.label === 'Conta 02')!
    expect(c02.value).toBeCloseTo(liquidoHotmartVenda(1000) - 1000, 6)
    // Controle negativo do sintoma que o dono viu: com o balde fantasma somando
    // lucro, TODAS as contas reais ficavam negativas por comparação. Aqui a conta
    // que fatura acima do gasto tem que ser a mais lucrativa das duas.
    const c03 = r.rows.find((x) => x.label === 'Conta 03')!
    expect(c02.value).toBeGreaterThan(c03.value)
  })

  it('conta que só gasta aparece negativa (isso é verdade, não bug)', () => {
    const semReceita = lucroPorConta([], [m({ account_id: CONTA_03, investimento: 700 })], allMeta)
    expect(semReceita.rows).toEqual([{ label: 'Conta 03', value: -700 }])
  })

  it('linha do meta_ads sem account_id não some do gasto', () => {
    const g = gastoPorConta([m({ investimento: 67.33 })])
    expect(g[CONTA_SEM_ID]).toBe(67.33)
    expect(lucroPorConta([], [m({ investimento: 67.33 })], []).rows).toEqual([
      { label: 'Conta não identificada', value: -67.33 },
    ])
  })
})

describe('buildContaResolver — devolve null quando não há anúncio de origem', () => {
  const resolver = buildContaResolver([
    m({ ad_id: '1201', account_id: CONTA_02, ad_name: 'demo-col-vid-04' }),
  ])
  it('resolve por ad_id', () => {
    expect(resolver(t({ ad_id: '1201' }))).toBe(CONTA_02)
  })
  it('resolve por nome do criativo quando o ad_id não bate', () => {
    expect(resolver(t({ criativo: 'demo-col-vid-04' }))).toBe(CONTA_02)
  })
  it('CONTROLE NEGATIVO: sem sinal nenhum devolve null, não um balde rotulado', () => {
    expect(resolver(t({}))).toBeNull()
  })
})

// ─── 3. Gasto por funil (regra de primeira sigla) ─────────────────────────────

describe('gastoPorFunilRows — cada anúncio conta em UM funil só', () => {
  // A linha ambígua: o ad_name diz LPS, a campanha diz COL. `filterByFunil`
  // casava as duas, então a mesma linha entrava em COL e em LPS.
  const ambigua = m({
    ad_name: 'lps-pv06-alunos-calculadora-col-1real',
    campaign_name: 'COL - Campanha Antiga',
    investimento: 91.93,
  })
  const metaAds = [
    m({ ad_name: 'demo-col-vid-04', campaign_name: 'COL', investimento: 1000 }),
    ambigua,
    m({ ad_name: 'sem-sigla-nenhuma', campaign_name: 'Branding', investimento: 50 }),
  ]
  const rows = gastoPorFunilRows(metaAds, DEFAULT_FUNIS)
  const valor = (label: string) => rows.find((r) => r.label === label)?.value ?? 0

  it('a linha ambígua vai para o funil da PRIMEIRA sigla (LPS), não para os dois', () => {
    expect(valor('Imersão Lucro Clínico')).toBeCloseTo(91.93, 6)
    expect(valor('Produto Demonstrativo')).toBeCloseTo(1000, 6)
  })

  it('CONTROLE NEGATIVO: o valor duplicado da régua antiga não aparece', () => {
    // Antes: COL somava 1000 + 91,93 = 1091,93 E LPS somava 91,93 — total 1183,86
    // sobre um investimento real de 1141,93.
    expect(valor('Produto Demonstrativo')).not.toBeCloseTo(1091.93, 6)
    const soma = rows.reduce((s, r) => s + r.value, 0)
    expect(soma).not.toBeCloseTo(1183.86, 6)
  })

  it('as linhas somam EXATAMENTE o investimento do recorte', () => {
    const investimento = metaAds.reduce((s, r) => s + r.investimento, 0)
    expect(rows.reduce((s, r) => s + r.value, 0)).toBeCloseTo(investimento, 6)
  })

  it('"Outros" recebe só o que não tem sigla — e não fica subestimado', () => {
    expect(valor(GASTO_OUTROS_LABEL)).toBeCloseTo(50, 6)
    // Controle negativo: a régua antiga calculava Outros = total − somatório
    // inflado, o que dava 50 − 91,93 = negativo e era descartado.
    expect(valor(GASTO_OUTROS_LABEL)).toBeGreaterThan(0)
  })

  it('a régua ANTIGA (filterByFunil por funil) de fato conta a linha duas vezes', () => {
    // Controle positivo do defeito: sem provar que o caminho antigo erra, o teste
    // acima não prova que a correção corrigiu alguma coisa.
    const col = filterByFunil(metaAds, 'col', DEFAULT_FUNIS).reduce((s, r) => s + r.investimento, 0)
    const lps = filterByFunil(metaAds, 'lps', DEFAULT_FUNIS).reduce((s, r) => s + r.investimento, 0)
    expect(col).toBeCloseTo(1091.93, 6)
    expect(lps).toBeCloseTo(91.93, 6)
    const investimento = metaAds.reduce((s, r) => s + r.investimento, 0)
    expect(col + lps).toBeGreaterThan(investimento) // 1183,86 > 1141,93
  })

  it('funil inativo não vira linha (`ativo !== false`, não `ativo`)', () => {
    const funis = DEFAULT_FUNIS.map((f) => (f.slug === 'col' ? { ...f, ativo: false } : f))
    const r = gastoPorFunilRows([m({ ad_name: 'demo-col-vid-04', investimento: 10 })], funis)
    expect(r).toEqual([{ label: GASTO_OUTROS_LABEL, value: 10 }])
  })

  it('funil com `ativo` ausente conta como ATIVO (a régua velha usava `f.ativo` e o omitia)', () => {
    const funis = DEFAULT_FUNIS.map(({ ativo: _ativo, ...resto }) => resto as typeof DEFAULT_FUNIS[0])
    const r = gastoPorFunilRows([m({ ad_name: 'demo-col-vid-04', investimento: 10 })], funis)
    expect(r).toEqual([{ label: 'Produto Demonstrativo', value: 10 }])
    expect(r.map((x) => x.label)).not.toContain(GASTO_OUTROS_LABEL)
  })
})

// ─── 4. Série diária com dia zerado ───────────────────────────────────────────

describe('serieDiaria — dia sem movimento entra como zero', () => {
  const transacoes = [
    t({ hotmart_id: 'a', data: '2026-06-01', valor_bruto: 100 }),
    t({ hotmart_id: 'b', data: '2026-06-04', valor_bruto: 300 }),
  ]
  const metaAds = [m({ data: '2026-06-01', investimento: 50 })]

  it('emite TODO dia entre o 1º e o último com dado', () => {
    const s = serieDiaria(transacoes, metaAds, { from: '2026-06-01' })
    expect(s.map((d) => d.date)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04'])
  })

  it('CONTROLE NEGATIVO: a série não pula mais direto de 01 para 04', () => {
    const s = serieDiaria(transacoes, metaAds, { from: '2026-06-01' })
    expect(s.map((d) => d.date)).not.toEqual(['2026-06-01', '2026-06-04'])
    expect(s.length).not.toBe(2)
  })

  it('o dia vazio DO MEIO vale zero em tudo — não some, não interpola', () => {
    const s = serieDiaria(transacoes, metaAds, { from: '2026-06-01' })
    expect(s.find((d) => d.date === '2026-06-02')).toEqual({
      date: '2026-06-02', faturamento: 0, investimento: 0, lucro: 0, vendasFront: 0,
    })
  })

  it('`from` anterior ao 1º dado alarga a série para trás com zeros', () => {
    const s = serieDiaria(transacoes, metaAds, { from: '2026-05-30' })
    expect(s[0].date).toBe('2026-05-30')
    expect(s[0].faturamento).toBe(0)
    expect(s[s.length - 1].date).toBe('2026-06-04')
  })

  it('CONTROLE NEGATIVO: a série NUNCA passa do último dia com dado', () => {
    // Todo dia, entre 00h e o cron do sync-meta, o "hoje" ainda não tem linha.
    // Emitir esse dia como zero desenhava um mergulho que não existe — e que o
    // gráfico do desktop não mostra.
    const s = serieDiaria(transacoes, metaAds, { from: '2026-06-01' })
    expect(s[s.length - 1].date).toBe('2026-06-04')
    expect(s.map((d) => d.date)).not.toContain('2026-06-05')
    expect(s[s.length - 1].faturamento).toBeGreaterThan(0)
  })

  it('o teto de 400 dias corta a CABEÇA, nunca a cauda', () => {
    // Regressão medida em 10/08/2026: com `?de=2020-01-01` a série parava em 2021
    // e o faturamento recente aparecia como ZERO no celular.
    const s = serieDiaria(
      [t({ hotmart_id: 'z', data: '2026-08-05', valor_bruto: 5000 })],
      [m({ data: '2026-08-05', investimento: 900 })],
      { from: '2020-01-01' },
    )
    expect(s.length).toBe(400)
    expect(s[s.length - 1].date).toBe('2026-08-05')
    expect(s[s.length - 1].faturamento).toBe(5000)
    expect(s.reduce((acc, d) => acc + d.faturamento, 0)).toBe(5000)
    // CONTROLE NEGATIVO: o comportamento antigo terminava em 2021 e somava zero.
    expect(s[s.length - 1].date.startsWith('2021')).toBe(false)
    expect(s.reduce((acc, d) => acc + d.faturamento, 0)).not.toBe(0)
  })

  it('sem nenhum dia com dado devolve série vazia', () => {
    expect(serieDiaria([], [], { from: '2026-06-01' })).toEqual([])
    expect(serieDiaria([], [], {})).toEqual([])
  })

  it('os totais da série continuam batendo com o recorte', () => {
    const s = serieDiaria(transacoes, metaAds, { from: '2026-06-01' })
    expect(s.reduce((acc, d) => acc + d.faturamento, 0)).toBe(400)
    expect(s.reduce((acc, d) => acc + d.investimento, 0)).toBe(50)
    expect(s.reduce((acc, d) => acc + d.vendasFront, 0)).toBe(2)
  })
})

// ─── 5. Montagem dos cards (o que a mutação provou não estar coberto) ─────────

describe('buildMobileHome — os números que vão para a tela', () => {
  const allMeta = [m({ ad_id: '1201', account_id: CONTA_02, ad_name: 'demo-col-vid-04' })]
  const metaAds = [m({ ad_id: '1201', account_id: CONTA_02, investimento: 1000, data: '2026-06-02' })]
  const transacoes = [
    t({ hotmart_id: 'a', ad_id: '1201', valor_bruto: 2000, data: '2026-06-02' }),
    t({ hotmart_id: 'b', valor_bruto: 500, data: '2026-06-04', produto: 'Manual Lucro Oculto' }),
  ]
  const base = { transacoes, metaAds, allMeta, funis: DEFAULT_FUNIS, funil: 'all' }
  const r = buildMobileHome({ ...base, from: '2026-06-01' })
  const card = (k: string) => r.kpis.find((x) => x.key === k)!

  it('o card de Lucro carrega o Lucro Líquido 01, NÃO o Lucro Bruto', () => {
    expect(card('lucro').total).toBe(r.core.lucroLiquido01)
    // CONTROLE NEGATIVO: foi este mutante que sobreviveu à suíte antiga.
    expect(card('lucro').total).not.toBe(r.core.lucroBruto)
    expect(r.core.lucroLiquido01).toBeLessThan(r.core.lucroBruto)
  })

  it('cada card carrega exatamente o seu total do núcleo', () => {
    expect(card('faturamento').total).toBe(r.core.faturamento)
    expect(card('investimento').total).toBe(r.core.investimento)
    // CONTROLE NEGATIVO: `investimento * 2` também sobrevivia antes.
    expect(card('investimento').total).not.toBe(r.core.investimento * 2)
  })

  it('os rótulos dos cards são os do desktop', () => {
    expect(r.kpis.map((k) => k.label)).toEqual([
      KPI_LABEL.faturamento, KPI_LABEL.investimento, KPI_LABEL.lucroLiquido01,
    ])
    expect(r.kpis.map((k) => k.label)).not.toContain('Lucro')
    expect(r.kpis.map((k) => k.label)).not.toContain('Valor Gasto')
  })

  it('o breakdown por conta de anúncio não inventa linha para o não atribuído', () => {
    const porConta = card('lucro').breakdowns.find((b) => b.title === 'Por conta de anúncio')!
    expect(porConta.rows.map((x) => x.label)).toEqual(['Conta 02'])
    expect(porConta.context).toContain('sem anúncio de origem')
  })

  it('o `from` do recorte chega na série — não é ignorado', () => {
    // CONTROLE NEGATIVO: `serieDiaria(..., { from: null })` sobrevivia à suíte antiga.
    const comFrom = buildMobileHome({ ...base, from: '2026-05-28' })
    const semFrom = buildMobileHome({ ...base, from: null })
    expect(comFrom.daily[0].date).toBe('2026-05-28')
    expect(semFrom.daily[0].date).toBe('2026-06-02')
    expect(comFrom.daily.length).toBeGreaterThan(semFrom.daily.length)
  })

  it('o chip ROAS Bruto colore pela PRÓPRIA base, não pela do líquido', () => {
    // Recorte construído para os dois caírem em faixas DIFERENTES do semáforo
    // (verde ≥ 1,5 / amarelo ≥ 1,0): bruto 1,55x e líquido ~1,40x.
    const rr = buildMobileHome({
      ...base,
      transacoes: [t({ hotmart_id: 'x', ad_id: '1201', valor_bruto: 1550, data: '2026-06-02' })],
      metaAds: [m({ ad_id: '1201', account_id: CONTA_02, investimento: 1000, data: '2026-06-02' })],
      from: '2026-06-01',
    })
    expect(rr.core.roasBruto).toBeGreaterThanOrEqual(1.5)
    expect(rr.core.roasLiquido).toBeLessThan(1.5)
    const bruto = rr.stats.find((s) => s.label === KPI_LABEL.roasBruto)!
    const liq = rr.stats.find((s) => s.label === KPI_LABEL.roasLiquido)!
    expect(bruto.tone).toBe('good')
    expect(liq.tone).toBe('warn')
    // CONTROLE NEGATIVO: colorir o bruto pela base do líquido daria 'warn' nos dois.
    expect(bruto.tone).not.toBe(liq.tone)
  })

  it('com um funil selecionado, o breakdown "Por produto" do gasto some', () => {
    // Ele reparte o gasto ENTRE funis; dentro de um funil o rótulo mentiria
    // (linha com campanha COL e ad_name lps saía rotulada "Imersão Lucro Clínico").
    const filtrado = buildMobileHome({ ...base, funil: 'col', from: '2026-06-01' })
    const titulos = filtrado.kpis.find((k) => k.key === 'investimento')!.breakdowns.map((b) => b.title)
    expect(titulos).toEqual(['Por conta'])
    expect(titulos).not.toContain('Por produto')
    // Com 'all' ele existe.
    expect(card('investimento').breakdowns.map((b) => b.title)).toContain('Por produto')
  })

  it('hasData reflete o recorte', () => {
    expect(r.hasData).toBe(true)
    expect(buildMobileHome({ ...base, transacoes: [], metaAds: [], from: null }).hasData).toBe(false)
  })
})

describe('bestWorst — o texto do rateio por conta não pode dizer bobagem', () => {
  const allMeta = [
    m({ ad_id: '1201', account_id: CONTA_02, ad_name: 'a' }),
    m({ ad_id: '1301', account_id: CONTA_03, ad_name: 'b' }),
  ]
  const ctx = (transacoes: SbTransacao[], metaAds: SbMetaAds[]) =>
    buildMobileHome({ transacoes, metaAds, allMeta, funis: DEFAULT_FUNIS, funil: 'all', from: null })
      .kpis.find((k) => k.key === 'lucro')!
      .breakdowns.find((b) => b.title === 'Por conta de anúncio')!.context

  it('CONTROLE NEGATIVO: com TODAS as contas no vermelho, ninguém "lucra"', () => {
    // Visto em produção: "Conta 05 lucra −R$ 165,64".
    const texto = ctx(
      [t({ hotmart_id: 'a', ad_id: '1201', valor_bruto: 100, data: '2026-06-02' })],
      [m({ ad_id: '1201', account_id: CONTA_02, investimento: 900, data: '2026-06-02' }),
       m({ ad_id: '1301', account_id: CONTA_03, investimento: 500, data: '2026-06-02' })],
    )
    expect(texto).not.toMatch(/lucra −?-?R\$/)
    expect(texto).toContain('Nenhuma conta no azul')
    expect(texto).toContain('menos deficitária')
  })

  it('com uma no azul e outra no vermelho, nomeia as duas', () => {
    const texto = ctx(
      [t({ hotmart_id: 'a', ad_id: '1201', valor_bruto: 5000, data: '2026-06-02' })],
      [m({ ad_id: '1201', account_id: CONTA_02, investimento: 100, data: '2026-06-02' }),
       m({ ad_id: '1301', account_id: CONTA_03, investimento: 500, data: '2026-06-02' })],
    )
    expect(texto).toContain('Conta 02 lucra')
    expect(texto).toContain('Conta 03 no vermelho')
  })
})
