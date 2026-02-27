const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');
require('dotenv').config();

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = 'https://api.asaas.com/v3';

const upload = multer({ dest: 'uploads/' });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Rota para Upload de Imagens de Produtos via Multer
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    }
    // Retorna a URL pública baseada no diretório estático '/uploads'
    const imageUrl = `/uploads/${req.file.filename}`;
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
        customer_name TEXT,
        customer_email TEXT,
        customer_cpf TEXT,
        customer_cep TEXT,
        customer_address_number TEXT,
        shipping_cost REAL DEFAULT 0,
        shipping_service TEXT,
        tracking_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Adiciona colunas a bancos já existentes (não vai falhar se as colunas já existirem no MySQL por causa do IGNORE ou exception ignorada)
    try { await dbUtil.run('ALTER TABLE sales ADD COLUMN customer_name TEXT'); } catch (e) { }
    try { await dbUtil.run('ALTER TABLE sales ADD COLUMN customer_email TEXT'); } catch (e) { }
    try { await dbUtil.run('ALTER TABLE sales ADD COLUMN customer_cpf TEXT'); } catch (e) { }
    try { await dbUtil.run('ALTER TABLE sales ADD COLUMN customer_cep TEXT'); } catch (e) { }
    try { await dbUtil.run('ALTER TABLE sales ADD COLUMN customer_address_number TEXT'); } catch (e) { }
    try { await dbUtil.run('ALTER TABLE sales ADD COLUMN shipping_cost REAL DEFAULT 0'); } catch (e) { }
    try { await dbUtil.run('ALTER TABLE sales ADD COLUMN shipping_service TEXT'); } catch (e) { }
    try { await dbUtil.run('ALTER TABLE sales ADD COLUMN tracking_code TEXT'); } catch (e) { }

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


// Rota de Teste para verificar se a API está online
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Moriah PDV Backend funcionando!' });
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
    const { name, category, cost, price, stock, minStock, sku, image_url, description, weight_grams, sell_online } = req.body;
    try {
        const result = await dbUtil.run(
            'INSERT INTO products (name, category, cost, price, stock, minStock, sku, image_url, description, weight_grams, sell_online) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [name, category, cost, price, stock, minStock, sku, image_url, description, weight_grams, sell_online]
        );
        res.status(201).json({ id: result[0].insertId, message: 'Produto cadastrado com sucesso!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao criar produto' });
    }
});

// 3. Atualizar um produto
app.put('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    const { name, category, cost, price, stock, minStock, sku, image_url, description, weight_grams, sell_online } = req.body;
    try {
        await dbUtil.run(
            'UPDATE products SET name=?, category=?, cost=?, price=?, stock=?, minStock=?, sku=?, image_url=?, description=?, weight_grams=?, sell_online=? WHERE id=?',
            [name, category, cost, price, stock, minStock, sku, image_url, description, weight_grams, sell_online, id]
        );
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
app.post('/api/products/import', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    const results = [];
    let separator = ';'; // Padrão Nuvemshop

    fs.createReadStream(req.file.path)
        .pipe(csv({ separator: separator, mapHeaders: ({ header }) => header.trim() }))
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            fs.unlinkSync(req.file.path); // Limpa arquivo temp

            let insertedCount = 0;
            try {
                // Tenta analisar se o CSV usou vírgula ao invés de ponto e vírgula
                // O csv-parser geralmente lida bem se passarmos as colunas certas, 
                // para garantir vamos buscar nas chaves do objeto de cada linha.

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

                res.status(200).json({ message: `Sucesso! \${insertedCount} produtos importados da planilha.`, count: insertedCount });
            } catch (err) {
                console.error('Erro na importação de CSV:', err);
                res.status(500).json({ error: 'Erro ao processar e salvar importação no banco de dados.' });
            }
        })
        .on('error', (err) => {
            fs.unlinkSync(req.file.path);
            res.status(500).json({ error: 'Erro ao ler o arquivo CSV.' });
        });
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

    // Se vieram arquivos anexados, atualize as variáveis para pegar o caminho do multer:
    if (req.files) {
        if (req.files['hero_video_file'] && req.files['hero_video_file'][0]) {
            hero_video = `/uploads/${req.files['hero_video_file'][0].filename}`;
        }
        if (req.files['about_image_file'] && req.files['about_image_file'][0]) {
            about_image = `/uploads/${req.files['about_image_file'][0].filename}`;
        }
    }

    try {
        await dbUtil.run(
            `UPDATE site_settings SET 
                hero_title=?, hero_subtitle=?, hero_text=?, hero_video=?, hero_video_opacity=?, hero_text_align=?, 
                about_title=?, about_subtitle=?, about_text_1=?, about_text_2=?, about_image=?, about_image_align=?, 
                updated_at=CURRENT_TIMESTAMP 
             WHERE id = (SELECT MIN(id) FROM site_settings)`,
            [hero_title, hero_subtitle, hero_text, hero_video, hero_video_opacity, hero_text_align, about_title, about_subtitle, about_text_1, about_text_2, about_image, about_image_align]
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

        // Em um sistema real e grande, as vendas seriam paginadas e fariamos JOIN para trazer os itens de cada venda de uma vez.
        // Para simplificar essa transição do localStorage para o banco:
        for (let i = 0; i < sales.length; i++) {
            const [items] = await dbUtil.query(
                'SELECT si.*, p.name FROM sale_items si JOIN products p ON si.product_id = p.id WHERE si.sale_id = ?',
                [sales[i].id]
            );
            sales[i].items = items;
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

    (async () => {
        try {
            await dbUtil.run(process.env.DATABASE_URL ? 'START TRANSACTION' : 'BEGIN TRANSACTION');

            // 1. Salva a venda principal
            const result = await dbUtil.run(
                'INSERT INTO sales (total, method, origin, status, customer_phone, payment_id) VALUES (?, ?, ?, ?, ?, ?)',
                [total, method, origin || 'Físico', 'Concluído', customer_phone, null]
            );
            const saleId = result[0].insertId;

            // 2. Salva os itens e baixa o estoque
            for (const item of items) {
                await dbUtil.run(
                    'INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)',
                    [saleId, item.id, item.name, item.quantity, item.price]
                );

                await dbUtil.run(
                    'UPDATE products SET stock = stock - ? WHERE id = ?',
                    [item.quantity, item.id]
                );
            }

            await dbUtil.run('COMMIT');
            res.status(201).json({ id: saleId, message: 'Venda finalizada com sucesso!' });
        } catch (error) {
            await dbUtil.run('ROLLBACK');
            console.error(error);
            res.status(500).json({ error: 'Erro ao finalizar venda. Transação desfeita.' });
        }
    })();
});

// ---- USUÁRIOS (Autenticação simples) ----
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        // Mockado simples (Não temos tabela de usuários no SQLite ainda, usa o hardcoded como antes)
        if (username === 'admin' && password === '123') {
            res.json({ id: 1, name: 'Administrador', username: 'admin', role: 'admin' });
        } else {
            res.status(401).json({ error: 'Usuário ou senha inválidos' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro no login' });
    }
});

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

app.post('/api/checkout', async (req, res) => {
    const { customerName, customerEmail, customerCpf, customerPhone, customerCep, customerAddressNumber, cartItems, totalAmount, billingType, cardData } = req.body;

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
            billingType: billingType || 'PIX', // 'PIX' ou 'CREDIT_CARD'
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
            paymentPayload.remoteIp = req.socket.remoteAddress || '127.0.0.1';
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

        // Enviar Email Tentar
        try {
            const mailOptions = {
                from: '"Moriah Café Especial" <atendimento@moriahcafe.com>',
                to: customerEmail,
                subject: 'Sua compra no Moriah Café! ☕',
                html: `<p>Olá ${customerName}, sua compra de R$ ${totalAmount} foi registrada no nosso sistema!</p><br><p><a href="${invoiceUrl}">Acessar Fatura ${billingType}</a></p>`
            };
            if (process.env.SMTP_USER) transporter.sendMail(mailOptions).catch(() => { });
        } catch (mailErr) { }

        // 4. Salvar venda no Banco de Dados
        (async () => {
            try {
                await dbUtil.run(process.env.DATABASE_URL ? 'START TRANSACTION' : 'BEGIN TRANSACTION');

                // Cartões aprovam mais rápido que PIX, porém deixaremos pendente até webhook para simplificar por enquanto.
                const statusInicial = 'Pendente';

                const result = await dbUtil.run(
                    'INSERT INTO sales (total, method, origin, status, customer_phone, payment_id, customer_name, customer_email, customer_cpf, customer_cep, customer_address_number, shipping_cost, shipping_service) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [totalAmount, billingType === 'CREDIT_CARD' ? 'Cartão de Crédito' : 'PIX', 'Online', statusInicial, customerPhone, paymentId, customerName, customerEmail, customerCpf, customerCep, customerAddressNumber || '', req.body.shippingCost || 0, req.body.shippingService || 'RETIRADA']
                );
                const saleId = result[0].insertId;

                for (const item of cartItems) {
                    await dbUtil.run(
                        'INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)',
                        [saleId, item.id, item.name, item.quantity, item.price]
                    );
                    await dbUtil.run(
                        'UPDATE products SET stock = stock - ? WHERE id = ?',
                        [item.quantity, item.id]
                    );
                }

                await dbUtil.run('COMMIT');
            } catch (dbErr) {
                await dbUtil.run('ROLLBACK');
                console.error("Erro ao salvar no banco:", dbErr);
            }
        })();

        res.status(200).json({
            success: true,
            sale_id: paymentId,
            pixPayload: pixPayload,
            encodedImage: encodedImage,
            invoiceUrl: invoiceUrl
        });

    } catch (error) {
        console.error('Erro no checkout / Asaas:', error.response?.data || error.message);
        const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
        res.status(500).json({ success: false, error: detail });
    }
});

// ==== LOGÍSTICA / MELHOR ENVIO ====
const MELHORENVIO_TOKEN = process.env.MELHORENVIO_TOKEN;
const ORIGIN_CEP = '44002622';

app.post('/api/shipping/calculate', async (req, res) => {
    const { destinationCep, cartItems } = req.body;

    if (!destinationCep || destinationCep.length < 8) {
        return res.status(400).json({ error: 'CEP Inválido' });
    }

    try {
        console.log('Calculando Frete Melhor Envios...');

        let totalWeight = 0;
        cartItems.forEach(item => { totalWeight += ((item.weight_grams || 250) * item.quantity); });

        let weightKg = (totalWeight / 1000).toFixed(2);
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
            services = response.data.filter(s => !s.error && (s.name.includes('PAC') || s.name.includes('SEDEX')));
        } else {
            console.log('MELHORENVIO_TOKEN ausente. Usando Fallback de Frete Simulado.');
            services = [
                { id: 1, name: 'PAC (Simulado via Backend)', price: '25.90', custom_delivery_time: 7 },
                { id: 2, name: 'SEDEX (Simulado via Backend)', price: '48.50', custom_delivery_time: 2 }
            ];
        }
        res.json({ success: true, services });
    } catch (error) {
        console.error('Erro ao calcular frete real, caindo para fallback:', error.response?.data || error.message);
        const services = [
            { id: 1, name: 'PAC (Fallback - Modo Teste)', price: '25.90', custom_delivery_time: 7 },
            { id: 2, name: 'SEDEX (Fallback - Modo Teste)', price: '48.50', custom_delivery_time: 2 }
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

        // Simulação Direta de Rastreio (Evitar bloqueios na Carteira do Cliente no Melhor Envio Sandbox)
        // Se houver saldo real, aqui entram os passos: /cart, /checkout e /generate.
        const trackingCode = `BR${Math.floor(Math.random() * 999999999)}ME`;
        const labelUrl = `https://rastreamento.correios.com.br/app/index.php`;

        await dbUtil.run('UPDATE sales SET tracking_code = ?, status = ? WHERE id = ?', [trackingCode, 'Etiqueta Gerada', sale_id]);

        res.json({ success: true, tracking_code: trackingCode, label_url: labelUrl });
    } catch (error) {
        console.error('Erro ao gerar Etiqueta Logística:', error);
        res.status(500).json({ error: 'Transportadora Falhou na Emissão da Etiqueta' });
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
