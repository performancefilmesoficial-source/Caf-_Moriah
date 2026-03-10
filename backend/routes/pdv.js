'use strict';
const express = require('express');
const axios = require('axios');
const { getDb } = require('../config/database');
const { broadcastStockUpdate } = require('../services/sseService');

const router = express.Router();
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = 'https://api.asaas.com/v3';
const INFINITEPAY_HANDLE = process.env.INFINITEPAY_HANDLE || 'cafemoriah';
const PDV_BASE_URL = process.env.PDV_BASE_URL || 'https://app.cafemoriah.com.br';

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
    const { total, items, cardType } = req.body;
    if (!total || total <= 0) return res.status(400).json({ error: 'Valor inválido.' });
    if (!items || !items.length) return res.status(400).json({ error: 'Carrinho vazio.' });

    try {
        const db = getDb();

        // Validar estoque
        for (const item of items) {
            const [rows] = await db.query('SELECT stock, name FROM products WHERE id = ?', [item.id]);
            if (!rows.length || rows[0].stock < item.quantity)
                return res.status(400).json({ error: `Estoque insuficiente: ${rows[0]?.name || 'Produto ' + item.id}` });
        }

        // Criar venda pendente no banco
        const methodLabel = cardType === 'debit' ? 'Cartão Débito' : 'Cartão Crédito';
        const saleId = await db.transaction(async (tx) => {
            const result = await tx.run(
                'INSERT INTO sales (total, method, origin, status, customer_name) VALUES (?, ?, ?, ?, ?)',
                [parseFloat(total), methodLabel, 'Físico', 'Aguardando Pagamento', 'Cliente PDV']
            );
            const sId = result[0].insertId;
            for (const item of items) {
                await tx.run('INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)',
                    [sId, item.id, item.name, item.quantity, item.price]);
                await tx.run('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.id]);
            }
            return sId;
        });

        const orderNsu = `moriah-pdv-${saleId}`;

        // Criar cobrança no InfinitePay
        let checkoutUrl = `https://checkout.infinitepay.io/${INFINITEPAY_HANDLE}`;
        try {
            const ipRes = await axios.post('https://api.infinitepay.io/invoices/public/checkout/links', {
                handle: INFINITEPAY_HANDLE,
                order_nsu: orderNsu,
                items: items.map(i => ({
                    price: Math.round(i.price * 100), // centavos
                    quantity: i.quantity,
                    description: i.name.substring(0, 60)
                })),
                redirect_url: `${PDV_BASE_URL}/?ip_paid=${saleId}`,
                webhook_url: `${PDV_BASE_URL}/api/webhooks/infinitepay`
            }, { headers: { 'Content-Type': 'application/json' }, timeout: 8000 });

            checkoutUrl = ipRes.data?.checkout_url
                || ipRes.data?.url
                || ipRes.data?.link
                || `https://checkout.infinitepay.io/${INFINITEPAY_HANDLE}`;

            await db.run('UPDATE sales SET payment_id = ? WHERE id = ?', [orderNsu, saleId]);
            console.log(`[INFINITEPAY] Cobrança criada para venda #${saleId}: ${checkoutUrl}`);
        } catch (ipErr) {
            console.error('[INFINITEPAY] Falha ao criar cobrança:', ipErr.response?.data || ipErr.message);
            // Mesmo com erro na API, a venda pendente foi criada — continua com URL fallback
        }

        broadcastStockUpdate(items.map(i => ({ product_id: i.id, quantity: i.quantity })));
        res.json({ success: true, sale_id: saleId, checkout_url: checkoutUrl });

    } catch (err) { next(err); }
});

// GET /api/pdv/infinitepay/status/:sale_id  (polling do frontend)
router.get('/infinitepay/status/:sale_id', async (req, res, next) => {
    try {
        const db = getDb();
        const [rows] = await db.query('SELECT status, method FROM sales WHERE id = ?', [req.params.sale_id]);
        if (!rows.length) return res.status(404).json({ error: 'Venda não encontrada.' });
        res.json({ paid: rows[0].status === 'Pago', status: rows[0].status, method: rows[0].method });
    } catch (err) { next(err); }
});

// PUT /api/pdv/sales/:id/confirm  (confirmação manual se webhook falhar)
router.put('/sales/:id/confirm', async (req, res, next) => {
    const { method } = req.body;
    try {
        const db = getDb();
        await db.run('UPDATE sales SET status = ?, method = ? WHERE id = ?', ['Pago', method || 'InfinitePay', req.params.id]);
        res.json({ success: true });
    } catch (err) { next(err); }
});

module.exports = router;
