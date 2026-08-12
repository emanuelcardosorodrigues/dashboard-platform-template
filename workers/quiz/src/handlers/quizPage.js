// GET /q/{slug} — serve SPA HTML com __QUIZ_CONFIG__ injetado via HTMLRewriter.
// Bots não bloqueados aqui (servir HTML não polui métricas — só /api/* gravam).
//
// Edge cache: o body rewritten é cacheado por 60s (mesmo TTL do KV) keyed por slug.
// Cookie uid + Set-Cookie ficam FORA do body cacheado pra não vazar identidade entre usuários.

import { resolveIdentity, buildUidCookie } from '../shared/ab-compat.js';
import { loadQuizConfig } from '../lib/config.js';

const EDGE_CACHE_TTL = 60; // segundos — alinhado com KV_TTL_SECONDS em lib/config.js

export async function handleQuizPage(request, env, ctx, slug) {
  // Resolve identity (uid cookie) — set se ausente, idêntico ao A/B
  const { uid, isNew } = resolveIdentity(request);

  const cache = caches.default;
  const cacheKey = new Request(`https://dashboard-quiz.internal/cache/v2/quiz-page/${slug}`, {
    method: 'GET',
  });

  // Tenta hit no edge cache.
  // Materializa em arrayBuffer pra evitar mismatches de content-length/encoding
  // entre o body cacheado e os headers que mutamos. CF re-comprime baseado em Accept-Encoding.
  let cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.arrayBuffer();
    const headers = new Headers();
    headers.set('Content-Type', cached.headers.get('Content-Type') || 'text/html; charset=utf-8');
    headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
    headers.set('X-Cache', 'HIT');
    headers.set('X-Quiz-Slug', slug);
    const xqf = cached.headers.get('X-Quiz-Found');
    if (xqf) headers.set('X-Quiz-Found', xqf);
    if (isNew) headers.append('Set-Cookie', buildUidCookie(uid, env));
    return new Response(body, {
      status: cached.status,
      headers,
    });
  }

  // Miss — monta resposta do zero
  const config = await loadQuizConfig(env, slug);

  // Busca asset SPA — fetching /q/ retorna public/q/index.html (CF Assets redirect normalization).
  // Pedir /q/ direto evita o 307 /q/index.html → /q/.
  // Forks servidos de public/_forks/{slug}.html (HTML self-contido; resto usa a SPA /q/).
  // Set explícito de propósito: com not_found_handling=SPA, um /_forks/{slug} inexistente
  // retornaria 200 (fallback), não 404 — então "tentar e cair pra /q/" serviria o errado.
  const FORK_SLUGS = new Set(['col-q02', 'lps-pda-ficha-de-interesse']);
  const assetPath = FORK_SLUGS.has(slug) ? `/_forks/${slug}` : '/q/';
  const assetReq = new Request(new URL(assetPath, request.url), request);
  const assetRes = await env.ASSETS.fetch(assetReq);

  // Injeção de __QUIZ_CONFIG__ via HTMLRewriter (no head, antes de qualquer script do GTM).
  // Removi uid e serverTs daqui pq o engine não consome esses campos — manter no body
  // quebraria o edge cache (body precisa ser idêntico entre usuários).
  const injectionScript = `<script>window.__QUIZ_CONFIG__=${JSON.stringify({
    slug,
    config: config || null,
    found: !!config,
  }).replace(/</g, '\\u003c')}</script>`;

  const rewritten = new HTMLRewriter()
    .on('head', {
      element(el) { el.prepend(injectionScript, { html: true }); },
    })
    .transform(assetRes);

  // Buffer pra (1) cachear, (2) servir agora. HTMLRewriter streama, então arrayBuffer força conclusão.
  const buffered = await rewritten.arrayBuffer();
  const baseHeaders = new Headers(rewritten.headers);
  baseHeaders.set('X-Quiz-Slug', slug);
  baseHeaders.set('X-Quiz-Found', config ? '1' : '0');

  // Versão cacheada: Cache-Control alto pra CF respeitar TTL do edge cache.
  const cacheableHeaders = new Headers(baseHeaders);
  cacheableHeaders.set('Cache-Control', `public, max-age=${EDGE_CACHE_TTL}`);
  const cacheableResponse = new Response(buffered, {
    status: rewritten.status,
    headers: cacheableHeaders,
  });
  ctx.waitUntil(cache.put(cacheKey, cacheableResponse));

  // Versão pro usuário: BFCache-friendly, sem cache compartilhado, cookie por request.
  const userHeaders = new Headers(baseHeaders);
  userHeaders.set('Cache-Control', 'private, max-age=0, must-revalidate');
  userHeaders.set('X-Cache', 'MISS');
  if (isNew) userHeaders.append('Set-Cookie', buildUidCookie(uid, env));

  return new Response(buffered, {
    status: rewritten.status,
    headers: userHeaders,
  });
}
