// Configuração Dinâmica de Banco de Dados (SQLite Local vs MySQL Cloud)
let dbUtil;
let sqliteDb;
let isMysql = !!process.env.DATABASE_URL;

async function setupDatabase() {
    if (isMysql) {
        const mysql = require('mysql2/promise');
        console.log('Conectando ao MySQL na nuvem...');
        const pool = mysql.createPool(process.env.DATABASE_URL);

        dbUtil = {
            query: async (sql, params = []) => {
                // MySQL2 usa ? para params, igual ao sqlite3, mas mysql não suporta AUTOINCREMENT (é AUTO_INCREMENT) e DATETIME DEFAULT CURRENT_TIMESTAMP funciona normal.
                const [rows] = await pool.query(sql, params);
                return [rows];
            },
            run: async (sql, params = []) => {
                const [result] = await pool.execute(sql, params);
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
            query: (sql, params = []) => new Promise((resolve, reject) => {
                sqliteDb.all(sql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve([rows]);
                });
            }),
            run: (sql, params = []) => new Promise((resolve, reject) => {
                sqliteDb.run(sql, params, function (err) {
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

    await dbUtil.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY ${autoInc},
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        cost REAL NOT NULL,
        price REAL NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        minStock INTEGER NOT NULL DEFAULT 5,
        sku TEXT NOT NULL,
        image_url TEXT,
        description TEXT,
        weight_grams INTEGER DEFAULT 250,
        sell_online INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbUtil.run(`CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY ${autoInc},
        total REAL NOT NULL,
        method TEXT NOT NULL,
        origin TEXT DEFAULT 'Físico',
        status TEXT DEFAULT 'Concluído',
        payment_id TEXT,
        customer_phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // FOREIGN KEY funciona em ambos
    await dbUtil.run(`CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY ${autoInc},
        sale_id INTEGER,
        product_id INTEGER,
        product_name TEXT,
        quantity INTEGER,
        price REAL
    )`);

    await dbUtil.run(`CREATE TABLE IF NOT EXISTS site_settings (
        id INTEGER PRIMARY KEY ${autoInc},
        hero_title TEXT DEFAULT 'O Café dos Seus Sonhos',
        hero_subtitle TEXT DEFAULT 'Experiência Sensorial',
        hero_text TEXT DEFAULT 'Grãos selecionados das melhores origens do Brasil, torrados artesanalmente para despertar todos os seus sentidos.',
        hero_video TEXT DEFAULT 'https://cdn.pixabay.com/video/2016/06/17/3494-171876527_large.mp4',
        about_title TEXT DEFAULT 'Descubra Nossa História',
        about_subtitle TEXT DEFAULT 'Tradição & Afeto',
        about_text_1 TEXT DEFAULT 'Nascida do amor profundo pelos grãos especiais e do desejo de levar a autêntica experiência das fazendas brasileiras diretamente para a sua xícara. O Moriah Café é mais do que uma marca, é a celebração da nossa herança.',
        about_text_2 TEXT DEFAULT 'Trabalhamos lado a lado com pequenos produtores, garantindo grãos de origem controlada e qualidade máxima. Nossa torra, feita de forma minuciosa e artesanal, respeita o tempo de cada variedade para extrair as melhores notas e aromas.',
        about_image TEXT DEFAULT 'https://images.unsplash.com/photo-1611162458324-aae1eb4129a4?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    const [rows] = await dbUtil.query("SELECT COUNT(*) as count FROM site_settings");
    if (rows[0].count === 0) {
        await dbUtil.run("INSERT INTO site_settings (hero_title) VALUES ('O Café dos Seus Sonhos')");
    }
}

// Inicializa os bancos antes das rotas
setupDatabase().catch(console.error);

// ==========================================
// ROTAS DA API
// ==========================================

