# Instalação e deploy

Este guia cria uma instalação nova. Nunca reutilize recursos, tokens ou domínios de outra operação.

## 1. Pré-requisitos

- Node.js 22 LTS e npm.
- Conta própria em Cloudflare, Supabase e Vercel.
- Um domínio próprio já delegado à Cloudflare, caso vá usar A/B ou quiz no domínio principal.
- Acesso de administrador às contas Hotmart, Meta e Google que serão integradas.

## 2. Instalar e configurar o dashboard

```bash
npm run install:all
cp apps/dashboard/.env.example apps/dashboard/.env.local
```

Preencha `apps/dashboard/.env.local` com os valores da nova operação. Todos os valores sem prefixo `NEXT_PUBLIC_` são secretos e devem ser cadastrados também no projeto Vercel, nunca no Git.

No Supabase, aplique as migrations em ordem:

```bash
cd apps/dashboard
for migration in supabase/migrations/*.sql; do
  npx supabase db execute --file "$migration"
done
```

Se o projeto não usa a CLI do Supabase, execute os mesmos arquivos no SQL Editor, em ordem numérica. Crie o primeiro usuário administrador com `scripts/seed-admin.mjs`, usando variáveis de ambiente locais, nunca argumentos de linha de comando.

Publique `apps/dashboard` na Vercel. Cadastre todas as variáveis de `.env.local` no escopo Production e use uma região próxima ao público. Verifique `/api/health/freshness` depois do primeiro deploy.

## 3. Cloudflare Workers

Faça login na sua conta Cloudflare e crie recursos isolados para esta instalação. Os arquivos `wrangler` usam placeholders deliberadamente; troque somente pelos IDs criados na sua conta antes de publicar.

| Worker | Recursos necessários | Migrations |
| --- | --- | --- |
| `hotmart-consolidator` | 2 bancos D1, um por funil | `migrations/000_logs.sql`, `001_orders_tables.sql` |
| `ab-router` | 1 namespace KV e 1 banco D1 | use a schema de experimentos do dashboard |
| `quiz` | 1 namespace KV e 1 banco D1 | `migrations/d1/0001_init.sql` e migrations Supabase |
| `nfse` | 1 banco D1 de produção e outro de staging | `migrations/*.sql` |

Para cada Worker:

```bash
cd workers/NOME_DO_WORKER
npx wrangler login
npx wrangler d1 create NOME_DO_BANCO
npx wrangler kv namespace create NOME_DO_NAMESPACE
# atualize o wrangler.* com os IDs retornados
npx wrangler deploy --dry-run
```

Cadastre segredos diretamente no Cloudflare. Não adicione secrets em `vars` nem em arquivos versionados:

```bash
# hotmart-consolidator
npx wrangler secret put STAPE_ENDPOINT

# ab-router
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
npx wrangler secret put WP_DOMAIN
npx wrangler secret put EMERGENCY_URL

# quiz
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put ADMIN_ACTION_PASSWORD
npx wrangler secret put CRM_WEBHOOK_URL
npx wrangler secret put CRM_WEBHOOK_TOKEN

# nfse: configurar staging e validar antes da produção
npx wrangler secret put API_KEY --env staging
npx wrangler secret put HOTMART_TOKEN --env staging
npx wrangler secret put COOKIE_HMAC_SECRET --env staging
npx wrangler secret put CERT_PRIVATE_KEY --env staging
npx wrangler secret put CERT_PUBLIC --env staging
```

O worker NFS-e também requer variáveis não-secretas específicas da prefeitura, definidas no `wrangler.jsonc` ou no painel Cloudflare: `NFSE_PROVIDER_NAME`, `NFSE_PROVIDER_CNPJ`, `NFSE_PROVIDER_MUNICIPAL_REGISTRATION`, `NFSE_PROVIDER_CITY`, `NFSE_PROVIDER_STATE`, `NFSE_PROVIDER_POSTAL_CODE`, `NFSE_MUNICIPALITY_CODE`, `NFSE_SERVICE_CODE`, `NFSE_ENDPOINT_STAGING`, `NFSE_ENDPOINT_PRODUCTION` e `NFSE_VERIFICATION_URL`. Valide sempre em homologação com certificado novo antes de ativar a rota de produção.

Depois de aplicar cada migration remota, publique:

```bash
npx wrangler deploy
```

No consolidator, publique também a configuração low-ticket com `npx wrangler deploy --config wrangler.lowticket.toml`.

## 4. Webhooks e cron

- Hotmart: configure o webhook no endpoint do dashboard ou no `hotmart-consolidator`, conforme o funil. Use assinatura HMAC e guarde o valor somente em Secret.
- Vercel Cron: mantenha os agendamentos de `vercel.json` e autorize cada endpoint com `CRON_SECRET`.
- Cloudflare: confirme os crons declarados no `wrangler` após cada deploy.
- NFS-e: habilite o webhook somente após o teste de emissão e cancelamento em staging.

## 5. Validação

```bash
npm run test
npm run security:scan
```

Faça smoke tests com credenciais da nova operação: login do dashboard, webhook de teste Hotmart, redirect A/B, carregamento de quiz e emissão NFS-e em homologação. Só então altere DNS/rotas de produção.
