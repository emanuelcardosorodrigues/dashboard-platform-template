/**
 * Blocos numéricos da HOME MOBILE (/visao-geral no celular). Funções PURAS, sem
 * fetch e sem `Date` — é o que permite testá-las contra o desktop com o mesmo
 * input (visaoGeralParidade.test.ts).
 *
 * Cada função aqui existe porque a versão anterior, inline no page.tsx, produzia
 * um número que contradizia o desktop na MESMA tela:
 *
 *  - `receitaPorOrigemRows` substitui um mapa próprio de ad_id que jogava toda
 *    transação sem anúncio num balde "Orgânico / sem conta" (48,7% do
 *    faturamento em 30d, medido em 08/08/2026) enquanto o bloco de origem do
 *    desktop chamava de "Orgânico" uma fatia 20x menor. Agora as duas telas
 *    chamam a MESMA função (lib/origem.ts), então a palavra tem um significado só.
 *
 *  - `lucroPorConta` nunca cria linha para receita NÃO atribuída a anúncio. O
 *    balde antigo recebia receita e ZERO gasto, marcava +R$ 7,7k de lucro e
 *    empurrava as quatro contas reais para o vermelho — texto que mandava pausar
 *    campanha saudável. Sem gasto para comparar, não existe lucro de conta.
 *
 *  - `gastoPorFunilRows` particiona o gasto pela regra de PRIMEIRA SIGLA
 *    (lib/funisConfig), em vez de somar por funil com `filterByFunil`, que casa
 *    token em campaign_name OU ad_name e contava a mesma linha em dois funis.
 *
 *  - `serieDiaria` emite TODO dia do intervalo, inclusive os zerados. Antes o dia
 *    sem movimento sumia da série, o que deslocava a projeção do "esperado".
 */

import { aggregateByOrigem } from './origem'
import { resolverFunilPorTokens, type FunilConfig } from './funisConfig'
import { tipoDaTransacao, type SbTransacao, type SbMetaAds } from './supabase'
import { liquidoHotmartVenda } from './hotmartFees'
import { contaNomeCurto, CONTA_SEM_ID } from './contas'
import {
  getFrontEndLabel, formatCurrency, formatCurrencyCompact, formatPercent, formatRoas,
} from './formatters'
import { getSemaforoColor, getSemaforoColorForFunil } from './thresholds'
import { computeVisaoGeralCore, KPI_LABEL, type VisaoGeralCore } from './visaoGeral'
import type { WhatChangedDay } from './whatChanged'

export interface BreakdownRow {
  label: string
  value: number
}

// ─── Tipos dos cards ──────────────────────────────────────────────────────────
// Espelham components/mobile/MobileHome.tsx. Declarados aqui (e não importados de
// lá) para lib/ não passar a depender de um componente client.

export interface MobileBreakdown {
  title: string
  context: string
  total: number
  signed?: boolean
  rows: BreakdownRow[]
}
export interface MobileKpi {
  key: string
  label: string
  total: number
  totalLabel: string
  accent: 'cyan' | 'rose' | 'emerald'
  positive?: boolean
  breakdowns: MobileBreakdown[]
}
export interface MobileStat {
  label: string
  value: string
  tone?: 'good' | 'warn' | 'bad' | 'neutral'
}

// ─── Receita por origem (paridade com o bloco do desktop) ─────────────────────

/**
 * Faturamento BRUTO por origem, com os rótulos canônicos de lib/origem.ts
 * ("Tráfego pago", "Orgânico", "WhatsApp", "Direto"). Dado o mesmo conjunto de
 * transações, devolve exatamente as mesmas linhas que o desktop desenha em
 * "Receita por Origem" — é a mesma função de classificação.
 */
export function receitaPorOrigemRows(transacoes: SbTransacao[]): BreakdownRow[] {
  return aggregateByOrigem(transacoes).map((r) => ({ label: r.label, value: r.faturamentoBruto }))
}

// ─── Atribuição transação → conta de anúncio ──────────────────────────────────

/**
 * Resolve a conta Meta de uma transação herdando da ad que a gerou (ad_id e, na
 * falta dele, o nome do criativo). Devolve `null` quando a transação não veio de
 * anúncio nenhum — order bump, upsell, venda fechada no WhatsApp. `null` é o
 * ponto: o chamador precisa poder EXCLUIR o não-atribuído, não rotulá-lo.
 *
 * `allMeta` deve ser o histórico completo (não o recorte), porque a ad que gerou
 * a venda pode ter rodado antes do período selecionado.
 */
export function buildContaResolver(allMeta: SbMetaAds[]): (t: SbTransacao) => string | null {
  const porAdId: Record<string, string> = {}
  const porNome: Record<string, string> = {}
  for (const r of allMeta) {
    if (!r.account_id) continue
    if (r.ad_id && !porAdId[r.ad_id]) porAdId[r.ad_id] = r.account_id
    const nm = (r.ad_name || r.criativo || '').trim()
    if (nm && !porNome[nm]) porNome[nm] = r.account_id
  }
  return (t: SbTransacao) => porAdId[t.ad_id || ''] || porNome[(t.criativo || '').trim()] || null
}

// ─── Gasto por conta ──────────────────────────────────────────────────────────

/**
 * Gasto por conta de anúncio. Linha do meta_ads sem `account_id` cai em
 * CONTA_SEM_ID ("Conta não identificada") em vez de sumir — o total tem que
 * fechar com o card de Investimento.
 */
export function gastoPorConta(metaAds: SbMetaAds[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of metaAds) {
    const k = r.account_id || CONTA_SEM_ID
    out[k] = (out[k] || 0) + (r.investimento || 0)
  }
  return out
}

// ─── Lucro por conta ──────────────────────────────────────────────────────────

export interface LucroContaResultado {
  rows: BreakdownRow[]
  /** Receita líquida de transações SEM anúncio de origem — fora das linhas. */
  receitaNaoAtribuida: number
  /** Nº de transações sem anúncio de origem (contexto do rodapé). */
  vendasNaoAtribuidas: number
}

/**
 * Lucro por conta = receita líquida ATRIBUÍDA à conta − gasto da conta.
 *
 * Só entram contas de anúncio REAIS: as que têm gasto no recorte e/ou receita
 * herdada de uma ad delas. A receita sem anúncio de origem sai das linhas e volta
 * em `receitaNaoAtribuida`, para o chamador declarar o que ficou de fora em vez
 * de fingir que é lucro de alguém.
 */
export function lucroPorConta(
  transacoes: SbTransacao[],
  metaAds: SbMetaAds[],
  allMeta: SbMetaAds[],
): LucroContaResultado {
  const contaDe = buildContaResolver(allMeta)
  const liq: Record<string, number> = {}
  let receitaNaoAtribuida = 0
  let vendasNaoAtribuidas = 0

  for (const t of transacoes) {
    const liquido = liquidoHotmartVenda(t.valor_bruto || 0)
    const acct = contaDe(t)
    if (!acct) {
      receitaNaoAtribuida += liquido
      vendasNaoAtribuidas += 1
      continue
    }
    liq[acct] = (liq[acct] || 0) + liquido
  }

  const gasto = gastoPorConta(metaAds)
  const chaves = new Set([...Object.keys(liq), ...Object.keys(gasto)])
  const rows = Array.from(chaves).map((acct) => ({
    label: contaNomeCurto(acct),
    value: (liq[acct] || 0) - (gasto[acct] || 0),
  }))
  return { rows, receitaNaoAtribuida, vendasNaoAtribuidas }
}

// ─── Gasto por produto de front-end (funil) ───────────────────────────────────

/** Rótulo do balde que recebe o gasto sem sigla de funil no nome. */
export const GASTO_OUTROS_LABEL = 'Outros'

/**
 * Particiona o gasto entre os funis pela regra de PRIMEIRA SIGLA
 * (`resolverFunilPorTokens`): cada linha do meta_ads entra em UM funil só, o da
 * sigla que aparece primeiro, na ordem de campos ad_name → sck → campaign_name.
 *
 * A versão anterior somava `filterByFunil(metaAds, slug)` por funil. Esse filtro
 * casa o token em campaign_name OU ad_name, em qualquer posição — então uma linha
 * cujo ad_name diz "lps" e a campanha diz "col" entrava nos DOIS funis. As linhas
 * somavam mais que o total e o "Outros" (total − somatório) saía subestimado no
 * mesmo tanto.
 */
export function gastoPorFunilRows(metaAds: SbMetaAds[], funis: FunilConfig[]): BreakdownRow[] {
  const porSlug: Record<string, number> = {}
  let outros = 0
  for (const r of metaAds) {
    const v = r.investimento || 0
    if (!v) continue
    const slug = resolverFunilPorTokens(
      { criativo: r.ad_name || r.criativo, campaign: r.campaign_name },
      funis,
    )
    if (slug) porSlug[slug] = (porSlug[slug] || 0) + v
    else outros += v
  }

  const ativos = funis.filter((f) => f.ativo !== false).slice().sort((a, b) => a.ordem - b.ordem)
  const rows: BreakdownRow[] = ativos
    .filter((f) => (porSlug[f.slug] || 0) > 0.005)
    .map((f) => ({ label: getFrontEndLabel(f.slug), value: porSlug[f.slug] }))
  if (outros > 0.005) rows.push({ label: GASTO_OUTROS_LABEL, value: outros })
  return rows
}

// ─── Série diária ─────────────────────────────────────────────────────────────

const addDias = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Teto de dias emitidos — trava contra um `de` absurdo vindo da URL. */
const MAX_DIAS_SERIE = 400

/**
 * Série diária do recorte (faturamento bruto, líquido−gasto, gasto, vendas front),
 * com TODO dia do intervalo presente — dia sem movimento entra como zero.
 *
 * Antes só entravam dias COM movimento. Como a banda de "esperado" projeta um
 * passo à frente sobre a série recebida, um domingo zerado que sumia deslocava a
 * projeção do dia seguinte e o gráfico mentia sobre a continuidade do período.
 *
 * O intervalo emitido vai de `from` (ou do 1º dia com dado, o que vier antes) até
 * o ÚLTIMO DIA COM DADO. Nunca depois: dia futuro zerado é invenção, não medição.
 */
export function serieDiaria(
  transacoes: SbTransacao[],
  metaAds: SbMetaAds[],
  opts: { from?: string | null; funis?: FunilConfig[] },
): WhatChangedDay[] {
  const byDate: Record<string, { fat: number; liq: number; inv: number; vf: number }> = {}
  const bucket = (d: string) => (byDate[d] ??= { fat: 0, liq: 0, inv: 0, vf: 0 })

  for (const t of transacoes) {
    const date = t.data?.slice(0, 10)
    if (!date) continue
    const b = bucket(date)
    b.fat += t.valor_bruto || 0
    b.liq += liquidoHotmartVenda(t.valor_bruto || 0)
    if (tipoDaTransacao(t, opts.funis) === 'frontEnd') b.vf += 1
  }
  for (const r of metaAds) {
    const date = r.data?.slice(0, 10)
    if (!date) continue
    bucket(date).inv += r.investimento || 0
  }

  const observados = Object.keys(byDate).sort()
  const minObs = observados[0]
  const maxObs = observados[observados.length - 1]

  // Sem nenhum dia com dado não existe série — devolver zeros até a data final só
  // encheria o gráfico de nada (a Home já mostra o estado vazio via `hasData`).
  if (!minObs || !maxObs) return []

  // FIM = último dia COM DADO, sempre. Zerar o que vem depois inventaria um
  // mergulho a zero: todo dia, entre 00h e o cron do sync-meta, o gráfico
  // terminaria num vale que não existe — e que o gráfico do desktop não mostra.
  // Buraco NO MEIO segue entrando como zero, que é o defeito original.
  const fim = maxObs
  // INÍCIO = o `de` pedido, esticado para trás se houver dado mais antigo.
  let inicio = opts.from && opts.from < minObs ? opts.from : minObs
  if (fim < inicio) return []
  // Teto de dias: corta a CABEÇA, nunca a cauda. Cortar do início descartava o
  // dado RECENTE — com `?de=2020-01-01` a série parava em 2021 e o faturamento
  // do mês aparecia como zero. O preset "Tudo" passa de 400 dias em 05/02/2027.
  const limite = addDias(fim, -(MAX_DIAS_SERIE - 1))
  if (inicio < limite) inicio = limite

  const out: WhatChangedDay[] = []
  for (let d = inicio; d <= fim; d = addDias(d, 1)) {
    const b = byDate[d] ?? { fat: 0, liq: 0, inv: 0, vf: 0 }
    out.push({
      date: d,
      faturamento: Math.round(b.fat),
      investimento: Math.round(b.inv),
      lucro: Math.round(b.liq - b.inv),
      vendasFront: b.vf,
    })
  }
  return out
}

// ─── Montagem completa da Home mobile ─────────────────────────────────────────

/** Ordena desc por magnitude, corta em `n` e junta o resto em "Outros". */
export function capRows(rows: BreakdownRow[], n = 5): BreakdownRow[] {
  const sorted = [...rows].filter((r) => Math.abs(r.value) > 0.005).sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  if (sorted.length <= n) return sorted
  const head = sorted.slice(0, n)
  const tail = sorted.slice(n)
  head.push({ label: `Outros (${tail.length})`, value: tail.reduce((s, r) => s + r.value, 0) })
  return head
}

const recToRows = (rec: Record<string, number>, labelFn: (k: string) => string): BreakdownRow[] =>
  Object.entries(rec).map(([k, v]) => ({ label: labelFn(k), value: v }))

const toTone = (c: string): MobileStat['tone'] =>
  c === 'green' ? 'good' : c === 'yellow' ? 'warn' : c === 'red' ? 'bad' : 'neutral'

/**
 * Chips de razão-chave. Mesmos rótulos e mesmas cores de semáforo do desktop —
 * inclusive o ROAS Bruto, que colore pela SUA PRÓPRIA base (no mobile ele era
 * sempre neutro, enquanto o card do desktop já coloria).
 */
export function buildMobileStats(core: VisaoGeralCore, funil: string): MobileStat[] {
  const { investimento, cpa, ticketFE, frontEndVendas } = core
  return [
    { label: KPI_LABEL.roasLiquido, value: formatRoas(core.roasLiquido), tone: investimento > 0 ? toTone(getSemaforoColor('roasLiquido', core.roasLiquido)) : 'neutral' },
    { label: KPI_LABEL.roasBruto, value: formatRoas(core.roasBruto), tone: investimento > 0 ? toTone(getSemaforoColor('roasLiquido', core.roasBruto)) : 'neutral' },
    { label: KPI_LABEL.cpa, value: cpa > 0 ? formatCurrency(cpa) : '–', tone: cpa > 0 ? toTone(getSemaforoColorForFunil('cpa', cpa, funil, ticketFE)) : 'neutral' },
    { label: KPI_LABEL.compradores, value: frontEndVendas.toLocaleString('pt-BR'), tone: 'neutral' },
  ]
}

export interface MobileHomeData {
  kpis: MobileKpi[]
  stats: MobileStat[]
  daily: WhatChangedDay[]
  hasData: boolean
  core: VisaoGeralCore
}

/**
 * Monta a Home mobile inteira a partir dos dados JÁ filtrados (data/funil/conta).
 *
 * É função pura em lib/ — e não inline no Server Component — porque era ali que os
 * defeitos passavam batido: uma rodada de mutação em 10/08/2026 trocou
 * `total: lucroLiquido01` por `lucroBruto`, dobrou o investimento e fez a série
 * ignorar o período, e a suíte de 704 testes continuou 100% verde, porque os
 * testes só liam SUBSTRING do page.tsx. Aqui o comportamento é observável.
 */
export function buildMobileHome(args: {
  transacoes: SbTransacao[]
  metaAds: SbMetaAds[]
  /** Histórico COMPLETO do meta_ads — a ad que gerou a venda pode ser anterior ao recorte. */
  allMeta: SbMetaAds[]
  funis: FunilConfig[]
  /** Slug do funil selecionado ('all' = todos). */
  funil: string
  /** `de` do recorte — só alarga a série para trás; nunca corta dado. */
  from?: string | null
}): MobileHomeData {
  const { transacoes, metaAds, allMeta, funis, funil, from } = args
  const core = computeVisaoGeralCore(transacoes, metaAds)
  const { faturamento, investimento, receitaLiquida, lucroLiquido01 } = core

  // Faturamento e receita líquida por PRODUTO. O breakdown por CONTA saiu daqui:
  // sem anúncio de origem não existe conta, e fingir que existia era o que criava
  // o balde "Orgânico / sem conta" com 48,7% da receita.
  const fatPorProduto: Record<string, number> = {}
  const liqPorProduto: Record<string, number> = {}
  for (const t of transacoes) {
    const v = t.valor_bruto || 0
    const prod = (t.produto || 'Sem produto').trim()
    fatPorProduto[prod] = (fatPorProduto[prod] || 0) + v
    liqPorProduto[prod] = (liqPorProduto[prod] || 0) + liquidoHotmartVenda(v)
  }

  const share = (v: number, total: number) => (total !== 0 ? formatPercent((v / total) * 100) : '0%')
  const fatProdRows = capRows(recToRows(fatPorProduto, (k) => k))
  // Receita por ORIGEM — mesma função e mesmos rótulos do bloco do desktop.
  const origemRows = receitaPorOrigemRows(transacoes)
  const gastoContaRows = capRows(recToRows(gastoPorConta(metaAds), contaNomeCurto))
  // "Por produto" reparte o gasto ENTRE funis — só faz sentido com o filtro em
  // "todos". Com um funil selecionado, `metaAds` veio de filterByFunil (token em
  // campaign_name OU ad_name, em qualquer posição) e o rateio usa a primeira sigla:
  // linha com campanha "COL" e ad_name "lps-…" entrava no recorte de COL e saía
  // rotulada "Imersão Lucro Clínico". O total fechava e o rótulo mentia.
  const gastoProdRows = funil === 'all' ? capRows(gastoPorFunilRows(metaAds, funis)) : []
  const lucroConta = lucroPorConta(transacoes, metaAds, allMeta)
  const lucroContaRows = capRows(lucroConta.rows)
  const lucroProdRows = capRows(recToRows(liqPorProduto, (k) => k))

  const ctxTop = (rows: BreakdownRow[], total: number, noun: string) =>
    rows.length ? `${rows[0].label} lidera com ${share(rows[0].value, total)} · ${rows.length} ${noun}` : ''
  // O que NÃO entra no rateio por conta precisa ser declarado, não escondido.
  const notaNaoAtribuida = lucroConta.receitaNaoAtribuida > 0.005
    ? `${formatCurrencyCompact(lucroConta.receitaNaoAtribuida)} de receita líquida (${lucroConta.vendasNaoAtribuidas} venda(s)) sem anúncio de origem ficam fora deste rateio`
    : ''
  const bestWorst = (): string => {
    if (!lucroContaRows.length) return notaNaoAtribuida
    const maxPos = [...lucroContaRows].sort((a, b) => b.value - a.value)[0]
    const minVal = [...lucroContaRows].sort((a, b) => a.value - b.value)[0]
    // "lucra" só quando lucra de verdade. Com TODAS as contas no vermelho, a régua
    // antiga imprimia "Conta 05 lucra −R$ 165,64" — visto em produção em 10/08/2026.
    const base = maxPos.value < 0
      ? `Nenhuma conta no azul; a menos deficitária é ${maxPos.label} (${formatCurrencyCompact(maxPos.value)})`
      : minVal.value < 0 && minVal.label !== maxPos.label
        ? `${maxPos.label} lucra ${formatCurrencyCompact(maxPos.value)}; ${minVal.label} no vermelho (${formatCurrencyCompact(minVal.value)})`
        : `${maxPos.label} é a conta mais lucrativa (${formatCurrencyCompact(maxPos.value)})`
    return [base, notaNaoAtribuida].filter(Boolean).join(' · ')
  }

  const kpis: MobileKpi[] = [
    {
      key: 'faturamento',
      label: KPI_LABEL.faturamento,
      total: faturamento,
      totalLabel: formatCurrencyCompact(faturamento),
      accent: 'cyan',
      breakdowns: [
        { title: 'Por produto', total: faturamento, rows: fatProdRows, context: ctxTop(fatProdRows, faturamento, 'produtos') },
        { title: 'Por origem', total: faturamento, rows: origemRows, context: origemRows.length ? `${origemRows[0].label} responde por ${share(origemRows[0].value, faturamento)} · classificação determinística por UTM/ad_id` : '' },
      ],
    },
    {
      key: 'investimento',
      label: KPI_LABEL.investimento,
      total: investimento,
      totalLabel: formatCurrencyCompact(investimento),
      accent: 'rose',
      breakdowns: [
        { title: 'Por conta', total: investimento, rows: gastoContaRows, context: gastoContaRows.length ? `Maior gasto em ${gastoContaRows[0].label} (${share(gastoContaRows[0].value, investimento)}) · ${gastoContaRows.length} conta(s)` : '' },
        ...(gastoProdRows.length
          ? [{ title: 'Por produto', total: investimento, rows: gastoProdRows, context: 'Investimento por produto de front-end de cada funil — cada anúncio conta em um funil só (a primeira sigla do nome)' }]
          : []),
      ],
    },
    {
      key: 'lucro',
      label: KPI_LABEL.lucroLiquido01,
      total: lucroLiquido01,
      totalLabel: formatCurrencyCompact(lucroLiquido01),
      accent: 'emerald',
      positive: lucroLiquido01 >= 0,
      breakdowns: [
        { title: 'Por conta de anúncio', total: lucroLiquido01, signed: true, rows: lucroContaRows, context: bestWorst() },
        { title: 'Receita líq. por produto', total: receitaLiquida, rows: lucroProdRows, context: 'Receita líquida por produto — o investimento não é rateado por produto' },
      ],
    },
  ]

  return {
    kpis,
    stats: buildMobileStats(core, funil),
    daily: serieDiaria(transacoes, metaAds, { from }),
    hasData: faturamento > 0 || investimento > 0,
    core,
  }
}
