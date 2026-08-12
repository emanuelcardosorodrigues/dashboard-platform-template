# Prompt para o construtor

Copie e envie o texto abaixo junto com o link do repositório:

```text
Você é responsável por instalar este repositório como uma operação nova e isolada. Trabalhe somente neste clone; não altere nem consulte qualquer infraestrutura anterior.

Objetivo: deixar o dashboard completo em produção, com app Next.js na Vercel, Supabase, Workers Cloudflare (Hotmart consolidator, roteador A/B, quiz e NFS-e) e Google Tag Manager configurado conforme a documentação.

Regras inegociáveis:
1. Nunca versionar, imprimir ou enviar credenciais, tokens, certificados, domínios, IDs de conta, dados de clientes ou dumps de banco.
2. Criar contas, bancos D1, namespaces KV, projetos Supabase/Vercel e Workers próprios desta operação. Não reutilizar recursos existentes.
3. Guardar segredos exclusivamente nos provedores (Cloudflare Secrets e Vercel Environment Variables) e arquivos locais ignorados pelo Git.
4. Seguir docs/INSTALL.md, docs/GTM.md e docs/SECURITY.md, nesta ordem.
5. Configurar NFS-e primeiro em staging/homologação; não ativar produção sem uma emissão e um cancelamento de teste aprovados.
6. Não remover funcionalidades. Quando faltar uma informação externa, liste exatamente o que é necessário, onde cadastrar e por quê.

Execute o trabalho até concluir e entregue: URLs de produção, lista de recursos criados (sem IDs sensíveis), checklist de smoke tests aprovado, pendências externas e prova de que `npm run test` e `npm run security:scan` passaram. Não inclua valores secretos na resposta.
```
