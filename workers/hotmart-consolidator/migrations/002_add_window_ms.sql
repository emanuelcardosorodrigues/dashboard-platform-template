-- Janela de consolidação por produto: cada order agora carrega o seu próprio window_ms.
-- Default 180000 (3 min) cobre orders já existentes e produtos não listados em PRODUCT_CONFIG.
ALTER TABLE orders ADD COLUMN window_ms INTEGER NOT NULL DEFAULT 180000;
