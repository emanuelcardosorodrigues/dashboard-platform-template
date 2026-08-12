/**
 * Endpoint do drawer "Perguntar à IA".
 * Auth: middleware (cookie lst_session) + leitura de role aqui pro contexto.
 * Rate limit por role+IP (em memória — reset a cada deploy).
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { askAI, CanaryLeakError } from '@/lib/askAI'
import { sanitizeAIResponse, isResponseSuspicious } from '@/lib/aiSanitize'
import { SESSION_COOKIE, isPathAllowed } from '@/lib/auth'
import { domainForPath, canAccessDomain } from '@/lib/access'
import { lookupSession } from '@/lib/sessions'
import { getAiUsage, incrementAndGetAiUsage } from '@/lib/aiUsage'
import { log } from '@/lib/log'
import { audit } from '@/lib/audit'
import { parseBody, badRequest } from '@/lib/validation/schemas'
import { askBodySchema } from '@/lib/validation/schemas'
import { checkRateLimit, rateLimitHeaders } from '@/lib/rateLimit'
import { claudeAvailable } from '@/lib/aiProviders'

export const dynamic = 'force-dynamic'
export const maxDuration = 120 // Claude (bridge) pode demorar mais que Gemini

// Config do drawer: motor disponível + créditos restantes (sem consumir quota).
export async function GET() {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  const session = sessionId ? await lookupSession(sessionId) : null
  if (!session) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const usage = await getAiUsage(session.user_id)
  return NextResponse.json({
    claude_available: claudeAvailable(),
    credits: Math.max(0, session.ai_config.quota_daily - usage.count),
    quota: session.ai_config.quota_daily,
  })
}

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  const session = sessionId ? await lookupSession(sessionId) : null
  if (!session) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }
  const role = session.role
  const ai = session.ai_config

  // Toggle hard: admin pode desabilitar IA por user.
  if (ai.disabled) {
    return NextResponse.json({ error: 'IA desativada para este usuário.' }, { status: 403 })
  }

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'

  // Burst protect (independente da quota diária): 20 req/min por user, 60 req/min por IP.
  const userBurst = await checkRateLimit(`ai:user:${session.user_id}`, 20, 60)
  if (!userBurst.allowed) {
    return NextResponse.json(
      { error: 'Muitas requisições. Aguarde alguns segundos.' },
      { status: 429, headers: rateLimitHeaders(userBurst) },
    )
  }
  const ipBurst = await checkRateLimit(`ai:ip:${ip}`, 60, 60)
  if (!ipBurst.allowed) {
    return NextResponse.json(
      { error: 'Muitas requisições do seu IP. Aguarde alguns segundos.' },
      { status: 429, headers: rateLimitHeaders(ipBurst) },
    )
  }

  const parsed = await parseBody(req, askBodySchema)
  if (!parsed.ok) {
    const r = badRequest(parsed)
    return NextResponse.json(r.body, { status: r.status })
  }
  const body = parsed.data
  const question = body.question
  const requestedPath = body.pathname ?? '/'
  const searchParams = body.searchParams ?? {}
  const history = body.history ?? []

  const ua = req.headers.get('user-agent') ?? null

  // Server-authoritative: escopo da IA = allowed_paths do user.
  // Admin role bypassa (acesso total). Path forjado pra rota fora do escopo → 403.
  if (role !== 'admin' && !isPathAllowed(session.allowed_paths, requestedPath)) {
    await audit({
      action: 'ai.ask.path_denied',
      status: 'denied',
      actorRole: role,
      actorLabel: session.user_id,
      ip,
      userAgent: ua,
      resource: '/api/ai/ask',
      metadata: { user_id: session.user_id, requestedPath },
    })
    return NextResponse.json({ error: 'Rota não permitida pra este usuário' }, { status: 403 })
  }
  // Camada aditiva: escopo por DOMÍNIO de dados da IA (admin bypassa; rota sem
  // domínio de dados = null → nada a barrar).
  const dominio = domainForPath(requestedPath)
  if (role !== 'admin' && dominio && !canAccessDomain({ role, ai_config: ai }, dominio)) {
    await audit({
      action: 'ai.ask.domain_denied',
      status: 'denied',
      actorRole: role,
      actorLabel: session.user_id,
      ip,
      userAgent: ua,
      resource: '/api/ai/ask',
      metadata: { user_id: session.user_id, requestedPath, dominio },
    })
    return NextResponse.json({ error: 'Domínio de dados não permitido pra este usuário' }, { status: 403 })
  }
  const pathname = requestedPath

  // Quota diária por user — counter persistente em ai_usage_daily (reset 00:00 UTC).
  // Checa SEM incrementar; só debita depois de uma resposta válida (abaixo), pra
  // falha do modelo / resposta descartada NÃO consumir crédito do usuário.
  const usage = await getAiUsage(session.user_id)
  if (usage.count >= ai.quota_daily) {
    await audit({
      action: 'ai.ask.rate_limited',
      status: 'denied',
      actorRole: role,
      actorLabel: session.user_id,
      ip,
      userAgent: ua,
      resource: '/api/ai/ask',
      metadata: { limit: ai.quota_daily, count: usage.count },
    })
    return NextResponse.json(
      { error: `Limite diário atingido (${ai.quota_daily}). Tente novamente amanhã.` },
      { status: 429 },
    )
  }

  try {
    const result = await askAI({ question, pathname, searchParams, history, role, provider: body.provider, model: body.model })
    if (isResponseSuspicious(result.answer)) {
      log.warn('[api/ai/ask] resposta suspeita descartada', { role, pathname })
      await audit({
        action: 'ai.ask.suspicious_response',
        status: 'denied',
        actorRole: role,
        ip,
        userAgent: ua,
        resource: '/api/ai/ask',
        metadata: { pathname },
      })
      return NextResponse.json(
        { error: 'Resposta inválida do modelo. Tente reformular a pergunta.' },
        { status: 502 },
      )
    }
    const safeAnswer = sanitizeAIResponse(result.answer)
    // Cobra a quota SÓ agora — resposta válida entregue ao usuário.
    const after = await incrementAndGetAiUsage(session.user_id)
    await audit({
      action: 'ai.ask.success',
      actorRole: role,
      ip,
      userAgent: ua,
      resource: '/api/ai/ask',
      metadata: {
        pathname,
        tokens_in: result.tokens_input,
        tokens_out: result.tokens_output,
        modelo: result.modelo,
      },
    })
    return NextResponse.json({
      ok: true,
      answer: safeAnswer,
      tokens: { in: result.tokens_input, out: result.tokens_output },
      modelo: result.modelo,
      credits: Math.max(0, ai.quota_daily - after.count),
    })
  } catch (err) {
    if (err instanceof CanaryLeakError) {
      log.warn('[api/ai/ask] canary leak — discarding response', { role, pathname })
      await audit({
        action: 'ai.ask.canary_leak',
        status: 'denied',
        actorRole: role,
        ip,
        userAgent: ua,
        resource: '/api/ai/ask',
        metadata: { pathname },
      })
      return NextResponse.json(
        { error: 'Não posso responder a esta pergunta.' },
        { status: 422 },
      )
    }
    log.error('[api/ai/ask] erro inesperado', { err, role, pathname })
    await audit({
      action: 'ai.ask.error',
      status: 'error',
      actorRole: role,
      ip,
      userAgent: ua,
      resource: '/api/ai/ask',
      metadata: { pathname, message: err instanceof Error ? err.message : 'unknown' },
    })
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
