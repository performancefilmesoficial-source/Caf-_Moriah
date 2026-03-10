'use strict';
const express = require('express');
const { getDb } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard  (protegido por JWT)
router.get('/', authenticateJWT, async (req, res, next) => {
    try {
        const db = getDb();
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const paidStatuses = ['Pago', 'Etiqueta Gerada', 'Enviado', 'Concluído'];

        const [allSales] = await db.query(
            'SELECT id, total, status, created_at, customer_name, method, shipping_service FROM sales ORDER BY created_at DESC'
        );

        let revenueToday = 0, revenueMonth = 0, pendingCount = 0, pendingTotal = 0;
        for (const s of allSales) {
            const ds = new Date(s.created_at).toISOString().split('T')[0];
            if (paidStatuses.includes(s.status)) {
                if (ds === todayStr) revenueToday += parseFloat(s.total || 0);
                if (ds >= monthStart) revenueMonth += parseFloat(s.total || 0);
            }
            if (s.status === 'Pendente' || s.status === 'Aguardando Pagamento') {
                pendingCount++;
                pendingTotal += parseFloat(s.total || 0);
            }
        }

        const [pendingSales] = await db.query(
            "SELECT id, customer_name, total, status, created_at, shipping_service FROM sales WHERE status IN ('Pendente', 'Aguardando Pagamento') ORDER BY created_at DESC LIMIT 10"
        );
        const [lowStock] = await db.query(
            'SELECT id, name, stock, category FROM products WHERE stock <= 5 ORDER BY stock ASC LIMIT 20'
        );
        const recentSales = allSales.filter(s => paidStatuses.includes(s.status)).slice(0, 5);

        res.json({
            success: true,
            revenue: { today: revenueToday, month: revenueMonth },
            pending: { count: pendingCount, total: pendingTotal, sales: pendingSales },
            lowStock,
            recentSales
        });
    } catch (err) { next(err); }
});

module.exports = router;
