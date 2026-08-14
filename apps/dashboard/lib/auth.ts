// __Host- prefix exige Secure + Path=/ + sem Domain — só em prod (HTTPS).
// Em dev (HTTP) o prefix é rejeitado pelo browser.
export const SESSION_COOKIE = process.env.NODE_ENV === 'production'
  ? '__Host-lst_session'
  : 'lst_session'

// Projeto (workspace) ativo escolhido no switcher. Cookie de PREFERÊNCIA — a
// autoridade é server-side: getActiveWorkspaceId valida o valor contra a
// membership do usuário (forjar = ignorado, cai no default). Por isso não precisa
// de __Host/assinatura: um valor inválido nunca concede acesso a outro projeto.
export const ACTIVE_WS_COOKIE = 'active_ws'

export type Role = 'admin' | 'viewer'

/** Sub-abas da rota consolidada /criativos-ia. */
export const CREATIVE_ANALYSIS_TABS = ['cards', 'historico', 'criativos', 'insights'] as const
export type CreativeAnalysisTab = (typeof CREATIVE_ANALYSIS_TABS)[number]

/** Entrada não reconhecida mantém a aba atual, Cards. */
export function normalizeCreativeAnalysisTab(value: string | null | undefined): CreativeAnalysisTab {
  return CREATIVE_ANALYSIS_TABS.includes(value as CreativeAnalysisTab)
    ? value as CreativeAnalysisTab
    : 'cards'
}

/**
 * Catálogo canônico das abas do dashboard.
 * Fonte da verdade pro admin escolher allowed_paths.
 * Mudar aqui = mudar nas sidebars + na UI do /admin/[id] (tab IA).
 */
export const DASHBOARD_PATHS = [
  '/visao-geral',
  '/calculadora',
  // Grants legados preservados: cada um abre apenas sua sub-aba em
  // /criativos-ia (ver isCreativeAnalysisTabAllowed). Não removê-los sem uma
  // migração explícita de users.allowed_paths.
  '/criativos',
  '/criativos-ia',
  '/campanhas',
  '/qualificacao',
  '/funil',
  '/perpetuo',
  '/analise-paginas',
  '/acoes-vendas',
  '/planejamento',
  '/financeiro',
  '/comparacao',
  '/perfil-comprador',
  '/voz-comprador',
  '/lead-scoring',
  '/analise-estrategica',
  '/experimentos',
  '/quizzes',
  '/saude-trafego',
  '/clarity',
  '/notas-fiscais',
  '/insights-ia',
  '/vsl',
  '/ga4',
  '/raio-x',
  '/organico/visao-geral',
  '/organico/conteudo',
  '/organico/youtube',
  '/organico/instagram',
  '/organico/tiktok',
  '/organico/inteligencia-de-conteudo',
  '/organico/insights',
  '/organico/comentarios',
  '/organico/transcricoes',
  '/organico/extrair-comentarios',
] as const

/**
 * Verifica se um path está no allowlist do user.
 * - allowedPaths é a coluna `users.allowed_paths`.
 * - Admin role bypassa esse check (ver middleware) — pra admin a função não é chamada.
 * - Match exato ou prefixo (ex: '/visao-geral' libera '/visao-geral/foo' também).
 */
export function isPathAllowed(allowedPaths: readonly string[], pathname: string): boolean {
  return allowedPaths.some(p => pathname === p || pathname.startsWith(p + '/'))
}

/**
 * Compatibilidade de permissão durante a consolidação de Criativos.
 *
 * As permissões existentes NÃO são migradas implicitamente: /criativos e
 * /insights-ia só dão acesso às respectivas sub-abas no endereço novo;
 * /criativos-ia continua sendo a permissão de Cards e Histórico. Assim o
 * redirect legado passa duas vezes pelo proxy sem virar um bypass de escopo.
 */
export function isCreativeAnalysisTabAllowed(
  allowedPaths: readonly string[],
  tab: string | null | undefined,
): boolean {
  switch (normalizeCreativeAnalysisTab(tab)) {
    case 'criativos':
      return isPathAllowed(allowedPaths, '/criativos')
    case 'insights':
      return isPathAllowed(allowedPaths, '/insights-ia')
    case 'cards':
    case 'historico':
      return isPathAllowed(allowedPaths, '/criativos-ia')
  }
}

/** Há pelo menos uma sub-aba de Análise de Criativos que o viewer pode abrir. */
export function canAccessCreativeAnalysis(allowedPaths: readonly string[]): boolean {
  return CREATIVE_ANALYSIS_TABS.some(tab => isCreativeAnalysisTabAllowed(allowedPaths, tab))
}

/** Primeiro destino seguro do item único de navegação para um viewer. */
export function creativeAnalysisHrefForAllowedPaths(allowedPaths: readonly string[]): string {
  if (isCreativeAnalysisTabAllowed(allowedPaths, 'cards')) return '/criativos-ia'
  if (isCreativeAnalysisTabAllowed(allowedPaths, 'criativos')) return '/criativos-ia?tab=criativos'
  if (isCreativeAnalysisTabAllowed(allowedPaths, 'insights')) return '/criativos-ia?tab=insights'
  return '/criativos-ia'
}
