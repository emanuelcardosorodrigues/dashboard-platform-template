// ── Experiment config (Phase 1 — hardcoded; Phase 2 reads from KV/Supabase) ──
//
// variants[].url aceita qualquer destino: WordPress, Cloudflare Pages, outro domínio.
// Para iniciar um novo teste, adicione uma entrada aqui (Phase 1)
// ou crie pelo dashboard (Phase 2+).
// Fase 1 — experimentos hardcoded como fallback quando KV/Supabase não têm config.
// Fase 2+: criar experimentos pelo dashboard; o Worker lê do KV automaticamente.
// Para adicionar um teste aqui: inserir no Supabase pelo dashboard e copiar o UUID gerado.
// Substitua SEU_DOMINIO.COM.BR pelo domínio real das variantes.
export const EXPERIMENTS = {
  '/exemplo': {
    id: 'INSERIR-UUID-DO-SUPABASE-AQUI',
    name: 'Exemplo — slug',
    variants: [
      { name: 'A', slug: 'slug-v01', url: 'https://SEU_DOMINIO.COM.BR/slug-v01/', weight: 0.5 },
      { name: 'B', slug: 'slug-v02', url: 'https://SEU_DOMINIO.COM.BR/slug-v02/', weight: 0.5 },
    ],
  },
};

// ── murmurhash3 32-bit (pure JS, sem dependências) ────────────────────────────
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

// ── Identity ──────────────────────────────────────────────────────────────────
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

function simplifyUA(ua) {
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

// ── Bot detection ─────────────────────────────────────────────────────────────
const BOT_UA = [
  // Meta / Facebook
  'facebookexternalhit', 'facebot', 'facebookcatalog', 'meta-externalagent', 'meta-externalads',
  'facebookplatform', 'fb_iab', 'fbav',
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
  // AI crawlers (OpenAI, Anthropic, Google AI, TikTok, Amazon)
  'gptbot', 'chatgpt-user', 'oai-searchbot', 'claudebot', 'anthropic-ai',
  'google-extended', 'bytespider', 'amazonbot', 'petalbot', 'ccbot',
  // Generic
  'bot', 'crawl', 'spider', 'archiver',
];

// Padrões estruturais de UAs de crawlers disfarçados — não são substrings simples.
// Confirmados via honeypot /probe: nenhum humano real usa esses padrões.
const BOT_UA_PATTERNS = [
  /android [0-9]+; k\)/i,        // Meta stealth: device model "K" genérico (ex: "Android 10; K)")
  /HeadlessChrome/i,              // Chromium headless sem disfarce
  /Googlebot-Image/i,             // Google image bot
  /^Mozilla\/5\.0 \(\)$/i,       // UA completamente vazio/mínimo — headless comum
];

// Verificação síncrona de UA — usada para bloquear antes de qualquer query ao DB.
export function isBotUA(ua) {
  const lower = (ua || '').toLowerCase();
  return BOT_UA.some(b => lower.includes(b)) || BOT_UA_PATTERNS.some(p => p.test(ua));
}

export async function detectBot(request, env, ctx) {
  // Layer 1 — Cloudflare Bot Management score (disponível no plano Pro+)
  const botScore = request.cf?.botManagement?.score;
  if (typeof botScore === 'number' && botScore < 30) return true;

  // Layer 2 — UA blocklist (strings + padrões estruturais)
  const uaRaw = request.headers.get('User-Agent') || '';
  const ua = uaRaw.toLowerCase();
  if (BOT_UA.some(b => ua.includes(b))) return true;
  if (BOT_UA_PATTERNS.some(p => p.test(uaRaw))) return true;

  // Layer 2b — Instagram app sem Accept-Language: crawler disfarçado do Meta.
  // App real sempre envia o idioma do dispositivo; crawlers não enviam.
  if (ua.includes('instagram') && !request.headers.get('Accept-Language')) return true;

  // Layer 3 — Rate limit por IP via KV: máx 20 req por IP por janela de 10 min
  if (env.AB_KV) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const window = Math.floor(Date.now() / 600_000);
    const key = `rate:${ip}:${window}`;
    try {
      const raw = await env.AB_KV.get(key);
      const count = raw ? parseInt(raw, 10) : 0;
      if (count > 20) return true;
      ctx.waitUntil(env.AB_KV.put(key, String(count + 1), { expirationTtl: 600 }));
    } catch (_) {
      // KV indisponível — nunca bloqueia usuário
    }
  }

  // Layer 4 — D1 bot_fingerprints: IPs confirmados via honeypot /probe
  if (env.DB) {
    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (ip) {
      try {
        const row = await env.DB
          .prepare('SELECT 1 FROM bot_fingerprints WHERE ip = ? LIMIT 1')
          .bind(ip)
          .first();
        if (row) return true;
      } catch (_) {}
    }
  }

  return false;
}

// ── UTM-based bot signature (sincronizado com dashboard-quiz/src/shared/ab-compat.js) ──
// Captura Meta crawlers que passam pelo isBotUA (Safari mobile real) mas vêm de
// placement desktop-only ou sem template UTM completo.
//   - utm_source=Facebook_Right_Column = desktop-only no Meta; em mobile = crawler.
//   - utm_medium=pago-metaads SEM utm_campaign/content/term = template do Ads Manager
//     nunca chega vazio em clicks reais.
// Aceita: URLSearchParams ou plain object. Retorna string-reason ou null.
export function isUtmBot(input) {
  const get = (k) => {
    if (!input) return '';
    if (typeof input.get === 'function') return input.get(k) || '';
    return input[k] || '';
  };
  const source = String(get('utm_source')).toLowerCase();
  const medium = String(get('utm_medium')).toLowerCase();

  if (source.includes('right_column')) return 'placement_right_column';

  const isPaidMeta = medium.includes('metaads') || (medium === 'cpc' && source.includes('facebook'));
  if (isPaidMeta && !get('utm_campaign') && !get('utm_content') && !get('utm_term')) {
    return 'paid_meta_no_template';
  }
  return null;
}

// ── Variant assignment (hash determinístico por uid × experimentId) ───────────
// experimentId garante independência estatística entre experimentos distintos
// para o mesmo uid: hash(uid + 'page-uuid') ≠ hash(uid + 'checkout-uuid')
// Bloco preconnect/dns-prefetch padrão das landing pages, replicado como
// HTTP Link header no redirect. Browser inicia as conexões DURANTE o 302,
// então quando o HTML chega no destino, o pool já está warm.
// Ordem por prioridade: GTM (browser + server) → Meta → TikTok → S3 CAPI →
// Clarity (dns-prefetch). Espelha project_plo_landing_pages.md.
export function addPerfHeaders(headers, env) {
  const wp = env.WP_DOMAIN || 'example.com'
  // Destino do redirect (WP) e GTM browser-side
  headers.append('Link', `<https://${wp}>; rel=preconnect`)
  headers.append('Link', `<https://www.googletagmanager.com>; rel=preconnect; crossorigin`)
  // GTM server-side (ts.example proxy do GTM)
  headers.append('Link', `<https://ts.example.com>; rel=preconnect; crossorigin`)
  // Meta Pixel (browser + CAPI fallback)
  headers.append('Link', `<https://connect.facebook.net>; rel=preconnect; crossorigin`)
  headers.append('Link', `<https://www.facebook.com>; rel=preconnect; crossorigin`)
  // TikTok Pixel
  headers.append('Link', `<https://analytics.tiktok.com>; rel=preconnect; crossorigin`)
  // Microsoft Clarity (dns-prefetch — mais leve, payload baixo)
  headers.append('Link', `<https://scripts.clarity.ms>; rel=dns-prefetch`)
  headers.append('Link', `<https://www.clarity.ms>; rel=dns-prefetch`)
  headers.append('Link', `<https://r.clarity.ms>; rel=dns-prefetch`)
}

export function buildUidCookie(uid, env) {
  const dom = env.WP_DOMAIN ? `; Domain=.${env.WP_DOMAIN}` : ''
  return `uid=${uid}${dom}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`
}

// Granularidade 10000 (0,01%) — honra pesos com 2 casas decimais (ex: 33,35%).
// Antes era % 100 (granularidade de 1%), que jogava as casas decimais fora.
// Espera variantes já normalizadas (soma dos pesos = 1) — ver activeNormalized.
export function assignVariant(uid, variants, experimentId = '') {
  const hash = murmurhash3(uid + experimentId) % 10000;
  let cumulative = 0;
  for (const v of variants) {
    cumulative += (v.weight || 0) * 10000;
    if (hash < cumulative) return v;
  }
  return variants[variants.length - 1];
}

// Filtra variantes desativadas (enabled === false) e renormaliza os pesos das
// ATIVAS pra somar 1 — é isso que dá a "redistribuição proporcional" de graça:
// desligar uma variante faz as outras absorverem o tráfego mantendo a razão.
// Variante sem o campo `enabled` conta como ativa (retrocompat com dados legados).
// Guardas defensivas: se nenhuma estiver ativa, ou a soma dos pesos for <= 0,
// devolve um split uniforme — o Worker nunca pode ficar sem variante pra sortear.
export function activeNormalized(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return variants;
  const active = variants.filter(v => v.enabled !== false);
  const pool = active.length ? active : variants;
  const sum = pool.reduce((s, v) => s + (v.weight || 0), 0);
  if (sum <= 0) {
    const w = 1 / pool.length;
    return pool.map(v => ({ ...v, weight: w }));
  }
  return pool.map(v => ({ ...v, weight: (v.weight || 0) / sum }));
}

// Lê pesos de bandit do KV (key `bandit:{experimentId}`) e devolve cópia das
// variantes com pesos sobrescritos. Se o experimento não tem auto_optimize
// ligado, ou o KV não tem entry, devolve as variantes originais.
//
// KV payload esperado:  {"weights": {"slugA": 0.6, "slugB": 0.4}}
// (gravado pelo cron bandit-update do dashboard).
export async function getBanditVariants(exp, env) {
  if (!exp) return exp?.variants;

  // base = pesos do bandit (se auto_optimize ligado) ou os pesos configurados.
  let base = exp.variants;
  if (exp.auto_optimize && env?.AB_KV) {
    try {
      const raw = await env.AB_KV.get(`bandit:${exp.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        const weights = parsed?.weights;
        if (weights && typeof weights === 'object') {
          // Reconstrói variantes com pesos do bandit. Mantém ordem original.
          base = exp.variants.map(v => ({
            ...v,
            weight: typeof weights[v.slug] === 'number' ? weights[v.slug] : v.weight,
          }));
        }
      }
    } catch (_) {
      base = exp.variants;
    }
  }

  // Sempre filtra desativadas e renormaliza (vale com ou sem bandit).
  return activeNormalized(base);
}
