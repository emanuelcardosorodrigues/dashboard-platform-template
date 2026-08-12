/**
 * Page Slug Builder — instalação: GTM → Nova tag → HTML Personalizado → Acionador: All Pages
 * Prioridade: deve rodar ANTES do Click Interceptor (defina priority menor, ex: 0 vs 1).
 *
 * O que faz:
 *   1. Lê pathname da página atual (ex: col-pv03)
 *   2. Lê ?pv= injetado pelo Worker (ex: t01-col-pv03) — valida charset [a-zA-Z0-9-]
 *   3. Constrói pageSlug = "{pathname}_pv{pvParam}" (sem pv → só "{pathname}")
 *   4. Injeta ?sck={pageSlug} na URL via history.replaceState (sem recarregar)
 *      — o Click Interceptor lê sck da URL e acrescenta _ck/_ob no checkout
 *   5. Grava cookie first-touch (cookiePageSlug) — nunca sobrescreve
 *
 * Formato sck[0] resultante (após Click Interceptor completar):
 *   col-pv03_pvt01-col-pv03_ckck-v1_obob2
 *   └──────┘ └──────────────────┘ └──────┘ └──────┘
 *   pathname  pv (Worker)          ck       ob
 */
(function () {
  try {
    var sp = new URLSearchParams(window.location.search);

    // ── 1. Pathname da LP (ex: "col-pv03") ────────────────────────────────
    var pathname = window.location.pathname.replace(/^\/|\/$/g, '');
    if (!pathname) return;

    // ── 2. Marcador ?pv= injetado pelo Worker ──────────────────────────────
    var pvParam = sp.get('pv') || '';
    var pvSegment = '';
    if (pvParam && /^[a-zA-Z0-9-]+$/.test(pvParam)) {
      pvSegment = '_pv' + pvParam;
    }

    // ── 3. pageSlug (sem ck/ob — Click Interceptor adiciona no checkout) ───
    var pageSlug = pathname + pvSegment;

    // ── 4. Injeta sck na URL para o Click Interceptor ler ─────────────────
    if (!sp.get('sck')) {
      sp.set('sck', pageSlug);
      var newSearch = '?' + sp.toString();
      history.replaceState(null, '', newSearch + window.location.hash);
    }

    // ── 5. Cookie first-touch (30 dias) — nunca sobrescreve ───────────────
    var cookieName = 'cookiePageSlug';
    if (document.cookie.indexOf(cookieName + '=') === -1) {
      var expires = new Date();
      expires.setDate(expires.getDate() + 30);
      document.cookie = cookieName + '=' + encodeURIComponent(pageSlug)
        + '; path=/; expires=' + expires.toUTCString()
        + '; SameSite=Lax';
    }

  } catch (e) {
    // silencia falhas para não bloquear a página
  }
})();
