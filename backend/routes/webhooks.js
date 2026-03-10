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
        const { order_id, status } = req.body;
        if (status === 'PAID') {
            const db = getDb();
            await db.run('UPDATE sales SET status = ? WHERE id = ?', ['Pago', order_id]);
            console.log(`[WEBHOOK INFINITEPAY] Venda #${order_id} → Pago.`);
        }
        res.json({ received: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
