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

/**
 * Catálogo canônico das abas do dashboard.
 * Fonte da verdade pro admin escolher allowed_paths.
 * Mudar aqui = mudar nas sidebars + na UI do /admin/[id] (tab IA).
 */
export const DASHBOARD_PATHS = [
  '/visao-geral',
  '/calculadora',
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
