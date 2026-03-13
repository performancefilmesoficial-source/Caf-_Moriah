/**
 * config/database.js
 * Abstração da camada de banco de dados.
 * Suporta SQLite (dev local) e MySQL (produção via DATABASE_URL).
 * Pronto para PostgreSQL: basta adicionar driver `pg` e lógica isPg.
 */
'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');

let dbUtil = null;
let isMysql = false;

async function hashPwd(password) {
    return bcrypt.hash(password, 10);
}

async function initTables(db, mysql) {
    const autoInc = mysql ? 'AUTO_INCREMENT' : 'AUTOINCREMENT';

    console.log('[DB] Criando tabelas se não existirem...');

    await db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY ${autoInc},
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        cost REAL NOT NULL,
        price REAL NOT NULL,
        price_moido REAL DEFAULT 0,
        stock INTEGER NOT NULL DEFAULT 0,
        stock_moido INTEGER DEFAULT 0,
        stock_grao INTEGER DEFAULT 0,
        minStock INTEGER NOT NULL DEFAULT 5,
        sku TEXT NOT NULL,
        image_url MEDIUMTEXT,
        description TEXT,
        weight_grams INTEGER DEFAULT 250,
        sell_online INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await db.run(`CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY ${autoInc},
        name VARCHAR(255),
        phone VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(255),
        last_message_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Migração para clientes antigos
    try { await db.run('ALTER TABLE customers ADD COLUMN last_message_at DATETIME'); } catch (_) { }

    await db.run(`CREATE TABLE IF NOT EXISTS sales (
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

    // Migrations cumulativas (falha silenciosa se coluna já existir)
    const salesColumns = [
        'origin TEXT DEFAULT "Fisico"', 'status TEXT DEFAULT "Concluido"', 'payment_id TEXT',
        'customer_phone TEXT', 'customer_name TEXT', 'customer_email TEXT', 'customer_cpf TEXT',
        'customer_cep TEXT', 'customer_address_number TEXT', 'customer_street TEXT',
        'customer_neighborhood TEXT', 'customer_city TEXT', 'customer_state TEXT',
        'customer_complement TEXT', 'shipping_cost REAL DEFAULT 0', 'shipping_service TEXT',
        'shipping_service_id TEXT', 'tracking_code TEXT', 'me_order_id TEXT', 'label_url TEXT'
    ];
    for (const col of salesColumns) {
        try { await db.run(`ALTER TABLE sales ADD COLUMN ${col}`); } catch (_) { }
    }

    await db.run(`CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY ${autoInc},
        sale_id INTEGER,
        product_id INTEGER,
        product_name TEXT,
        quantity INTEGER,
        price REAL
    )`);

    await db.run(`CREATE TABLE IF NOT EXISTS site_settings (
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
        hero_banners MEDIUMTEXT,
        site_title TEXT,
        logo_url TEXT,
        favicon_url TEXT,
        whatsapp_number TEXT,
        instagram_url TEXT,
        contact_email TEXT,
        cnpj TEXT,
        address TEXT,
        footer_text TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    const siteSettingsCols = [
        'hero_video_opacity TEXT', 'hero_text_align TEXT', 'about_image_align TEXT', 'hero_banners MEDIUMTEXT',
        'site_title TEXT', 'logo_url TEXT', 'favicon_url TEXT', 'whatsapp_number TEXT', 'instagram_url TEXT',
        'contact_email TEXT', 'cnpj TEXT', 'address TEXT', 'footer_text TEXT',
        "hero_font_family VARCHAR(50) DEFAULT 'sans'", "hero_title_size VARCHAR(20) DEFAULT '5'", "hero_text_color VARCHAR(20) DEFAULT '#ffffff'",
        "about_font_family VARCHAR(50) DEFAULT 'sans'", "about_title_color VARCHAR(20) DEFAULT '#5d4037'"
    ];
    for (const col of siteSettingsCols) {
        try {
            await db.query(`ALTER TABLE site_settings ADD COLUMN ${col}`);
        } catch (e) {
            if (!e.message.includes('Duplicate column') && !e.message.includes('already exists')) {
                console.error(`[DB] ALTER site_settings ADD ${col.split(' ')[0]}:`, e.message);
            }
        }
    }
    if (mysql) {
        // Garante MEDIUMTEXT (16MB) para todos os campos que armazenam Base64
        try { await db.run('ALTER TABLE site_settings MODIFY COLUMN hero_video MEDIUMTEXT'); } catch (_) { }
        try { await db.run('ALTER TABLE site_settings MODIFY COLUMN about_image MEDIUMTEXT'); } catch (_) { }
        try { await db.run('ALTER TABLE site_settings MODIFY COLUMN hero_banners MEDIUMTEXT'); } catch (_) { }
        try { await db.run('ALTER TABLE site_settings MODIFY COLUMN logo_url MEDIUMTEXT'); } catch (_) { }
        try { await db.run('ALTER TABLE site_settings MODIFY COLUMN favicon_url MEDIUMTEXT'); } catch (_) { }
        try { await db.run('ALTER TABLE products MODIFY COLUMN image_url MEDIUMTEXT'); } catch (_) { }
    }

    const [settingsRows] = await db.query('SELECT COUNT(*) as count FROM site_settings');
    if (settingsRows[0].count === 0) {
        await db.run("INSERT INTO site_settings (hero_title) VALUES ('O Cafe dos Seus Sonhos')");
    }

    try {
        await db.run(`CREATE TABLE IF NOT EXISTS pdv_users (
            id INTEGER PRIMARY KEY ${autoInc},
            name VARCHAR(255) NOT NULL,
            username VARCHAR(100) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'operator',
            must_change_password INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    } catch (e) {
        console.error('[DB] Erro ao criar pdv_users:', e.message);
    }
    try { await db.run('ALTER TABLE pdv_users ADD COLUMN must_change_password INTEGER DEFAULT 0'); } catch (_) { }

    const [uRows] = await db.query("SELECT id FROM pdv_users WHERE username = 'admin'");
    const hash = await hashPwd('root');
    
    if (uRows.length === 0) {
        await db.run(
            'INSERT INTO pdv_users (name, username, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?)',
            ['Administrador', 'admin', hash, 'admin', 0]
        );
        console.log('[DB] Usuário padrão criado: admin / root');
    } else {
        await db.run('UPDATE pdv_users SET password_hash = ? WHERE username = ?', [hash, 'admin']);
        console.log('[DB] Senha do admin resetada para: root');
    }

    try { await db.run('ALTER TABLE products ADD COLUMN price_moido REAL DEFAULT 0'); } catch (_) { }
    try { await db.run('ALTER TABLE products ADD COLUMN stock_moido INTEGER DEFAULT 0'); } catch (_) { }
    try { await db.run('ALTER TABLE products ADD COLUMN stock_grao INTEGER DEFAULT 0'); } catch (_) { }
    try { await db.run('ALTER TABLE products ADD COLUMN cost_moido REAL DEFAULT 0'); } catch (_) { }
    try { await db.run('ALTER TABLE products ADD COLUMN weight_grams_moido INTEGER DEFAULT 250'); } catch (_) { }

    console.log('[DB] Inicialização concluída.');
}

async function setupDatabase() {
    isMysql = !!process.env.DATABASE_URL;

    if (isMysql) {
        const mysql = require('mysql2/promise');
        console.log('[DB] Conectando ao MySQL...');

        const pool = mysql.createPool({
            uri: process.env.DATABASE_URL,
            charset: 'utf8mb4',
            waitForConnections: true,
            connectionLimit: 10
        });

        const clean = (params) =>
            Array.isArray(params) ? params.map(v => (v === undefined ? null : v)) : params;

        dbUtil = {
            isMysql: true,
            query: async (sql, params = []) => {
                const [rows] = await pool.query(sql, clean(params));
                return [rows];
            },
            run: async (sql, params = []) => {
                const isDDL = /^\s*(CREATE|ALTER|DROP|TRUNCATE|RENAME)/i.test(sql);
                if (isDDL) {
                    const [r] = await pool.query(sql, clean(params));
                    return [{ insertId: r.insertId || 0, changes: r.affectedRows || 0 }];
                }
                const [r] = await pool.execute(sql, clean(params));
                return [{ insertId: r.insertId, changes: r.affectedRows }];
            },
            transaction: async (callback) => {
                const conn = await pool.getConnection();
                await conn.beginTransaction();
                try {
                    const tx = {
                        run: async (sql, params) => {
                            const [r] = await conn.execute(sql, clean(params));
                            return [{ insertId: r.insertId, changes: r.affectedRows }];
                        },
                        query: async (sql, params) => {
                            const [rows] = await conn.query(sql, clean(params));
                            return [rows];
                        }
                    };
                    const result = await callback(tx);
                    await conn.commit();
                    return result;
                } catch (err) {
                    await conn.rollback();
                    throw err;
                } finally {
                    conn.release();
                }
            },
            pool
        };

        await initTables(dbUtil, true);
    } else {
        const sqlite3 = require('sqlite3').verbose();
        console.log('[DB] Conectando ao SQLite local...');
        const sqliteDb = new sqlite3.Database('./moriahpdv.sqlite');

        const clean = (params) =>
            Array.isArray(params) ? params.map(v => (v === undefined ? null : v)) : params;

        dbUtil = {
            isMysql: false,
            query: (sql, params = []) =>
                new Promise((resolve, reject) => {
                    sqliteDb.all(sql, clean(params), (err, rows) => {
                        if (err) reject(err);
                        else resolve([rows]);
                    });
                }),
            run: (sql, params = []) =>
                new Promise((resolve, reject) => {
                    sqliteDb.run(sql, clean(params), function (err) {
                        if (err) reject(err);
                        else resolve([{ insertId: this.lastID, changes: this.changes }]);
                    });
                }),
            transaction: async (callback) => {
                await dbUtil.run('BEGIN TRANSACTION');
                try {
                    const result = await callback(dbUtil);
                    await dbUtil.run('COMMIT');
                    return result;
                } catch (err) {
                    await dbUtil.run('ROLLBACK');
                    throw err;
                }
            },
            db: sqliteDb
        };

        await initTables(dbUtil, false);
    }

    return dbUtil;
}

function getDb() {
    if (!dbUtil) throw new Error('[DB] Banco não inicializado. Aguarde setupDatabase().');
    return dbUtil;
}

module.exports = { setupDatabase, getDb };
