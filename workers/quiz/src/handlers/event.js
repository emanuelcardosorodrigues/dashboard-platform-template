// POST /q/api/event — grava evento granular.
// Aceita: step_view, step_answer, step_back, checkout_click, dropout, complete.
// Bots → drop silencioso.
// Body: { session_id, quiz_slug, event_type, step_index?, step_id?, answer?, attempt_id?, metadata? }

import { detectBot, resolveIdentity } from '../shared/ab-compat.js';
import { persistInsert, persistUpdate, logBotFingerprint } from '../lib/persist.js';
import { jsonResponse, errorResponse, readJson } from '../lib/http.js';

const VALID_TYPES = new Set(['step_view', 'step_answer', 'step_back', 'checkout_click', 'dropout', 'complete']);

export async function handleEvent(request, env, ctx) {
  let body;
  try { body = await readJson(request); }
  catch (e) { return errorResponse(String(e.message || e), 400); }

  const session_id = String(body.session_id || '').trim();
  const quiz_slug = String(body.quiz_slug || '').trim();
  const event_type = String(body.event_type || '').trim();

  if (!session_id || !quiz_slug || !event_type) {
    return errorResponse('missing_required_fields', 400);
  }
  if (!VALID_TYPES.has(event_type)) {
    return errorResponse('invalid_event_type', 400);
  }
  if (!/^[a-z0-9-]+$/i.test(quiz_slug)) {
    return errorResponse('invalid_quiz_slug', 400);
  }

  const { isBot, reason } = await detectBot(request, env, ctx);
  if (isBot) {
    logBotFingerprint(env, ctx, request, reason || 'unknown', quiz_slug);
    return jsonResponse({ ok: true, bot: true, reason });
  }

  const eventPayload = {
    session_id,
    quiz_slug,
    attempt_id: body.attempt_id ? String(body.attempt_id).slice(0, 64) : null,
    event_type,
    step_index: Number.isInteger(body.step_index) ? body.step_index : null,
    step_id: body.step_id ? String(body.step_id).slice(0, 80) : null,
    answer: body.answer ?? null,
    metadata: body.metadata ?? null,
  };

  persistInsert(env, ctx, 'quiz_events', eventPayload);

  // Side-effect: marcar completed_at na sessão quando complete
  if (event_type === 'complete') {
    persistUpdate(env, ctx, 'quiz_sessions', `session_id=eq.${encodeURIComponent(session_id)}`,
      { completed_at: new Date().toISOString() });
  }

  return jsonResponse({ ok: true });
}
