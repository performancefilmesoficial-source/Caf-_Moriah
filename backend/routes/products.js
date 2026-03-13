'use strict';
const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { getDb } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/products  (PDV — requer JWT)
router.get('/', authenticateJWT, async (req, res, next) => {
    try {
        const db = getDb();
        const [rows] = await db.query('SELECT * FROM products ORDER BY name ASC');
        res.json(rows);
    } catch (err) { next(err); }
});

// GET /api/products/online  (e-commerce público)
router.get('/online', async (req, res, next) => {
    try {
        const db = getDb();
        const [rows] = await db.query(
            "SELECT * FROM products WHERE sell_online = 1 AND (stock > 0 OR stock_grao > 0 OR stock_moido > 0) ORDER BY name ASC"
        );
        res.json(rows);
    } catch (err) { next(err); }
});

// POST /api/products
router.post('/', authenticateJWT, async (req, res, next) => {
    const { name, category, cost, price, cost_moido, price_moido, stock, stock_moido, stock_grao, minStock, sku, image_url, description, weight_grams, weight_grams_moido, sell_online } = req.body;
    try {
        const db = getDb();
        const result = await db.run(
            'INSERT INTO products (name, category, cost, price, cost_moido, price_moido, stock, stock_moido, stock_grao, minStock, sku, image_url, description, weight_grams, weight_grams_moido, sell_online) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [name, category, cost || 0, price || 0, cost_moido || 0, price_moido || 0, stock || 0, stock_moido || 0, stock_grao || 0, minStock || 5, sku, image_url, description, weight_grams || 250, weight_grams_moido || 250, sell_online ?? 1]
        );
        res.status(201).json({ id: result[0].insertId, message: 'Produto cadastrado com sucesso!' });
    } catch (err) {
        next(err);
    }
});

// PUT /api/products/:id
router.put('/:id', authenticateJWT, async (req, res, next) => {
    const { id } = req.params;
    const { name, category, cost, price, cost_moido, price_moido, stock, stock_moido, stock_grao, minStock, sku, image_url, description, weight_grams, weight_grams_moido, sell_online } = req.body;
    try {
        const db = getDb();
        await db.run(
            'UPDATE products SET name=?, category=?, cost=?, price=?, cost_moido=?, price_moido=?, stock=?, stock_moido=?, stock_grao=?, minStock=?, sku=?, image_url=?, description=?, weight_grams=?, weight_grams_moido=?, sell_online=? WHERE id=?',
            [name, category, cost || 0, price || 0, cost_moido || 0, price_moido || 0, stock || 0, stock_moido || 0, stock_grao || 0, minStock || 5, sku, image_url, description, weight_grams || 250, weight_grams_moido || 250, sell_online ?? 1, id]
        );
        res.json({ message: 'Produto atualizado com sucesso!' });
    } catch (err) { next(err); }
});

// DELETE /api/products/:id
router.delete('/:id', authenticateJWT, async (req, res, next) => {
    try {
        const db = getDb();
        await db.run('DELETE FROM products WHERE id=?', [req.params.id]);
        res.json({ message: 'Produto excluído com sucesso!' });
    } catch (err) { next(err); }
});

// POST /api/products/import  (CSV Nuvemshop)
router.post('/import', authenticateJWT, upload.single('file'), async (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    try {
        const db = getDb();
        const results = [];
        await new Promise((resolve, reject) => {
            Readable.from(req.file.buffer)
                .pipe(csv({ separator: ';', mapHeaders: ({ header }) => header.trim() }))
                .on('data', d => results.push(d))
                .on('end', resolve)
                .on('error', reject);
        });

        let count = 0;
        for (const row of results) {
            const g = (keys) => {
                const k = Object.keys(row).find(k => keys.some(p => k.toLowerCase().includes(p)));
                return k ? row[k] : null;
            };
            const name = g(['nome', 'name', 'produto']);
            if (!name) continue;
            const sku = g(['sku', 'código', 'cdigo']) || `IMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const cost = parseFloat(String(g(['custo', 'cost']) || '0').replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
            const price = parseFloat(String(g(['preço', 'price', 'valor', 'preo']) || '0').replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
            const stock = parseInt(g(['estoque', 'stock', 'quantidade']) || '0', 10);
            const category = g(['categoria', 'category']) || 'Importado';
            const image_url = g(['imagem', 'image', 'url', 'foto']) || '';
            const description = g(['descrição', 'description', 'detalhes', 'descrio']) || '';
            const weight_kg = parseFloat(String(g(['peso', 'weight']) || '0').replace(',', '.'));
            const weight_grams = Math.round(weight_kg * 1000) || 250;

            await db.run(
                'INSERT INTO products (name, category, cost, price, stock, minStock, sku, image_url, description, weight_grams, sell_online) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [name, category, cost, price, stock, 5, sku, image_url, description, weight_grams, 1]
            );
            count++;
        }
        res.json({ message: `${count} produtos importados com sucesso.`, count });
    } catch (err) { next(err); }
});

// ─── Rota IA (movida para app.js) ──────────────────────────────
// ... (Removido daqui para usar a rota global unificada no app.js)


module.exports = router;
