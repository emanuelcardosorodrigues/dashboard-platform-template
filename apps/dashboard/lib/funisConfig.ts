/**
 * Funis configuráveis (admin) — engine de classificação config-driven que substitui
 * a régua hard-coded (produtoToTipo / resolveFunil / detectFunil / produtoToFunil /
 * produtoBumpDefault em lib/supabase.ts).
 *
 * Um FUNIL é definido pelo usuário com:
 *  - produtos: cada produto (match por NOME e/ou ID) marcado com um PAPEL
 *    (front / ob / upsell / downsell);
 *  - campanhas: tokens que, achados no criativo/sck/campanha, atribuem o GASTO
 *    (e a transação, quando não há produto fixo) àquele funil.
 *
 * DEFAULT_FUNIS reproduz exatamente a classificação atual (COL/DPL/LPS/PLO) e serve
 * de (a) fallback quando a config do banco está vazia e (b) seed da migration 0044.
 * Os testes-ouro (funisConfig.test.ts) travam a equivalência com o comportamento atual.
 */

export type Papel = 'front' | 'ob' | 'upsell' | 'downsell'
/** tipo "achatado" usado no resto do dashboard (mantém ob1..ob4 p/ take-rate por OB). */
export type ProdutoTipoFlat = 'frontEnd' | 'ob1' | 'ob2' | 'ob3' | 'ob4' | 'upsell' | 'downsell'

export interface ProdutoRegra {
  /** tokens separados por espaço; TODOS precisam aparecer no alvo (reproduz regex `.*`). */
  match: string
  /** casa no nome do produto ou no id Hotmart. */
  por: 'nome' | 'id'
  papel: Papel
  /** 1..4 quando papel === 'ob' (mantém ob1..ob4); ignorado nos demais. */
  ordemOb?: number
}

export type CampoToken = 'campaign_name' | 'ad_name' | 'sck' | 'utm_campaign' | 'utm_content' | 'utm_term'

/** Ordem de prioridade na resolução do funil: o primeiro que casar decide. */
export const CAMPOS_TOKEN: CampoToken[] = ['ad_name', 'sck', 'utm_campaign', 'utm_content', 'utm_term', 'campaign_name']

export interface CampanhaRegra {
  habilitado: boolean
  tokens: string[]
  /**
   * Onde procurar os tokens. `campaign_name` é o nome da campanha no META;
   * `utm_campaign`/`utm_content`/`utm_term` são o pacote de origem da própria
   * transação (migration 0068) — é o que permite identificar o funil de uma venda
   * fechada fora do anúncio, que não tem ad_name nem campanha do Meta.
   */
  campos: Array<CampoToken>
}

export interface FunilConfig {
  slug: string
  nome: string
  ordem: number
  ativo: boolean
  cor?: string
  produtos: ProdutoRegra[]
  campanhas: CampanhaRegra
}

/** Config-padrão = espelho 1:1 da régua atual. Também é o seed da migration 0044. */
export const DEFAULT_FUNIS: FunilConfig[] = [
  {
    slug: 'col', nome: 'COL', ordem: 1, ativo: true, cor: '#06B6D4',
    produtos: [
      { match: 'produto demonstrativo', por: 'nome', papel: 'front' },
      { match: 'script', por: 'nome', papel: 'ob', ordemOb: 1 },
      { match: 'tribut', por: 'nome', papel: 'ob', ordemOb: 2 },
      { match: 'dentista', por: 'nome', papel: 'ob', ordemOb: 3 },
      { match: 'manual', por: 'nome', papel: 'ob', ordemOb: 4 },
    ],
    campanhas: { habilitado: true, tokens: ['col'], campos: ['ad_name', 'sck', 'campaign_name'] },
  },
  {
    slug: 'dpl', nome: 'DPL', ordem: 2, ativo: true, cor: '#F59E0B',
    produtos: [{ match: 'dentista', por: 'nome', papel: 'front' }],
    campanhas: { habilitado: true, tokens: ['dpl'], campos: ['ad_name', 'sck', 'campaign_name'] },
  },
  {
    slug: 'lps', nome: 'LPS', ordem: 3, ativo: true, cor: '#10B981',
    produtos: [{ match: 'imers', por: 'nome', papel: 'front' }],
    campanhas: { habilitado: true, tokens: ['lps'], campos: ['ad_name', 'sck', 'campaign_name'] },
  },
  {
    slug: 'plo', nome: 'PLO', ordem: 4, ativo: true, cor: '#A78BFA',
    produtos: [
      { match: 'implementa express', por: 'nome', papel: 'downsell' },
      { match: 'implementa', por: 'nome', papel: 'upsell' },
      { match: 'protocolo lucro oculto', por: 'nome', papel: 'front' },
    ],
    campanhas: { habilitado: true, tokens: ['plo'], campos: ['ad_name', 'sck', 'campaign_name'] },
  },
]

const lower = (s?: string | null) => (s || '').toLowerCase()
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** funis ativos em ordem (cópia defensiva ordenada por `ordem`). */
function ativosOrdenados(funis: FunilConfig[]): FunilConfig[] {
  return funis.filter((f) => f.ativo !== false).slice().sort((a, b) => a.ordem - b.ordem)
}

/** token como PALAVRA delimitada (espelha hasFunilToken: fronteiras [^a-z]). */
export function temToken(texto: string | null | undefined, token: string): boolean {
  const t = lower(texto), tok = lower(token)
  if (!t || !tok) return false
  return new RegExp(`(?:^|[^a-z])${escapeRe(tok)}(?:[^a-z]|$)`).test(t)
}

/**
 * Posição da PRIMEIRA ocorrência do token como palavra delimitada. -1 se não achar.
 * Mesma fronteira do `temToken` — só que devolvendo onde, em vez de só se.
 */
export function posicaoToken(texto: string | null | undefined, token: string): number {
  const t = lower(texto), tok = lower(token)
  if (!t || !tok) return -1
  const m = new RegExp(`(?:^|[^a-z])${escapeRe(tok)}(?:[^a-z]|$)`).exec(t)
  if (!m) return -1
  // o match pode começar no delimitador; a sigla em si vem logo depois quando isso ocorre.
  return m.index + (m[0].startsWith(tok) ? 0 : 1)
}

/**
 * Funil da PRIMEIRA SIGLA que aparece no texto — não o primeiro funil por `ordem`.
 *
 * Regra de negócio (Equipe, 25/07/2026): quando mais de uma sigla aparece, vale a que
 * vem primeiro. `demo-col-vid-04` é COL (a sigla vem depois do prefixo do expert, e é a
 * primeira que aparece). Já `lps-pv06-alunos-calculadora-col-1real` é LPS: é a página que
 * vende a Calculadora pros alunos do LPS, então o `col` no meio é o nome do produto
 * ofertado, não o funil.
 *
 * A régua anterior varria os funis em ordem de config e devolvia o primeiro que casasse
 * em QUALQUER posição — então COL (ordem 1) ganhava de LPS (ordem 3) mesmo aparecendo
 * depois no texto, e 39 vendas de "Imersão Lucro Clínico!" a R$1 (front do LPS) eram
 * creditadas ao COL. Empate de posição desempata pela ordem do funil, como antes.
 */
function funilDaPrimeiraSigla(
  texto: string | null | undefined,
  ativos: FunilConfig[],
  campo: CampoToken,
): string | null {
  let melhorSlug: string | null = null
  let melhorPos = Number.POSITIVE_INFINITY
  for (const f of ativos) {
    if (!f.campanhas?.habilitado) continue
    if (!f.campanhas.campos?.includes(campo)) continue
    for (const tk of f.campanhas.tokens ?? []) {
      const pos = posicaoToken(texto, tk)
      if (pos >= 0 && pos < melhorPos) {
        melhorPos = pos
        melhorSlug = f.slug
      }
    }
  }
  return melhorSlug
}

/**
 * Casamento de uma regra de produto.
 *
 * `por:'nome'` — TODOS os tokens de `match` precisam aparecer no nome (E), por
 * TRECHO. É o modo legado: funciona, mas o nome é editável na Hotmart e um
 * rename silencioso desclassifica a venda.
 *
 * `por:'id'` — o ID do produto tem que ser IGUAL a um dos ids de `match` (OU),
 * separados por espaço ou vírgula. Igualdade, nunca `includes`: os IDs da
 * Hotmart compartilham prefixo (8204315 / 8204066 / 8217416) e um match por
 * trecho colaria produtos diferentes no mesmo papel. Sem `produto_id` na linha
 * (histórico antes da migration 0067), a regra por id simplesmente não casa —
 * é o silêncio correto, não um fallback para o nome.
 */
function regraCasa(regra: ProdutoRegra, produtoLower: string, produtoId: string): boolean {
  const toks = lower(regra.match).split(/[\s,]+/).filter(Boolean)
  if (toks.length === 0) return false
  if (regra.por === 'id') {
    const alvo = lower(produtoId)
    return alvo !== '' && toks.includes(alvo)
  }
  return toks.every((tok) => produtoLower.includes(tok))
}

/** Primeira regra de produto que casa, dentro de um funil. */
function regraDoFunil(f: FunilConfig, produtoLower: string, produtoId: string): ProdutoRegra | null {
  for (const r of f.produtos) if (regraCasa(r, produtoLower, produtoId)) return r
  return null
}

export interface SinalFunil {
  criativo?: string | null
  sck?: string | null
  campaign?: string | null
  /** utm_campaign da transação (≠ campaign do Meta). */
  utmCampaign?: string | null
  utmContent?: string | null
  utmTerm?: string | null
  produto?: string | null
  produtoId?: string | null
  /** funil já resolvido p/ o email do comprador (herança de order bump órfão). */
  emailFunil?: string | null
}

/**
 * Resolve o slug do funil de uma transação, na MESMA prioridade do resolveFunil atual:
 *   1. token no criativo  2. token no sck  3. token na campanha
 *   4. produto FIXO (front/upsell/downsell)  5. herança por email  6. order bump (default)
 */
export function resolverFunil(sinal: SinalFunil, funis: FunilConfig[] = DEFAULT_FUNIS): string | null {
  const ativos = ativosOrdenados(funis)
  const pid = lower(sinal.produtoId)
  const pnome = lower(sinal.produto)

  // 1-3: tokens de campanha por campo (criativo → sck → campanha), funis por ordem.
  const campoTexto: Record<CampoToken, string | null | undefined> = {
    ad_name: sinal.criativo, sck: sinal.sck, campaign_name: sinal.campaign,
    utm_campaign: sinal.utmCampaign, utm_content: sinal.utmContent, utm_term: sinal.utmTerm,
  }
  for (const campo of CAMPOS_TOKEN) {
    const slug = funilDaPrimeiraSigla(campoTexto[campo], ativos, campo)
    if (slug) return slug
  }
  // 4: produto fixo (front/upsell/downsell) — só roteia por filiação se NÃO for OB
  // em outro funil. Produto ambíguo (front aqui, OB lá) decide por token/default,
  // não por filiação — espelha produtoToFunil (Dentista só vai pro DPL com token dpl).
  const ehObEmOutro = (slug: string) =>
    ativos.some((g) => {
      if (g.slug === slug) return false
      const rg = regraDoFunil(g, pnome, pid)
      return !!rg && rg.papel === 'ob'
    })
  for (const f of ativos) {
    const r = regraDoFunil(f, pnome, pid)
    if (r && r.papel !== 'ob' && !ehObEmOutro(f.slug)) return f.slug
  }
  // 5: herança por email.
  if (sinal.emailFunil) return sinal.emailFunil
  // 6: order bump → default (primeiro funil por ordem que tem o produto como OB).
  for (const f of ativos) {
    const r = regraDoFunil(f, pnome, pid)
    if (r && r.papel === 'ob') return f.slug
  }
  return null
}

/**
 * Resolve o funil SÓ pelos tokens de campanha (criativo → sck → campanha) — sem
 * filiação de produto. Espelha o `directOf` do filterTransacoesByFunil atual, usado
 * pra montar a herança por email (qual funil o front do comprador veio).
 */
export function resolverFunilPorTokens(sinal: SinalFunil, funis: FunilConfig[] = DEFAULT_FUNIS): string | null {
  const ativos = ativosOrdenados(funis)
  const campoTexto: Record<CampoToken, string | null | undefined> = {
    ad_name: sinal.criativo, sck: sinal.sck, campaign_name: sinal.campaign,
    utm_campaign: sinal.utmCampaign, utm_content: sinal.utmContent, utm_term: sinal.utmTerm,
  }
  for (const campo of CAMPOS_TOKEN) {
    const slug = funilDaPrimeiraSigla(campoTexto[campo], ativos, campo)
    if (slug) return slug
  }
  return null
}

/** Papel → tipo achatado (ob + ordemOb → ob1..ob4). */
function papelParaTipo(r: ProdutoRegra): ProdutoTipoFlat {
  if (r.papel === 'front') return 'frontEnd'
  if (r.papel === 'upsell') return 'upsell'
  if (r.papel === 'downsell') return 'downsell'
  return (`ob${r.ordemOb && r.ordemOb >= 1 && r.ordemOb <= 4 ? r.ordemOb : 1}`) as ProdutoTipoFlat
}

/**
 * Classifica um produto em frontEnd/ob1..ob4/upsell/downsell.
 * Usa o papel no funil RESOLVIDO; se o produto não pertence a ele, cai pro papel
 * "natural" (primeiro funil por ordem que contém o produto). Fallback: frontEnd
 * (conservador, igual ao produtoToTipo atual).
 */
export function classificarProduto(
  produto: string,
  funilSlug: string | null,
  funis: FunilConfig[] = DEFAULT_FUNIS,
  produtoId = '',
): ProdutoTipoFlat {
  const ativos = ativosOrdenados(funis)
  const pnome = lower(produto), pid = lower(produtoId)
  if (funilSlug) {
    const f = ativos.find((x) => x.slug === funilSlug)
    if (f) { const r = regraDoFunil(f, pnome, pid); if (r) return papelParaTipo(r) }
  }
  for (const f of ativos) { const r = regraDoFunil(f, pnome, pid); if (r) return papelParaTipo(r) }
  return 'frontEnd'
}

/** Rótulo do produto front-end de um funil (espelha getFrontEndLabel). */
export function labelFrontDoFunil(funilSlug: string, funis: FunilConfig[] = DEFAULT_FUNIS): string {
  const f = ativosOrdenados(funis).find((x) => x.slug === funilSlug)
  const frontMatch = f?.produtos.find((r) => r.papel === 'front')?.match
  return frontMatch ? frontMatch : (f?.nome || 'Principal')
}
