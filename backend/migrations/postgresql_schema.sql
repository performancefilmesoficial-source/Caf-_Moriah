-- =============================================================================
-- MORIAH CAFÉ PDV — Schema PostgreSQL com Clean Architecture
-- =============================================================================
-- Como usar:
--   1. Crie o banco: CREATE DATABASE moriahpdv;
--   2. Conecte: \c moriahpdv
--   3. Execute este script: \i postgresql_schema.sql
--
-- Diferenças em relação ao MySQL/SQLite:
--   - SERIAL ao invés de AUTO_INCREMENT
--   - TIMESTAMPTZ para timestamps com timezone
--   - NUMERIC(10,2) ao invés de REAL para valores monetários (evita imprecisão de float)
--   - Foreign Keys reais com ON DELETE constraints
--   - Índices para performance em queries frequentes
--   - Row Level Security (RLS) para isolamento de dados por role
-- =============================================================================

-- Extensões úteis
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- Para uuid_generate_v4() se necessário
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- Para busca textual (LIKE rápido)

-- =============================================================================
-- 1. PRODUTOS
-- =============================================================================
CREATE TABLE IF NOT EXISTS products (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    category      TEXT NOT NULL,
    cost          NUMERIC(10,2) NOT NULL DEFAULT 0,
    price         NUMERIC(10,2) NOT NULL DEFAULT 0,
    price_moido   NUMERIC(10,2) NOT NULL DEFAULT 0,   -- Preço versão pó/moído
    stock         INTEGER NOT NULL DEFAULT 0,
    min_stock     INTEGER NOT NULL DEFAULT 5,
    sku           TEXT NOT NULL,
    image_url     TEXT,                                -- Base64 data URL ou URL externa
    description   TEXT,
    weight_grams  INTEGER NOT NULL DEFAULT 250,
    sell_online   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de busca
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku       ON products(sku);
CREATE INDEX        IF NOT EXISTS idx_products_category  ON products(category);
CREATE INDEX        IF NOT EXISTS idx_products_sell_online ON products(sell_online) WHERE sell_online = TRUE;
CREATE INDEX        IF NOT EXISTS idx_products_low_stock ON products(stock) WHERE stock <= 5;
-- Índice de texto para busca por nome (usando pg_trgm)
CREATE INDEX        IF NOT EXISTS idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);

-- =============================================================================
-- 2. VENDAS
-- =============================================================================
CREATE TABLE IF NOT EXISTS sales (
    id                      SERIAL PRIMARY KEY,
    total                   NUMERIC(10,2) NOT NULL,
    method                  VARCHAR(100) NOT NULL,      -- "PIX", "Cartão de Crédito", "Dinheiro", "InfinitePay"
    origin                  VARCHAR(100) NOT NULL DEFAULT 'Fisico',  -- "Fisico" | "Online"
    status                  VARCHAR(100) NOT NULL DEFAULT 'Concluido',
    -- Integração Asaas
    payment_id              VARCHAR(255),
    -- Dados do cliente
    customer_name           VARCHAR(255),
    customer_email          VARCHAR(255),
    customer_phone          VARCHAR(20),
    customer_cpf            VARCHAR(20),
    -- Endereço de entrega
    customer_cep            VARCHAR(10),
    customer_address_number VARCHAR(50),
    customer_street         TEXT,
    customer_neighborhood   TEXT,
    customer_city           TEXT,
    customer_state          CHAR(2),                    -- UF: BA, SP, etc.
    customer_complement     TEXT,
    -- Frete
    shipping_cost           NUMERIC(10,2) NOT NULL DEFAULT 0,
    shipping_service        VARCHAR(100),               -- "PAC", "SEDEX", "Expressa Moriah", "RETIRADA"
    shipping_service_id     VARCHAR(100),               -- ID numérico do Melhor Envio
    tracking_code           VARCHAR(100),
    me_order_id             VARCHAR(100),               -- ID do pedido no Melhor Envio
    label_url               TEXT,                       -- URL do PDF da etiqueta
    -- Timestamps
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_sales_status     ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_payment_id ON sales(payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_origin     ON sales(origin);
CREATE INDEX IF NOT EXISTS idx_sales_pending    ON sales(status) WHERE status IN ('Pendente', 'Aguardando Pagamento');

-- =============================================================================
-- 3. ITENS DE VENDA (Foreign Keys reais)
-- =============================================================================
CREATE TABLE IF NOT EXISTS sale_items (
    id           SERIAL PRIMARY KEY,
    sale_id      INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,  -- null se produto for excluído
    product_name TEXT NOT NULL,     -- Snapshot do nome no momento da venda
    quantity     INTEGER NOT NULL CHECK (quantity > 0),
    price        NUMERIC(10,2) NOT NULL CHECK (price >= 0)
);

-- Índice para lookup de itens por venda (evita full scan)
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id    ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id) WHERE product_id IS NOT NULL;

-- =============================================================================
-- 4. CONFIGURAÇÕES DO SITE (CMS E-commerce)
-- =============================================================================
CREATE TABLE IF NOT EXISTS site_settings (
    id                SERIAL PRIMARY KEY,
    hero_title        TEXT,
    hero_subtitle     TEXT,
    hero_text         TEXT,
    hero_video        TEXT,             -- Base64 ou URL do vídeo
    hero_video_opacity TEXT,
    hero_text_align   TEXT DEFAULT 'center',
    about_title       TEXT,
    about_subtitle    TEXT,
    about_text_1      TEXT,
    about_text_2      TEXT,
    about_image       TEXT,             -- Base64 ou URL
    about_image_align TEXT DEFAULT 'left',
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Garantir que existe apenas 1 linha de configurações
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_settings_single ON site_settings((TRUE));

-- Seed inicial
INSERT INTO site_settings (hero_title)
VALUES ('O Café dos Seus Sonhos')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 5. USUÁRIOS DO PDV
-- =============================================================================
CREATE TABLE IF NOT EXISTS pdv_users (
    id                    SERIAL PRIMARY KEY,
    name                  VARCHAR(255) NOT NULL,
    username              VARCHAR(100) NOT NULL UNIQUE,
    password_hash         VARCHAR(255) NOT NULL,        -- Bcrypt hash
    role                  VARCHAR(50) NOT NULL DEFAULT 'operator',  -- "admin" | "operator"
    must_change_password  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pdv_users_username ON pdv_users(username);

-- =============================================================================
-- 6. ROW LEVEL SECURITY (RLS)
-- =============================================================================
-- RLS garante que queries feitas por roles sem privilégio não acessam dados
-- indevidos. Na prática, o backend usa 1 role (app_user) que tem acesso total.
-- Para ambientes multi-tenant ou com acesso direto ao DB, habilite estas policies.

-- Habilitar RLS nas tabelas sensíveis
ALTER TABLE pdv_users   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE products     ENABLE ROW LEVEL SECURITY;

-- Role da aplicação: acesso total
-- Crie com: CREATE ROLE app_user LOGIN PASSWORD 'senha_segura';
--           GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user;
--           GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Policy: app_user vê tudo
CREATE POLICY app_full_access ON pdv_users  USING (current_user = 'app_user' OR current_user = 'postgres');
CREATE POLICY app_full_access ON sales       USING (current_user = 'app_user' OR current_user = 'postgres');
CREATE POLICY app_full_access ON sale_items  USING (current_user = 'app_user' OR current_user = 'postgres');
CREATE POLICY app_full_access ON products    USING (current_user = 'app_user' OR current_user = 'postgres');

-- Policy pública: e-commerce só lê produtos online com estoque
-- (Para uso futuro se a API pública conectar direto ao PG)
CREATE POLICY ecommerce_read_products ON products
    FOR SELECT
    USING (sell_online = TRUE AND stock > 0);

-- =============================================================================
-- 7. FUNÇÃO: atualizar updated_at automaticamente
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 8. VIEWS ÚTEIS PARA O DASHBOARD
-- =============================================================================

-- Receita por dia (últimos 30 dias)
CREATE OR REPLACE VIEW v_revenue_by_day AS
SELECT
    DATE(created_at) AS day,
    SUM(total)       AS revenue,
    COUNT(*)         AS sale_count
FROM sales
WHERE status IN ('Pago', 'Etiqueta Gerada', 'Enviado', 'Concluído')
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY day DESC;

-- Produtos com estoque baixo
CREATE OR REPLACE VIEW v_low_stock AS
SELECT id, name, category, stock, min_stock
FROM products
WHERE stock <= min_stock
ORDER BY stock ASC;

-- Top 10 produtos mais vendidos
CREATE OR REPLACE VIEW v_top_products AS
SELECT
    p.id,
    p.name,
    p.category,
    SUM(si.quantity) AS total_sold,
    SUM(si.quantity * si.price) AS total_revenue
FROM sale_items si
JOIN products p ON si.product_id = p.id
JOIN sales s ON si.sale_id = s.id
WHERE s.status IN ('Pago', 'Etiqueta Gerada', 'Enviado', 'Concluído')
GROUP BY p.id, p.name, p.category
ORDER BY total_sold DESC
LIMIT 10;

-- =============================================================================
-- NOTAS DE MIGRAÇÃO DO MYSQL → POSTGRESQL
-- =============================================================================
-- Se você já tem dados em MySQL/SQLite, use este script de migração:
--
-- 1. Exporte do MySQL:
--    mysqldump --compatible=ansi --skip-extended-insert -t moriah products sales sale_items site_settings pdv_users > data.sql
--
-- 2. Adapte o dump com sed:
--    sed -i "s/\`/\"/g; s/NOW()/NOW()/g; s/AUTOINCREMENT/SERIAL/g" data.sql
--
-- 3. Importe no PostgreSQL:
--    psql -U app_user -d moriahpdv -f data.sql
--
-- Para usar PostgreSQL no backend:
--   npm install pg
--   DATABASE_URL=postgresql://app_user:senha@host:5432/moriahpdv
-- =============================================================================
