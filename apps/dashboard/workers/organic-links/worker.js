/**
 * Encurtador de links orgânicos — roda na Cloudflare DO CLIENTE, no domínio
 * dele (ex.: example.com/{slug}).
 *
 * GET /{slug} → lê o KV (json {dest, platform, post}) → 302 pro destino
 * carimbando utm_source=organico & utm_medium={platform} & utm_content={post}
 * & sck=org_{platform}_{post} (preserva query existente do destino) e dispara
 * um beacon de clique pro dashboard (fire-and-forget, sem segredo embarcado).
 *
 * Bindings/vars (wrangler.toml): KV LINKS · var WS (workspace id) ·
 * var HIT_URL (https://dashboard.example.com/api/webhook/link-hit).
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const slug = url.pathname.replace(/^\/+|\/+$/g, '')
    if (!slug || slug.includes('/')) {
      return new Response('Not found', { status: 404 })
    }

    const raw = await env.LINKS.get(slug)
    if (!raw) return new Response('Not found', { status: 404 })

    let link
    try {
      link = JSON.parse(raw)
    } catch {
      return new Response('Not found', { status: 404 })
    }

    const dest = new URL(link.dest)
    dest.searchParams.set('utm_source', 'organico')
    if (link.platform) dest.searchParams.set('utm_medium', link.platform)
    if (link.post) {
      dest.searchParams.set('utm_content', link.post)
      dest.searchParams.set('sck', `org_${link.platform || 'social'}_${link.post}`)
    } else {
      dest.searchParams.set('utm_content', slug)
      dest.searchParams.set('sck', `org_link_${slug}`)
    }

    if (env.HIT_URL && env.WS) {
      ctx.waitUntil(fetch(env.HIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ws: env.WS, slug }),
      }).catch(() => {}))
    }

    return Response.redirect(dest.toString(), 302)
  },
}
