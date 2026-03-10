-- =============================================================================
-- MORIAH CAFÉ PDV — Otimização MySQL: Índices + Foreign Keys
-- =============================================================================
-- Execute no banco MySQL de produção para melhorar performance e integridade.
-- Todos os comandos são idempotentes (IF NOT EXISTS / IF EXISTS).
-- =============================================================================

-- ─── Índices de Performance ───────────────────────────────────────────────────

-- products: busca por categoria e vitrine online
ALTER TABLE products
    ADD INDEX IF NOT EXISTS idx_products_category   (category),
    ADD INDEX IF NOT EXISTS idx_products_sell_online (sell_online),
    ADD INDEX IF NOT EXISTS idx_products_sku         (sku(50)),
    ADD INDEX IF NOT EXISTS idx_products_stock       (stock);

-- sales: busca por status (dashboard), payment_id (webhook), data
ALTER TABLE sales
    ADD INDEX IF NOT EXISTS idx_sales_status      (status(50)),
    ADD INDEX IF NOT EXISTS idx_sales_payment_id  (payment_id(100)),
    ADD INDEX IF NOT EXISTS idx_sales_created_at  (created_at),
    ADD INDEX IF NOT EXISTS idx_sales_origin      (origin(50));

-- sale_items: lookup por venda (JOIN frequente)
ALTER TABLE sale_items
    ADD INDEX IF NOT EXISTS idx_sale_items_sale_id    (sale_id),
    ADD INDEX IF NOT EXISTS idx_sale_items_product_id (product_id);

-- pdv_users: login por username
ALTER TABLE pdv_users
    ADD INDEX IF NOT EXISTS idx_pdv_users_username (username(100));

-- ─── Foreign Keys (integridade referencial) ───────────────────────────────────
-- Atenção: para adicionar FK, não pode haver orphan rows.
-- Verifique antes: SELECT si.id FROM sale_items si LEFT JOIN sales s ON si.sale_id = s.id WHERE s.id IS NULL;

-- sale_items.sale_id → sales.id (cascade delete)
ALTER TABLE sale_items
    ADD CONSTRAINT IF NOT EXISTS fk_sale_items_sale
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;

-- sale_items.product_id → products.id (set null se produto excluído)
ALTER TABLE sale_items
    ADD CONSTRAINT IF NOT EXISTS fk_sale_items_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

-- ─── Charset UTF8MB4 (para emojis e caracteres especiais) ────────────────────
ALTER TABLE products     CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE sales         CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE sale_items    CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE site_settings CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE pdv_users     CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Colunas MEDIUMTEXT para imagens Base64 ──────────────────────────────────
ALTER TABLE products     MODIFY COLUMN image_url    MEDIUMTEXT;
ALTER TABLE site_settings MODIFY COLUMN hero_video  MEDIUMTEXT;
ALTER TABLE site_settings MODIFY COLUMN about_image MEDIUMTEXT;

-- ─── Verificação: orphan rows em sale_items ──────────────────────────────────
-- Execute para checar integridade antes de adicionar FKs:
-- SELECT COUNT(*) as orphan_sales    FROM sale_items si LEFT JOIN sales s    ON si.sale_id    = s.id    WHERE s.id IS NULL;
-- SELECT COUNT(*) as orphan_products FROM sale_items si LEFT JOIN products p ON si.product_id = p.id WHERE p.id IS NULL;
