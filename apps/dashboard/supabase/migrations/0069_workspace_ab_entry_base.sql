-- Link de entrada do Worker A/B, exclusivo por projeto.
-- Ex.: thiagomagalhaes.com.br/r. A rota /r é deliberadamente fixa: é o
-- prefixo removido pelo Worker antes de procurar o experimento.
alter table public.workspaces add column if not exists ab_entry_base text;

alter table public.workspaces
  drop constraint if exists workspaces_ab_entry_base_format;

alter table public.workspaces
  add constraint workspaces_ab_entry_base_format
  check (
    ab_entry_base is null
    or ab_entry_base ~ '^[a-z0-9.-]+/r$'
  );

create unique index if not exists workspaces_ab_entry_base_unique
  on public.workspaces (ab_entry_base)
  where ab_entry_base is not null;

comment on column public.workspaces.ab_entry_base is
  'Domínio e prefixo /r do Worker A/B deste projeto, sem protocolo.';
