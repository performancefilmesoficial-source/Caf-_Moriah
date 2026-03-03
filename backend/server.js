const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const multer = require('multer');
const csv = require('csv-parser');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

// Hash de senha com salt fixo (SHA-256) — sem dependências externas
function hashPwd(password) {
    return crypto.createHash('sha256').update(password + 'moriah_pdv_2024').digest('hex');
}

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = 'https://api.asaas.com/v3';

// Upload em memória - imagem vira Base64 e fica no banco (não depende de disco)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // máx 5MB
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Mantém compatibilidade com imagens antigas salvas em /uploads
app.use('/uploads', express.static('uploads'));

// Rota de Upload de Imagens — converte para Base64 e retorna como Data URL
// Assim a imagem fica salva no banco MySQL e nunca é perdida em deploys
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    }
    const mime = req.file.mimetype || 'image/jpeg';
    const base64 = req.file.buffer.toString('base64');
    const imageUrl = `data:${mime};base64,${base64}`;
    res.json({ imageUrl });
});

// Integração Simulação Gemini I.A. (Gerador de Produto)
app.post('/api/generate-ai', async (req, res) => {
    const { productName } = req.body;

    if (!productName) {
        return res.status(400).json({ error: 'Nome do produto não informado.' });
    }

    try {
        // Simulador MOCK da Resposta do Gemini focada em Vendas
        const mockSku = `MORIAH-${productName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
        const mockDescription = `Descubra a experiência sensorial única de provar o **${productName}**. 
Cultivado nas melhores fazendas e torrado artesanalmente para extrair notas surpreendentes. 
Ideal para seus momentos de pausa ou para impressionar depois de um bom almoço. 
Adquira já o seu e eleve o padrão do seu café diário.`;

        // Aqui vai o código oficial do GoogleGenAI no futuro, quando a KEY for conectada (req.env...)

        setTimeout(() => {
            res.json({ sku: mockSku, description: mockDescription });
        }, 1200); // Simulando delay do Robô \"Pensando...\"

    } catch (error) {
        console.error('Erro na IA:', error);
        res.status(500).json({ error: 'Falha ao conectar com o modelo de I.A.' });
    }
});

// Configuração Dinâmica de Banco de Dados (SQLite Local vs MySQL Cloud)
let dbUtil;
let sqliteDb;
let isMysql = !!process.env.DATABASE_URL;

async function setupDatabase() {
    if (isMysql) {
        const mysql = require('mysql2/promise');
        console.log('Conectando ao MySQL na nuvem...');

        // Parse do DATABASE_URL manualmente para garantir charset correto
        const pool = mysql.createPool({
            uri: process.env.DATABASE_URL,
            charset: 'utf8mb4',
            waitForConnections: true,
            connectionLimit: 10
        });

        dbUtil = {
            // Helper para limpar parâmetros undefined (causa erro fatal no mysql2)
            _clean: (params) => (Array.isArray(params) ? params.map(v => (v === undefined ? null : v)) : params),

            // query: para SELECT — usa pool.query (aceita prepared statements com arrays)
            query: async (sql, params = []) => {
                const [rows] = await pool.query(sql, dbUtil._clean(params));
                return [rows];
            },

            // run: para DML (INSERT/UPDATE/DELETE) — usa pool.execute (mais seguro para params)
            run: async (sql, params = []) => {
                const cleaned = dbUtil._clean(params);
                // DDL (CREATE TABLE, ALTER TABLE, MODIFY, etc.) usa pool.query pois pool.execute não suporta DDL
                const isDDL = /^\s*(CREATE|ALTER|DROP|TRUNCATE|RENAME)/i.test(sql);
                if (isDDL) {
                    const [result] = await pool.query(sql, cleaned);
                    return [{ insertId: result.insertId || 0, changes: result.affectedRows || 0 }];
                }
                const [result] = await pool.execute(sql, cleaned);
                return [{ insertId: result.insertId, changes: result.affectedRows }];
            },
            pool: pool
        };

        await initTables(dbUtil, true);
    } else {
        const sqlite3 = require('sqlite3').verbose();
        console.log('Conectando ao SQLite local...');
        sqliteDb = new sqlite3.Database('./moriahpdv.sqlite');

        dbUtil = {
            _clean: (params) => (Array.isArray(params) ? params.map(v => (v === undefined ? null : v)) : params),
            query: (sql, params = []) => new Promise((resolve, reject) => {
                sqliteDb.all(sql, dbUtil._clean(params), (err, rows) => {
                    if (err) reject(err);
                    else resolve([rows]);
                });
            }),
            run: (sql, params = []) => new Promise((resolve, reject) => {
                sqliteDb.run(sql, dbUtil._clean(params), function (err) {
                    if (err) reject(err);
                    else resolve([{ insertId: this.lastID, changes: this.changes }]);
                });
            }),
            db: sqliteDb
        };

        await initTables(dbUtil, false);
    }
}

async function initTables(dbUtil, isMysql) {
    const autoInc = isMysql ? 'AUTO_INCREMENT' : 'AUTOINCREMENT';

    console.log('[DB] Criando tabelas se não existirem...');

    await dbUtil.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY ${autoInc},
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        cost REAL NOT NULL,
        price REAL NOT NULL,
        price_moido REAL DEFAULT 0,
        stock INTEGER NOT NULL DEFAULT 0,
        minStock INTEGER NOT NULL DEFAULT 5,
        sku TEXT NOT NULL,
        image_url MEDIUMTEXT,
        description TEXT,
        weight_grams INTEGER DEFAULT 250,
        sell_online INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('[DB] Tabela products: OK');

    await dbUtil.run(`CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY ${autoInc},
        total REAL NOT NULL,
        method VARCHAR(100) NOT NULL,
        origin VARCHAR(100) DEFAULT 'Fisico',
        status VARCHAR(100) DEFAULT 'Concluido',
        payment_id VARCHAR(255),
        customer_phone VARCHAR(20),
        customer_name VARCHAR(255),
        customer_email VARCHAR(255),
        customer_cpf VARCHAR(20),
        customer_cep VARCHAR(10),
        customer_address_number VARCHAR(50),
        shipping_cost REAL DEFAULT 0,
        shipping_service VARCHAR(100),
        tracking_code VARCHAR(100),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('[DB] Tabela sales: OK');

    // Adiciona colunas a bancos já existentes (falha silenciosa se já existirem)
    const salesColumns = [
        'origin TEXT DEFAULT "Fisico"', 'status TEXT DEFAULT "Concluido"', 'payment_id TEXT',
        'customer_phone TEXT', 'customer_name TEXT', 'customer_email TEXT', 'customer_cpf TEXT',
        'customer_cep TEXT', 'customer_address_number TEXT', 'customer_street TEXT',
        'customer_neighborhood TEXT', 'customer_city TEXT', 'customer_state TEXT',
        'customer_complement TEXT', 'shipping_cost REAL DEFAULT 0', 'shipping_service TEXT',
        'shipping_service_id TEXT', 'tracking_code TEXT', 'me_order_id TEXT', 'label_url TEXT'
    ];
    for (const colDef of salesColumns) {
        try { await dbUtil.run(`ALTER TABLE sales ADD COLUMN ${colDef}`); } catch (e) { }
    }
    try { await dbUtil.run('ALTER TABLE products ADD COLUMN price_moido REAL DEFAULT 0'); } catch (e) { }
    // MODIFY COLUMN é sintaxe MySQL — só executa quando conectado ao MySQL
    if (isMysql) { try { await dbUtil.run('ALTER TABLE products MODIFY COLUMN image_url MEDIUMTEXT'); } catch (e) { } }

    await dbUtil.run(`CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY ${autoInc},
        sale_id INTEGER,
        product_id INTEGER,
        product_name TEXT,
        quantity INTEGER,
        price REAL
    )`);
    console.log('[DB] Tabela sale_items: OK');

    await dbUtil.run(`CREATE TABLE IF NOT EXISTS site_settings (
        id INTEGER PRIMARY KEY ${autoInc},
        hero_title TEXT,
        hero_subtitle TEXT,
        hero_text TEXT,
        hero_video MEDIUMTEXT,
        hero_video_opacity TEXT,
        hero_text_align TEXT,
        about_title TEXT,
        about_subtitle TEXT,
        about_text_1 TEXT,
        about_text_2 TEXT,
        about_image MEDIUMTEXT,
        about_image_align TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Migrations para bancos já existentes (falha silenciosa se coluna já existir)
    try { await dbUtil.run('ALTER TABLE site_settings ADD COLUMN hero_video_opacity TEXT'); } catch (e) { }
    try { await dbUtil.run('ALTER TABLE site_settings ADD COLUMN hero_text_align TEXT'); } catch (e) { }
    try { await dbUtil.run('ALTER TABLE site_settings ADD COLUMN about_image_align TEXT'); } catch (e) { }
    // Ampliar colunas para MEDIUMTEXT no MySQL (suporta Base64 de imagens/vídeos até ~16MB)
    if (isMysql) {
        try { await dbUtil.run('ALTER TABLE site_settings MODIFY COLUMN hero_video MEDIUMTEXT'); } catch (e) { }
        try { await dbUtil.run('ALTER TABLE site_settings MODIFY COLUMN about_image MEDIUMTEXT'); } catch (e) { }
    }
    console.log('[DB] Tabela site_settings: OK');

    const [rows] = await dbUtil.query("SELECT COUNT(*) as count FROM site_settings");
    if (rows[0].count === 0) {
        await dbUtil.run("INSERT INTO site_settings (hero_title) VALUES ('O Cafe dos Seus Sonhos')");
    }

    // Tabela de usuários do PDV (login compartilhado entre dispositivos)
    // VARCHAR obrigatório no MySQL: TEXT com UNIQUE causa erro "key without key length"
    try {
        await dbUtil.run(`CREATE TABLE IF NOT EXISTS pdv_users (
            id INTEGER PRIMARY KEY ${autoInc},
            name VARCHAR(255) NOT NULL,
            username VARCHAR(100) NOT NULL UNIQUE,
            password_hash VARCHAR(64) NOT NULL,
            role VARCHAR(50) DEFAULT 'operator',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    } catch (e) {
        console.error('[DB] ERRO ao criar pdv_users:', e.message);
    }
    // Cria admin padrão se não existir nenhum usuário
    const [uRows] = await dbUtil.query('SELECT COUNT(*) as count FROM pdv_users');
    if (uRows[0].count === 0) {
        await dbUtil.run('INSERT INTO pdv_users (name, username, password_hash, role) VALUES (?, ?, ?, ?)',
            ['Administrador', 'admin', hashPwd('root'), 'admin']);
        console.log('[DB] Usuário padrão criado: admin / root');
    }
    console.log('[DB] Tabela pdv_users: OK');
    console.log('[DB] Inicializacao concluida com sucesso!');
}

// Inicializa os bancos antes das rotas
setupDatabase().catch(console.error);

// ==========================================
// ROTAS DA API
// ==========================================


// Rota de Teste para verificar se a API está online
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Moriah PDV Backend funcionando!' });
});

// ==== AUTH / USUÁRIOS PDV ====

// Login — valida credenciais e retorna dados do usuário (sem senha)
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuário e senha obrigatórios.' });
    try {
        const [rows] = await dbUtil.query('SELECT * FROM pdv_users WHERE username = ?', [username]);
        if (!rows.length || rows[0].password_hash !== hashPwd(password)) {
            return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
        }
        const u = rows[0];
        res.json({ id: u.id, name: u.name, username: u.username, role: u.role });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Listar usuários (sem senha)
app.get('/api/users', async (req, res) => {
    try {
        const [rows] = await dbUtil.query('SELECT id, name, username, role, created_at FROM pdv_users ORDER BY id');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Criar usuário
app.post('/api/users', async (req, res) => {
    const { name, username, password, role } = req.body;
    if (!name || !username || !password) return res.status(400).json({ error: 'Nome, usuário e senha são obrigatórios.' });
    try {
        await dbUtil.run('INSERT INTO pdv_users (name, username, password_hash, role) VALUES (?, ?, ?, ?)',
            [name, username, hashPwd(password), role || 'operator']);
        res.json({ success: true });
    } catch (err) {
        const isDup = err.message.includes('UNIQUE') || err.message.includes('Duplicate');
        res.status(isDup ? 400 : 500).json({ error: isDup ? 'Este usuário já existe.' : err.message });
    }
});

// Excluir usuário
app.delete('/api/users/:id', async (req, res) => {
    try {
        await dbUtil.run('DELETE FROM pdv_users WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Alterar senha
app.put('/api/users/:id/password', async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Nova senha obrigatória.' });
    try {
        await dbUtil.run('UPDATE pdv_users SET password_hash = ? WHERE id = ?', [hashPwd(password), req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- PRODUTOS ----

// 1. Listar todos os produtos (Painel Admin PDV)
app.get('/api/products', async (req, res) => {
    try {
        const [rows] = await dbUtil.query('SELECT * FROM products ORDER BY name ASC');
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar produtos' });
    }
});

// 1.1 Listar APENAS produtos marcados para venda online (Vitrine Ecommerce)
app.get('/api/products/online', async (req, res) => {
    try {
        const [rows] = await dbUtil.query('SELECT * FROM products WHERE sell_online = 1 AND stock > 0 ORDER BY name ASC');
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar produtos online' });
    }
});

// 2. Adicionar um novo produto
app.post('/api/products', async (req, res) => {
    const { name, category, cost, price, price_moido, stock, minStock, sku, image_url, description, weight_grams, sell_online } = req.body;
    try {
        const result = await dbUtil.run(
            'INSERT INTO products (name, category, cost, price, price_moido, stock, minStock, sku, image_url, description, weight_grams, sell_online) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [name, category, cost, price, price_moido || 0, stock, minStock, sku, image_url, description, weight_grams, sell_online]
        );
        res.status(201).json({ id: result[0].insertId, message: 'Produto cadastrado com sucesso!' });
    } catch (error) {
        // Se falhou por causa do price_moido (coluna ainda nao existe), tenta sem ele
        if (error.code === 'ER_BAD_FIELD_ERROR' && error.message && error.message.includes('price_moido')) {
            try {
                const result = await dbUtil.run(
                    'INSERT INTO products (name, category, cost, price, stock, minStock, sku, image_url, description, weight_grams, sell_online) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [name, category, cost, price, stock, minStock, sku, image_url, description, weight_grams, sell_online]
                );
                return res.status(201).json({ id: result[0].insertId, message: 'Produto cadastrado com sucesso!' });
            } catch (e2) {
                console.error(e2);
                return res.status(500).json({ error: 'Erro ao criar produto' });
            }
        }
        console.error(error);
        res.status(500).json({ error: 'Erro ao criar produto' });
    }
});

// 3. Atualizar um produto
app.put('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    const { name, category, cost, price, price_moido, stock, minStock, sku, image_url, description, weight_grams, sell_online } = req.body;
    try {
        // UPDATE principal sem price_moido para garantir compatibilidade com banco existente
        await dbUtil.run(
            'UPDATE products SET name=?, category=?, cost=?, price=?, stock=?, minStock=?, sku=?, image_url=?, description=?, weight_grams=?, sell_online=? WHERE id=?',
            [name, category, cost, price, stock, minStock, sku, image_url, description, weight_grams, sell_online, id]
        );
        // Tenta atualizar price_moido separadamente (falha silenciosa se coluna nao existir ainda)
        if (price_moido !== undefined) {
            try {
                await dbUtil.run('UPDATE products SET price_moido=? WHERE id=?', [price_moido || 0, id]);
            } catch (e) { /* coluna pode ainda nao existir */ }
        }
        res.json({ message: 'Produto atualizado com sucesso!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao atualizar produto' });
    }
});

// 4. Excluir um produto
app.delete('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await dbUtil.run('DELETE FROM products WHERE id=?', [id]);
        res.json({ message: 'Produto excluído com sucesso!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao excluir produto' });
    }
});

// 5. Importar produtos via CSV (Nuvemshop)
app.post('/api/products/import', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    try {
        // multer usa memoryStorage — arquivo fica em req.file.buffer (sem path em disco)
        const { Readable } = require('stream');
        const results = [];
        const separator = ';'; // Padrão Nuvemshop

        await new Promise((resolve, reject) => {
            Readable.from(req.file.buffer)
                .pipe(csv({ separator, mapHeaders: ({ header }) => header.trim() }))
                .on('data', (data) => results.push(data))
                .on('end', resolve)
                .on('error', reject);
        });

        let insertedCount = 0;

        for (const row of results) {
            const getVal = (possibleNames) => {
                const key = Object.keys(row).find(k => possibleNames.some(p => k.toLowerCase().includes(p)));
                return key ? row[key] : null;
            };

            const name = getVal(['nome', 'name', 'produto']);
            if (!name) continue; // Ignora linha sem nome (pode ser linha vazia)

            const sku = getVal(['sku', 'código', 'cdigo']) || `IMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const cost = parseFloat(String(getVal(['custo', 'cost']) || '0').replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
            const price = parseFloat(String(getVal(['preço', 'price', 'valor', 'preo']) || '0').replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
            const stock = parseInt(getVal(['estoque', 'stock', 'quantidade']) || '0', 10);
            const category = getVal(['categoria', 'category']) || 'Importado';
            const image_url = getVal(['imagem', 'image', 'url', 'foto']) || '';
            const description = getVal(['descrição', 'description', 'detalhes', 'descrio']) || '';
            const weight_kg = parseFloat(String(getVal(['peso', 'weight']) || '0').replace(',', '.'));
            const weight_grams = Math.round(weight_kg * 1000) || 250;

            await dbUtil.run(
                'INSERT INTO products (name, category, cost, price, stock, minStock, sku, image_url, description, weight_grams, sell_online) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [name, category, cost, price, stock, 5, sku, image_url, description, weight_grams, 1]
            );
            insertedCount++;
        }

        res.status(200).json({ message: `Sucesso! ${insertedCount} produtos importados da planilha.`, count: insertedCount });
    } catch (err) {
        console.error('Erro na importação de CSV:', err);
        res.status(500).json({ error: 'Erro ao processar e salvar importação no banco de dados.' });
    }
});

// ---- CONFIGURAÇÕES DO SITE (CMS E-COMMERCE) ----

// 1. Obter configurações atuais
app.get('/api/site-settings', async (req, res) => {
    try {
        const [rows] = await dbUtil.query('SELECT * FROM site_settings LIMIT 1');
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.json({});
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar configurações do site' });
    }
});

// 2. Atualizar configurações
app.put('/api/site-settings', upload.fields([{ name: 'hero_video_file', maxCount: 1 }, { name: 'about_image_file', maxCount: 1 }]), async (req, res) => {
    const { hero_title, hero_subtitle, hero_text, hero_video_opacity, hero_text_align, about_title, about_subtitle, about_text_1, about_text_2, about_image_align } = req.body;
    let { hero_video, about_image } = req.body;

    // Se vieram arquivos, converte para Base64 (multer usa memoryStorage — sem path em disco)
    if (req.files) {
        if (req.files['hero_video_file'] && req.files['hero_video_file'][0]) {
            const file = req.files['hero_video_file'][0];
            hero_video = `data:${file.mimetype || 'video/mp4'};base64,${file.buffer.toString('base64')}`;
        }
        if (req.files['about_image_file'] && req.files['about_image_file'][0]) {
            const file = req.files['about_image_file'][0];
            about_image = `data:${file.mimetype || 'image/jpeg'};base64,${file.buffer.toString('base64')}`;
        }
    }

    try {
        // Busca o ID primeiro para evitar restrição do MySQL:
        // "You can't specify target table for update in FROM clause"
        const [settingsRows] = await dbUtil.query('SELECT id FROM site_settings LIMIT 1');
        const settingsId = settingsRows.length ? settingsRows[0].id : 1;

        await dbUtil.run(
            `UPDATE site_settings SET
                hero_title=?, hero_subtitle=?, hero_text=?, hero_video=?, hero_video_opacity=?, hero_text_align=?,
                about_title=?, about_subtitle=?, about_text_1=?, about_text_2=?, about_image=?, about_image_align=?,
                updated_at=CURRENT_TIMESTAMP
             WHERE id = ?`,
            [hero_title, hero_subtitle, hero_text, hero_video, hero_video_opacity, hero_text_align, about_title, about_subtitle, about_text_1, about_text_2, about_image, about_image_align, settingsId]
        );
        res.json({ message: 'Configurações atualizadas com sucesso!', hero_video, about_image });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao atualizar configurações' });
    }
});

// ---- VENDAS ----

// 1. Listar vendas
app.get('/api/sales', async (req, res) => {
    try {
        const [sales] = await dbUtil.query('SELECT * FROM sales ORDER BY created_at DESC LIMIT 100');

        if (sales.length > 0) {
            // Busca todos os itens em 1 query (evita N+1).
            // LEFT JOIN garante que itens de produtos excluídos ainda aparecem (usa product_name salvo).
            const placeholders = sales.map(() => '?').join(',');
            const saleIds = sales.map(s => s.id);
            const [allItems] = await dbUtil.query(
                `SELECT si.*, COALESCE(p.name, si.product_name) as name FROM sale_items si LEFT JOIN products p ON si.product_id = p.id WHERE si.sale_id IN (${placeholders})`,
                saleIds
            );
            const itemsBySaleId = {};
            for (const item of allItems) {
                if (!itemsBySaleId[item.sale_id]) itemsBySaleId[item.sale_id] = [];
                itemsBySaleId[item.sale_id].push(item);
            }
            for (const sale of sales) {
                sale.items = itemsBySaleId[sale.id] || [];
            }
        }

        res.json(sales);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar vendas' });
    }
});

// 2. Finalizar uma venda
app.post('/api/sales', async (req, res) => {
    const { seller, items, subtotal, discount, total, method, origin, customer_phone } = req.body;
    try {
        // Salva a venda principal
        const result = await dbUtil.run(
            'INSERT INTO sales (total, method, origin, status, customer_phone, payment_id) VALUES (?, ?, ?, ?, ?, ?)',
            [total, method, origin || 'Físico', 'Concluído', customer_phone, null]
        );
        const saleId = result[0].insertId;

        // Salva os itens e baixa o estoque
        for (const item of items) {
            // Extrai ID numérico (pode vir como "123-grao" ou número simples)
            const productId = parseInt(String(item.id).split('-')[0]);
            await dbUtil.run(
                'INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)',
                [saleId, productId, item.name, item.quantity, item.price]
            );
            await dbUtil.run(
                'UPDATE products SET stock = stock - ? WHERE id = ?',
                [item.quantity, productId]
            );
        }

        res.status(201).json({ id: saleId, message: 'Venda finalizada com sucesso!' });
    } catch (error) {
        console.error('[/api/sales] Erro:', error);
        res.status(500).json({ error: 'Erro ao finalizar venda: ' + error.message });
    }
});

// /api/login removido — use /api/auth/login (autenticação via banco de dados)

// ==== E-COMMERCE: E-MAILS TRANSACIONAIS ====
// Configuração do Transportador de Email (Exemplo genérico)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com', // Substituir pelo configurado pelo usuario
    port: process.env.SMTP_PORT || 587,
    secure: false, // true para port 465, false para outras
    auth: {
        user: process.env.SMTP_USER || 'seuemail@moriahcafe.com.br',
        pass: process.env.SMTP_PASS || 'suasenha',
    },
});

// Notifica o cliente via WhatsApp quando etiqueta/rastreio é gerado
async function notifyCustomerTracking(sale, trackingCode) {
    const token = process.env.META_WHATSAPP_TOKEN;
    const phoneId = process.env.META_PHONE_NUMBER_ID;
    if (!token || !phoneId) return;
    let phone = (sale.customer_phone || '').replace(/\D/g, '');
    if (!phone) return;
    if (!phone.startsWith('55')) phone = '55' + phone;
    const trackUrl = `https://rastreamento.correios.com.br/app/index.php?label=${trackingCode}`;
    const msg = [
        `☕ *Moriah Café — Seu pedido foi enviado!*`,
        ``,
        `Olá ${sale.customer_name || 'Cliente'}! Seu pedido está a caminho. 📦`,
        ``,
        `🔍 *Código de rastreio:* ${trackingCode}`,
        `🌐 Rastreie em: ${trackUrl}`,
        ``,
        `Qualquer dúvida, fale conosco. Bom café! ☕`
    ].join('\n');
    axios.post(
        `https://graph.facebook.com/v19.0/${phoneId}/messages`,
        { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: msg } },
        { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
    ).catch(err => console.error('[WA META] Erro ao notificar cliente rastreio:', err.response?.data || err.message));
}

// Notifica o dono via WhatsApp Cloud API (Meta)
// Env vars necessárias: META_WHATSAPP_TOKEN, META_PHONE_NUMBER_ID, OWNER_PHONE (ex: 5575999999999)
function notifyOwnerNewOrder({ customerName, customerPhone, customerCep, totalAmount, billingType, shippingService, shippingCost, cartItems }) {
    const token = process.env.META_WHATSAPP_TOKEN;
    const phoneId = process.env.META_PHONE_NUMBER_ID;
    const ownerPhone = process.env.OWNER_PHONE;
    if (!token || !phoneId || !ownerPhone) return;

    const shippingLabel = shippingService === 'RETIRADA' ? 'Retirada na Loja' :
        (shippingService && shippingService.includes('Expressa')) ? 'Expressa Moriah (Feira)' :
            (shippingService && shippingService.includes('Padrão Feira')) ? 'Padrão Feira de Santana' :
                `Correios - ${shippingService || 'A definir'}`;
    const shippingCostLabel = parseFloat(shippingCost) > 0
        ? `R$ ${parseFloat(shippingCost).toFixed(2).replace('.', ',')}`
        : 'GRÁTIS';
    const paymentLabel = billingType === 'CREDIT_CARD' ? 'Cartão de Crédito' : 'PIX';
    const itemsList = (cartItems || []).map(i => `  • ${i.name} x${i.quantity}`).join('\n');

    const msg = [
        '☕ *Novo Pedido - Moriah Café*',
        `👤 Cliente: ${customerName}`,
        `📞 Tel: ${customerPhone || 'não informado'}`,
        `📮 CEP: ${customerCep || 'não informado'}`,
        `💰 Total: R$ ${parseFloat(totalAmount).toFixed(2).replace('.', ',')}`,
        `💳 Pagamento: ${paymentLabel}`,
        `🚚 Entrega: ${shippingLabel} — ${shippingCostLabel}`,
        `📦 Itens:\n${itemsList}`,
        `\nAcesse o PDV para acompanhar.`
    ].join('\n');

    axios.post(
        `https://graph.facebook.com/v19.0/${phoneId}/messages`,
        {
            messaging_product: 'whatsapp',
            to: ownerPhone,
            type: 'text',
            text: { body: msg }
        },
        { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
    ).catch(err => console.error('[WA META] Erro ao enviar notificação:', err.response?.data || err.message));
}

app.post('/api/checkout', async (req, res) => {
    const { customerName, customerEmail, customerCpf, customerPhone, customerCep, customerAddressNumber, customerStreet, customerNeighborhood, customerCity, customerState, customerComplement, cartItems, totalAmount, billingType, cardData } = req.body;
    const shippingServiceId = req.body.shippingServiceId || null;

    // Validar estoque antes de qualquer processamento de pagamento
    try {
        for (const item of cartItems) {
            const [rows] = await dbUtil.query('SELECT stock, name FROM products WHERE id = ?', [item.id]);
            if (!rows.length) return res.status(400).json({ success: false, error: `Produto não encontrado: ${item.name}` });
            if (rows[0].stock < item.quantity) {
                return res.status(400).json({ success: false, error: `"${rows[0].name}" sem estoque suficiente. Disponível: ${rows[0].stock} unidade(s).` });
            }
        }
    } catch (stockErr) {
        console.error('[CHECKOUT] Erro ao validar estoque:', stockErr);
        return res.status(500).json({ success: false, error: 'Erro ao verificar disponibilidade dos produtos.' });
    }

    // SE NÃO HÁ API KEY DO ASAAS configurada, simula um checkout manual (loja registra o pedido e notifica via email)
    if (!ASAAS_API_KEY) {
        console.log('[CHECKOUT] ASAAS_API_KEY não configurada. Registrando pedido manualmente.');
        try {
            const fakePaymentId = `MANUAL-${Date.now()}`;
            const result = await dbUtil.run(
                'INSERT INTO sales (total, method, origin, status, customer_phone, payment_id, customer_name, customer_email, customer_cpf, customer_cep, customer_address_number, customer_street, customer_neighborhood, customer_city, customer_state, customer_complement, shipping_cost, shipping_service, shipping_service_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [totalAmount, billingType === 'CREDIT_CARD' ? 'Cartão de Crédito' : 'PIX', 'Online', 'Aguardando Pagamento', customerPhone, fakePaymentId, customerName, customerEmail, customerCpf, customerCep, customerAddressNumber || '', customerStreet || '', customerNeighborhood || '', customerCity || '', customerState || '', customerComplement || '', req.body.shippingCost || 0, req.body.shippingService || 'CORREIOS', shippingServiceId]
            );
            const saleId = result[0].insertId;
            for (const item of cartItems) {
                await dbUtil.run('INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)',
                    [saleId, item.id, item.name, item.quantity, item.price]);
                await dbUtil.run('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.id]);
            }
            // Notificar dono da loja sobre o novo pedido manual
            notifyOwnerNewOrder({ customerName, customerPhone, customerEmail, customerCep: customerCep || '', totalAmount, billingType, shippingService: req.body.shippingService, shippingCost: req.body.shippingCost, cartItems, invoiceUrl: null });
            // PIX simulado para o cliente finalizar
            const pixPayload = `00020126360014BR.GOV.BCB.PIX0114+5575992073245520400005303986540${totalAmount.toFixed(2)}5802BR5912MORIAH CAFE6009SAO PAULO62070503***6304ABCD`;
            return res.status(200).json({
                success: true,
                sale_id: fakePaymentId,
                pixPayload: pixPayload,
                encodedImage: null, // Sem QR code dinâmico sem API
                invoiceUrl: 'https://wa.me/5575992073245?text=Olá%2C%20fiz%20um%20pedido%20no%20site%20e%20quero%20pagar',
                note: 'Pedido registrado manualmente. Entre em contato via WhatsApp para confirmar o pagamento.'
            });
        } catch (dbErr) {
            console.error('[CHECKOUT MANUAL] Erro ao salvar:', dbErr);
            return res.status(500).json({ success: false, error: 'Erro ao registrar pedido manual.' });
        }
    }

    try {
        console.log("Iniciando requisição de checkout remoto - Asaas API...");

        // 1. Criar o Cliente no Asaas
        const customerResponse = await axios.post(`${ASAAS_URL}/customers`, {
            name: customerName,
            email: customerEmail,
            cpfCnpj: customerCpf || '',
            phone: customerPhone || ''
        }, {
            headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' }
        });

        const customerId = customerResponse.data.id;

        // 2. Montar Cobrança Asaas
        const paymentPayload = {
            customer: customerId,
            billingType: billingType || 'PIX',
            dueDate: new Date().toISOString().split('T')[0],
            value: totalAmount,
            description: 'Pedido E-commerce Moriah Café'
        };

        // Regras para Cartão de Crédito exigem Card Info
        if (billingType === 'CREDIT_CARD') {
            paymentPayload.creditCard = {
                holderName: cardData.holderName,
                number: cardData.number,
                expiryMonth: cardData.expiryMonth.padStart(2, '0'),
                expiryYear: cardData.expiryYear,
                ccv: cardData.ccv
            };
            paymentPayload.creditCardHolderInfo = {
                name: customerName,
                email: customerEmail,
                cpfCnpj: customerCpf,
                postalCode: customerCep,
                addressNumber: customerAddressNumber,
                phone: customerPhone
            };
            // Extrai IP real (IPv4) — Asaas rejeita IPv6 (::1) e IPs locais
            const rawIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
                || req.headers['x-real-ip']
                || req.socket.remoteAddress
                || '189.6.0.1';
            // Converte ::ffff:x.x.x.x (IPv4-mapped IPv6) para IPv4 puro
            const cleanIp = rawIp.replace(/^::ffff:/, '');
            // Se ainda for um endereço IPv6 ou localhost, usa um IP público válido de fallback
            const isValidIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(cleanIp) && cleanIp !== '127.0.0.1';
            paymentPayload.remoteIp = isValidIpv4 ? cleanIp : '189.6.0.1';
        }

        // Criar Pagamento
        const paymentResponse = await axios.post(`${ASAAS_URL}/payments`, paymentPayload, {
            headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' }
        });

        const paymentId = paymentResponse.data.id;
        const invoiceUrl = paymentResponse.data.invoiceUrl;
        let pixPayload = null;
        let encodedImage = null;

        // 3. Obter QR Code do PIX APENAS SE FOR PIX
        if (billingType === 'PIX') {
            const qrCodeResponse = await axios.get(`${ASAAS_URL}/payments/${paymentId}/pixQrCode`, {
                headers: { 'access_token': ASAAS_API_KEY }
            });
            pixPayload = qrCodeResponse.data.payload;
            encodedImage = qrCodeResponse.data.encodedImage;
        }

        // 4. Salvar venda no Banco de Dados ANTES de responder ao cliente
        // (se salvar depois e o banco falhar, o cliente pagou mas a venda não existe no PDV)
        try {
            await dbUtil.run(process.env.DATABASE_URL ? 'START TRANSACTION' : 'BEGIN TRANSACTION');
            const statusInicial = billingType === 'CREDIT_CARD' ? 'Pago' : 'Pendente';
            const result = await dbUtil.run(
                'INSERT INTO sales (total, method, origin, status, customer_phone, payment_id, customer_name, customer_email, customer_cpf, customer_cep, customer_address_number, customer_street, customer_neighborhood, customer_city, customer_state, customer_complement, shipping_cost, shipping_service, shipping_service_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [totalAmount, billingType === 'CREDIT_CARD' ? 'Cartão de Crédito' : 'PIX', 'Online', statusInicial, customerPhone, paymentId, customerName, customerEmail, customerCpf, customerCep, customerAddressNumber || '', customerStreet || '', customerNeighborhood || '', customerCity || '', customerState || '', customerComplement || '', req.body.shippingCost || 0, req.body.shippingService || 'CORREIOS', shippingServiceId]
            );
            const saleId = result[0].insertId;
            for (const item of cartItems) {
                await dbUtil.run('INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)',
                    [saleId, item.id, item.name, item.quantity, item.price]);
                await dbUtil.run('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.id]);
            }
            await dbUtil.run('COMMIT');
        } catch (dbErr) {
            await dbUtil.run('ROLLBACK').catch(() => { });
            console.error("Erro ao salvar venda no banco após pagamento aprovado:", dbErr);
            // Pagamento foi aprovado mas não salvou — loga para investigação manual
        }

        // Enviar e-mail de confirmação ao cliente (fire-and-forget)
        if (process.env.SMTP_USER) {
            const mailOptions = {
                from: '"Moriah Café Especial" <atendimento@moriahcafe.com>',
                to: customerEmail,
                subject: 'Sua compra no Moriah Café! ☕',
                html: `<p>Olá ${customerName}, sua compra de R$ ${totalAmount} foi registrada no nosso sistema!</p><br><p><a href="${invoiceUrl}">Acessar Fatura ${billingType}</a></p>`
            };
            transporter.sendMail(mailOptions).catch(() => { });
        }
        // Notificar dono da loja sobre o novo pedido
        notifyOwnerNewOrder({ customerName, customerPhone, customerEmail, customerCep, totalAmount, billingType, shippingService: req.body.shippingService, shippingCost: req.body.shippingCost, cartItems, invoiceUrl });

        res.status(200).json({
            success: true,
            sale_id: paymentId,
            pixPayload: pixPayload,
            encodedImage: encodedImage,
            invoiceUrl: invoiceUrl
        });

    } catch (error) {
        const asaasData = error.response?.data;
        console.error('Erro no checkout / Asaas:', asaasData || error.message);

        // Extrai mensagem amigável dos erros do Asaas
        let friendlyError = 'Erro ao processar pagamento. Verifique seus dados e tente novamente.';
        if (asaasData) {
            if (asaasData.errors && Array.isArray(asaasData.errors) && asaasData.errors.length > 0) {
                const msgs = asaasData.errors.map(e => e.description || e.code || JSON.stringify(e));
                friendlyError = msgs.join(' | ');
            } else if (asaasData.description) {
                friendlyError = asaasData.description;
            } else {
                friendlyError = JSON.stringify(asaasData);
            }
        } else if (error.message) {
            friendlyError = error.message;
        }
        res.status(500).json({ success: false, error: friendlyError, raw: asaasData || null });
    }
});

// ==== LOGÍSTICA / MELHOR ENVIO ====
const MELHORENVIO_TOKEN = process.env.MELHORENVIO_TOKEN;
const ORIGIN_CEP = '44002622';

// Verifica se o CEP pertence a Feira de Santana (44000-000 a 44149-999)
function isFeiraDeSantanaCep(cep) {
    const num = parseInt(String(cep).replace(/\D/g, ''), 10);
    return num >= 44000000 && num <= 44149999;
}

app.post('/api/shipping/calculate', async (req, res) => {
    const { destinationCep, cartItems } = req.body;

    if (!destinationCep || destinationCep.length < 8) {
        return res.status(400).json({ error: 'CEP Inválido' });
    }

    // CEP de Feira de Santana → opções de entrega local
    if (isFeiraDeSantanaCep(destinationCep)) {
        const cartTotal = (cartItems || []).reduce((acc, item) => acc + (parseFloat(item.price) * item.quantity), 0);
        const padraoGratis = cartTotal >= 100;
        return res.json({
            success: true,
            localDelivery: true,
            services: [
                {
                    id: 'feira-expressa',
                    name: 'Expressa Moriah ☕',
                    price: '12.00',
                    delivery_time: 'Até 2 horas',
                    local: true
                },
                {
                    id: 'feira-padrao',
                    name: 'Entrega Padrão Feira',
                    price: padraoGratis ? '0.00' : '7.00',
                    delivery_time: 'Até 24h úteis',
                    local: true,
                    free: padraoGratis
                }
            ]
        });
    }

    try {
        console.log('Calculando Frete Melhor Envios...');

        let totalWeight = 0;
        cartItems.forEach(item => { totalWeight += ((item.weight_grams || 250) * item.quantity); });

        // parseFloat garante número (toFixed retorna string, causaria bug na API do Melhor Envio)
        let weightKg = parseFloat((totalWeight / 1000).toFixed(2));
        if (weightKg < 0.1) weightKg = 0.3; // Mín. Correios

        const payload = {
            from: { postal_code: ORIGIN_CEP },
            to: { postal_code: destinationCep },
            products: [{ id: '1', width: 20, height: 20, length: 20, weight: weightKg, insurance_value: 50.0, quantity: 1 }]
        };

        let services = [];

        if (MELHORENVIO_TOKEN) {
            const response = await axios.post('https://melhorenvio.com.br/api/v2/me/shipment/calculate', payload, {
                headers: {
                    'Authorization': `Bearer ${MELHORENVIO_TOKEN}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'MoriahCafe (atendimento@moriahcafe.com)'
                }
            });
            services = response.data
                .filter(s => !s.error && (s.name.includes('PAC') || s.name.includes('SEDEX')))
                .map(s => ({
                    id: s.id,
                    name: s.name,
                    price: s.price,
                    delivery_time: s.custom_delivery_time ? `${s.custom_delivery_time} dias úteis` : 'Consulte o prazo'
                }));
        } else {
            console.log('MELHORENVIO_TOKEN ausente. Usando frete simulado.');
            services = [
                { id: 1, name: 'PAC - Correios', price: '25.90', delivery_time: 'Até 7 dias úteis' },
                { id: 2, name: 'SEDEX - Correios', price: '48.50', delivery_time: 'Até 2 dias úteis' }
            ];
        }
        res.json({ success: true, services });
    } catch (error) {
        console.error('Erro ao calcular frete, usando simulado:', error.message);
        const services = [
            { id: 1, name: 'PAC - Correios', price: '25.90', delivery_time: 'Até 7 dias úteis' },
            { id: 2, name: 'SEDEX - Correios', price: '48.50', delivery_time: 'Até 2 dias úteis' }
        ];
        res.json({ success: true, services });
    }
});

app.post('/api/shipping/generate-label', async (req, res) => {
    const { sale_id } = req.body;
    try {
        const [sales] = await dbUtil.query('SELECT * FROM sales WHERE id = ?', [sale_id]);
        if (!sales.length) return res.status(404).json({ error: 'Pedido não encontrado.' });

        const sale = sales[0];
        if (!sale.shipping_service || sale.shipping_service === 'RETIRADA' || !sale.customer_cep) {
            return res.status(400).json({ error: 'Venda Físico ou Sem Frete Informado.' });
        }
        // Entregas locais Feira não usam Melhor Envio
        if (sale.shipping_service && (sale.shipping_service.includes('Expressa Moriah') || sale.shipping_service.includes('Padrão Feira'))) {
            return res.status(400).json({ error: 'Entrega local de Feira de Santana não usa transportadora.' });
        }

        const hasFullAddress = sale.customer_street && sale.customer_city && sale.customer_state;

        // === MELHOR ENVIO REAL ===
        if (MELHORENVIO_TOKEN && hasFullAddress && sale.shipping_service_id) {
            const [items] = await dbUtil.query(
                'SELECT si.quantity, si.price, si.product_name, COALESCE(p.weight_grams, 250) AS weight_grams FROM sale_items si LEFT JOIN products p ON si.product_id = p.id WHERE si.sale_id = ?',
                [sale_id]
            );
            const totalWeight = items.reduce((acc, i) => acc + (i.weight_grams * i.quantity), 0);
            const totalValue = items.reduce((acc, i) => acc + (parseFloat(i.price) * i.quantity), 0);
            const weightKg = parseFloat(Math.max(totalWeight / 1000, 0.1).toFixed(2));

            const meHeaders = {
                'Authorization': `Bearer ${MELHORENVIO_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'MoriahCafe (atendimento@moriahcafe.com)'
            };

            // 1. Adicionar ao carrinho Melhor Envio
            const cartPayload = {
                service: parseInt(sale.shipping_service_id),
                from: {
                    name: process.env.STORE_NAME || 'Moriah Café',
                    phone: process.env.STORE_PHONE || '75992073245',
                    email: process.env.STORE_EMAIL || 'atendimento@moriahcafe.com',
                    document: process.env.STORE_DOCUMENT || '',
                    address: process.env.STORE_ADDRESS || 'Endereço da Loja',
                    complement: process.env.STORE_COMPLEMENT || null,
                    number: process.env.STORE_NUMBER || 'S/N',
                    district: process.env.STORE_DISTRICT || 'Centro',
                    city: process.env.STORE_CITY || 'Feira de Santana',
                    country_id: 'BR',
                    postal_code: ORIGIN_CEP,
                    state_abbr: process.env.STORE_STATE || 'BA'
                },
                to: {
                    name: sale.customer_name || 'Cliente',
                    phone: (sale.customer_phone || '').replace(/\D/g, ''),
                    email: sale.customer_email || '',
                    document: (sale.customer_cpf || '').replace(/\D/g, ''),
                    address: sale.customer_street || '',
                    complement: sale.customer_complement || null,
                    number: sale.customer_address_number || 'S/N',
                    district: sale.customer_neighborhood || '',
                    city: sale.customer_city || '',
                    country_id: 'BR',
                    postal_code: (sale.customer_cep || '').replace(/\D/g, ''),
                    state_abbr: sale.customer_state || ''
                },
                products: items.map(i => ({
                    name: i.product_name || 'Produto',
                    quantity: i.quantity,
                    unitary_value: parseFloat(i.price)
                })),
                volumes: [{ height: 20, width: 20, length: 20, weight: weightKg }],
                options: {
                    insurance_value: parseFloat(totalValue.toFixed(2)),
                    receipt: false, own_hand: false, reverse: false, non_commercial: true
                }
            };

            const cartResp = await axios.post('https://melhorenvio.com.br/api/v2/me/shipment/cart', cartPayload, { headers: meHeaders });
            const meOrderId = cartResp.data.id;

            // 2. Checkout — desconta saldo da carteira Melhor Envio
            await axios.post('https://melhorenvio.com.br/api/v2/me/shipment/checkout', { orders: [meOrderId] }, { headers: meHeaders });

            // 3. Gerar etiqueta
            await axios.post('https://melhorenvio.com.br/api/v2/me/shipment/generate', { orders: [meOrderId] }, { headers: meHeaders });

            // 4. Buscar código de rastreio (pode ser null inicialmente — Correios ativa ao escanear)
            let trackingCode = `ME-${meOrderId.substring(0, 8).toUpperCase()}`;
            try {
                const trackResp = await axios.get(
                    `https://melhorenvio.com.br/api/v2/me/shipment/tracking?orders[]=${meOrderId}`,
                    { headers: meHeaders }
                );
                if (trackResp.data && trackResp.data[meOrderId]) trackingCode = trackResp.data[meOrderId];
            } catch (_) { /* tracking pode demorar; usa placeholder por ora */ }

            const labelProxyUrl = `/api/shipping/label/${sale_id}`;
            await dbUtil.run(
                'UPDATE sales SET tracking_code = ?, status = ?, me_order_id = ?, label_url = ? WHERE id = ?',
                [trackingCode, 'Etiqueta Gerada', meOrderId, labelProxyUrl, sale_id]
            );
            notifyCustomerTracking(sale, trackingCode);
            return res.json({ success: true, tracking_code: trackingCode, label_url: labelProxyUrl });
        }

        // === SIMULAÇÃO (fallback quando sem token, endereço incompleto ou sem service_id) ===
        console.log('[LABEL SIMULADA] Token:', !!MELHORENVIO_TOKEN, '| Endereço completo:', !!hasFullAddress, '| ServiceId:', !!sale.shipping_service_id);
        const trackingCode = `BR${Math.floor(Math.random() * 999999999)}ME`;
        await dbUtil.run('UPDATE sales SET tracking_code = ?, status = ? WHERE id = ?', [trackingCode, 'Etiqueta Gerada', sale_id]);
        notifyCustomerTracking(sale, trackingCode);
        res.json({ success: true, tracking_code: trackingCode, label_url: 'https://rastreamento.correios.com.br/app/index.php', simulated: true });

    } catch (error) {
        const errMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
        console.error('Erro ao gerar etiqueta Melhor Envio:', errMsg);
        // Fallback para simulação em caso de erro da API
        try {
            const trackingCode = `BR${Math.floor(Math.random() * 999999999)}ME`;
            await dbUtil.run('UPDATE sales SET tracking_code = ?, status = ? WHERE id = ?', [trackingCode, 'Etiqueta Gerada', sale_id]);
            notifyCustomerTracking(sale, trackingCode);
            res.json({ success: true, tracking_code: trackingCode, label_url: 'https://rastreamento.correios.com.br/app/index.php', simulated: true, api_error: errMsg });
        } catch (dbErr) {
            res.status(500).json({ error: 'Erro ao gerar etiqueta: ' + errMsg });
        }
    }
});

// Proxy autenticado para download da etiqueta PDF do Melhor Envio
app.get('/api/shipping/label/:sale_id', async (req, res) => {
    if (!MELHORENVIO_TOKEN) return res.status(400).send('Token Melhor Envio não configurado.');
    try {
        const [sales] = await dbUtil.query('SELECT me_order_id FROM sales WHERE id = ?', [req.params.sale_id]);
        if (!sales.length || !sales[0].me_order_id) return res.status(404).send('Etiqueta não encontrada. Verifique o Melhor Envio.');
        const meOrderId = sales[0].me_order_id;
        const printResp = await axios.get(
            `https://melhorenvio.com.br/api/v2/me/shipment/print?mode=private&orders[]=${meOrderId}`,
            { headers: { 'Authorization': `Bearer ${MELHORENVIO_TOKEN}`, 'Accept': 'application/pdf, application/json', 'User-Agent': 'MoriahCafe (atendimento@moriahcafe.com)' }, responseType: 'arraybuffer' }
        );
        const contentType = printResp.headers['content-type'] || 'application/pdf';
        res.setHeader('Content-Type', contentType);
        if (contentType.includes('pdf')) res.setHeader('Content-Disposition', `attachment; filename="etiqueta-${req.params.sale_id}.pdf"`);
        res.send(Buffer.from(printResp.data));
    } catch (error) {
        console.error('Erro ao baixar etiqueta:', error.message);
        try {
            const jsonData = JSON.parse(Buffer.from(error.response?.data || '{}').toString());
            if (jsonData.url) return res.redirect(jsonData.url);
        } catch (_) { }
        res.status(500).send('Erro ao obter etiqueta. Acesse https://melhorenvio.com.br/envios para baixar manualmente.');
    }
});

// Webhook Asaas — confirmação automática de PIX (PAYMENT_RECEIVED / PAYMENT_CONFIRMED)
// Configurar no painel Asaas: Configurações → Notificações → Webhook URL = https://cafemoriah.com.br/api/webhooks/asaas
app.post('/api/webhooks/asaas', async (req, res) => {
    try {
        const { event, payment } = req.body;
        console.log('[WEBHOOK ASAAS] Evento:', event, '| Payment ID:', payment?.id);

        if (!payment?.id || !['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event)) {
            return res.json({ received: true });
        }

        const [sales] = await dbUtil.query('SELECT * FROM sales WHERE payment_id = ?', [payment.id]);
        if (!sales.length) {
            console.log('[WEBHOOK ASAAS] Venda não encontrada para payment_id:', payment.id);
            return res.json({ received: true });
        }

        const sale = sales[0];
        if (sale.status === 'Pago') return res.json({ received: true }); // já confirmado

        await dbUtil.run('UPDATE sales SET status = ? WHERE id = ?', ['Pago', sale.id]);
        console.log(`[WEBHOOK ASAAS] Venda #${sale.id} (${sale.customer_name}) marcada como Pago.`);

        // Notificar dono: confirmação PIX
        const token = process.env.META_WHATSAPP_TOKEN;
        const phoneId = process.env.META_PHONE_NUMBER_ID;
        const ownerPhone = process.env.OWNER_PHONE;
        if (token && phoneId && ownerPhone) {
            const msg = [
                `✅ *PIX Confirmado — Moriah Café*`,
                ``,
                `👤 Cliente: ${sale.customer_name}`,
                `💰 Valor: R$ ${parseFloat(sale.total).toFixed(2).replace('.', ',')}`,
                `📋 Venda #${sale.id}`,
                ``,
                `Acesse o PDV para preparar o pedido. ☕`
            ].join('\n');
            axios.post(
                `https://graph.facebook.com/v19.0/${phoneId}/messages`,
                { messaging_product: 'whatsapp', to: ownerPhone, type: 'text', text: { body: msg } },
                { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
            ).catch(e => console.error('[WA META] Webhook notify:', e.response?.data || e.message));
        }

        return res.json({ received: true });
    } catch (err) {
        console.error('[WEBHOOK ASAAS] Erro:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// Dashboard financeiro
app.get('/api/dashboard', async (req, res) => {
    try {
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const paidStatuses = ['Pago', 'Etiqueta Gerada', 'Enviado'];

        const [allSales] = await dbUtil.query('SELECT id, total, status, created_at, customer_name, method, shipping_service FROM sales ORDER BY created_at DESC');

        let revenueToday = 0, revenueMonth = 0, pendingCount = 0, pendingTotal = 0;
        for (const s of allSales) {
            const ds = new Date(s.created_at).toISOString().split('T')[0];
            if (paidStatuses.includes(s.status)) {
                if (ds === todayStr) revenueToday += parseFloat(s.total || 0);
                if (ds >= monthStart) revenueMonth += parseFloat(s.total || 0);
            }
            if (s.status === 'Pendente' || s.status === 'Aguardando Pagamento') {
                pendingCount++;
                pendingTotal += parseFloat(s.total || 0);
            }
        }

        const [pendingSales] = await dbUtil.query(
            "SELECT id, customer_name, total, status, created_at, shipping_service FROM sales WHERE status IN ('Pendente', 'Aguardando Pagamento') ORDER BY created_at DESC LIMIT 10"
        );
        const [lowStock] = await dbUtil.query(
            'SELECT id, name, stock, category FROM products WHERE stock <= 5 ORDER BY stock ASC LIMIT 20'
        );
        const recentSales = allSales.filter(s => paidStatuses.includes(s.status)).slice(0, 5);

        res.json({
            success: true,
            revenue: { today: revenueToday, month: revenueMonth },
            pending: { count: pendingCount, total: pendingTotal, sales: pendingSales },
            lowStock,
            recentSales
        });
    } catch (err) {
        console.error('[DASHBOARD]', err.message);
        res.status(500).json({ error: err.message });
    }
});

const path = require('path');
const pdvStatic = express.static(path.join(__dirname, '../'));
const ecommerceStatic = express.static(path.join(__dirname, '../frontend_ecommerce'));

// Servindo a pasta frontend_ecommerce explicitamente na rota /ecommerce para testes locais
app.use('/ecommerce', ecommerceStatic);

app.use((req, res, next) => {
    const host = req.hostname || '';
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
    if (host.includes('www.cafemoriah.com.br') || host === 'cafemoriah.com.br') return ecommerceStatic(req, res, next);
    return pdvStatic(req, res, next);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor backend rodando na porta ${PORT}`);
});
