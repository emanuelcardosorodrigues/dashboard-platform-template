# Segurança e privacidade

Este repositório é um template. Ele não deve receber qualquer dado de produção, segredo, domínio, ID de conta, certificado, dump de banco, log de webhook ou imagem de cliente.

- Use `.env.local` apenas localmente e Secrets no Cloudflare/Vercel/Supabase.
- Gere segredos novos por instalação: `openssl rand -hex 32`.
- Restrinja tokens Cloudflare, Meta, Google e Hotmart ao menor escopo necessário.
- Use ambiente de staging antes de produção, especialmente para NFS-e e webhooks.
- Revogue e rotacione qualquer segredo que tenha sido exposto em Git, logs ou chat.
- Rode `npm run security:scan` antes de cada push e mantenha o workflow Gitleaks ativo.
- Não anexe exportações de GTM, planilhas, certificados ou backups ao repositório.
