import { murmurhash3 } from '../shared/ab-compat.js';

// session_id determinístico = hash(uid : slug : dia_UTC).
// Mesma combinação no mesmo dia → mesmo session_id (sobrevive reload).
// Reseta meia-noite UTC.
export function sessionIdFor(uid, quizSlug, date = new Date()) {
  const day = date.toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const raw = murmurhash3(`${uid}:${quizSlug}:${day}`);
  return `qs_${day.replace(/-/g, '')}_${raw.toString(36)}`;
}

export function parseUTMs(url) {
  const u = url instanceof URL ? url : new URL(url);
  const out = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'sck']) {
    const v = u.searchParams.get(k);
    if (v) out[k] = v.slice(0, 500); // hard cap
  }
  return out;
}
