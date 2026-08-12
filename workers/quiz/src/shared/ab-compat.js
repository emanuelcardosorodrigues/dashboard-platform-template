// ============================================================================
// FROZEN: keep in sync with ~/Projects/dashboard-ab-router/src/ab.js
// ============================================================================
// Funções copiadas LITERAL do A/B Worker pra garantir uid cookie idêntico
// (cross-tool identity) e mesma lógica de identidade/bots em ambos.
//
// SE PRECISAR MUDAR ALGO AQUI: confirme se a mudança vai pro ab.js também,
// ou faça override em arquivo separado (ex: src/quiz-bots.js) sem tocar este.
//
// Origem (linha-a-linha): ab.js:21-59 (murmur), 62-77 (parseCookies+simplifyUA),
// 79-90 (resolveIdentity), 92-130 (BOT_UA + isBotUA), 132-177 (detectBot
// adaptado: AB_KV→QUIZ_KV, DB→QUIZ_DB), 189-192 (buildUidCookie).
// ============================================================================

// ── murmurhash3 32-bit (pure JS, sem dependências) ──────────────────────────
export function murmurhash3(str, seed = 0) {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  let h1 = seed >>> 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  const nblocks = len >> 2;
  for (let i = 0; i < nblocks; i++) {
    const o = i * 4;
    let k1 = (bytes[o] | bytes[o+1] << 8 | bytes[o+2] << 16 | bytes[o+3] << 24) >>> 0;
    k1 = Math.imul(k1, c1) >>> 0;
    k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0;
    k1 = Math.imul(k1, c2) >>> 0;
    h1 ^= k1;
    h1 = ((h1 << 13) | (h1 >>> 19)) >>> 0;
    h1 = (Math.imul(h1, 5) + 0xe6546b64) >>> 0;
  }

  let k1 = 0;
  const tail = len & 3;
  const s = nblocks * 4;
  if (tail >= 3) k1 ^= bytes[s + 2] << 16;
  if (tail >= 2) k1 ^= bytes[s + 1] << 8;
  if (tail >= 1) {
    k1 ^= bytes[s];
    k1 = Math.imul(k1, c1) >>> 0;
    k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0;
    k1 = Math.imul(k1, c2) >>> 0;
    h1 ^= k1;
  }

  h1 ^= len;
  h1 ^= h1 >>> 16; h1 = Math.imul(h1, 0x85ebca6b) >>> 0;
  h1 ^= h1 >>> 13; h1 = Math.imul(h1, 0xc2b2ae35) >>> 0;
  h1 ^= h1 >>> 16;
  return h1 >>> 0;
}

// ── Identity ─────────────────────────────────────────────────────────────────
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k) out[k] = part.slice(eq + 1).trim();
  }
  return out;
}

export function simplifyUA(ua) {
  const m = (ua || '').match(/(Chrome|Firefox|Safari|Edge|OPR)\/(\d+)/);
  return m ? `${m[1]}/${m[2]}` : 'Other';
}

export function resolveIdentity(request) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const existingUid = cookies['uid'] || null;
  const uid = existingUid || crypto.randomUUID();

  const ip   = request.headers.get('CF-Connecting-IP') || '';
  const ua   = request.headers.get('User-Agent') || '';
  const lang = request.headers.get('Accept-Language') || '';
  const ip_fp = String(murmurhash3(`${ip}:${simplifyUA(ua)}:${lang}`) % 1_000_000_000);

  return { uid, ip_fp, isNew: !existingUid };
}

// ── Bot detection ────────────────────────────────────────────────────────────
const BOT_UA_AB = [
  // Meta / Facebook
  'facebookexternalhit', 'facebot', 'facebookcatalog', 'meta-externalagent', 'meta-externalads',
  'facebookplatform',
  // 'fb_iab' e 'fbav' saíram: são o navegador EMBUTIDO do app do Facebook/Instagram,
  // usado por gente de verdade. O crawler da Meta é `facebookexternalhit` /
  // `meta-external*`, que seguem na lista. Público que chega por anúncio abre o link
  // dentro do app — barrar essas duas era barrar o lead no meio do funil.
  // Google
  'googlebot', 'adsbot-google', 'google-inspectiontool', 'googleweblight',
  'google-site-verification', 'mediapartners-google', 'apis-google',
  // Microsoft / Bing
  'bingbot', 'msnbot', 'bingpreview',
  // Social previews
  'twitterbot', 'xbot', 'linkedinbot', 'whatsapp', 'telegrambot', 'slackbot',
  'discordbot', 'applebot', 'iframely', 'embedly', 'pinterestbot',
  // Search engines
  'yandexbot', 'yandex', 'slurp', 'duckduckbot', 'baidu', 'sogou', 'exabot',
  // SEO crawlers
  'ia_archiver', 'semrushbot', 'ahrefsbot', 'mj12bot', 'dotbot',
  'rogerbot', 'screaming frog', 'dataforseo', 'serpstatbot', 'sistrix',
  // AI crawlers
  'gptbot', 'chatgpt-user', 'oai-searchbot', 'claudebot', 'anthropic-ai',
  'google-extended', 'bytespider', 'amazonbot', 'petalbot', 'ccbot',
  // Generic
  'bot', 'crawl', 'spider', 'archiver',
];

// ── Quiz-specific 2026 expansão (não compartilhar com A/B) ──────────────────
const BOT_UA_QUIZ_2026 = [
  'meta-externalfetcher',
  'perplexitybot',
  'applebot-extended',
  'cohere-ai',
  'youbot',
  'diffbot',
  'imagesiftbot',
  'omgilibot',
];

const BOT_UA = [...BOT_UA_AB, ...BOT_UA_QUIZ_2026];

const BOT_UA_PATTERNS = [
  // /android [0-9]+; k\)/i REMOVIDO — não é bot: é a UA REDUZIDA que todo Chrome
  // no Android manda desde 2023 (o "K" é o placeholder que substituiu a versão do
  // aparelho). Isso marcava como robô a maior fatia de celular do Brasil.
  /HeadlessChrome/i,
  /Googlebot-Image/i,
  /^Mozilla\/5\.0 \(\)$/i,
];

export function isBotUA(ua) {
  const lower = (ua || '').toLowerCase();
  return BOT_UA.some(b => lower.includes(b)) || BOT_UA_PATTERNS.some(p => p.test(ua));
}

// detectBot adaptado: AB_KV → QUIZ_KV, DB → QUIZ_DB.
// Retorna { isBot: boolean, reason: string|null } pra dashboard mostrar motivo.
export async function detectBot(request, env, ctx) {
  // Layer 1 — Cloudflare Bot Management score
  const botScore = request.cf?.botManagement?.score;
  if (typeof botScore === 'number' && botScore < 30) return { isBot: true, reason: `cf_botscore_${botScore}` };

  // Layer 2 — UA blocklist
  const uaRaw = request.headers.get('User-Agent') || '';
  const ua = uaRaw.toLowerCase();
  const matched = BOT_UA.find(b => ua.includes(b));
  if (matched) return { isBot: true, reason: `ua_blocklist:${matched}` };
  const pattern = BOT_UA_PATTERNS.find(p => p.test(uaRaw));
  if (pattern) return { isBot: true, reason: `ua_pattern:${pattern.source}` };

  // Layer 2b — Instagram in-app sem Accept-Language = Meta crawler disfarçado
  if (ua.includes('instagram') && !request.headers.get('Accept-Language')) {
    return { isBot: true, reason: 'instagram_no_lang' };
  }

  // Layer 3 — Rate limit por IP via KV (max 20 req / 10min)
  if (env.QUIZ_KV) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const window = Math.floor(Date.now() / 600_000);
    const key = `rate:${ip}:${window}`;
    try {
      const raw = await env.QUIZ_KV.get(key);
      const count = raw ? parseInt(raw, 10) : 0;
      if (count > 20) return { isBot: true, reason: 'rate_limit' };
      ctx.waitUntil(env.QUIZ_KV.put(key, String(count + 1), { expirationTtl: 600 }));
    } catch (_) {
      // KV indisponível — nunca bloqueia usuário
    }
  }

  // Layer 4 — D1 bot_fingerprints (IPs já confirmados como bot)
  //
  // ⚠️ NÃO casar por `ua = ?`. Era assim e se autoenvenenava: UA de iPhone é uma
  // string compartilhada por milhões de aparelhos reais. Bastava UM bot (ou um
  // visitante que estourou o rate limit) ser gravado com aquela UA pra que todo
  // iPhone igual virasse "bot" — e cada bloqueio gravava outra linha, realimentando.
  // Em 07/2026 a tabela tinha 321 linhas, 166 delas com motivo `d1_fingerprint`,
  // e 108 UAs de iPhone. Lógica de UA vive nas Layers 2/2b, que é o lugar dela.
  //
  // Também ignora motivos "moles" (`rate_limit` é estado passageiro de gente real,
  // `d1_fingerprint` é a própria regra) — senão o laço volta pela porta do IP.
  if (env.QUIZ_DB) {
    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (ip) {
      try {
        const row = await env.QUIZ_DB
          // Só banimento por IP vindo de motivo CERTO (a UA se identificou como
          // crawler). `utm:*` é heurística — um clique real com template de UTM
          // torto banaria o IP daquela pessoa pra sempre, em qualquer navegador.
          // A checagem de UTM continua valendo por requisição, no /start.
          .prepare(`SELECT 1 FROM bot_fingerprints
                    WHERE headers_json LIKE ?
                      AND (reason LIKE 'ua_blocklist:%' OR reason LIKE 'ua_pattern:%')
                    LIMIT 1`)
          .bind(`%"ip":"${ip}"%`)
          .first();
        if (row) return { isBot: true, reason: 'd1_fingerprint' };
      } catch (_) {}
    }
  }

  return { isBot: false, reason: null };
}

// ── UTM-based bot signature ─────────────────────────────────────────────────
// Detecta Meta crawler/preview bots que passam pela detecção por UA (usam
// Safari mobile real). Assinaturas observadas em prod 2026-05:
//   - utm_source=Facebook_Right_Column (desktop-only no Meta — em mobile = crawler)
//   - utm_medium=pago-metaads SEM utm_campaign/content/term (template do Ads
//     Manager nunca chega vazio em ad clicks reais)
// Retorna string-reason ou null. NÃO depende de KV/D1 — pura UTM lookup.
export function isUtmBot(utms) {
  if (!utms || typeof utms !== 'object') return null;
  const source = String(utms.utm_source || '').toLowerCase();
  const medium = String(utms.utm_medium || '').toLowerCase();

  if (source.includes('right_column')) return 'placement_right_column';

  const isPaidMeta = medium.includes('metaads') || (medium === 'cpc' && source.includes('facebook'));
  if (isPaidMeta && !utms.utm_campaign && !utms.utm_content && !utms.utm_term) {
    return 'paid_meta_no_template';
  }
  return null;
}

// ── Cookie compartilhado A/B ── CRÍTICO: atributos idênticos ────────────────
// Quiz Worker SÓ chama isso se cookie estiver ausente (resolveIdentity.isNew).
export function buildUidCookie(uid, env) {
  const dom = env.WP_DOMAIN ? `; Domain=.${env.WP_DOMAIN}` : '';
  return `uid=${uid}${dom}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`;
}
