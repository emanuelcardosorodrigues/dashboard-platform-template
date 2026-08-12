// Persistence layer com DLQ fallback.
// Padrão: tenta Supabase via ctx.waitUntil; em qualquer falha (5xx, timeout, network),
// grava no D1 dlq pra cron drenar depois.

import { sbInsert, sbUpdate } from './supabase.js';

export function persistInsert(env, ctx, table, payload) {
  ctx.waitUntil((async () => {
    try {
      await sbInsert(env, table, payload);
    } catch (e) {
      await pushDLQ(env, table, 'insert', payload, String(e));
    }
  })());
}

export function persistUpdate(env, ctx, table, filter, payload) {
  ctx.waitUntil((async () => {
    try {
      await sbUpdate(env, table, filter, payload);
    } catch (e) {
      await pushDLQ(env, table, 'update', { filter, payload }, String(e));
    }
  })());
}

async function pushDLQ(env, table, op, payload, err) {
  try {
    await env.QUIZ_DB.prepare(
      'INSERT INTO dlq (table_name, payload, err, created_at) VALUES (?, ?, ?, ?)'
    ).bind(`${table}:${op}`, JSON.stringify(payload), err, Date.now()).run();
  } catch (dlqErr) {
    // Última camada: log e segue. Worker NUNCA falha por isso.
    console.error('[dlq_failed]', table, op, err, '->', String(dlqErr));
  }
}

// Motivos que NÃO viram fingerprint. `d1_fingerprint` é a própria regra se
// reconfirmando (era 166 das 321 linhas) e `rate_limit` é gente real que clicou
// rápido demais, não assinatura de bot. Gravar os dois transformava a tabela num
// laço que só crescia e ia banindo visitante legítimo.
const MOTIVOS_MOLES = new Set(['d1_fingerprint', 'rate_limit', 'unknown']);

export async function logBotFingerprint(env, ctx, request, reason, quizSlug) {
  if (MOTIVOS_MOLES.has(reason)) return;
  const ua = request.headers.get('User-Agent') || '';
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const country = request.cf?.country || '';
  const headersJson = JSON.stringify({
    ip,
    al: request.headers.get('Accept-Language') || '',
    ac: request.headers.get('Accept') || '',
    sf: request.headers.get('Sec-Fetch-Mode') || '',
  });
  ctx.waitUntil((async () => {
    try {
      await env.QUIZ_DB.prepare(
        'INSERT INTO bot_fingerprints (ua, headers_json, ip_country, reason, quiz_slug, created_at) VALUES (?,?,?,?,?,?)'
      ).bind(ua, headersJson, country, reason, quizSlug || null, Date.now()).run();
    } catch (_) {}
  })());
}
