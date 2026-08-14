/**
 * Acesso por DOMÍNIO DE DADOS (Fase 2.7).
 *
 * Um admin escopa a IA (Equipe/Odin) de cada usuário a "domínios de dados"
 * coerentes (criativos, funil, financeiro, pesquisa, orgânico, experimentos).
 * Isto é uma camada ADICIONAL de controle, ortogonal ao allowlist de rotas
 * (`allowed_paths` em lib/auth.ts) — enquanto allowed_paths decide quais ABAS
 * o usuário vê/pergunta, os domínios agrupam essas abas por FONTE DE DADOS pra
 * o admin liberar/bloquear em blocos.
 *
 * Regra de negócio:
 *  - Admin  → SEMPRE todos os domínios (god-mode; ignora data_domains).
 *  - Viewer → só os domínios explicitamente concedidos em ai_config.data_domains.
 *
 * ── SEMÂNTICA FAIL-CLOSED (deliberadamente documentada) ──────────────────────
 * Este é código de segurança: na dúvida, negar. A ÚNICA exceção — consciente e
 * temporária — é a retrocompatibilidade de `data_domains` ainda não configurado:
 *
 *   data_domains === undefined / null  → NÃO configurado → tratado como TODOS.
 *       Motivo: usuários existentes nunca tiveram esse campo; fechar por padrão
 *       quebraria o acesso deles da noite pro dia. Fail-OPEN só neste caso.
 *   data_domains === []  (array vazio) → explicitamente NENHUM domínio.
 *   data_domains === ['funil', ...]    → exatamente os listados.
 *
 * TODO(2.8): depois de migrar todos os viewers pra um data_domains explícito,
 * inverter o default de undefined pra NENHUM (fail-closed puro) e remover esta
 * exceção — a checagem passa a negar tudo que não estiver na lista.
 *
 * As funções são puras (sem I/O, sem DB) e recebem uma estrutura mínima
 * (role + ai_config.data_domains), o que as torna diretamente testáveis.
 */

import type { Role } from '@/lib/auth'

interface DataDomainDef {
  id: string
  label: string
  /** Prefixos de rota que este domínio cobre (match exato ou com borda "/"). */
  prefixes: readonly string[]
}

/**
 * CATÁLOGO CANÔNICO — hard-coded de propósito (máximo determinismo).
 * Cada rota de DASHBOARD_PATHS (lib/auth.ts) cai em EXATAMENTE um domínio.
 * Mudar aqui = mudar na UI do /admin/[id] (aba IA) e na leitura da sessão.
 */
export const DATA_DOMAINS = [
  {
    id: 'criativos',
    label: 'Criativos & Anúncios',
    prefixes: ['/criativos', '/criativos-ia', '/vsl', '/campanhas', '/calculadora'],
  },
  {
    id: 'funil',
    label: 'Funil, Páginas & Perpétuo',
    prefixes: [
      '/visao-geral',
      '/funil',
      '/perpetuo',
      '/analise-paginas',
      '/acoes-vendas',
      '/comparacao',
      '/insights-ia',
    ],
  },
  {
    id: 'financeiro',
    label: 'Financeiro',
    prefixes: ['/financeiro', '/notas-fiscais', '/raio-x'],
  },
  {
    id: 'pesquisa',
    label: 'Pesquisa & Público',
    prefixes: [
      '/qualificacao',
      '/perfil-comprador',
      '/voz-comprador',
      '/analise-estrategica',
      '/lead-scoring',
    ],
  },
  {
    id: 'organico',
    label: 'Orgânico',
    // Prefixo único: cobre todas as sub-rotas /organico/* pela borda "/".
    prefixes: ['/organico'],
  },
  {
    id: 'experimentos',
    label: 'Experimentos & Ferramentas',
    prefixes: ['/experimentos', '/quizzes', '/planejamento', '/saude-trafego', '/clarity', '/ga4'],
  },
] as const satisfies readonly DataDomainDef[]

export type DomainId = (typeof DATA_DOMAINS)[number]['id']

export const ALL_DOMAIN_IDS: DomainId[] = DATA_DOMAINS.map((d) => d.id)

const DOMAIN_ID_SET = new Set<string>(ALL_DOMAIN_IDS)

/** Type-guard: string é um DomainId conhecido do catálogo. */
export function isDomainId(x: unknown): x is DomainId {
  return typeof x === 'string' && DOMAIN_ID_SET.has(x)
}

/**
 * Índice plano prefixo→domínio, ordenado do prefixo MAIS LONGO pro mais curto.
 * Assim o match é determinístico mesmo com sobreposições (ex.: '/criativos-ia'
 * ganha de '/criativos'). Construído uma vez no load do módulo.
 */
const PREFIX_INDEX: { prefix: string; domain: DomainId }[] = DATA_DOMAINS
  .flatMap((d) => d.prefixes.map((prefix) => ({ prefix, domain: d.id as DomainId })))
  .sort((a, b) => b.prefix.length - a.prefix.length)

/**
 * Resolve o domínio de dados de uma rota. Ignora querystring.
 * Retorna null se a rota não pertence a nenhum domínio catalogado
 * (ex.: /admin) — o chamador decide o que fazer com null (normalmente: não é
 * uma rota de dados, então nada a gatear).
 */
export function domainForPath(path: string): DomainId | null {
  if (!path || typeof path !== 'string') return null
  const clean = path.split('?')[0].split('#')[0]
  for (const { prefix, domain } of PREFIX_INDEX) {
    if (clean === prefix || clean.startsWith(prefix + '/')) return domain
  }
  return null
}

/**
 * Domínio de IA da sub-aba consolidada de Análise de Criativos.
 *
 * Insights IA continuava no domínio "funil" antes da consolidação. Mantemos
 * isso na URL nova para que mover a tela não amplie o acesso a dados da IA de
 * viewers que têm apenas o domínio de criativos (ou vice-versa).
 */
export function domainForCreativeAnalysisTab(tab: string | null | undefined): DomainId {
  return tab === 'insights' ? 'funil' : 'criativos'
}

/** Estrutura mínima pra decidir acesso — SessionInfo é atribuível a isto. */
export interface DomainAccessInput {
  role: Role
  ai_config: { data_domains?: string[] | null } | null | undefined
}

/**
 * Este usuário pode acessar `domainId`?
 *  - admin                    → true (sempre).
 *  - data_domains undefined   → true (não configurado; fail-OPEN de compat, ver topo).
 *  - data_domains === []      → false (explicitamente nenhum).
 *  - senão                    → true iff a lista inclui domainId.
 */
export function canAccessDomain(subject: DomainAccessInput, domainId: DomainId): boolean {
  if (subject.role === 'admin') return true
  const dd = subject.ai_config?.data_domains
  if (dd == null) return true // não configurado → TODOS (retrocompat; ver TODO 2.8)
  return dd.includes(domainId)
}

/**
 * Lista de domínios que a sessão pode acessar (já validada contra o catálogo —
 * strings desconhecidas/obsoletas são descartadas). Ordem estável do catálogo.
 *  - admin                    → todos.
 *  - data_domains undefined   → todos (não configurado; compat).
 *  - senão                    → interseção com o catálogo.
 */
export function allowedDomains(subject: DomainAccessInput): DomainId[] {
  if (subject.role === 'admin') return [...ALL_DOMAIN_IDS]
  const dd = subject.ai_config?.data_domains
  if (dd == null) return [...ALL_DOMAIN_IDS] // não configurado → todos (compat)
  return ALL_DOMAIN_IDS.filter((id) => dd.includes(id))
}

/**
 * Sanitiza entrada bruta (ex.: FormData.getAll('data_domains')) numa lista de
 * DomainId válidos, deduplicada e na ordem do catálogo. Descarta qualquer coisa
 * fora do catálogo — a UI do admin nunca grava lixo em ai_config.data_domains.
 */
export function sanitizeDomainIds(raw: Iterable<unknown>): DomainId[] {
  const set = new Set<DomainId>()
  for (const v of raw) {
    const s = String(v).trim()
    if (isDomainId(s)) set.add(s)
  }
  return ALL_DOMAIN_IDS.filter((id) => set.has(id))
}
