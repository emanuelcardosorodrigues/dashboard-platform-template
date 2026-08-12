# Google Tag Manager: A/B, checkout e quiz

Use um container GTM próprio da nova operação. Não importe containers nem variáveis de outra conta.

## Variáveis

Crie as variáveis de URL Query `ck` e `ob`. Elas carregam as variantes de checkout e order bump atribuídas pelo Worker A/B.

## Tag de atribuição da página

No script de atribuição que gera o `pageSlug`, adicione o trecho abaixo imediatamente após obter o slug da URL e antes de gravá-lo em cookie/local storage:

```javascript
var pageSlug = window.location.pathname.replace(/^\/|\/$/g, '') || 'raiz';
var ckParam = getParameterByName('ck');
var obParam = getParameterByName('ob');
if (ckParam && /^[a-zA-Z0-9-]+$/.test(ckParam)) pageSlug += '_ck' + ckParam;
if (obParam && /^[a-zA-Z0-9-]+$/.test(obParam)) pageSlug += '_ob' + obParam;
```

Isso garante que a atribuição que acompanha o checkout inclua as três dimensões: página, checkout e order bump.

## Beacon de impressão real

Após publicar o Worker A/B e as páginas de variação, crie uma tag Custom HTML disparada em `DOM Ready` somente nas páginas de teste:

```html
<script>
  (function () {
    var path = window.location.pathname.replace(/^\/|\/$/g, '');
    if (!path) return;
    navigator.sendBeacon('/r/i?p=' + encodeURIComponent(path));
  })();
</script>
```

Teste a tag no Preview do GTM e confira uma resposta 204/200 no Network. Só depois defina `IMPRESSION_MODE` como `beacon` no Worker. Enquanto a tag não estiver em todas as variantes, mantenha `redirect` para não perder métricas.

## Eventos do quiz

Dispare eventos de `quiz_start`, `quiz_step`, `quiz_lead` e `quiz_complete` no `dataLayer`. Evite enviar e-mail, telefone, CPF ou outras informações pessoais ao GTM/Meta/GA4. Para leads, envie apenas um identificador pseudônimo e eventos agregados.

## Checklist de publicação

- Preview GTM não mostra erros de JavaScript.
- O `pageSlug` contém `ck` e `ob` quando presentes.
- O beacon ocorre uma vez por carregamento real de variante.
- Parâmetros UTM, `fbclid` e `gclid` continuam presentes até o checkout.
- Nenhum evento leva PII para plataformas de analytics.
