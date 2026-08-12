/**
 * Sugestões de criativo por MÉTRICA-OBJETIVO da Calculadora (S7) — "qual criativo eu
 * escalo/replico pra mover ESTA métrica", separado por funil e sempre lastreado no
 * número real que sustenta a sugestão.
 *
 * A tabela de sinal→métrica é FIXA (não inventar outra):
 *
 *   ctr        → hook rate            views_3seg ÷ impressoes         piso 1.000 impressões
 *   convPag    → body conversion      convBodyPct (lib/metrics/convBody.ts)  piso dele (30 views_75pct)
 *   ticket     → attach de OB         vendas OB ÷ vendas front, MESMO criativo  piso 10 vendas front
 *   roas       → ROAS consolidado     CreativeStats.roas               piso 5 vendas front
 *   lucroPorPv → lucro por view       (receita − investimento) ÷ landing_views  piso 200 landing views
 *
 * Precedente que este módulo segue (mesmo espírito de convBody.ts e ticketFunil.ts):
 * abaixo do piso de amostra o criativo NÃO ENTRA na lista — não é "0%", é ausência de
 * evidência. Se ninguém passa do piso, a resposta é `semDado: true` com o motivo, nunca
 * uma lista fantasma. `evidencia` sempre carrega o número E a amostra que o sustentam;
 * sugestão sem número é proibida.
 *
 * `gancho`/`formato` vêm de `criativo_analise` (classificação da IA) e são OPCIONAIS: o
 * chamador busca o mapa por `ad_id` (ver `lib/criativoAnalises.ts`) e passa em
 * `opts.analises`. Sem isso, ou pra criativo ainda não analisado, ficam `undefined` e a
 * UI mostra "SEM DADO". Nunca gerar código g01–g46 por conta própria: o repo só tem a
 * faixa do regex (taxonomia-demo.ts), não os nomes; inventar um código seria alucinar rótulo.
 *
 * Função pura, sem I/O, sem React — mesmo contrato de computeTicketFunil.
 */

import {
  filterByFunil,
  filterTransacoesByFunil,
  normalizeFunil,
  tipoDaTransacao,
  type SbMetaAds,
  type SbTransacao,
} from './supabase'
import { DEFAULT_FUNIS, type FunilConfig } from './funisConfig'
import { aggregateCreatives, type CreativeStats } from './creativeAnalysis'
import { convBodyPct, MIN_VIEWS_75_CONV_BODY } from './metrics/convBody'
import { formatCurrency, formatNumber, formatPercent, formatRoas } from './formatters'

export type MetricaObjetivo = 'ctr' | 'convPag' | 'ticket' | 'roas' | 'lucroPorPv'

export interface SugestaoCriativo {
  criativo: string
  adId: string | null
  /** o número que SUSTENTA a sugestão, já formatado pra exibir (ex.: "hook rate 34,2%") */
  evidencia: string
  /** valor bruto do sinal, pra ordenar */
  valor: number
  /** amostra que dá confiança (impressões, ou views_75pct no caso do corpo) */
  amostra: number
  investimento: number
  /** rótulos vindos de criativo_analise, quando existirem */
  gancho?: string
  formato?: string
  /** por que ESTE criativo foi escolhido pra ESTA métrica */
  motivo: string
}

export interface SugestoesPorMetrica {
  metrica: MetricaObjetivo
  funil: string | null
  sinal: string // nome do sinal usado, ex.: "hook rate"
  sugestoes: SugestaoCriativo[]
  semDado: boolean // true quando não há amostra suficiente pra sugerir NADA
  motivoSemDado?: string // ex.: "nenhum criativo com 30+ views de 75% na janela"
}

// ─── Pisos de amostra (tabela fixa do contrato — não inventar outro) ───────────
export const PISO_IMPRESSOES_CTR = 1000
export const PISO_VENDAS_FRONT_TICKET = 10
export const PISO_VENDAS_FRONT_ROAS = 5
export const PISO_LANDING_VIEWS_LUCRO = 200
// convPag usa MIN_VIEWS_75_CONV_BODY (30), importado de lib/metrics/convBody.ts.

const DEFAULT_LIMITE = 5

const SINAL_NOME: Record<MetricaObjetivo, string> = {
  ctr: 'hook rate',
  convPag: 'body conversion',
  ticket: 'attach de order bump',
  roas: 'ROAS consolidado',
  lucroPorPv: 'lucro por visualização',
}

const PISO_LABEL: Record<MetricaObjetivo, string> = {
  ctr: `${formatNumber(PISO_IMPRESSOES_CTR)}+ impressões`,
  convPag: `${MIN_VIEWS_75_CONV_BODY}+ views de 75%`,
  ticket: `${PISO_VENDAS_FRONT_TICKET}+ vendas front`,
  roas: `${PISO_VENDAS_FRONT_ROAS}+ vendas front`,
  lucroPorPv: `${formatNumber(PISO_LANDING_VIEWS_LUCRO)}+ landing views`,
}

/** True se `data` cai dentro de [de, ate] (inclusivo). Espelha emJanela de lib/ticketFunil.ts. */
function emJanela(data: string | null | undefined, de?: string, ate?: string): boolean {
  if (!data) return !de && !ate
  if (de && data < de) return false
  if (ate && data > ate) return false
  return true
}

// ─── Índice por NOME do criativo (mesma chave de aggregateCreatives) ──────────
// aggregateCreatives já dá investimento/landing_views/receita/roas/compras por nome,
// mas não expõe views_3seg/views_75pct nem a contagem de vendas de ORDER BUMP (só
// front). Reconstruímos aqui a MESMA rota (ad_id → nome, com fallback pro nome cru
// do criativo) pra que as duas contagens fechem com o grupo do CreativeStats.

interface NameAgg {
  impressoes: number
  views3seg: number
  views75pct: number
  vendasFront: number
  vendasOb: number
}

function buildAdIdToName(metaAds: SbMetaAds[]): { adIdToName: Map<string, string>; names: Set<string> } {
  const adIdToName = new Map<string, string>()
  const names = new Set<string>()
  for (const m of metaAds) {
    const name = m.criativo || m.ad_name || '(sem nome)'
    names.add(name)
    if (m.ad_id) adIdToName.set(m.ad_id, name)
  }
  return { adIdToName, names }
}

/** Mesma rota de aggregateCreatives: ad_id da transação → nome; fallback pro nome cru. */
function nomeDaTransacao(t: SbTransacao, adIdToName: Map<string, string>, names: Set<string>): string | null {
  const adId = t.ad_id || null
  const nameFromAd = adId ? adIdToName.get(adId) : undefined
  if (nameFromAd && names.has(nameFromAd)) return nameFromAd
  if (t.criativo && names.has(t.criativo)) return t.criativo
  return null
}

function aggregatePorNome(
  metaAds: SbMetaAds[],
  transacoes: SbTransacao[],
  funis: FunilConfig[],
): Map<string, NameAgg> {
  const { adIdToName, names } = buildAdIdToName(metaAds)
  const acc = new Map<string, NameAgg>()
  const get = (name: string): NameAgg => {
    let a = acc.get(name)
    if (!a) {
      a = { impressoes: 0, views3seg: 0, views75pct: 0, vendasFront: 0, vendasOb: 0 }
      acc.set(name, a)
    }
    return a
  }
  for (const m of metaAds) {
    const name = m.criativo || m.ad_name || '(sem nome)'
    const a = get(name)
    a.impressoes += Number(m.impressoes ?? 0)
    a.views3seg += Number(m.views_3seg ?? 0)
    a.views75pct += Number(m.views_75pct ?? 0)
  }
  for (const t of transacoes) {
    const name = nomeDaTransacao(t, adIdToName, names)
    if (!name) continue
    const a = get(name)
    const tipo = tipoDaTransacao(t, funis)
    if (tipo === 'frontEnd') a.vendasFront += 1
    else if (tipo === 'ob1' || tipo === 'ob2' || tipo === 'ob3' || tipo === 'ob4') a.vendasOb += 1
  }
  return acc
}

// ─── Candidatos por métrica ─────────────────────────────────────────────────
// Cada builder devolve só quem PASSA do piso — quem não passa fica de fora (nunca
// vira 0%/0 fantasma). `valor` já na unidade "de exibição" (percentual 0-100 pra
// taxas, ratio cru pro ROAS, R$ cru pro lucro por PV) — a ordenação DESC não muda
// com a escala, e fica mais fácil de auditar no debugger/teste.

function candidatosCtr(creatives: CreativeStats[], agg: Map<string, NameAgg>): SugestaoCriativo[] {
  const out: SugestaoCriativo[] = []
  for (const c of creatives) {
    const a = agg.get(c.criativo)
    const impressoes = a?.impressoes ?? 0
    if (impressoes < PISO_IMPRESSOES_CTR) continue
    const views3 = a?.views3seg ?? 0
    const hookPct = (views3 / impressoes) * 100
    const pctStr = formatPercent(hookPct)
    out.push({
      criativo: c.criativo,
      adId: c.ad_id,
      evidencia: `hook rate ${pctStr} em ${formatNumber(impressoes)} impressões`,
      valor: hookPct,
      amostra: impressoes,
      investimento: c.investimento,
      motivo: `${pctStr} de quem viu o anúncio ficou pelo menos 3 segundos — gancho forte, dá pra escalar sem estourar CPM.`,
    })
  }
  return out
}

function candidatosConvPag(creatives: CreativeStats[], agg: Map<string, NameAgg>): SugestaoCriativo[] {
  const out: SugestaoCriativo[] = []
  for (const c of creatives) {
    const a = agg.get(c.criativo)
    const views75 = a?.views75pct ?? 0
    const vendasFront = a?.vendasFront ?? 0
    const pct = convBodyPct(vendasFront, views75)
    if (pct === undefined) continue
    const pctStr = formatPercent(pct)
    out.push({
      criativo: c.criativo,
      adId: c.ad_id,
      evidencia: `body conversion ${pctStr} em ${formatNumber(views75)} views de 75%`,
      valor: pct,
      amostra: views75,
      investimento: c.investimento,
      motivo: `De quem assistiu até 75% do vídeo, ${pctStr} comprou — a oferta do corpo converte quem fica até o fim.`,
    })
  }
  return out
}

function candidatosTicket(creatives: CreativeStats[], agg: Map<string, NameAgg>): SugestaoCriativo[] {
  const out: SugestaoCriativo[] = []
  for (const c of creatives) {
    const a = agg.get(c.criativo)
    const vendasFront = a?.vendasFront ?? 0
    if (vendasFront < PISO_VENDAS_FRONT_TICKET) continue
    const vendasOb = a?.vendasOb ?? 0
    const attachPct = (vendasOb / vendasFront) * 100
    const pctStr = formatPercent(attachPct)
    out.push({
      criativo: c.criativo,
      adId: c.ad_id,
      evidencia: `attach de order bump ${pctStr} em ${formatNumber(vendasFront)} vendas front`,
      valor: attachPct,
      amostra: vendasFront,
      investimento: c.investimento,
      motivo: `${pctStr} de quem comprou o produto principal deste criativo também levou algum order bump — puxa o ticket médio pra cima.`,
    })
  }
  return out
}

function candidatosRoas(creatives: CreativeStats[], agg: Map<string, NameAgg>): SugestaoCriativo[] {
  const out: SugestaoCriativo[] = []
  for (const c of creatives) {
    const vendasFront = agg.get(c.criativo)?.vendasFront ?? 0
    if (vendasFront < PISO_VENDAS_FRONT_ROAS) continue
    const roasStr = formatRoas(c.roas)
    out.push({
      criativo: c.criativo,
      adId: c.ad_id,
      evidencia: `ROAS ${roasStr} em ${formatNumber(vendasFront)} vendas front`,
      valor: c.roas,
      amostra: vendasFront,
      investimento: c.investimento,
      motivo: `Retorno de ${roasStr} sobre cada real investido — o mais eficiente em receita líquida por verba, neste recorte.`,
    })
  }
  return out
}

function candidatosLucroPorPv(creatives: CreativeStats[]): SugestaoCriativo[] {
  const out: SugestaoCriativo[] = []
  for (const c of creatives) {
    if (c.landing_views < PISO_LANDING_VIEWS_LUCRO) continue
    const lucroPorPv = (c.receita - c.investimento) / c.landing_views
    const valorStr = formatCurrency(lucroPorPv)
    out.push({
      criativo: c.criativo,
      adId: c.ad_id,
      evidencia: `lucro por visualização ${valorStr} em ${formatNumber(c.landing_views)} landing views`,
      valor: lucroPorPv,
      amostra: c.landing_views,
      investimento: c.investimento,
      motivo: `Cada visita à página deixou ${valorStr} de lucro líquido — o criativo que mais entrega por visualização.`,
    })
  }
  return out
}

export function computeSugestoes(
  transacoes: SbTransacao[],
  metaAds: SbMetaAds[],
  opts: {
    de?: string
    ate?: string
    funil?: string
    funis?: FunilConfig[]
    metrica: MetricaObjetivo
    limite?: number
    /**
     * Rótulos da IA por `ad_id`, vindos de `criativo_analise`. Opcional: sem isso os
     * itens saem com gancho/formato `undefined` e a UI mostra "SEM DADO", que é o
     * comportamento honesto pra criativo ainda não analisado.
     */
    analises?: Map<string, { gancho?: string; formato?: string }>
  },
): SugestoesPorMetrica {
  const funis = opts.funis ?? DEFAULT_FUNIS
  const funilRaw = opts.funil ?? ''
  const limite = opts.limite ?? DEFAULT_LIMITE
  const slug = normalizeFunil(funilRaw, funis)

  // 1. Recorte de data ANTES do filtro de funil (mesma ordem de computeTicketFunil).
  const transDate = transacoes.filter((t) => emJanela(t.data, opts.de, opts.ate))
  const metaDate = metaAds.filter((m) => emJanela(m.data, opts.de, opts.ate))

  // 2. Filtro de funil. `filterTransacoesByFunil` recebe o meta_ads INTEIRO (não só o
  //    recorte de data) pro lookup criativo→campanha — mesmo padrão de ticketFunil.ts.
  const metaFiltrado = filterByFunil(metaDate, funilRaw, funis)
  const transFiltrado = filterTransacoesByFunil(transDate, funilRaw, metaAds, funis)

  const creatives = aggregateCreatives(metaFiltrado, transFiltrado)
  const agg = aggregatePorNome(metaFiltrado, transFiltrado, funis)

  const metrica = opts.metrica
  const candidatos =
    metrica === 'ctr'
      ? candidatosCtr(creatives, agg)
      : metrica === 'convPag'
        ? candidatosConvPag(creatives, agg)
        : metrica === 'ticket'
          ? candidatosTicket(creatives, agg)
          : metrica === 'roas'
            ? candidatosRoas(creatives, agg)
            : candidatosLucroPorPv(creatives)

  const ordenados = candidatos.sort((x, y) => y.valor - x.valor)
  const topo = ordenados.slice(0, Math.max(0, limite))

  // Rótulos de gancho/formato vêm da tabela `criativo_analise` (classificação da IA),
  // que o CHAMADOR busca e passa aqui — este módulo continua puro. Só preenche o que
  // existe: criativo sem análise fica `undefined` e a UI mostra "SEM DADO". NUNCA
  // derivar código g01–g46 por conta própria (o repo só tem a faixa do regex em
  // taxonomia-demo.ts, não os nomes — inventar aqui seria alucinar rótulo).
  const sugestoes = opts.analises
    ? topo.map((s) => {
        const a = s.adId ? opts.analises!.get(s.adId) : undefined
        return a?.gancho || a?.formato ? { ...s, gancho: a.gancho, formato: a.formato } : s
      })
    : topo
  const semDado = sugestoes.length === 0

  return {
    metrica,
    funil: slug,
    sinal: SINAL_NOME[metrica],
    sugestoes,
    semDado,
    motivoSemDado: semDado ? `nenhum criativo com ${PISO_LABEL[metrica]} na janela` : undefined,
  }
}
