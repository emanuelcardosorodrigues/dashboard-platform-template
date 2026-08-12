# Dashboard Platform Template

Template neutro para um dashboard de vendas e marketing, com integrações de Hotmart, Meta Ads, Supabase, roteamento A/B, quiz e emissão de NFS-e.

Não contém credenciais, domínios, contas, históricos, dados de clientes ou identidade visual de qualquer operação. Cada instalação deve criar sua própria infraestrutura e cadastrar Secrets diretamente nos provedores.

## Componentes

| Caminho | Responsabilidade | Hospedagem |
| --- | --- | --- |
| `apps/dashboard` | Aplicação Next.js, painel e APIs | Vercel |
| `workers/hotmart-consolidator` | Consolidação de pedidos Hotmart e envio à CAPI | Cloudflare Workers + D1 |
| `workers/ab-router` | Roteamento A/B, atribuição e beacons | Cloudflare Workers + KV + D1 |
| `workers/quiz` | Quiz, captura de leads e fila de reenvio | Cloudflare Workers + KV + D1 |
| `workers/nfse` | Emissão/cancelamento de NFS-e | Cloudflare Workers + D1 |

## Começo rápido

1. Leia [`docs/INSTALL.md`](docs/INSTALL.md) e crie os recursos na sua própria conta Cloudflare/Supabase/Vercel.
2. Preencha somente arquivos locais de configuração; nunca os versione.
3. Instale dependências com `npm run install:all`.
4. Aplique migrations e publique na ordem indicada no guia.
5. Configure o GTM com [`docs/GTM.md`](docs/GTM.md).
6. Rode `npm run check` antes de enviar alterações.

O prompt pronto para entregar a outro construtor está em [`PROMPT_PARA_INSTALACAO.md`](PROMPT_PARA_INSTALACAO.md).
