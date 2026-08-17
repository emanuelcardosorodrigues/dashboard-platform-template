import { resolveIdentity, detectBot, assignVariant, isBotUA, isUtmBot, buildUidCookie, addPerfHeaders, getBanditVariants, murmurhash3 } from './ab.js';

// Cache em memória: evita reads repetidos ao KV dentro do mesmo isolate.
// Sobrevive enquanto o isolate estiver aquecido (dezenas de requests).
// Estrutura: kvKey → { data, expires }. As chaves incluem workspace: dois
// projetos podem usar o mesmo slug sem vazar experimento entre domínios.
const MEM_CACHE = new Map();
const MEM_TTL_MS = 300_000; // 5 min — alinhado com o TTL do KV
const KV_TTL_S  = 300;      // 5 min — reduz writes de 1.440/dia para ~288/dia por path

// Busca experimento por tipo e pathname.
// KV key: experiment:{type}:{pathname}  ex: experiment:page:/col
//
// O argumento opcional `cacheRef` é um objeto mutável usado pra rastrear o
// pior caso de cache hit dentro de um request — se qualquer chamada bater
// no Supabase (MISS), o handler top-level marca a resposta como X-Cache: MISS.
async function resolveWorkspaceId(hostname, env) {
  const host = hostname.toLowerCase();
  const kvKey = `workspace-host:${host}`;
  const mem = MEM_CACHE.get(kvKey);
  if (mem && mem.expires > Date.now()) return mem.data;

  if (env.AB_KV) {
    try {
      const cached = await env.AB_KV.get(kvKey);
      if (cached) {
        MEM_CACHE.set(kvKey, { data: cached, expires: Date.now() + MEM_TTL_MS });
        return cached;
      }
    } catch (_) {}
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return null;
  try {
    // ab_entry_base é canônico: "cliente.com.br/r". A rota do Worker recebe
    // sempre /r/*, portanto o host identifica inequivocamente o projeto.
    const base = `${host}/r`;
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/workspaces?select=id&ab_entry_base=eq.${encodeURIComponent(base)}&limit=1`,
      { headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` } },
    );
    const rows = await res.json();
    const id = Array.isArray(rows) ? rows[0]?.id : null;
    if (!id) return null;
    MEM_CACHE.set(kvKey, { data: id, expires: Date.now() + MEM_TTL_MS });
    if (env.AB_KV) env.AB_KV.put(kvKey, id, { expirationTtl: KV_TTL_S }).catch(() => {});
    return id;
  } catch (_) {
    return null;
  }
}

async function getExperimentByType(pathname, type, workspaceId, env, cacheRef) {
  const kvKey = `experiment:${workspaceId}:${type}:${pathname}`;

  // Camada 0 — memória (sem I/O, gratuito)
  const mem = MEM_CACHE.get(kvKey);
  if (mem && mem.expires > Date.now()) return mem.data;

  // Camada 1 — KV (edge, cross-isolate)
  if (env.AB_KV) {
    try {
      const cached = await env.AB_KV.get(kvKey);
      if (cached) {
        const data = JSON.parse(cached);
        MEM_CACHE.set(kvKey, { data, expires: Date.now() + MEM_TTL_MS });
        return data;
      }
    } catch (_) {}
  }

  // A partir daqui pagamos Supabase — qualquer leitura é MISS.
  if (cacheRef) cacheRef.miss = true;

  // Camada 2 — Supabase
  if (env.SUPABASE_URL && env.SUPABASE_KEY) {
    try {
      const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/experiments?workspace_id=eq.${encodeURIComponent(workspaceId)}&entry_path=eq.${encodeURIComponent(pathname)}&type=eq.${type}&status=eq.active&limit=1`,
        { headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` } }
      );
      const rows = await res.json();
      if (Array.isArray(rows) && rows[0]) {
        const exp = rows[0];
        MEM_CACHE.set(kvKey, { data: exp, expires: Date.now() + MEM_TTL_MS });
        if (env.AB_KV) {
          env.AB_KV.put(kvKey, JSON.stringify(exp), { expirationTtl: KV_TTL_S }).catch(() => {});
        }
        // Persiste fallback_url no D1 para sobreviver à queda do Supabase
        if (exp.fallback_url && env.DB) {
          env.DB
            .prepare('INSERT OR REPLACE INTO rotas (path, type, fallback_url) VALUES (?, ?, ?)')
            .bind(`${workspaceId}:${pathname}`, type, exp.fallback_url)
            .run()
            .catch(() => {});
        }
        return exp;
      }
    } catch (_) {}
  }

  return null;
}

// Copia todos os params de sourceUrl para destUrl.
// Params da fonte são soberanos — sobrescrevem o que já existir no destino.
// Use skip[] para omitir chaves internas do Worker (ex: 'ck', 'ob').
function forwardParams(sourceUrl, destUrl, skip = []) {
  for (const [k, v] of sourceUrl.searchParams.entries()) {
    if (!skip.includes(k)) destUrl.searchParams.set(k, v);
  }
}

// Garante barra final em paths WordPress para evitar o 301 canônico extra.
// WordPress redireciona /slug → /slug/ automaticamente — evitamos o hop extra
// adicionando a barra antes do redirect. Não aplica em URLs externas (ex: Hotmart).
// wpDomain vem de env.WP_DOMAIN (wrangler secret). Se vazio, a função é no-op.
function ensureTrailingSlash(destUrl, wpDomain) {
  if (
    wpDomain && destUrl.hostname === wpDomain &&
    !destUrl.pathname.endsWith('/') &&
    !destUrl.pathname.includes('.')
  ) {
    destUrl.pathname = destUrl.pathname + '/';
  }
}

// Retorna true se o experimento está dentro da janela de agendamento (ou sem agendamento).
function isWithinSchedule(exp) {
  const now = Date.now();
  if (exp.scheduled_start && now < new Date(exp.scheduled_start).getTime()) return false;
  if (exp.scheduled_end   && now > new Date(exp.scheduled_end).getTime())   return false;
  return true;
}

// Busca o fallback_url com redundância em 2 camadas:
//   1. Supabase (fonte primária)
//   2. D1 local — última fallback_url vista para este path (persiste mesmo sem Supabase)
// Sem EMERGENCY_URL global: o fallback de emergência é sempre o último configurado
// no próprio experimento, gravado no D1 a cada fetch bem-sucedido do Supabase.
async function getFallbackUrl(pathname, type, workspaceId, env) {
  // Camada 1 — Supabase
  if (env.SUPABASE_URL && env.SUPABASE_KEY) {
    try {
      const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/experiments?workspace_id=eq.${encodeURIComponent(workspaceId)}&entry_path=eq.${encodeURIComponent(pathname)}&type=eq.${type}&order=created_at.desc&limit=1&select=fallback_url`,
        { headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` } }
      );
      const rows = await res.json();
      const url = rows?.[0]?.fallback_url ?? null;
      if (url) return url;
    } catch (_) {}
  }

  // Camada 2 — D1: última fallback_url registrada para este path
  if (env.DB) {
    try {
      const row = await env.DB
        .prepare('SELECT fallback_url FROM rotas WHERE path = ? AND type = ? LIMIT 1')
        .bind(`${workspaceId}:${pathname}`, type)
        .first();
      if (row?.fallback_url) return row.fallback_url;
    } catch (_) {}
  }

  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Strip /r prefix (same-domain route: SEU_DOMINIO.COM.BR/r/*)
    const raw = url.pathname.replace(/\/$/, '') || '/';
    const pathname = raw.startsWith('/r/') ? raw.slice(2) : raw === '/r' ? '/' : raw;

    if (pathname === '/probe') {
      return handleProbe(request, env);
    }

    const workspaceId = await resolveWorkspaceId(url.hostname, env);
    if (!workspaceId) {
      return new Response('Domínio A/B não configurado em nenhum projeto.', {
        status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    if (pathname === '/assign') {
      return handleAssign(request, workspaceId, env);
    }

    if (pathname === '/i') {
      return handleImpression(request, workspaceId, env, ctx);
    }

    if (pathname.startsWith('/check/')) {
      return handleCheckout(pathname, request, workspaceId, env, ctx);
    }

    return handlePage(pathname, request, workspaceId, env, ctx);
  },
};

// ── Rota /assign — retorna {ck, ob} para o click interceptor ─────────────────
// Chamada pelo script na LP antes de redirecionar para o checkout.
// Permite que o SCK seja composto antes da navegação (útil para VTURB/iframe).
async function handleAssign(request, workspaceId, env) {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug') || '';

  if (!slug || !/^[a-zA-Z0-9-]+$/.test(slug)) {
    return new Response(JSON.stringify({ error: 'slug inválido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const pagePath = `/${slug}`;
  const { uid, isNew } = resolveIdentity(request);
  const cacheRef = { miss: false };

  const [checkoutExp, obExp] = await Promise.all([
    getExperimentByType(pagePath, 'checkout', workspaceId, env, cacheRef),
    getExperimentByType(pagePath, 'ob', workspaceId, env, cacheRef),
  ]);

  const result = {};
  if (checkoutExp && isWithinSchedule(checkoutExp)) {
    const variants = await getBanditVariants(checkoutExp, env);
    result.ck = assignVariant(uid, variants, checkoutExp.id).slug;
  }
  if (obExp && isWithinSchedule(obExp)) {
    const variants = await getBanditVariants(obExp, env);
    result.ob = assignVariant(uid, variants, obExp.id).slug;
  }

  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'X-Cache': cacheRef.miss ? 'MISS' : 'HIT',
  });
  if (isNew) {
    headers.append('Set-Cookie', buildUidCookie(uid, env));
  }

  return new Response(JSON.stringify(result), { status: 200, headers });
}

// ── Rota /i — beacon de impressão real (carregamento da página) ───────────────
// Chamada por uma tag GTM no load da página (sendBeacon /r/i?p=<slug>). Diferente
// do log no redirect, conta a impressão SÓ quando a página realmente carregou —
// alinha "Visualizações" do dashboard com landing page views do Meta e remove a
// inflação de quem clica e desiste durante o salto.
//
// Só registra quando IMPRESSION_MODE=beacon. Em 'redirect' (default) é no-op
// silencioso, o que permite instalar a tag GTM e validar o tráfego ANTES de
// virar a chave (sem zerar métrica nem contar em dobro).
//
// A variante é RECOMPUTADA pelo uid (mesmo hash determinístico do redirect), então
// o endpoint não confia em nada que o cliente envie além do path (?p=slug).
// Sempre responde 204 — beacon nunca mostra erro ao usuário.
async function handleImpression(request, workspaceId, env, ctx) {
  const url = new URL(request.url);
  const headers = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
  const ok = () => new Response(null, { status: 204, headers });

  if ((env.IMPRESSION_MODE || 'redirect') !== 'beacon') return ok();

  const slug = url.searchParams.get('p') || '';
  if (!slug || !/^[a-zA-Z0-9-]+$/.test(slug)) return ok();

  // Bot guard síncrono — mesmo critério das outras rotas.
  if (isBotUA(request.headers.get('User-Agent') || '') || isUtmBot(url.searchParams)) return ok();

  const pathname = `/${slug}`;
  const pageExp = await getExperimentByType(pathname, 'page', workspaceId, env);
  if (!pageExp || !isWithinSchedule(pageExp)) return ok();

  const { uid, ip_fp } = resolveIdentity(request);

  // Dedup por uid×experimento (janela de 30 min): evita que reload ou duplo-disparo
  // do GTM inflem a contagem. Semântica = "viewer único na sessão".
  if (env.AB_KV) {
    const seenKey = `seen:${pageExp.id}:${uid}`;
    try {
      if (await env.AB_KV.get(seenKey)) return ok();
      ctx.waitUntil(env.AB_KV.put(seenKey, '1', { expirationTtl: 1800 }));
    } catch (_) {}
  }

  // Recomputa a variante pelo uid — fonte da verdade é o servidor, não o cliente.
  const variants = await getBanditVariants(pageExp, env);
  const variant = assignVariant(uid, variants, pageExp.id);

  // Bot detection completa + log em background — não bloqueiam a resposta.
  ctx.waitUntil((async () => {
    const isBot = await detectBot(request, env, ctx);
    if (!isBot) {
      await logImpression({
        experiment_id: pageExp.id,
        variant: variant.name,
        uid,
        ip_fp,
        country: request.cf?.country ?? 'XX',
        timestamp: new Date().toISOString(),
      }, env);
    }
  })());

  return ok();
}

// ── Rota de página (/col) ─────────────────────────────────────────────────────
// Busca o experimento de página, depois checkout/ob (usando checkout_slug se
// configurado), atribui variantes independentes por hash uid × experimentId,
// e monta o redirect com ?ck= e ?ob= para que o chtml componha o slug composto.
async function handlePage(pathname, request, workspaceId, env, ctx) {
  const url = new URL(request.url);
  const cacheRef = { miss: false };

  // Bloqueia bots antes de qualquer sorteio ou query ao banco.
  // Bots não recebem cookie, não são logados, e vão direto ao fallback.
  if (isBotUA(request.headers.get('User-Agent') || '') || isUtmBot(url.searchParams)) {
    const fallback = await getFallbackUrl(pathname, 'page', workspaceId, env);
    if (fallback) return Response.redirect(fallback, 302);
    return new Response('OK', { status: 200 });
  }

  // Busca o experimento de página primeiro para ler checkout_slug se configurado
  const pageExp = await getExperimentByType(pathname, 'page', workspaceId, env, cacheRef);

  // checkout_slug permite que uma página use o checkout de outro funil
  const checkoutPath = (pageExp && pageExp.checkout_slug) ? pageExp.checkout_slug : pathname;

  const [checkoutExp, obExp] = await Promise.all([
    getExperimentByType(checkoutPath, 'checkout', workspaceId, env, cacheRef),
    getExperimentByType(checkoutPath, 'ob', workspaceId, env, cacheRef),
  ]);

  if (!pageExp || !isWithinSchedule(pageExp)) {
    const fallback = pageExp?.fallback_url ?? await getFallbackUrl(pathname, 'page', workspaceId, env);
    if (fallback) {
      const fallbackDest = new URL(fallback);
      ensureTrailingSlash(fallbackDest, env.WP_DOMAIN);
      // Propaga UTMs mas reserva ck, ob e pv para o Worker definir
      forwardParams(url, fallbackDest, ['ck', 'ob', 'pv']);

      // Mesmo sem teste de página, sorteia ck e ob para que o chtml componha o SCK
      // checkoutExp e obExp já foram buscados em paralelo acima
      const { uid, isNew } = resolveIdentity(request);
      if (checkoutExp && isWithinSchedule(checkoutExp)) {
        const variants = await getBanditVariants(checkoutExp, env);
        fallbackDest.searchParams.set('ck', assignVariant(uid, variants, checkoutExp.id).slug);
      }
      if (obExp && isWithinSchedule(obExp)) {
        const variants = await getBanditVariants(obExp, env);
        fallbackDest.searchParams.set('ob', assignVariant(uid, variants, obExp.id).slug);
      }

      const fallbackHeaders = new Headers({ 'Location': fallbackDest.toString(), 'Cache-Control': 'no-store', 'X-Cache': cacheRef.miss ? 'MISS' : 'HIT' });
      if (isNew) {
        fallbackHeaders.append('Set-Cookie', buildUidCookie(uid, env));
      }
      addPerfHeaders(fallbackHeaders, env);
      return new Response(null, { status: 302, headers: fallbackHeaders });
    }
    return new Response(
      `Nenhum experimento de página ativo em "${pathname}". Configure no dashboard.`,
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  const { uid, ip_fp, isNew } = resolveIdentity(request);

  // Atribuição independente: hash(uid + experimentId) diferente para cada dimensão.
  // Aplica pesos do bandit (KV `bandit:{exp.id}`) se exp.auto_optimize=true.
  const pageVariants = await getBanditVariants(pageExp, env);
  const pageVariant = assignVariant(uid, pageVariants, pageExp.id);
  const dest = new URL(pageVariant.url);
  ensureTrailingSlash(dest, env.WP_DOMAIN);

  // Propaga todos os params da URL de entrada para a LP (UTMs, fbclid, gclid, etc.)
  // ck, ob e pv são omitidos aqui pois são definidos pelo Worker logo abaixo
  forwardParams(url, dest, ['ck', 'ob', 'pv']);

  // Marcador de variante de página — usado pelo cHtml para atribuição robusta via sck
  dest.searchParams.set('pv', pageVariant.slug);

  // Marcador do path de entrada — o beacon /i usa pra logar a impressão no
  // carregamento real da página (IMPRESSION_MODE=beacon). A variante é recomputada
  // lá pelo uid, então só o path precisa viajar na URL.
  dest.searchParams.set('_abp', pathname.replace(/^\//, ''));

  if (checkoutExp) {
    const checkoutVariants = await getBanditVariants(checkoutExp, env);
    const ckVariant = assignVariant(uid, checkoutVariants, checkoutExp.id);
    dest.searchParams.set('ck', ckVariant.slug);
  }
  if (obExp) {
    const obVariants = await getBanditVariants(obExp, env);
    const obVariant = assignVariant(uid, obVariants, obExp.id);
    dest.searchParams.set('ob', obVariant.slug);
  }

  const headers = new Headers({
    'Location': dest.toString(),
    'Cache-Control': 'no-store',
    'X-Cache': cacheRef.miss ? 'MISS' : 'HIT',
  });

  if (isNew) {
    headers.append('Set-Cookie', buildUidCookie(uid, env));
  }
  addPerfHeaders(headers, env);

  // Bot detection e logs em background — não bloqueiam o redirect. Uma única passada de
  // detectBot alimenta os dois writes, com o MESMO critério (senão click e view ficariam
  // filtrados de forma assimétrica e o connect rate mentiria).
  ctx.waitUntil((async () => {
    const isBot = await detectBot(request, env, ctx);
    if (isBot) return;
    const row = {
      experiment_id: pageExp.id,
      variant: pageVariant.name,
      uid,
      ip_fp,
      country: request.cf?.country ?? 'XX',
      timestamp: new Date().toISOString(),
    };

    // O clique roteado (302) é logado SEMPRE, independente do IMPRESSION_MODE. É o
    // "clicou no anúncio e foi roteado". A view (page load) vem do beacon /r/i.
    // connect rate = views ÷ clicks. Tabela própria: nunca entra em `impressions`.
    await logRouteClick(row, env);

    // Em IMPRESSION_MODE=beacon, a impressão (denominador do bandit) é logada pelo
    // beacon no load real — aqui NÃO. Em 'redirect' (legado) a impressão ainda é o 302.
    if ((env.IMPRESSION_MODE || 'redirect') === 'redirect') {
      await logImpression(row, env);
    }
  })());

  return new Response(null, { status: 302, headers });
}

// ── Rota de checkout (/check/:id) ─────────────────────────────────────────────
// Busca o experimento de checkout pelo path da página (type=checkout, entry_path=/col).
// Respeita o ?ck= que veio propagado pelo chtml — veredito já definido na entrada.
async function handleCheckout(pathname, request, workspaceId, env, ctx) {
  const id = pathname.slice('/check/'.length); // ex: "col"
  const pagePathname = `/${id}`;               // ex: "/col"

  const incomingUrl = new URL(request.url);
  const cacheRef = { miss: false };

  // Bloqueia bots antes de qualquer sorteio ou query ao banco.
  if (isBotUA(request.headers.get('User-Agent') || '') || isUtmBot(incomingUrl.searchParams)) {
    const fallback = await getFallbackUrl(pagePathname, 'checkout', workspaceId, env);
    if (fallback) return Response.redirect(fallback, 302);
    return new Response('OK', { status: 200 });
  }

  const [experiment, obExperiment] = await Promise.all([
    getExperimentByType(pagePathname, 'checkout', workspaceId, env, cacheRef),
    getExperimentByType(pagePathname, 'ob', workspaceId, env, cacheRef),
  ]);

  if (!experiment || !isWithinSchedule(experiment)) {
    const fallback = experiment?.fallback_url ?? await getFallbackUrl(pagePathname, 'checkout', workspaceId, env);
    if (fallback) {
      const fallbackDest = new URL(fallback);
      forwardParams(incomingUrl, fallbackDest);
      return Response.redirect(fallbackDest.toString(), 302);
    }
    return new Response(
      `Nenhum experimento de checkout ativo para "${pagePathname}". Configure no dashboard.`,
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  const { uid, ip_fp, isNew } = resolveIdentity(request);

  // Prefere ?ck= já presente na URL (veredito propagado pelo chtml da página)
  const ckFromUrl = incomingUrl.searchParams.get('ck');
  const variantByUrl = ckFromUrl
    ? experiment.variants.find(v => v.slug === ckFromUrl)
    : null;
  const checkoutVariants = variantByUrl ? experiment.variants : await getBanditVariants(experiment, env);
  const variant = variantByUrl ?? assignVariant(uid, checkoutVariants, experiment.id);

  // ?ob= pode vir da página (fluxo integrado) ou ser atribuído aqui (fluxo modular, paths diferentes)
  const obFromUrl = incomingUrl.searchParams.get('ob');
  let obSlug = obFromUrl;
  if (!obSlug && obExperiment && isWithinSchedule(obExperiment)) {
    const obVariants = await getBanditVariants(obExperiment, env);
    obSlug = assignVariant(uid, obVariants, obExperiment.id).slug;
  }

  // Usa URL da matriz (checkout × ob) se disponível; senão, URL da variante de checkout
  const matrixKey = obSlug ? `${variant.slug}_${obSlug}` : null;
  const matrixUrl = matrixKey && obExperiment?.matrix?.[matrixKey];
  const dest = new URL(matrixUrl || variant.url);

  // Propaga todos os params de entrada para o destino — tráfego é soberano (sobrescreve destino)
  forwardParams(incomingUrl, dest);
  // ck e ob são definidos pelo Worker por último — garantem SCK composto correto no chtml
  dest.searchParams.set('ck', variant.slug);
  if (obSlug) dest.searchParams.set('ob', obSlug);

  const headers = new Headers({
    'Location': dest.toString(),
    'Cache-Control': 'no-store',
    'X-Cache': cacheRef.miss ? 'MISS' : 'HIT',
  });

  if (isNew) {
    headers.append('Set-Cookie', buildUidCookie(uid, env));
  }
  addPerfHeaders(headers, env);

  // Bot detection e log acontecem em background — não bloqueiam o redirect
  ctx.waitUntil((async () => {
    const isBot = await detectBot(request, env, ctx);
    if (!isBot) {
      await logImpression({
        experiment_id: experiment.id,
        variant: variant.name,
        uid,
        ip_fp,
        country: request.cf?.country ?? 'XX',
        timestamp: new Date().toISOString(),
      }, env);

      // Loga impressão do OB junto com o checkout (mesmo momento de exposição)
      if (obExperiment && obSlug) {
        const obVariant = obExperiment.variants.find(v => v.slug === obSlug);
        if (obVariant) {
          await logImpression({
            experiment_id: obExperiment.id,
            variant: obVariant.name,
            uid,
            ip_fp,
            country: request.cf?.country ?? 'XX',
            timestamp: new Date().toISOString(),
          }, env);
        }
      }
    }
  })());

  return new Response(null, { status: 302, headers });
}

// ── Rota /probe — honeypot para fingerprinting de bots do Meta ───────────────
// Crie um anúncio apontando para SEU_DOMINIO.COM.BR/r/probe.
// Todo tráfego que chegar aqui é bot (nenhum humano real conhece a URL).
// Os registros ficam na tabela bot_fingerprints do D1 para análise.
async function handleProbe(request, env) {
  const ua = request.headers.get('User-Agent') || '';
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const lang = request.headers.get('Accept-Language') || '';
  const referer = request.headers.get('Referer') || '';
  const botScore = request.cf?.botManagement?.score ?? null;
  const country = request.cf?.country ?? '';

  // 1. D1: fingerprint local — usado pelo Worker para rate-limit/lookup
  if (env.DB) {
    try {
      await env.DB
        .prepare(
          'INSERT INTO bot_fingerprints (ua, ip, cf_bot_score, cf_country, accept_language, referer) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(ua, ip, botScore, country, lang, referer)
        .run();
    } catch (_) {}
  }

  // 2. Supabase bot_uids: insere status='suspect' pra UI de Quarentena revisar.
  // Sem cookie uid (bot honeypot), gera uid determinístico hash(ip+ua).
  if (env.SUPABASE_URL && env.SUPABASE_KEY) {
    const probeUid = `probe_${murmurhash3(`${ip}:${ua}`) >>> 0}`;
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/bot_uids?on_conflict=uid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_KEY}`,
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          uid: probeUid,
          ip_fp: ip ? String(murmurhash3(ip) >>> 0) : null,
          source: 'probe',
          score: 100,
          signals: { ua, country, cf_bot_score: botScore, lang, referer },
          status: 'suspect',
        }),
      });
    } catch (_) {}
  }

  return new Response('OK', { status: 200 });
}

async function logImpression(data, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return;
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/impressions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(data),
    });
  } catch (_) {}
}

// Clique roteado (302) → tabela route_clicks (migration 0053). Denominador do connect
// rate (views ÷ clicks). Upsert ignora duplicata: o índice único (ws, exp, variant, uid,
// dia) dedup em 1 clicante por variante por dia — reload não infla. `dia` é default no DB
// (America/Sao_Paulo). Silencioso se a tabela não existir (migration não aplicada).
async function logRouteClick(data, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return;
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/route_clicks?on_conflict=workspace_id,experiment_id,variant,uid,dia`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
        'Prefer': 'return=minimal,resolution=ignore-duplicates',
      },
      body: JSON.stringify(data),
    });
  } catch (_) {}
}
