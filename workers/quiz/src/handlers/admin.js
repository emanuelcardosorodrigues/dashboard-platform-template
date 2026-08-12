// /q/api/admin/* — auth via header X-Admin-Password.
// GET /q/api/admin/config?slug=... → retorna config do KV
// PUT /q/api/admin/config?slug=... → grava config no KV (body = JSON)
// PUT /q/api/admin/webhook?slug=... → seta URL do webhook (body = { url })
// GET /q/api/admin/dlq → lista pendentes
// GET /q/api/admin/health → checa Supabase + D1

import { jsonResponse, errorResponse, readJson } from '../lib/http.js';
import { loadQuizConfig, saveQuizConfig } from '../lib/config.js';

function auth(request, env) {
  const pwd = request.headers.get('X-Admin-Password');
  return !!pwd && pwd === env.ADMIN_ACTION_PASSWORD;
}

export async function handleAdmin(request, env, ctx, subpath) {
  if (!auth(request, env)) return errorResponse('unauthorized', 401);

  const url = new URL(request.url);
  const slug = url.searchParams.get('slug') || '';

  if (subpath === 'config') {
    if (!/^[a-z0-9-]+$/i.test(slug)) return errorResponse('invalid_slug', 400);

    if (request.method === 'GET') {
      const config = await loadQuizConfig(env, slug);
      return jsonResponse({ slug, config });
    }
    if (request.method === 'PUT') {
      let body;
      try { body = await readJson(request, 200_000); }
      catch (e) { return errorResponse(String(e.message || e), 400); }
      await saveQuizConfig(env, slug, body);
      return jsonResponse({ ok: true, slug });
    }
    return errorResponse('method_not_allowed', 405);
  }

  if (subpath === 'webhook') {
    if (!/^[a-z0-9-]+$/i.test(slug)) return errorResponse('invalid_slug', 400);
    if (request.method !== 'PUT') return errorResponse('method_not_allowed', 405);
    let body;
    try { body = await readJson(request); }
    catch (e) { return errorResponse(String(e.message || e), 400); }
    const u = String(body.url || '').trim();
    if (!u || !/^https?:\/\//i.test(u)) return errorResponse('invalid_url', 400);
    await env.QUIZ_KV.put(`quiz:${slug}:webhook`, u);
    return jsonResponse({ ok: true, slug, url: u });
  }

  if (subpath === 'dlq') {
    if (request.method !== 'GET') return errorResponse('method_not_allowed', 405);
    const rows = await env.QUIZ_DB.prepare(
      'SELECT id, table_name, err, retry_count, permanent_failure, created_at, last_attempt_at FROM dlq ORDER BY created_at DESC LIMIT 100'
    ).all();
    return jsonResponse({ rows: rows.results || [] });
  }

  if (subpath === 'health') {
    const checks = { worker: 'ok', supabase: null, d1: null, kv: null };
    try {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/quiz_quizzes?select=slug&limit=1`, {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        signal: AbortSignal.timeout(3000),
      });
      checks.supabase = r.ok ? 'ok' : `http_${r.status}`;
    } catch (e) {
      checks.supabase = `err:${String(e).slice(0, 100)}`;
    }
    try {
      const row = await env.QUIZ_DB.prepare('SELECT 1 AS ok').first();
      checks.d1 = row?.ok === 1 ? 'ok' : 'unexpected';
    } catch (e) {
      checks.d1 = `err:${String(e).slice(0, 100)}`;
    }
    try {
      await env.QUIZ_KV.get('__health__');
      checks.kv = 'ok';
    } catch (e) {
      checks.kv = `err:${String(e).slice(0, 100)}`;
    }
    return jsonResponse(checks);
  }

  return errorResponse('not_found', 404);
}
