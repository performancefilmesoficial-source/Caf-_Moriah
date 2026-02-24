const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json()); // Permite receber JSON no body da requisição

// Configuração da conexão com o Banco de Dados (MySQL)
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'moriahpdv',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Testar a conexão com o banco ao iniciar
pool.getConnection()
    .then(conn => {
        console.log('Conexão com o MySQL (Hostinger) estabelecida com sucesso!');
        conn.release();
    })
    .catch(err => {
        console.error('Erro ao conectar ao MySQL:', err.message);
        console.log('Verifique as credenciais no arquivo .env');
    });

// ==========================================
// ROTAS DA API
// ==========================================

// Rota de Teste para verificar se a API está online
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Moriah PDV Backend funcionando!' });
});

// ---- PRODUTOS ----

// 1. Listar todos os produtos
app.get('/api/products', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM products ORDER BY name ASC');
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar produtos' });
    }
});

// 2. Adicionar um novo produto
app.post('/api/products', async (req, res) => {
    const { name, category, cost, price, stock, minStock, sku } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO products (name, category, cost, price, stock, minStock, sku) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, category, cost, price, stock, minStock, sku]
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
    const { name, category, cost, price, stock, minStock, sku } = req.body;
    try {
        await pool.query(
            'UPDATE products SET name=?, category=?, cost=?, price=?, stock=?, minStock=?, sku=? WHERE id=?',
            [name, category, cost, price, stock, minStock, sku, id]
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
        await pool.query('DELETE FROM products WHERE id=?', [id]);
        res.json({ message: 'Produto excluído com sucesso!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao excluir produto' });
    }
});

// ---- VENDAS ----

// 1. Listar vendas
app.get('/api/sales', async (req, res) => {
    try {
        const [sales] = await pool.query('SELECT * FROM sales ORDER BY date DESC LIMIT 100');

        // Em um sistema real e grande, as vendas seriam paginadas e fariamos JOIN para trazer os itens de cada venda de uma vez.
        // Para simplificar essa transição do localStorage para o banco:
        for (let i = 0; i < sales.length; i++) {
            const [items] = await pool.query(
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
    const { seller, items, subtotal, discount, total, method } = req.body;

    // Iniciar uma transação MySQL (Garante que se falhar no meio, ele cancela tudo e não salva pela metade)
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Salva a venda principal
        const [saleResult] = await connection.query(
            'INSERT INTO sales (seller, subtotal, discount, total, method) VALUES (?, ?, ?, ?, ?)',
            [seller, subtotal, discount, total, method]
        );
        const saleId = saleResult.insertId;

        // 2. Salva os itens e baixa o estoque
        for (const item of items) {
            // Salva o item vendido
            await connection.query(
                'INSERT INTO sale_items (sale_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
                [saleId, item.id, item.quantity, item.price]
            );

            // Abate o estoque do produto
            await connection.query(
                'UPDATE products SET stock = stock - ? WHERE id = ?',
                [item.quantity, item.id]
            );
        }

        await connection.commit();
        res.status(201).json({ id: saleId, message: 'Venda finalizada com sucesso!' });
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ error: 'Erro ao finalizar venda. Transação desfeita.' });
    } finally {
        connection.release();
    }
});

// ---- USUÁRIOS (Autenticação simples) ----
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [users] = await pool.query('SELECT id, name, username, role FROM users WHERE username = ? AND password = ?', [username, password]);
        if (users.length > 0) {
            res.json(users[0]);
        } else {
            res.status(401).json({ error: 'Usuário ou senha inválidos' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro no login' });
    }
});

const path = require('path');
// Servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, '../')));

// Inicializando o servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor backend rodando na porta ${PORT}`);
});
