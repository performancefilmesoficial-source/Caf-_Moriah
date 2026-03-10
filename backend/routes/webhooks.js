'use strict';
const express = require('express');
const { getDb } = require('../config/database');
const { notifyOwnerPixConfirmed } = require('../services/notificationService');

const router = express.Router();

// POST /api/webhooks/asaas
router.post('/asaas', async (req, res) => {
    try {
        const { event, payment } = req.body;
        console.log('[WEBHOOK ASAAS] Evento:', event, '| ID:', payment?.id);

        if (!payment?.id || !['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event)) {
            return res.json({ received: true });
        }

        const db = getDb();
        const [sales] = await db.query('SELECT * FROM sales WHERE payment_id = ?', [payment.id]);
        if (!sales.length) {
            console.log('[WEBHOOK ASAAS] Venda não encontrada para payment_id:', payment.id);
            return res.json({ received: true });
        }

        const sale = sales[0];
        if (sale.status === 'Pago') return res.json({ received: true });

        await db.run('UPDATE sales SET status = ? WHERE id = ?', ['Pago', sale.id]);
        console.log(`[WEBHOOK ASAAS] Venda #${sale.id} (${sale.customer_name}) → Pago.`);

        notifyOwnerPixConfirmed(sale);

        return res.json({ received: true });
    } catch (err) {
        console.error('[WEBHOOK ASAAS]', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// POST /api/webhooks/infinitepay
router.post('/infinitepay', async (req, res) => {
    try {
        console.log('[WEBHOOK INFINITEPAY]', JSON.stringify(req.body));
        const { order_nsu, paid_amount, amount, capture_method } = req.body;

        // Confirma quando pago (paid_amount >= amount)
        if (order_nsu && paid_amount != null && amount != null && paid_amount >= amount) {
            // order_nsu formato: "moriah-pdv-{sale_id}"
            const saleId = parseInt(order_nsu.replace('moriah-pdv-', ''), 10);
            if (!isNaN(saleId)) {
                const db = getDb();
                const method = capture_method === 'debit_card'  ? 'Cartão Débito'
                             : capture_method === 'credit_card' ? 'Cartão Crédito'
                             : 'InfinitePay';
                await db.run(
                    'UPDATE sales SET status = ?, method = ? WHERE id = ? AND status != ?',
                    ['Pago', method, saleId, 'Pago']
                );
                console.log(`[WEBHOOK INFINITEPAY] Venda #${saleId} → Pago (${method})`);
            }
        }

        // InfinitePay exige resposta exata dentro de 1s
        res.json({ success: true, message: null });
    } catch (err) {
        console.error('[WEBHOOK INFINITEPAY]', err.message);
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
