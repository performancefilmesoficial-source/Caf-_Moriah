'use strict';
const jwt = require('jsonwebtoken');

// Fallback igual ao original — mantém compatibilidade com tokens já emitidos.
// Para segurança máxima, defina JWT_SECRET nas variáveis de ambiente do Coolify.
const SECRET = process.env.JWT_SECRET || 'moriah_segredo_pdv_2026';

if (!process.env.JWT_SECRET) {
    console.warn('[AVISO] JWT_SECRET não definido. Usando chave padrão — defina JWT_SECRET em produção para mais segurança.');
}

function authenticateJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Sessão expirada ou token inválido.' });
        req.user = user;
        next();
    });
}

module.exports = { authenticateJWT, SECRET };
