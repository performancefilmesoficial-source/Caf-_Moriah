'use strict';
const express = require('express');
const axios = require('axios');
const { getDb } = require('../config/database');
const { broadcastStockUpdate } = require('../services/sseService');

const router = express.Router();
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = 'https://api.asaas.com/v3';

// POST /api/pdv/charge  (cobrança Asaas presencial)
router.post('/charge', async (req, res, next) => {
    if (!ASAAS_API_KEY)
        return res.status(400).json({ error: 'Asaas não configurado. Defina ASAAS_API_KEY.' });

    const { customerName, total, billingType } = req.body;
    if (!total || total <= 0) return res.status(400).json({ error: 'Valor inválido.' });

    try {
        const custRes = await axios.post(`${ASAAS_URL}/customers`, {
            name: customerName || 'Cliente PDV Moriah',
            externalReference: `PDV-${Date.now()}`
        }, { headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' } });

        const payRes = await axios.post(`${ASAAS_URL}/payments`, {
            customer: custRes.data.id,
            billingType: billingType || 'UNDEFINED',
            dueDate: new Date().toISOString().split('T')[0],
            value: parseFloat(total),
            description: 'PDV Moriah Café',
            externalReference: `PDV-${Date.now()}`
        }, { headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' } });

        res.json({ payment_id: payRes.data.id, invoiceUrl: payRes.data.invoiceUrl, status: payRes.data.status });
    } catch (err) {
        console.error('[PDV CHARGE]', err.response?.data || err.message);
        res.status(500).json({ error: err.response?.data?.errors?.[0]?.description || 'Erro ao criar cobrança.' });
    }
});

// GET /api/pdv/payment-status/:payment_id
router.get('/payment-status/:payment_id', async (req, res, next) => {
    if (!ASAAS_API_KEY) return res.status(400).json({ error: 'Asaas não configurado.' });
    try {
        const r = await axios.get(`${ASAAS_URL}/payments/${req.params.payment_id}`, {
            headers: { 'access_token': ASAAS_API_KEY }
        });
        const p = r.data;
        res.json({ payment_id: p.id, status: p.status, paid: ['CONFIRMED', 'RECEIVED'].includes(p.status), billingType: p.billingType, value: p.value });
    } catch (err) { next(err); }
});

// POST /api/pdv/infinitepay/charge
router.post('/infinitepay/charge', async (req, res, next) => {
    const { total, items, discount } = req.body;
    if (!total || total <= 0) return res.status(400).json({ error: 'Valor inválido.' });

    try {
        const db = getDb();

        // Validar estoque
        for (const item of items) {
            const [rows] = await db.query('SELECT stock, name FROM products WHERE id = ?', [item.id]);
            if (!rows.length || rows[0].stock < item.quantity)
                return res.status(400).json({ error: `Estoque insuficiente: ${rows[0]?.name || 'Produto ' + item.id}` });
        }

        const saleId = await db.transaction(async (tx) => {
            const result = await tx.run(
                'INSERT INTO sales (total, method, origin, status, customer_name) VALUES (?, ?, ?, ?, ?)',
                [parseFloat(total), 'InfinitePay', 'Físico', 'Aguardando Pagamento', 'Cliente PDV']
            );
            const sId = result[0].insertId;
            for (const item of items) {
                await tx.run('INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)',
                    [sId, item.id, item.name, item.quantity, item.price]);
                await tx.run('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.id]);
            }
            return sId;
        });

        broadcastStockUpdate(items.map(i => ({ product_id: i.id, quantity: i.quantity })));
        res.json({ success: true, sale_id: saleId });
    } catch (err) { next(err); }
});

// PUT /api/pdv/sales/:id/confirm
router.put('/sales/:id/confirm', async (req, res, next) => {
    const { method } = req.body;
    try {
        const db = getDb();
        await db.run('UPDATE sales SET status = ?, method = ? WHERE id = ?', ['Pago', method || 'InfinitePay', req.params.id]);
        res.json({ success: true });
    } catch (err) { next(err); }
});

module.exports = router;
