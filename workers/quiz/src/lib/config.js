// KV-backed config loader com cache short-TTL via cf cache (60s).
// Chave: quiz:{slug} → JSON do quiz.

const KV_TTL_SECONDS = 60;

export async function loadQuizConfig(env, slug) {
  const key = `quiz:${slug}`;
  const raw = await env.QUIZ_KV.get(key, { cacheTtl: KV_TTL_SECONDS });
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveQuizConfig(env, slug, config) {
  const key = `quiz:${slug}`;
  await env.QUIZ_KV.put(key, JSON.stringify(config));
}

export async function loadWebhookUrl(env, slug) {
  const raw = await env.QUIZ_KV.get(`quiz:${slug}:webhook`, { cacheTtl: KV_TTL_SECONDS });
  return raw || null;
}
