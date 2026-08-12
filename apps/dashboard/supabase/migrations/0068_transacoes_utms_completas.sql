-- 0068_transacoes_utms_completas.sql — pacote de origem completo na transação.
--
-- MOTIVO: `transacoes` só guardava utm_source e utm_medium (último e primeiro).
-- O `parseSck` JÁ extraía utm_campaign (posição 3/10) e utm_content (4/11) do sck
-- que a Hotmart devolve — e o valor era descartado na gravação, por falta de
-- coluna. Não era limitação da origem: era coluna que nunca foi criada.
--
-- O QUE ENTRA:
--   · campaign / content / term / placement, em último e primeiro impacto;
--   · `sck_raw`: o sck exatamente como veio. Se o mapeamento de posições mudar
--     (ou estiver errado), dá pra reprocessar sem perder venda;
--   · `utms` jsonb: TODAS as posições por nome, incluindo as que ainda não têm
--     coluna dedicada (`pos5`, `pos12`, ...). É o que atende "criar novas quando
--     chegar uma não registrada" — parâmetro novo entra sem migration.
--
-- DUAS RESSALVAS HONESTAS:
--   · TERM: as posições 5 e 12 do sck nunca foram lidas. Pelo padrão UTM o slot
--     que sobra é o term, e é assim que passam a ser lidas — mas isso é inferência
--     do layout, não confirmação da tag do GTM. `utms`/`sck_raw` garantem que, se
--     for outra coisa, nada se perde e a leitura se corrige depois.
--   · PLACEMENT: NÃO vem no sck hoje. A coluna nasce vazia e só enche se a tag
--     passar a mandar `utm_placement`. Hoje o placement do Meta está chegando
--     DENTRO do utm_source ("Instagram_Feed", "Instagram_Stories"); o caminho
--     limpo é o breakdown publisher_platform/platform_position no sync do Meta,
--     que `meta_ads` também não tem ainda.
--
-- ADITIVA: colunas nulas não mudam nada do que já roda. O histórico fica vazio
-- (o dado foi descartado na época) — só é recuperável reprocessando a
-- sales/history da Hotmart, que devolve o sck completo das vendas antigas.

ALTER TABLE transacoes
  ADD COLUMN IF NOT EXISTS utm_campaign_ultimo    text,
  ADD COLUMN IF NOT EXISTS utm_content_ultimo     text,
  ADD COLUMN IF NOT EXISTS utm_term_ultimo        text,
  ADD COLUMN IF NOT EXISTS utm_placement_ultimo   text,
  ADD COLUMN IF NOT EXISTS utm_campaign_primeiro  text,
  ADD COLUMN IF NOT EXISTS utm_content_primeiro   text,
  ADD COLUMN IF NOT EXISTS utm_term_primeiro      text,
  ADD COLUMN IF NOT EXISTS utm_placement_primeiro text,
  ADD COLUMN IF NOT EXISTS sck_raw                text,
  ADD COLUMN IF NOT EXISTS utms                   jsonb;

-- Filtro por campanha é o uso esperado (e o que passa a resolver funil).
CREATE INDEX IF NOT EXISTS transacoes_ws_utm_campaign_idx
  ON transacoes (workspace_id, utm_campaign_ultimo);

-- Busca dentro do pacote inteiro (chave nova sem coluna dedicada).
CREATE INDEX IF NOT EXISTS transacoes_utms_gin_idx
  ON transacoes USING gin (utms);

-- Depois de algumas vendas novas, este SELECT responde o que há na posição 5:
--   SELECT utms->>'utm_term' AS term, utms->>'pos5' AS pos5_cru, count(*)
--   FROM transacoes WHERE utms IS NOT NULL GROUP BY 1,2 ORDER BY 3 DESC;
