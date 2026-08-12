-- 0065 — Arquivar projeto (workspace) sem destruir dado.
--
-- Motivo: um cliente que sai da operação precisa sumir do switcher, mas apagar o
-- workspace faz CASCADE em TUDO (meta_ads, orgânico, criativos, credenciais…) e é
-- irreversível. `arquivado_at` some da UI e mantém o dado recuperável; o purge de
-- verdade vira uma decisão separada e explícita.
--
-- Aditiva/idempotente. Quem lista workspace filtra `arquivado_at is null`.
alter table public.workspaces add column if not exists arquivado_at timestamptz;

comment on column public.workspaces.arquivado_at is
  'Quando preenchido, o projeto some do switcher/lista (soft-delete). O dado continua no banco — purge é ação separada.';

create index if not exists idx_workspaces_ativos on public.workspaces (arquivado_at) where arquivado_at is null;
