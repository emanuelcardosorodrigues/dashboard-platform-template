// POST /q/api/lead — captura final.
// Body: { session_id, quiz_slug, lead: { name?, email?, whatsapp?, ... } }
// 1. Valida + filtra bot
// 2. Faz UPDATE em quiz_sessions.lead_data
// 3. Dispara webhook (se configurado em KV quiz:{slug}:webhook) via ctx.waitUntil

import { detectBot } from '../shared/ab-compat.js';
import { persistUpdate, logBotFingerprint } from '../lib/persist.js';
import { loadWebhookUrl } from '../lib/config.js';
import { jsonResponse, errorResponse, readJson } from '../lib/http.js';

function sanitizeLead(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  // Campos de qualificação da ficha de interesse do Águia. Sem estar aqui, o
  // sanitize descarta em silêncio e o formulário coleta sem gravar nada.
  const allowed = ['name', 'email', 'whatsapp', 'phone', 'company', 'cargo', 'extra',
                   'cadeiras', 'faturamento', 'parceiro', 'investimento', 'desafio'];
  for (const k of allowed) {
    if (raw[k] != null) out[k] = String(raw[k]).slice(0, 500);
  }
  return Object.keys(out).length ? out : null;
}

export async function handleLead(request, env, ctx) {
  let body;
  try { body = await readJson(request); }
  catch (e) { return errorResponse(String(e.message || e), 400); }

  const session_id = String(body.session_id || '').trim();
  const quiz_slug = String(body.quiz_slug || '').trim();
  if (!session_id || !quiz_slug) return errorResponse('missing_required_fields', 400);
  if (!/^[a-z0-9-]+$/i.test(quiz_slug)) return errorResponse('invalid_quiz_slug', 400);

  const lead = sanitizeLead(body.lead);
  if (!lead) return errorResponse('invalid_lead_payload', 400);

  const { isBot, reason } = await detectBot(request, env, ctx);
  if (isBot) {
    logBotFingerprint(env, ctx, request, reason || 'unknown', quiz_slug);
    return jsonResponse({ ok: true, bot: true, reason });
  }

  // Persist lead_data
  persistUpdate(env, ctx, 'quiz_sessions',
    `session_id=eq.${encodeURIComponent(session_id)}`,
    { lead_data: lead, completed_at: new Date().toISOString() });

  // Webhook dispatch (best-effort)
  ctx.waitUntil((async () => {
    const webhookUrl = await loadWebhookUrl(env, quiz_slug);
    if (!webhookUrl) return;
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'dashboard-quiz',
          quiz_slug,
          session_id,
          lead,
          ts: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      // webhook failure → DLQ pra retry
      try {
        await env.QUIZ_DB.prepare(
          'INSERT INTO dlq (table_name, payload, err, created_at) VALUES (?,?,?,?)'
        ).bind('webhook:' + quiz_slug, JSON.stringify({ url: webhookUrl, session_id, lead }),
               String(e), Date.now()).run();
      } catch (_) {}
    }
  })());

  return jsonResponse({ ok: true });
}
