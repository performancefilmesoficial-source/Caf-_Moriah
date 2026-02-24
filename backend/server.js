const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
require('dotenv').config();

const upload = multer({ dest: 'uploads/' });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configuração da conexão com o Banco de Dados (SQLite Local)
const db = new sqlite3.Database('./moriahpdv.sqlite', (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco SQLite:', err.message);
    } else {
        console.log('Conexão SQLite (Localhost Portátil) estabelecida com sucesso!');

        // Setup Inicial das Tabelas
        db.run(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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

        db.run(`CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            total REAL NOT NULL,
            method TEXT NOT NULL,
            customer_phone TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS sale_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER,
            product_id INTEGER,
            product_name TEXT,
            quantity INTEGER,
            price REAL,
            FOREIGN KEY (sale_id) REFERENCES sales(id)
        )`);
    }
});

// Wrapper de Promises para o SQLite3
const dbUtil = {
    query: (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve([rows]); // Mimetiza o [rows] do db2/promise
        });
    }),
    run: (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve([{ insertId: this.lastID, changes: this.changes }]);
        });
    })
};

// Conexão e criação das tabelas feitas na inicialização acima.

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
    const { seller, items, subtotal, discount, total, method, customer_phone } = req.body;

    // Usando serialização nativa do SQLite para garantir consistência
    db.serialize(async () => {
        try {
            db.run('BEGIN TRANSACTION');

            // 1. Salva a venda principal
            const result = await dbUtil.run(
                'INSERT INTO sales (total, method, customer_phone) VALUES (?, ?, ?)',
                [total, method, customer_phone]
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

            db.run('COMMIT');
            res.status(201).json({ id: saleId, message: 'Venda finalizada com sucesso!' });
        } catch (error) {
            db.run('ROLLBACK');
            console.error(error);
            res.status(500).json({ error: 'Erro ao finalizar venda. Transação desfeita.' });
        }
    });
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
    // Esse endpoint receberá os dados do carrinho e os dados do cliente oriundos do Frontend
    const { customerName, customerEmail, cartItems, totalAmount } = req.body;

    try {
        // ... (Aqui entraria a lógica de integração com o Gateway PagBank/Cielo etc e o PDV) ...

        // 1. Lógica de Envio do E-mail de "Pedido Confirmado"
        const mailOptions = {
            from: `"Moriah Café Especial" <${process.env.SMTP_USER || 'atendimento@moriahcafe.com'}>`, // Remetente
            to: customerEmail, // Destinatário (Email do cliente)
            subject: 'Seu Pedido Moriah Café foi Confirmado! ☕', // Assunto
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1f1b18;">
                    <h2 style="color: #123930;">Olá, ${customerName}!</h2>
                    <p>Obrigado por escolher o Moriah Café Especial.</p>
                    <p>Recebemos o seu pedido no valor total de <strong>R$ ${totalAmount.toFixed(2)}</strong> e já estamos separando os seus grãos torrados com maestria!</p>
                    <hr style="border: none; border-top: 1px solid #ecdcc2; my: 20px;">
                    <p>Seu pedido está sendo preparado. Em breve você receberá um novo email com o seu <strong>Código de Rastreio</strong> e a Nota Fiscal.</p>
                    <br>
                    <p>Com carinho,</p>
                    <p><strong>Equipe Moriah Café</strong></p>
                </div>
            `
        };

        // Descomente a linha abaixo quando for rodar em Produção com credenciais SMTP válidas no .env!
        // await transporter.sendMail(mailOptions);
        console.log(`[SIMULAÇÃO] E-mail Transacional Enviado para: ${customerEmail}`);

        // Retorna Sucesso pro Frontend puxar pra página de obrigado
        res.status(200).json({ message: "Checkout processado com sucesso e e-mail enviado!" });

    } catch (error) {
        console.error("Erro no processamento do checkout ou e-mail:", error);
        res.status(500).json({ error: "Ocorreu um erro no processamento do seu pedido." });
    }
});

const path = require('path');
// Servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, '../')));

// Inicializando o servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor backend rodando na porta ${PORT}`);
});
