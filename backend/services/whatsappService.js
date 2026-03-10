'use strict';
const axios = require('axios');

/**
 * whatsappService.js
 * Centraliza as chamadas para a Evolution API (WhatsApp Gateway).
 */

const WHATSAPP_URL = process.env.WHATSAPP_URL; // Ex: https://sua-api.com
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY; // Global API Key
const WHATSAPP_INSTANCE = process.env.WHATSAPP_INSTANCE || 'MoriahPDV';

/**
 * Envia uma mensagem de texto simples.
 */
async function sendText(phone, text) {
    if (!WHATSAPP_URL) return { error: 'WhatsApp URL não configurada.' };

    try {
        const res = await axios.post(`${WHATSAPP_URL}/message/sendText/${WHATSAPP_INSTANCE}`, {
            number: phone,
            text: text,
            delay: 1200,
            linkPreview: true
        }, {
            headers: { 'apikey': WHATSAPP_API_KEY }
        });
        return res.data;
    } catch (err) {
        console.error('[WhatsApp] Erro sendText:', err.response?.data || err.message);
        throw err;
    }
}

/**
 * Envia uma mensagem com imagem (JPG/PNG).
 */
async function sendImage(phone, text, imageUrl) {
    if (!WHATSAPP_URL) return { error: 'WhatsApp URL não configurada.' };

    try {
        const res = await axios.post(`${WHATSAPP_URL}/message/sendMedia/${WHATSAPP_INSTANCE}`, {
            number: phone,
            mediaMessage: {
                mediatype: 'image',
                caption: text,
                media: imageUrl // Pode ser URL pública ou Base64 (sem prefixo data:)
            },
            delay: 1500
        }, {
            headers: { 'apikey': WHATSAPP_API_KEY }
        });
        return res.data;
    } catch (err) {
        console.error('[WhatsApp] Erro sendImage:', err.response?.data || err.message);
        throw err;
    }
}

module.exports = { sendText, sendImage };
