// Supabase client mínimo (REST direto, sem SDK — segue padrão A/B Worker).
// Inserts usam Prefer: return=minimal (não traz body de volta). Timeouts curtos.

const TIMEOUT_MS = 2500;

function headers(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function sbInsert(env, table, payload) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(env, { Prefer: 'return=minimal' }),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`sb_insert_${r.status}:${text.slice(0, 200)}`);
  }
  return true;
}

export async function sbUpdate(env, table, filter, payload) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: headers(env, { Prefer: 'return=minimal' }),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`sb_update_${r.status}:${text.slice(0, 200)}`);
  }
  return true;
}

export async function sbSelect(env, table, query = '') {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`, {
    headers: headers(env),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`sb_select_${r.status}:${text.slice(0, 200)}`);
  }
  return r.json();
}
