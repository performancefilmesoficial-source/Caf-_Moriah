'use strict';

/**
 * app.js — Configuração do Express + rotas.
 * Separado do server.js para facilitar testes e importação.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const multer = require('multer');

const { errorHandler, notFound } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiters');
const { sseMiddleware } = require('./services/sseService');

// ─── Routes ──────────────────────────────────────────────────────────────────
const authRoutes      = require('./routes/auth');
const productsRoutes  = require('./routes/products');
const salesRoutes     = require('./routes/sales');
const checkoutRoute   = require('./routes/checkout');
const shippingRoutes  = require('./routes/shipping');
const webhooksRoutes  = require('./routes/webhooks');
const dashboardRoute  = require('./routes/dashboard');
const pdvRoutes       = require('./routes/pdv');
const settingsRoutes  = require('./routes/settings');

const app = express();

// ─── Segurança: Helmet (headers HTTP seguros) ─────────────────────────────────
// content-security-policy desabilitado: front-end usa CDN externo (React, Tailwind, Babel)
app.use(helmet({ contentSecurityPolicy: false }));

// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.NODE_ENV === 'production'
    ? ['https://cafemoriah.com.br', 'https://www.cafemoriah.com.br']
    : true; // Em dev, aceita qualquer origem

app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// ─── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Rate limit global ────────────────────────────────────────────────────────
app.use('/api/', apiLimiter);

// ─── Rota SSE (sincronização de estoque em tempo real) ───────────────────────
app.get('/api/sse/stock', sseMiddleware);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Moriah PDV Backend funcionando!', ts: Date.now() });
});

// ─── Rota de upload de imagem (converte para Base64) ──────────────────────────
const uploadMiddleware = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.post('/api/upload', uploadMiddleware.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    const mime = req.file.mimetype || 'image/jpeg';
    const base64 = req.file.buffer.toString('base64');
    res.json({ imageUrl: `data:${mime};base64,${base64}` });
});

// ─── Rota IA (gerador de SKU/descrição — mock) ───────────────────────────────
app.post('/api/generate-ai', (req, res) => {
    const { productName } = req.body;
    if (!productName) return res.status(400).json({ error: 'Nome do produto não informado.' });
    const sku = `MORIAH-${productName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
    const description = `Descubra a experiência sensorial única de provar o **${productName}**. Cultivado nas melhores fazendas e torrado artesanalmente para extrair notas surpreendentes. Ideal para seus momentos de pausa ou para impressionar depois de um bom almoço.`;
    setTimeout(() => res.json({ sku, description }), 1200);
});

// ─── Rotas da API ─────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/users',         authRoutes); // /api/users usa o mesmo router de auth
app.use('/api/products',      productsRoutes);
app.use('/api/sales',         salesRoutes);
app.use('/api/checkout',      checkoutRoute);
app.use('/api/shipping',      shippingRoutes);
app.use('/api/webhooks',      webhooksRoutes);
app.use('/api/dashboard',     dashboardRoute);
app.use('/api/pdv',           pdvRoutes);
app.use('/api/site-settings', settingsRoutes);

// ─── Arquivos estáticos (imagens antigas em /uploads) ─────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ─── Frontend: roteamento por hostname ───────────────────────────────────────
const ecommerceStatic = express.static(path.join(__dirname, '..', 'frontend_ecommerce'));
const pdvStatic       = express.static(path.join(__dirname, '..'));

app.use('/ecommerce', ecommerceStatic);

app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
    const host = req.hostname || '';
    if (host.includes('cafemoriah.com.br')) return ecommerceStatic(req, res, next);
    return pdvStatic(req, res, next);
});

// ─── Error handlers (SEMPRE por último) ──────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
