'use strict';
const express = require('express');
const { getDb } = require('../config/database');
const { authenticateJWT } = require('../middleware/auth');
const whatsappService = require('../services/whatsappService');

const router = express.Router();

// GET /api/customers
router.get('/', authenticateJWT, async (req, res, next) => {
    try {
        const db = getDb();
        const [rows] = await db.query('SELECT * FROM customers ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) { next(err); }
});

// POST /api/customers (Salva ou atualiza)
router.post('/', authenticateJWT, async (req, res, next) => {
    const { name, phone, email } = req.body;
    if (!phone) return res.status(400).json({ error: 'Telefone é obrigatório.' });

    const cleanPhone = phone.replace(/\D/g, '');

    try {
        const db = getDb();
        const [existing] = await db.query('SELECT id FROM customers WHERE phone = ?', [cleanPhone]);

        if (existing.length) {
            await db.run(
                'UPDATE customers SET name = COALESCE(?, name), email = COALESCE(?, email) WHERE phone = ?',
                [name || null, email || null, cleanPhone]
            );
            return res.json({ message: 'Cliente atualizado.' });
        }

        await db.run(
            'INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)',
            [name || 'Cliente PDV', cleanPhone, email || null]
        );
        res.status(201).json({ message: 'Cliente salvo com sucesso!' });
    } catch (err) { next(err); }
});

// DELETE /api/customers/:id
router.delete('/:id', authenticateJWT, async (req, res, next) => {
    try {
        const db = getDb();
        await db.run('DELETE FROM customers WHERE id = ?', [req.params.id]);
        res.json({ message: 'Cliente removido.' });
    } catch (err) { next(err); }
});

// POST /api/customers/bulk-marketing (Disparo para todos)
router.post('/bulk-marketing', authenticateJWT, async (req, res, next) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensagem é obrigatória.' });

    try {
        const db = getDb();
        // Busca clientes que não receberam mensagem nos últimos 15 dias (ou nunca receberam)
        const [customers] = await db.query(`
            SELECT * FROM customers 
            WHERE last_message_at IS NULL 
               OR last_message_at < datetime('now', '-15 days')
        `);

        if (customers.length === 0) {
            return res.json({ message: 'Nenhum cliente elegível para receber marketing hoje (regra de 15 dias).' });
        }

        let successCount = 0;
        let errorCount = 0;

        for (const customer of customers) {
            try {
                await whatsappService.sendText(customer.phone, message);
                await db.run('UPDATE customers SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?', [customer.id]);
                successCount++;
            } catch (err) {
                console.error(`Erro ao enviar para ${customer.phone}:`, err.message);
                errorCount++;
            }
        }

        res.json({
            message: `Disparo concluído. ${successCount} enviados com sucesso, ${errorCount} erros.`,
            successCount,
            errorCount
        });

    } catch (err) { next(err); }
});

module.exports = router;
