-- 0029_workspace_credentials.sql — Onda 4: credenciais de integração por projeto,
-- CIFRADAS em repouso (AES-256-GCM, master key em CREDENTIALS_MASTER_KEY no app).
-- O service-role lê/escreve; nunca exposta ao cliente. provider ∈ meta/vturb/ga4/
-- clarity/hotmart/cloudflare/nfse. `meta` jsonb = dicas NÃO-secretas (ex: ga4
-- property_id, lista de account_ids) que não precisam cifrar.

CREATE TABLE IF NOT EXISTS workspace_credentials (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider     text NOT NULL CHECK (provider IN ('meta','vturb','ga4','clarity','hotmart','cloudflare','nfse')),
  ciphertext   text NOT NULL,
  iv           text NOT NULL,
  auth_tag     text NOT NULL,
  meta         jsonb DEFAULT '{}'::jsonb,
  updated_at   timestamptz DEFAULT now(),
  PRIMARY KEY (workspace_id, provider)
);

-- RLS: deny-all (só service-role acessa, que bypassa). Defesa em profundidade —
-- nenhuma role anon/authenticated jamais lê credenciais, nem cifradas.
ALTER TABLE workspace_credentials ENABLE ROW LEVEL SECURITY;
