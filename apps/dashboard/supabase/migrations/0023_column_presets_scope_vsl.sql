-- 0023_column_presets_scope_vsl.sql
-- Permite predefinições de seleção de VSL (scope='vsl') na tabela column_presets
-- (reuso do sistema de presets; payload = { ids: [player_id,...] }).
-- Aditivo: só estende o CHECK de scope.

ALTER TABLE column_presets
  DROP CONSTRAINT IF EXISTS column_presets_scope_check;

ALTER TABLE column_presets
  ADD CONSTRAINT column_presets_scope_check
  CHECK (scope IN ('criativos', 'campanhas', 'conjuntos', 'funil', 'clarity', 'vsl'));
