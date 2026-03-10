'use strict';
const express = require('express');
const axios = require('axios');
const { getDb } = require('../config/database');
const { checkoutLimiter } = require('../middleware/rateLimiters');
const { sendOrderConfirmationEmail, notifyOwnerNewOrder } = require('../services/notificationService');
const { broadcastStockUpdate } = require('../services/sseService');

const router = express.Router();
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = 'https://api.asaas.com/v3';

// POST /api/checkout
router.post('/', checkoutLimiter, async (req, res, next) => {
    const {
        customerName, customerEmail, customerCpf, customerPhone,
        customerCep, customerAddressNumber, customerStreet, customerNeighborhood,
        customerCity, customerState, customerComplement,
        cartItems, totalAmount, billingType, cardData,
        shippingCost, shippingService, shippingServiceId
    } = req.body;

    const db = getDb();

    // ─── 1. Validar estoque ───────────────────────────────────────────────────
    try {
        for (const item of cartItems) {
            const [rows] = await db.query('SELECT stock, name FROM products WHERE id = ?', [item.id]);
            if (!rows.length)
                return res.status(400).json({ success: false, error: `Produto não encontrado: ${item.name}` });
            if (rows[0].stock < item.quantity)
                return res.status(400).json({
                    success: false,
                    error: `"${rows[0].name}" sem estoque suficiente. Disponível: ${rows[0].stock}.`
                });
        }
    } catch (err) {
        return res.status(500).json({ success: false, error: 'Erro ao verificar estoque.' });
    }

    const saleData = {
        total: parseFloat(totalAmount),
        method: billingType === 'CREDIT_CARD' ? 'Cartão de Crédito' : 'PIX',
        origin: 'Online',
        customerPhone: customerPhone || '',
        customerName, customerEmail, customerCpf,
        customerCep: customerCep || '',
        customerAddressNumber: customerAddressNumber || '',
        customerStreet: customerStreet || '',
        customerNeighborhood: customerNeighborhood || '',
        customerCity: customerCity || '',
        customerState: customerState || '',
        customerComplement: customerComplement || '',
        shippingCost: shippingCost || 0,
        shippingService: shippingService || 'CORREIOS',
        shippingServiceId: shippingServiceId || null
    };

    // ─── Helper: salva venda + baixa estoque ──────────────────────────────────
    async function saveOrder(paymentId, status) {
        return db.transaction(async (tx) => {
            const result = await tx.run(
                `INSERT INTO sales
                 (total, method, origin, status, customer_phone, payment_id, customer_name,
                  customer_email, customer_cpf, customer_cep, customer_address_number, customer_street,
                  customer_neighborhood, customer_city, customer_state, customer_complement,
                  shipping_cost, shipping_service, shipping_service_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [saleData.total, saleData.method, saleData.origin, status,
                 saleData.customerPhone, paymentId, saleData.customerName,
                 saleData.customerEmail, saleData.customerCpf, saleData.customerCep,
                 saleData.customerAddressNumber, saleData.customerStreet,
                 saleData.customerNeighborhood, saleData.customerCity,
                 saleData.customerState, saleData.customerComplement,
                 saleData.shippingCost, saleData.shippingService, saleData.shippingServiceId]
            );
            const saleId = result[0].insertId;
            for (const item of cartItems) {
                await tx.run(
                    'INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)',
                    [saleId, item.id, item.name, item.quantity, item.price]
                );
                await tx.run('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.id]);
            }
            return saleId;
        });
    }

    // ─── 2. Checkout sem Asaas (pedido manual) ───────────────────────────────
    if (!ASAAS_API_KEY) {
        try {
            const fakeId = `MANUAL-${Date.now()}`;
            await saveOrder(fakeId, 'Aguardando Pagamento');

            broadcastStockUpdate(cartItems.map(i => ({ product_id: i.id, quantity: i.quantity })));
            notifyOwnerNewOrder({ customerName, customerPhone, customerCep, totalAmount, billingType, shippingService, shippingCost, cartItems });

            const pixPayload = `00020126360014BR.GOV.BCB.PIX0114+5575992073245520400005303986540${parseFloat(totalAmount).toFixed(2)}5802BR5912MORIAH CAFE6009SAO PAULO62070503***6304ABCD`;
            return res.json({
                success: true,
                sale_id: fakeId,
                pixPayload,
                encodedImage: null,
                invoiceUrl: 'https://wa.me/5575992073245?text=Olá%2C+fiz+um+pedido+no+site',
                note: 'Pedido registrado. Entre em contato via WhatsApp para confirmar o pagamento.'
            });
        } catch (err) {
            return res.status(500).json({ success: false, error: 'Erro ao registrar pedido.' });
        }
    }

    // ─── 3. Checkout com Asaas ───────────────────────────────────────────────
    try {
        const custResp = await axios.post(`${ASAAS_URL}/customers`, {
            name: customerName, email: customerEmail,
            cpfCnpj: customerCpf || '', phone: customerPhone || ''
        }, { headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' } });

        const paymentPayload = {
            customer: custResp.data.id,
            billingType: billingType || 'PIX',
            dueDate: new Date().toISOString().split('T')[0],
            value: parseFloat(totalAmount),
            description: 'Pedido E-commerce Moriah Café'
        };

        if (billingType === 'CREDIT_CARD') {
            paymentPayload.creditCard = {
                holderName: cardData.holderName,
                number: cardData.number,
                expiryMonth: cardData.expiryMonth.padStart(2, '0'),
                expiryYear: cardData.expiryYear,
                ccv: cardData.ccv
            };
            paymentPayload.creditCardHolderInfo = {
                name: customerName, email: customerEmail, cpfCnpj: customerCpf,
                postalCode: customerCep, addressNumber: customerAddressNumber, phone: customerPhone
            };
            const rawIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
                || req.headers['x-real-ip'] || req.socket.remoteAddress || '189.6.0.1';
            const cleanIp = rawIp.replace(/^::ffff:/, '');
            const isValidIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(cleanIp) && cleanIp !== '127.0.0.1';
            paymentPayload.remoteIp = isValidIpv4 ? cleanIp : '189.6.0.1';
        }

        const payResp = await axios.post(`${ASAAS_URL}/payments`, paymentPayload, {
            headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' }
        });

        const paymentId = payResp.data.id;
        const invoiceUrl = payResp.data.invoiceUrl;
        let pixPayload = null, encodedImage = null;

        if (billingType === 'PIX') {
            const qrResp = await axios.get(`${ASAAS_URL}/payments/${paymentId}/pixQrCode`, {
                headers: { 'access_token': ASAAS_API_KEY }
            });
            pixPayload = qrResp.data.payload;
            encodedImage = qrResp.data.encodedImage;
        }

        const status = billingType === 'CREDIT_CARD' ? 'Pago' : 'Pendente';
        try {
            await saveOrder(paymentId, status);
            broadcastStockUpdate(cartItems.map(i => ({ product_id: i.id, quantity: i.quantity })));
        } catch (dbErr) {
            console.error('[CHECKOUT] Pagamento aprovado mas falhou ao salvar no DB:', dbErr.message);
        }

        sendOrderConfirmationEmail(customerEmail, customerName, totalAmount, invoiceUrl);
        notifyOwnerNewOrder({ customerName, customerPhone, customerCep, totalAmount, billingType, shippingService, shippingCost, cartItems });

        res.json({ success: true, sale_id: paymentId, pixPayload, encodedImage, invoiceUrl });

    } catch (error) {
        const asaasData = error.response?.data;
        console.error('[CHECKOUT ASAAS]', asaasData || error.message);

        let friendlyError = 'Erro ao processar pagamento. Verifique seus dados e tente novamente.';
        if (asaasData?.errors?.length) {
            friendlyError = asaasData.errors.map(e => e.description || e.code).join(' | ');
        } else if (asaasData?.description) {
            friendlyError = asaasData.description;
        } else if (error.message) {
            friendlyError = error.message;
        }
        res.status(500).json({ success: false, error: friendlyError, raw: asaasData || null });
    }
});

module.exports = router;
