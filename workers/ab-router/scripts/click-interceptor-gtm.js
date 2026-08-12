/**
 * Click Interceptor — instalação: GTM → Nova tag → HTML Personalizado → Acionador: All Pages
 *
 * O que faz:
 *   1. Intercepta cliques em links /r/check/ (Worker) e hotmart (direto)
 *   2. Para /r/check/: chama /r/assign para obter {ck, ob} determinístico
 *   3. Para hotmart direto: decora com sck/cookiePageSlug (garante atribuição)
 *   4. Preserva params nativos do href Hotmart (off, checkoutMode, split, offDiscount, etc.)
 *   5. Aplica _ck/_ob em sck posição 0 (last-touch) E posição 7 (first-touch contextual)
 *   6. Pad defensivo 14 posições no sck (decisão 2026-05-19)
 *   7. cookiePageSlug é first-touch absoluto — nunca tocado
 *   8. Dispara initiate_checkout no dataLayer e redireciona (respeita target="_blank")
 */
(function () {

  function readCookie(name) {
    try {
      var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    } catch (e) { return null; }
  }

  function buildFinalUrl(checkoutHref, data) {
    try {
      // Preserva params nativos do href Hotmart (off, checkoutMode, split, offDiscount, etc.)
      var url = new URL(checkoutHref);

      // Merge params da página em cima, SEM sobrescrever os do href
      var sp = new URLSearchParams(window.location.search);
      sp.forEach(function (value, key) {
        if (!url.searchParams.has(key)) {
          url.searchParams.set(key, value);
        }
      });

      // Fallback: se sck não veio na URL da página mas tem cookiePageSlug, usa
      if (!url.searchParams.has('sck')) {
        var cps = readCookie('cookiePageSlug');
        if (cps) url.searchParams.set('sck', cps);
      }

      // ck/ob sorteados (Worker /r/check/) sobrescrevem qualquer valor anterior
      if (data && data.ck) url.searchParams.set('ck', data.ck);
      if (data && data.ob) url.searchParams.set('ob', data.ob);

      // Decisão 2026-05-19: aplicar _ck/_ob em sck[0] (last-touch) E sck[7] (first-touch).
      // Se sck[7] estiver vazio, espelha sck[0] como first-touch contextual.
      var suffix = (data && data.ck ? '_ck' + data.ck : '') + (data && data.ob ? '_ob' + data.ob : '');
      var sck = url.searchParams.get('sck');
      if (suffix && sck) {
        var sckParts = sck.split('|');
        // Defesa em profundidade: garante 14 posições mesmo se sck vier truncado
        while (sckParts.length < 14) sckParts.push('');

        // sck[0] last-touch — só aplica se ainda não tem _ck (idempotente)
        if (sckParts[0] && sckParts[0].indexOf('_ck') === -1) {
          sckParts[0] = sckParts[0] + suffix;
        }

        // sck[7] first-touch — aplica se tem valor e ainda não tem _ck;
        // se está vazio, espelha sck[0] já modificado
        if (sckParts[7] && sckParts[7].indexOf('_ck') === -1) {
          sckParts[7] = sckParts[7] + suffix;
        } else if (!sckParts[7] && sckParts[0]) {
          sckParts[7] = sckParts[0];
        }

        url.searchParams.set('sck', sckParts.join('|'));
      }

      return url.toString();
    } catch (e) {
      return checkoutHref;
    }
  }

  function fireAndRedirect(finalUrl) {
    // SEMPRE same-tab — checkout via redirecionamento é feature do projeto.
    // Ignora target="_blank" do <a> propositalmente.
    var done = false;
    var navigate = function () {
      if (done) return;
      done = true;
      window.location.href = finalUrl;
    };
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      'event': 'initiate_checkout',
      'eventCallback': navigate,
      'eventTimeout': 3500
    });
    setTimeout(navigate, 3500);
  }

  document.addEventListener('click', function (e) {
    var target = e.target.closest('a');
    if (!target || !target.href) return;

    var href = target.href;
    var isWorker  = href.indexOf('/r/check/') !== -1;
    var isHotmart = href.indexOf('hotmart') !== -1;
    if (!isWorker && !isHotmart) return;

    e.preventDefault();

    // Link direto Hotmart — decora com params da página + cookiePageSlug fallback
    if (isHotmart) {
      fireAndRedirect(buildFinalUrl(href, {}));
      return;
    }

    // Link Worker (/r/check/) — sorteia ck/ob e atualiza sck last-touch + first-touch
    var match = href.match(/\/r\/check\/([a-zA-Z0-9-]+)/);
    var slug = match ? match[1] : null;

    var existingCk = null, existingOb = null;
    try {
      var sp = new URLSearchParams(window.location.search);
      existingCk = sp.get('ck');
      existingOb = sp.get('ob');
    } catch (e) {}

    if (existingCk || !slug) {
      // Worker já sorteou na entrada — reusa e atualiza sck last-touch + first-touch
      fireAndRedirect(buildFinalUrl(href, { ck: existingCk, ob: existingOb }));
      return;
    }

    // Acesso direto — chama /r/assign para sortear agora
    fetch('/r/assign?slug=' + encodeURIComponent(slug), { credentials: 'include' })
      .then(function (res) { return res.json(); })
      .then(function (data) { fireAndRedirect(buildFinalUrl(href, data)); })
      .catch(function () { fireAndRedirect(href); });

  }, true);

})();
