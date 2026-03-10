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
            const [rows] = await db.query('SELECT stock, stock_moido, stock_grao, name FROM products WHERE id = ?', [item.id]);
            if (!rows.length) return res.status(400).json({ error: 'Produto não encontrado: ' + item.id });

            let available = rows[0].stock;
            if (item.grind === 'Pó/Moído') available = rows[0].stock_moido;
            else if (item.grind === 'Em Grão') available = rows[0].stock_grao;

            if (available < item.quantity)
                return res.status(400).json({ error: `Estoque insuficiente (${item.grind || 'Geral'}): ${rows[0].name}` });
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

                if (item.grind === 'Pó/Moído') {
                    await tx.run('UPDATE products SET stock_moido = stock_moido - ? WHERE id = ?', [item.quantity, item.id]);
                } else if (item.grind === 'Em Grão') {
                    await tx.run('UPDATE products SET stock_grao = stock_grao - ? WHERE id = ?', [item.quantity, item.id]);
                } else {
                    await tx.run('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.id]);
                }
            }
            return sId;
        });
        // ... (rest of charge route logic remains and NSU logic remains)
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
                    description: `${i.name}${i.grind ? ' (' + i.grind + ')' : ''}`.substring(0, 60)
                })),
                redirect_url: `${PDV_BASE_URL}/?ip_paid=${saleId}`,
                webhook_url: `${PDV_BASE_URL}/api/webhooks/infinitepay`
            }, { headers: { 'Content-Type': 'application/json' }, timeout: 8000 });

            checkoutUrl = ipRes.data?.checkout_url
                || ipRes.data?.url
                || ipRes.data?.link
                || `https://checkout.infinitepay.io/${INFINITEPAY_HANDLE}`;

            await db.run('UPDATE sales SET payment_id = ? WHERE id = ?', [orderNsu, saleId]);
        } catch (ipErr) {
            console.error('[INFINITEPAY] Falha ao criar cobrança:', ipErr.response?.data || ipErr.message);
        }

        broadcastStockUpdate(items.map(i => ({ product_id: i.id, quantity: i.quantity, grind: i.grind })));
        res.json({ success: true, sale_id: saleId, checkout_url: checkoutUrl });

    } catch (err) { next(err); }
});

// GET /api/pdv/infinitepay/status/:sale_id
router.get('/infinitepay/status/:sale_id', async (req, res, next) => {
    try {
        const db = getDb();
        const [rows] = await db.query('SELECT status, method FROM sales WHERE id = ?', [req.params.sale_id]);
        if (!rows.length) return res.status(404).json({ error: 'Venda não encontrada.' });
        res.json({ paid: rows[0].status === 'Pago' || rows[0].status === 'Concluído', status: rows[0].status, method: rows[0].method });
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

// POST /api/pdv/infinitepay/tap (Tap to Pay nativo)
router.post('/infinitepay/tap', async (req, res, next) => {
    const { total, items, cardType } = req.body;
    if (!total || total <= 0) return res.status(400).json({ error: 'Valor inválido.' });
    if (!items || !items.length) return res.status(400).json({ error: 'Carrinho vazio.' });

    try {
        const db = getDb();

        // Validar estoque
        for (const item of items) {
            const [rows] = await db.query('SELECT stock, stock_moido, stock_grao, name FROM products WHERE id = ?', [item.id]);
            if (!rows.length) return res.status(400).json({ error: 'Produto não encontrado: ' + item.id });

            let available = rows[0].stock;
            if (item.grind === 'Pó/Moído') available = rows[0].stock_moido;
            else if (item.grind === 'Em Grão') available = rows[0].stock_grao;

            if (available < item.quantity)
                return res.status(400).json({ error: `Estoque insuficiente (${item.grind || 'Geral'}): ${rows[0].name}` });
        }

        // Criar venda pendente no banco
        const methodLabel = cardType === 'debit' ? 'Cartão Débito' : 'Cartão Crédito';
        const saleId = await db.transaction(async (tx) => {
            const result = await tx.run(
                'INSERT INTO sales (total, method, origin, status, customer_name) VALUES (?, ?, ?, ?, ?)',
                [parseFloat(total), methodLabel, 'Físico (Tap)', 'Aguardando Pagamento', 'Cliente PDV']
            );
            const sId = result[0].insertId;
            for (const item of items) {
                await tx.run('INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)',
                    [sId, item.id, item.name, item.quantity, item.price]);

                if (item.grind === 'Pó/Moído') {
                    await tx.run('UPDATE products SET stock_moido = stock_moido - ? WHERE id = ?', [item.quantity, item.id]);
                } else if (item.grind === 'Em Grão') {
                    await tx.run('UPDATE products SET stock_grao = stock_grao - ? WHERE id = ?', [item.quantity, item.id]);
                } else {
                    await tx.run('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.id]);
                }
            }
            return sId;
        });

        broadcastStockUpdate(items.map(i => ({ product_id: i.id, quantity: i.quantity, grind: i.grind })));
        res.json({ success: true, sale_id: saleId, total: parseFloat(total) });

    } catch (err) { next(err); }
});

// GET /api/pdv/receipt/:sale_id (Recibo público com meta tags)
router.get('/receipt/:sale_id', async (req, res, next) => {
    try {
        const db = getDb();
        const [saleRows] = await db.query('SELECT * FROM sales WHERE id = ?', [req.params.sale_id]);
        if (!saleRows.length) return res.status(404).send('Venda não encontrada');
        const sale = saleRows[0];

        const [itemRows] = await db.query('SELECT * FROM sale_items WHERE sale_id = ?', [req.params.sale_id]);

        const itemsHtml = itemRows.map(i => `<li>${i.quantity}x ${i.product_name} - R$ ${i.price.toFixed(2)}</li>`).join('');

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Recibo - Moriah Café</title>
                <!-- Meta tags para preview no WhatsApp -->
                <meta property="og:title" content="Recibo Moriah Café - R$ ${sale.total.toFixed(2)}">
                <meta property="og:description" content="Obrigado pela sua compra! Clique para ver os detalhes do seu pedido.">
                <meta property="og:image" content="${PDV_BASE_URL}/favicon.ico">
                <style>
                    body { font-family: sans-serif; padding: 20px; color: #444; background: #fafafa; }
                    .receipt { background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 400px; margin: auto; }
                    h1 { color: #5d4037; font-size: 22px; margin-bottom: 5px; }
                    .total { font-size: 24px; font-weight: bold; margin-top: 20px; border-top: 1px solid #eee; padding-top: 10px; }
                </style>
            </head>
            <body>
                <div class="receipt">
                    <h1>Moriah Café</h1>
                    <p>Comprovante de Venda #${sale.id}</p>
                    <p><small>${new Date(sale.created_at).toLocaleString('pt-BR')}</small></p>
                    <hr>
                    <ul>${itemsHtml}</ul>
                    <div class="total">Total: R$ ${sale.total.toFixed(2)}</div>
                    <p>Pagamento: ${sale.method}</p>
                    <p style="margin-top: 40px; font-size: 12px; color: #999;">Obrigado por escolher o Café Moriah!</p>
                </div>
            </body>
            </html>
        `);
    } catch (err) { next(err); }
});

// POST /api/pdv/send-receipt
const whatsappService = require('../services/whatsappService');
router.post('/send-receipt', async (req, res, next) => {
    const { phone, sale_id, message } = req.body;
    if (!phone || !sale_id) return res.status(400).json({ error: 'Telefone e ID da venda são obrigatórios.' });

    try {
        const db = getDb();
        const [saleRows] = await db.query('SELECT total, method FROM sales WHERE id = ?', [sale_id]);
        if (!saleRows.length) return res.status(404).json({ error: 'Venda não encontrada.' });

        const [settingsRows] = await db.query('SELECT about_image FROM site_settings LIMIT 1');
        const brandingImage = settingsRows[0]?.about_image || `${PDV_BASE_URL}/favicon.ico`;

        // Se a imagem no banco for Base64, a Evolution API aceita se enviarmos o conteúdo puro ou URL.
        // Como o PDV geralmente roda em HTTPS público, passamos a URL.
        const receiptUrl = `${PDV_BASE_URL}/api/pdv/receipt/${sale_id}`;
        const finalMessage = message || `*Moriah Café - Recibo Digital*\n\nValor: R$ ${saleRows[0].total.toFixed(2)}\nPagamento: ${saleRows[0].method}\n\n📄 Ver recibo completo:\n${receiptUrl}`;

        await whatsappService.sendImage(phone.replace(/\D/g, ''), finalMessage, brandingImage);

        // Atualiza/Cria cliente se necessário
        await axios.post(`${PDV_BASE_URL}/api/customers`, { phone: phone.replace(/\D/g, '') }, {
            headers: { 'Authorization': req.headers.authorization }
        }).catch(() => { });

        res.json({ success: true, message: 'Recibo enviado com sucesso!' });
    } catch (err) {
        console.error('[WhatsApp Receipt] Erro:', err.message);
        res.status(500).json({ error: 'Erro ao enviar WhatsApp. Verifique a API.' });
    }
});

module.exports = router;
