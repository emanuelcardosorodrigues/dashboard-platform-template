import { NextRequest, NextResponse } from 'next/server'
import {
  SESSION_COOKIE,
  isCreativeAnalysisTabAllowed,
  isPathAllowed,
  normalizeCreativeAnalysisTab,
} from '@/lib/auth'
import {
  lookupSession,
  touchSession,
  SESSION_RENEW_THRESHOLD_MS,
  SESSION_TTL_MS,
  type SessionInfo,
} from '@/lib/sessions'
import { applyDefaultFilters } from '@/lib/defaultFilters'

const PUBLIC = ['/api/webhook/', '/api/cron/', '/api/checkout-hit']
const VIEWER_ALLOWED_API_PREFIXES: string[] = ['/api/ai/ask']

/** Compara em tempo (quase) constante — o Edge runtime não tem
 *  crypto.timingSafeEqual do node. Evita side-channel de timing no segredo. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // '/login' exato ou '/login/*' (evita liberar hipotético '/loginXYZ').
  if (pathname === '/login' || pathname.startsWith('/login/')) return NextResponse.next()
  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next()

  // Server-to-server bypass: Bearer CRON_SECRET libera /api/ (exceto /api/admin,
  // que SEMPRE exige sessão admin — o secret não é chave-mestra do admin). Cada
  // rota ainda revalida o token. Comparação constant-time.
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/admin')) {
    const auth = req.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    if (auth && cronSecret && safeEqual(auth, `Bearer ${cronSecret}`)) {
      return NextResponse.next()
    }
  }

  const sessionId = req.cookies.get(SESSION_COOKIE)?.value
  if (!sessionId) return redirectToLogin(req)

  let session: SessionInfo | null = null
  try {
    session = await lookupSession(sessionId)
  } catch {
    session = null
  }
  if (!session) return redirectToLogin(req)

  // Onboarding gate: status pending_onboarding só pode acessar /onboarding.
  // Qualquer outra rota redireciona pra lá. Quando completa, status vira active
  // e o cache da session é invalidado pela action.
  if (session.status === 'pending_onboarding') {
    if (pathname.startsWith('/onboarding')) {
      return maybeRenew(NextResponse.next(), session)
    }
    if (pathname.startsWith('/api/')) {
      return new NextResponse('Forbidden', { status: 403 })
    }
    const url = req.nextUrl.clone()
    url.pathname = '/onboarding'
    return NextResponse.redirect(url)
  }

  // Usuário já completou onboarding tentando voltar pra /onboarding — manda pra home.
  if (pathname.startsWith('/onboarding')) {
    const url = req.nextUrl.clone()
    url.pathname = '/visao-geral'
    return NextResponse.redirect(url)
  }

  // Bloqueio de /admin/* — só admin acessa.
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    if (session.role !== 'admin') {
      if (pathname.startsWith('/api/')) {
        return new NextResponse('Forbidden', { status: 403 })
      }
      const url = req.nextUrl.clone()
      url.pathname = '/visao-geral'
      return NextResponse.redirect(url)
    }
    return maybeRenew(NextResponse.next(), session)
  }

  // Admin role: acesso total ao dashboard, ignora allowed_paths.
  if (session.role === 'admin') {
    return maybeRenew(NextResponse.next(), session)
  }

  // Viewer: allowed_paths governa.
  if (pathname === '/' || pathname === '') {
    return redirectToDefaultDestination(req, session)
  }

  if (pathname.startsWith('/api/')) {
    // Histórico aceita payload de IDs potencialmente grande; é POST para não
    // vazar o recorte completo pela URL/logs. A exceção é exata (não libera
    // subrotas) e replica a permissão da sub-aba no handler como defesa extra.
    const allowed = pathname === '/api/criativos/historico'
      ? req.method === 'POST' && isCreativeAnalysisTabAllowed(session.allowed_paths, 'historico')
      : VIEWER_ALLOWED_API_PREFIXES.some(p => pathname.startsWith(p))
    if (!allowed) return new NextResponse('Forbidden', { status: 403 })
    return maybeRenew(NextResponse.next(), session)
  }

  // A rota consolidada precisa preservar os grants legados por sub-aba. Não
  // basta liberar /criativos-ia inteiro: quem tinha apenas /insights-ia, por
  // exemplo, pode abrir somente ?tab=insights. O redirect das rotas legadas
  // passa por esta checagem numa segunda requisição, sem bypass do proxy.
  const isCreativeAnalysis = pathname === '/criativos-ia'
  const allowed = isCreativeAnalysis
    ? isCreativeAnalysisTabAllowed(session.allowed_paths, normalizeCreativeAnalysisTab(req.nextUrl.searchParams.get('tab')))
    : isPathAllowed(session.allowed_paths, pathname)

  if (!allowed) {
    return redirectToDefaultDestination(req, session)
  }

  return maybeRenew(NextResponse.next(), session)
}

function maybeRenew(res: NextResponse, session: SessionInfo): NextResponse {
  const remaining = session.expires_at - Date.now()
  if (remaining > SESSION_RENEW_THRESHOLD_MS) return res
  void touchSession(session.session_id)
  res.cookies.set(SESSION_COOKIE, session.session_id, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS / 1000,
    path: '/',
  })
  return res
}

function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('from', req.nextUrl.pathname)
  return NextResponse.redirect(url)
}

/**
 * Manda viewer pra primeira aba permitida. Se a allowlist tiver /visao-geral, vai
 * pra ela; senão pega o primeiro path do array; se vazio, manda pra /login com
 * erro (configuração incompleta).
 */
function redirectToDefaultDestination(req: NextRequest, session: SessionInfo) {
  const url = req.nextUrl.clone()
  const allowed = session.allowed_paths
  if (allowed.length === 0) {
    url.pathname = '/login'
    url.searchParams.set('error', 'no_access')
    return NextResponse.redirect(url)
  }
  const target = allowed.includes('/visao-geral') ? '/visao-geral' : allowed[0]
  url.pathname = target
  // Aplica filtros default se existirem (apenas no primeiro redirect — não pisa
  // em query params que o user já tenha).
  applyDefaultFiltersIfMissing(url, session)
  return NextResponse.redirect(url)
}

function applyDefaultFiltersIfMissing(url: URL, session: SessionInfo) {
  applyDefaultFilters(url, session.default_filters)
}

export const config = {
  // Exclui os assets PÚBLICOS da PWA (manifest/SW/ícones): o browser os busca SEM
  // credenciais — se o proxy os redirecionasse pro login, a PWA não instalava.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|manifest.webmanifest|sw.js|icons/).*)'],
}
