// POST /q/api/start — abre sessão de quiz.
// Idempotente: se session_id já existe, retorna 200 sem reinserir.
// Bots → drop silencioso (200 com flag bot=true, mas não persiste).

import { detectBot, isUtmBot, resolveIdentity, simplifyUA } from '../shared/ab-compat.js';
import { sessionIdFor, parseUTMs } from '../lib/session.js';
import { loadQuizConfig } from '../lib/config.js';
import { persistInsert, logBotFingerprint } from '../lib/persist.js';
import { jsonResponse, errorResponse, readJson } from '../lib/http.js';

export async function handleStart(request, env, ctx) {
  let body;
  try { body = await readJson(request); }
  catch (e) { return errorResponse(String(e.message || e), 400); }

  const slug = String(body.quiz_slug || '').trim();
  if (!slug || slug.length > 80 || !/^[a-z0-9-]+$/i.test(slug)) {
    return errorResponse('invalid_quiz_slug', 400);
  }

  const config = await loadQuizConfig(env, slug);
  if (!config) return errorResponse('quiz_not_found', 404);

  const { isBot, reason } = await detectBot(request, env, ctx);
  const { uid } = resolveIdentity(request);

  if (isBot) {
    logBotFingerprint(env, ctx, request, reason || 'unknown', slug);
    return jsonResponse({ ok: true, bot: true, reason, session_id: null, config: null });
  }

  const url = new URL(request.url);
  const utms = body.utms && typeof body.utms === 'object'
    ? body.utms
    : parseUTMs(`${url.origin}${request.headers.get('Referer') ? new URL(request.headers.get('Referer')).search : ''}`);

  // UTM-based bot signature — captura Meta crawlers que passam pelo isBotUA
  // (Safari mobile real) mas vêm de placement desktop-only ou sem template completo.
  const utmReason = isUtmBot(utms);
  if (utmReason) {
    logBotFingerprint(env, ctx, request, `utm:${utmReason}`, slug);
    return jsonResponse({ ok: true, bot: true, reason: `utm:${utmReason}`, session_id: null, config: null });
  }

  const session_id = sessionIdFor(uid, slug);
  const ua = request.headers.get('User-Agent') || '';

  // Insere sessão (Supabase tem PK em session_id → upsert via on_conflict do PostgREST)
  // Como persistInsert é fire-and-forget, vamos fazer "best effort": INSERT
  // simples; se já existir (PK conflict), Supabase retorna 23505 que vai pra DLQ
  // mas não estraga o user. Pra evitar DLQ-spam, usamos upsert.
  const sessionPayload = {
    session_id,
    uid,
    quiz_slug: slug,
    utms,
    ua,
    ua_simple: simplifyUA(ua),
    ip_country: request.cf?.country || null,
  };

  // Usar PostgREST upsert: header Prefer: resolution=merge-duplicates
  ctx.waitUntil((async () => {
    try {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/quiz_sessions`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal,resolution=merge-duplicates',
        },
        body: JSON.stringify(sessionPayload),
        signal: AbortSignal.timeout(2500),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        await env.QUIZ_DB.prepare(
          'INSERT INTO dlq (table_name, payload, err, created_at) VALUES (?,?,?,?)'
        ).bind('quiz_sessions:upsert', JSON.stringify(sessionPayload),
               `sb_${r.status}:${text.slice(0, 200)}`, Date.now()).run();
      }
    } catch (e) {
      try {
        await env.QUIZ_DB.prepare(
          'INSERT INTO dlq (table_name, payload, err, created_at) VALUES (?,?,?,?)'
        ).bind('quiz_sessions:upsert', JSON.stringify(sessionPayload), String(e), Date.now()).run();
      } catch (_) {}
    }
  })());

  return jsonResponse({
    ok: true,
    bot: false,
    session_id,
    uid,
    quiz_slug: slug,
    config,
  });
}
