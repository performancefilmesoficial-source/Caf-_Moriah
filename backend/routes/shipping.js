'use strict';
const express = require('express');
const axios = require('axios');
const { getDb } = require('../config/database');
const { notifyCustomerTracking } = require('../services/notificationService');

const router = express.Router();
const MELHORENVIO_TOKEN = process.env.MELHORENVIO_TOKEN;
const ORIGIN_CEP = '44002622';

function isFeiraDeSantanaCep(cep) {
    const num = parseInt(String(cep).replace(/\D/g, ''), 10);
    return num >= 44000000 && num <= 44149999;
}

// POST /api/shipping/calculate
router.post('/calculate', async (req, res, next) => {
    const { destinationCep, cartItems } = req.body;
    if (!destinationCep || destinationCep.length < 8)
        return res.status(400).json({ error: 'CEP inválido.' });

    // CEP local Feira de Santana
    if (isFeiraDeSantanaCep(destinationCep)) {
        const cartTotal = (cartItems || []).reduce((acc, i) => acc + parseFloat(i.price) * i.quantity, 0);
        return res.json({
            success: true,
            localDelivery: true,
            services: [
                { id: 'feira-expressa', name: 'Expressa Moriah ☕', price: '12.00', delivery_time: 'Até 2 horas', local: true },
                { id: 'feira-padrao', name: 'Entrega Padrão Feira', price: cartTotal >= 100 ? '0.00' : '7.00', delivery_time: 'Até 24h úteis', local: true, free: cartTotal >= 100 }
            ]
        });
    }

    try {
        let totalWeight = 0;
        (cartItems || []).forEach(i => { totalWeight += (i.weight_grams || 250) * i.quantity; });
        const weightKg = parseFloat(Math.max(totalWeight / 1000, 0.3).toFixed(2));

        const payload = {
            from: { postal_code: ORIGIN_CEP },
            to: { postal_code: destinationCep },
            products: [{ id: '1', width: 20, height: 20, length: 20, weight: weightKg, insurance_value: 50.0, quantity: 1 }]
        };

        let services = [];
        if (MELHORENVIO_TOKEN) {
            const resp = await axios.post('https://melhorenvio.com.br/api/v2/me/shipment/calculate', payload, {
                headers: {
                    Authorization: `Bearer ${MELHORENVIO_TOKEN}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'MoriahCafe (atendimento@moriahcafe.com)'
                }
            });
            services = resp.data
                .filter(s => !s.error && (s.name.includes('PAC') || s.name.includes('SEDEX')))
                .map(s => ({
                    id: s.id, name: s.name, price: s.price,
                    delivery_time: s.custom_delivery_time ? `${s.custom_delivery_time} dias úteis` : 'Consulte o prazo'
                }));
        } else {
            services = [
                { id: 1, name: 'PAC - Correios', price: '25.90', delivery_time: 'Até 7 dias úteis' },
                { id: 2, name: 'SEDEX - Correios', price: '48.50', delivery_time: 'Até 2 dias úteis' }
            ];
        }
        res.json({ success: true, services });
    } catch (err) {
        console.error('[FRETE] Erro, usando simulado:', err.message);
        res.json({
            success: true,
            services: [
                { id: 1, name: 'PAC - Correios', price: '25.90', delivery_time: 'Até 7 dias úteis' },
                { id: 2, name: 'SEDEX - Correios', price: '48.50', delivery_time: 'Até 2 dias úteis' }
            ]
        });
    }
});

// POST /api/shipping/generate-label
router.post('/generate-label', async (req, res, next) => {
    const { sale_id } = req.body;
    const db = getDb();
    try {
        const [sales] = await db.query('SELECT * FROM sales WHERE id = ?', [sale_id]);
        if (!sales.length) return res.status(404).json({ error: 'Pedido não encontrado.' });

        const sale = sales[0];
        if (!sale.shipping_service || sale.shipping_service === 'RETIRADA' || !sale.customer_cep)
            return res.status(400).json({ error: 'Venda física ou sem frete informado.' });
        if (sale.shipping_service?.includes('Expressa Moriah') || sale.shipping_service?.includes('Padrão Feira'))
            return res.status(400).json({ error: 'Entrega local de Feira de Santana não usa transportadora.' });

        const hasFullAddress = sale.customer_street && sale.customer_city && sale.customer_state;

        // ─── Melhor Envio Real ────────────────────────────────────────────────
        if (MELHORENVIO_TOKEN && hasFullAddress && sale.shipping_service_id) {
            const [items] = await db.query(
                'SELECT si.quantity, si.price, si.product_name, COALESCE(p.weight_grams, 250) AS weight_grams FROM sale_items si LEFT JOIN products p ON si.product_id = p.id WHERE si.sale_id = ?',
                [sale_id]
            );
            const totalWeight = items.reduce((acc, i) => acc + i.weight_grams * i.quantity, 0);
            const totalValue = items.reduce((acc, i) => acc + parseFloat(i.price) * i.quantity, 0);
            const weightKg = parseFloat(Math.max(totalWeight / 1000, 0.1).toFixed(2));

            const meHeaders = {
                Authorization: `Bearer ${MELHORENVIO_TOKEN}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'User-Agent': 'MoriahCafe (atendimento@moriahcafe.com)'
            };

            const cartPayload = {
                service: parseInt(sale.shipping_service_id),
                from: {
                    name: process.env.STORE_NAME || 'Moriah Café',
                    phone: process.env.STORE_PHONE || '75992073245',
                    email: process.env.STORE_EMAIL || 'atendimento@moriahcafe.com',
                    document: process.env.STORE_DOCUMENT || '',
                    address: process.env.STORE_ADDRESS || 'Endereço da Loja',
                    complement: process.env.STORE_COMPLEMENT || null,
                    number: process.env.STORE_NUMBER || 'S/N',
                    district: process.env.STORE_DISTRICT || 'Centro',
                    city: process.env.STORE_CITY || 'Feira de Santana',
                    country_id: 'BR',
                    postal_code: ORIGIN_CEP,
                    state_abbr: process.env.STORE_STATE || 'BA'
                },
                to: {
                    name: sale.customer_name || 'Cliente',
                    phone: (sale.customer_phone || '').replace(/\D/g, ''),
                    email: sale.customer_email || '',
                    document: (sale.customer_cpf || '').replace(/\D/g, ''),
                    address: sale.customer_street || '',
                    complement: sale.customer_complement || null,
                    number: sale.customer_address_number || 'S/N',
                    district: sale.customer_neighborhood || '',
                    city: sale.customer_city || '',
                    country_id: 'BR',
                    postal_code: (sale.customer_cep || '').replace(/\D/g, ''),
                    state_abbr: sale.customer_state || ''
                },
                products: items.map(i => ({ name: i.product_name || 'Produto', quantity: i.quantity, unitary_value: parseFloat(i.price) })),
                volumes: [{ height: 20, width: 20, length: 20, weight: weightKg }],
                options: { insurance_value: parseFloat(totalValue.toFixed(2)), receipt: false, own_hand: false, reverse: false, non_commercial: true }
            };

            const cartResp = await axios.post('https://melhorenvio.com.br/api/v2/me/shipment/cart', cartPayload, { headers: meHeaders });
            const meOrderId = cartResp.data.id;

            await axios.post('https://melhorenvio.com.br/api/v2/me/shipment/checkout', { orders: [meOrderId] }, { headers: meHeaders });
            await axios.post('https://melhorenvio.com.br/api/v2/me/shipment/generate', { orders: [meOrderId] }, { headers: meHeaders });

            let trackingCode = `ME-${meOrderId.substring(0, 8).toUpperCase()}`;
            try {
                const trackResp = await axios.get(`https://melhorenvio.com.br/api/v2/me/shipment/tracking?orders[]=${meOrderId}`, { headers: meHeaders });
                if (trackResp.data?.[meOrderId]) trackingCode = trackResp.data[meOrderId];
            } catch (_) { }

            const labelProxyUrl = `/api/shipping/label/${sale_id}`;
            await db.run('UPDATE sales SET tracking_code = ?, status = ?, me_order_id = ?, label_url = ? WHERE id = ?',
                [trackingCode, 'Etiqueta Gerada', meOrderId, labelProxyUrl, sale_id]);
            notifyCustomerTracking(sale, trackingCode);
            return res.json({ success: true, tracking_code: trackingCode, label_url: labelProxyUrl });
        }

        // ─── Fallback simulação ───────────────────────────────────────────────
        const trackingCode = `BR${Math.floor(Math.random() * 999999999)}ME`;
        await db.run('UPDATE sales SET tracking_code = ?, status = ? WHERE id = ?', [trackingCode, 'Etiqueta Gerada', sale_id]);
        notifyCustomerTracking(sale, trackingCode);
        res.json({ success: true, tracking_code: trackingCode, label_url: 'https://rastreamento.correios.com.br/app/index.php', simulated: true });

    } catch (err) {
        const errMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        console.error('[LABEL]', errMsg);
        try {
            const [sales] = await db.query('SELECT customer_phone, customer_name FROM sales WHERE id = ?', [sale_id]);
            const trackingCode = `BR${Math.floor(Math.random() * 999999999)}ME`;
            await db.run('UPDATE sales SET tracking_code = ?, status = ? WHERE id = ?', [trackingCode, 'Etiqueta Gerada', sale_id]);
            if (sales[0]) notifyCustomerTracking(sales[0], trackingCode);
            res.json({ success: true, tracking_code: trackingCode, label_url: 'https://rastreamento.correios.com.br/app/index.php', simulated: true, api_error: errMsg });
        } catch (dbErr) { next(dbErr); }
    }
});

// GET /api/shipping/label/:sale_id  (proxy PDF etiqueta)
router.get('/label/:sale_id', async (req, res, next) => {
    if (!MELHORENVIO_TOKEN) return res.status(400).send('Token Melhor Envio não configurado.');
    try {
        const db = getDb();
        const [sales] = await db.query('SELECT me_order_id FROM sales WHERE id = ?', [req.params.sale_id]);
        if (!sales.length || !sales[0].me_order_id)
            return res.status(404).send('Etiqueta não encontrada.');

        const printResp = await axios.get(
            `https://melhorenvio.com.br/api/v2/me/shipment/print?mode=private&orders[]=${sales[0].me_order_id}`,
            {
                headers: {
                    Authorization: `Bearer ${MELHORENVIO_TOKEN}`,
                    Accept: 'application/pdf, application/json',
                    'User-Agent': 'MoriahCafe (atendimento@moriahcafe.com)'
                },
                responseType: 'arraybuffer'
            }
        );
        const ct = printResp.headers['content-type'] || 'application/pdf';
        res.setHeader('Content-Type', ct);
        if (ct.includes('pdf'))
            res.setHeader('Content-Disposition', `attachment; filename="etiqueta-${req.params.sale_id}.pdf"`);
        res.send(Buffer.from(printResp.data));
    } catch (err) {
        try {
            const json = JSON.parse(Buffer.from(err.response?.data || '{}').toString());
            if (json.url) return res.redirect(json.url);
        } catch (_) { }
        res.status(500).send('Erro ao obter etiqueta. Acesse https://melhorenvio.com.br/envios');
    }
});

module.exports = router;
