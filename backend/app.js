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
            prompt = `Sugira um nome comercial curto, memorável e extremamente luxuoso para o produto: "${productName}". 
            O nome deve evocar exclusividade, curadoria de grãos selecionados e a sofisticação de uma boutique de cafés. 
            Retorne apenas o nome, sem aspas.`;
        } else if (field === 'sku') {
            prompt = `Gere um código SKU profissional e limpo para: "${productName}". Prefixo MORIAH-, em maiúsculas, curto (ex: MORIAH-EST-01). Retorne apenas o código.`;
        } else if (field === 'hero_title') {
            prompt = `Crie um título principal impactante para um e-commerce de cafés ultra-premium chamado Moriah Café. 
            O tom deve ser poético e sofisticado, apresentando o café como um ritual sagrado e uma experiência sensorial inesquecível.
            Use \n para quebras de linha que criem um impacto visual (ex: Moriah Café\nOnde o grão vira ritual). 
            Máximo 8 palavras. Retorne apenas o título.`;
        } else if (field === 'hero_text') {
            prompt = `Escreva uma linha de apoio (subtítulo) elegante para o topo do site. 
            Foque na alta pontuação dos grãos, no processo artesanal e na entrega de uma experiência que vai além do comum. 
            Máximo 18 palavras. Retorne apenas o texto.`;
        } else if (field === 'about_title') {
            prompt = `Crie um título elegante para a seção 'Nossa História' da Moriah Café. 
            Deve transmitir tradição, paixão pelo café e o compromisso com a excelência. 
            Ex: A Arte de Cultivar o Extraordinário. Retorne apenas o título.`;
        } else if (field === 'about_text_1' || field === 'about_text_2') {
            prompt = `Escreva um parágrafo envolvente e sofisticado sobre a história e os valores do Moriah Café. 
            Fale sobre a busca incessante pelo grão perfeito e o respeito ao produtor e ao terroir. 
            Tom narrativo e luxuoso. Máximo 40 palavras. Retorne apenas o texto.`;
        } else {
            prompt = `Escreva uma descrição detalhada de "Storytelling" para o produto: "${productName}". 
            O texto deve ser vendedora, mas elegante, explorando o terroir, as notas sensoriais (como frutas amarelas, chocolate belga, toffee) e o corpo do café. 
            Se for um acessório, descreva-o como a ferramenta indispensável para o entusiasta que busca a perfeição. 
            Use Markdown básico (negrito para termos chave). Retorne apenas a descrição.`;
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
