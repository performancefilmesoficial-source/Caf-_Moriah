'use strict';
const axios = require('axios');
const nodemailer = require('nodemailer');

// ─── Email transporter ────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
    }
});

async function sendOrderConfirmationEmail(to, customerName, totalAmount, invoiceUrl) {
    if (!process.env.SMTP_USER) return;
    try {
        await transporter.sendMail({
            from: '"Moriah Café Especial" <atendimento@moriahcafe.com>',
            to,
            subject: 'Sua compra no Moriah Café! ☕',
            html: `<p>Olá ${customerName}, sua compra de R$ ${totalAmount} foi registrada!</p><br><p><a href="${invoiceUrl}">Acessar Fatura</a></p>`
        });
    } catch (e) {
        console.error('[EMAIL]', e.message);
    }
}

// ─── WhatsApp via Meta Cloud API ──────────────────────────────────────────────

function sendWhatsApp(phone, message) {
    const token = process.env.META_WHATSAPP_TOKEN;
    const phoneId = process.env.META_PHONE_NUMBER_ID;
    if (!token || !phoneId || !phone) return;

    axios.post(
        `https://graph.facebook.com/v19.0/${phoneId}/messages`,
        { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: message } },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    ).catch(err => console.error('[WA META]', err.response?.data || err.message));
}

function notifyOwnerNewOrder({ customerName, customerPhone, customerCep, totalAmount, billingType, shippingService, shippingCost, cartItems }) {
    const ownerPhone = process.env.OWNER_PHONE;
    if (!ownerPhone) return;

    const shippingLabel = shippingService === 'RETIRADA' ? 'Retirada na Loja'
        : shippingService?.includes('Expressa') ? 'Expressa Moriah (Feira)'
        : shippingService?.includes('Padrão Feira') ? 'Padrão Feira de Santana'
        : `Correios - ${shippingService || 'A definir'}`;
    const shippingCostLabel = parseFloat(shippingCost) > 0
        ? `R$ ${parseFloat(shippingCost).toFixed(2).replace('.', ',')}` : 'GRÁTIS';
    const paymentLabel = billingType === 'CREDIT_CARD' ? 'Cartão de Crédito' : 'PIX';
    const itemsList = (cartItems || []).map(i => `  • ${i.name} x${i.quantity}`).join('\n');

    const msg = [
        '☕ *Novo Pedido - Moriah Café*',
        `👤 Cliente: ${customerName}`,
        `📞 Tel: ${customerPhone || 'não informado'}`,
        `📮 CEP: ${customerCep || 'não informado'}`,
        `💰 Total: R$ ${parseFloat(totalAmount).toFixed(2).replace('.', ',')}`,
        `💳 Pagamento: ${paymentLabel}`,
        `🚚 Entrega: ${shippingLabel} — ${shippingCostLabel}`,
        `📦 Itens:\n${itemsList}`,
        `\nAcesse o PDV para acompanhar.`
    ].join('\n');

    sendWhatsApp(ownerPhone, msg);
}

function notifyOwnerPixConfirmed(sale) {
    const ownerPhone = process.env.OWNER_PHONE;
    if (!ownerPhone) return;

    const msg = [
        `✅ *PIX Confirmado — Moriah Café*`,
        ``,
        `👤 Cliente: ${sale.customer_name}`,
        `💰 Valor: R$ ${parseFloat(sale.total).toFixed(2).replace('.', ',')}`,
        `📋 Venda #${sale.id}`,
        ``,
        `Acesse o PDV para preparar o pedido. ☕`
    ].join('\n');

    sendWhatsApp(ownerPhone, msg);
}

function notifyCustomerTracking(sale, trackingCode) {
    const token = process.env.META_WHATSAPP_TOKEN;
    const phoneId = process.env.META_PHONE_NUMBER_ID;
    if (!token || !phoneId) return;

    let phone = (sale.customer_phone || '').replace(/\D/g, '');
    if (!phone) return;
    if (!phone.startsWith('55')) phone = '55' + phone;

    const trackUrl = `https://rastreamento.correios.com.br/app/index.php?label=${trackingCode}`;
    const msg = [
        `☕ *Moriah Café — Seu pedido foi enviado!*`,
        ``,
        `Olá ${sale.customer_name || 'Cliente'}! Seu pedido está a caminho. 📦`,
        ``,
        `🔍 *Código de rastreio:* ${trackingCode}`,
        `🌐 Rastreie em: ${trackUrl}`,
        ``,
        `Qualquer dúvida, fale conosco. Bom café! ☕`
    ].join('\n');

    sendWhatsApp(phone, msg);
}

module.exports = {
    sendOrderConfirmationEmail,
    notifyOwnerNewOrder,
    notifyOwnerPixConfirmed,
    notifyCustomerTracking
};
