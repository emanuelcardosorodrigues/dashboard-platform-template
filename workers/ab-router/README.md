# Router A/B multi-projeto

Cada projeto usa seu próprio domínio na mesma rota fixa: `https://DOMINIO/r/*`.
O Worker resolve o projeto pelo host da requisição e só consulta experimentos
daquele workspace; portanto, dois projetos podem usar o mesmo slug sem cruzar
tráfego ou métricas.

## Configuração de um projeto

1. Aplique a migration `apps/dashboard/supabase/migrations/0069_workspace_ab_entry_base.sql`.
2. No dashboard, abra **Administração → Projetos → [projeto]** e preencha
   **Link base do teste A/B** com `dominio-do-cliente.com.br/r`.
3. Na conta Cloudflare que controla esse domínio, publique o mesmo Worker na
   rota `dominio-do-cliente.com.br/r/*` (DNS com proxy Cloudflare ativo).
4. Faça o smoke test `curl -I https://dominio-do-cliente.com.br/r/slug-do-teste`.

O Worker devolve `404 Domínio A/B não configurado em nenhum projeto` até os
passos 1 e 2 existirem. Isso é intencional: evita enviar tráfego de um cliente
para o experimento de outro.
