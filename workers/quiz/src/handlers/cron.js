// Cron (*/5 * * * *) — drena DLQ.
// Estratégia:
//   1. Pega até 200 rows pendentes (permanent_failure=0)
//   2. Pra cada row: re-tenta operação (insert/update/webhook) baseado em table_name
//   3. Se sucesso → DELETE
//   4. Se erro → UPDATE retry_count + last_attempt_at
//   5. Se retry_count >= 3 → permanent_failure=1 + alerta (futuro)

import { sbInsert, sbUpdate } from '../lib/supabase.js';

const BATCH = 200;
const MAX_RETRIES = 3;

export async function drainDLQ(env, ctx) {
  const t0 = Date.now();
  let processed = 0, succeeded = 0, failed = 0, retired = 0;

  const batch = await env.QUIZ_DB.prepare(
    `SELECT id, table_name, payload, retry_count
     FROM dlq
     WHERE permanent_failure = 0
     ORDER BY created_at ASC
     LIMIT ?`
  ).bind(BATCH).all();

  const rows = batch.results || [];

  for (const row of rows) {
    processed++;
    const result = await retryRow(env, row);
    if (result.ok) {
      await env.QUIZ_DB.prepare('DELETE FROM dlq WHERE id = ?').bind(row.id).run();
      succeeded++;
    } else {
      const newRetry = (row.retry_count || 0) + 1;
      const isPermanent = newRetry >= MAX_RETRIES;
      await env.QUIZ_DB.prepare(
        `UPDATE dlq SET retry_count = ?, last_attempt_at = ?, permanent_failure = ?, err = ?
         WHERE id = ?`
      ).bind(newRetry, Date.now(), isPermanent ? 1 : 0,
             result.err.slice(0, 500), row.id).run();
      if (isPermanent) retired++;
      else failed++;
    }
  }

  const ms = Date.now() - t0;
  console.log(`[dlq_drain] processed=${processed} ok=${succeeded} fail=${failed} retired=${retired} ms=${ms}`);

  // Alerta se retired > 0
  if (retired > 0 && env.ALERT_WEBHOOK_URL) {
    ctx.waitUntil(fetch(env.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'dashboard-quiz',
        event: 'dlq_permanent_failure',
        retired_count: retired,
        ts: new Date().toISOString(),
      }),
    }).catch(() => {}));
  }

  return { processed, succeeded, failed, retired, ms };
}

async function retryRow(env, row) {
  let payload;
  try { payload = JSON.parse(row.payload); }
  catch (e) { return { ok: false, err: 'json_parse_failed' }; }

  // Format: "table:operation" ou "webhook:slug"
  const [tablePart, op] = String(row.table_name).split(':');

  try {
    if (tablePart === 'webhook') {
      // `webhook:crm` guarda o payload SEM url (o token do CRM não pode ficar no
      // D1) — a URL é remontada do env aqui. Os demais trazem `payload.url`.
      let alvo = payload.url;
      if (op === 'crm') {
        if (!env.CRM_WEBHOOK_URL || !env.CRM_WEBHOOK_TOKEN) return { ok: false, err: 'crm_nao_configurado' };
        alvo = `${env.CRM_WEBHOOK_URL}?token=${encodeURIComponent(env.CRM_WEBHOOK_TOKEN)}`;
      }
      const r = await fetch(alvo, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'dashboard-quiz-retry',
          ...payload,
          ts: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return { ok: false, err: `webhook_${r.status}` };
      return { ok: true };
    }

    if (op === 'upsert' && tablePart === 'quiz_sessions') {
      // re-run upsert via merge-duplicates
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/quiz_sessions`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal,resolution=merge-duplicates',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(2500),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        return { ok: false, err: `sb_${r.status}:${text.slice(0, 100)}` };
      }
      return { ok: true };
    }

    if (op === 'update') {
      // payload = { filter, payload }
      await sbUpdate(env, tablePart, payload.filter, payload.payload);
      return { ok: true };
    }

    if (op === 'insert' || !op) {
      await sbInsert(env, tablePart, payload);
      return { ok: true };
    }

    return { ok: false, err: `unknown_op:${tablePart}:${op}` };
  } catch (e) {
    return { ok: false, err: String(e).slice(0, 300) };
  }
}
