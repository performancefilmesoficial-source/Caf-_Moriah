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
const authRoutes = require('./routes/auth');
const productsRoutes = require('./routes/products');
const salesRoutes = require('./routes/sales');
const checkoutRoute = require('./routes/checkout');
const shippingRoutes = require('./routes/shipping');
const webhooksRoutes = require('./routes/webhooks');
const dashboardRoute = require('./routes/dashboard');
const pdvRoutes = require('./routes/pdv');
const settingsRoutes = require('./routes/settings');
const customersRoutes = require('./routes/customers');

const app = express();

// ─── Trust Proxy (obrigatório atrás do reverse proxy do Coolify/nginx) ────────
// Sem isso, express-rate-limit lança ValidationError em cada request
app.set('trust proxy', 1);

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

// ─── Rota IA (gerador de SKU/descrição via Gemini) ───────────────────────────
const { GoogleGenerativeAI } = require('@google/generative-ai');

app.post('/api/generate-ai', async (req, res) => {
    const { productName, field } = req.body;
    if (!productName) return res.status(400).json({ error: 'Nome do produto não informado.' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'Configuração de IA Pendente: Por favor, configure a GEMINI_API_KEY nas variáveis de ambiente do servidor.' });
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        let prompt = "";
        if (field === 'name') {
            prompt = `Sugira um nome comercial sofisticado, curto e luxuoso para o produto: "${productName}". 
            O nome deve evocar sensações de exclusividade, grãos selecionados e tradição cafeeira premium. 
            Retorne apenas o nome sugerido, sem aspas ou explicações.`;
        } else if (field === 'sku') {
            prompt = `Gere um código SKU único e profissional para o produto: "${productName}". O SKU deve ter o prefixo MORIAH-, ser curto (ex: MORIAH-CAFE-INT) e em maiúsculas. Retorne apenas o código.`;
        } else if (field === 'hero_title') {
            prompt = `Crie um título impactante e luxuoso para a página principal de um e-commerce de cafés especiais chamado Moriah. 
            O título deve ser curto (máximo 10 palavras) e transmitir a sensação de que o café Moriah é um momento sagrado, exclusivo e sensorialmente rico. 
            DICA: Use \n (ex: Seu momento MORIAH\nta te esperando) para quebras de linha estratégicas.
            Retorne apenas o título.`;
        } else if (field === 'hero_text') {
            prompt = `Escreva uma frase descritiva elegante e curta (máximo 20 palavras) para o cabeçalho de um site de cafés premium. 
            Foque na origem, no sabor inconfundível e no cuidado artesanal da Moriah. 
            Retorne apenas o texto.`;
        } else {
            prompt = `Escreva uma descrição detalhada, vendedora e extremamente profissional para o site de e-commerce do produto: "${productName}". 
            Destaque características como notas sensoriais (chocolate, caramelo, frutas), aroma envolvente e a experiência de um café especial superior. 
            Caso seja um acessório, foque no design, durabilidade e como ele eleva o preparo do café.
            Use formatação Markdown leve (negrito para pontos chave). 
            O público é exigente e aprecia cafés de altíssima qualidade.
            Retorne apenas a descrição.`;
        }

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();

        const responseData = {
            sku: field === 'sku' ? text : `MORIAH-${productName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase()}-${Math.floor(Math.random() * 100)}`,
            description: (field === 'description' || !field || field.startsWith('hero_')) ? text : `Descubra a experiência sensorial de ${productName}.`,
            name: field === 'name' ? text : productName,
            [field]: text
        };

        res.json(responseData);
    } catch (error) {
        console.error('Erro Gemini:', error);
        res.status(500).json({ error: 'Falha ao processar IA: ' + (error.message || 'Erro no Gemini') });
    }
});

// ─── Rotas da API ─────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', authRoutes); // /api/users usa o mesmo router de auth
app.use('/api/products', productsRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/checkout', checkoutRoute);
app.use('/api/shipping', shippingRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/dashboard', dashboardRoute);
app.use('/api/pdv', pdvRoutes);
app.use('/api/site-settings', settingsRoutes);
app.use('/api/customers', customersRoutes);

// ─── Arquivos estáticos (imagens antigas em /uploads) ─────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ─── Frontend: roteamento por hostname ───────────────────────────────────────
const ecommerceStatic = express.static(path.join(__dirname, '..', 'frontend_ecommerce'));
const pdvStatic = express.static(path.join(__dirname, '..'));

app.use('/ecommerce', ecommerceStatic);

app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
    const host = req.hostname || '';
    // app.cafemoriah.com.br → PDV admin
    if (host === 'app.cafemoriah.com.br') return pdvStatic(req, res, next);
    // cafemoriah.com.br e www.cafemoriah.com.br → e-commerce
    if (host.includes('cafemoriah.com.br')) return ecommerceStatic(req, res, next);
    // localhost / dev
    return pdvStatic(req, res, next);
});

// ─── Error handlers (SEMPRE por último) ──────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
