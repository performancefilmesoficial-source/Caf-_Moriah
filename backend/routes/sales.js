'use strict';
const express = require('express');
const { getDb } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');
const { broadcastStockUpdate } = require('../services/sseService');

const router = express.Router();

// GET /api/sales
router.get('/', authenticateJWT, async (req, res, next) => {
    try {
        const db = getDb();
        const [sales] = await db.query('SELECT * FROM sales ORDER BY created_at DESC LIMIT 100');

        if (sales.length > 0) {
            const placeholders = sales.map(() => '?').join(',');
            const saleIds = sales.map(s => s.id);
            const [allItems] = await db.query(
                `SELECT si.*, COALESCE(p.name, si.product_name) as name
                 FROM sale_items si
                 LEFT JOIN products p ON si.product_id = p.id
                 WHERE si.sale_id IN (${placeholders})`,
                saleIds
            );
            const byId = {};
            for (const item of allItems) {
                if (!byId[item.sale_id]) byId[item.sale_id] = [];
                byId[item.sale_id].push(item);
            }
            for (const sale of sales) sale.items = byId[sale.id] || [];
        }

        res.json(sales);
    } catch (err) { next(err); }
});

// POST /api/sales  (venda física no PDV)
router.post('/', authenticateJWT, async (req, res, next) => {
    const { seller, items, total, method, origin, customer_phone } = req.body;
    try {
        const db = getDb();
        const saleId = await db.transaction(async (tx) => {
            const result = await tx.run(
                'INSERT INTO sales (total, method, origin, status, customer_phone, payment_id, customer_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [total, method, origin || 'Físico', 'Concluído', customer_phone, null, seller || null]
            );
            const sId = result[0].insertId;

            for (const item of items) {
                const productId = parseInt(String(item.id).split('-')[0]);
                await tx.run(
                    'INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)',
                    [sId, productId, item.name, item.quantity, item.price]
                );

                // Lógica de decremento de estoque específico
                if (item.grind === 'Pó/Moído') {
                    await tx.run('UPDATE products SET stock_moido = stock_moido - ? WHERE id = ?', [item.quantity, productId]);
                } else if (item.grind === 'Em Grão') {
                    await tx.run('UPDATE products SET stock_grao = stock_grao - ? WHERE id = ?', [item.quantity, productId]);
                } else {
                    await tx.run('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, productId]);
                }
            }
            return sId;
        });

        // Notifica PDV e e-commerce conectados sobre mudança de estoque
        broadcastStockUpdate(items.map(i => ({
            product_id: parseInt(String(i.id).split('-')[0]),
            quantity: i.quantity,
            grind: i.grind
        })));

        res.status(201).json({ id: saleId, message: 'Venda finalizada com sucesso!' });
    } catch (err) { next(err); }
});

module.exports = router;
