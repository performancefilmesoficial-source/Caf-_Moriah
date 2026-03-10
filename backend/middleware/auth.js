'use strict';
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// Aviso em desenvolvimento se JWT_SECRET não estiver definido
if (!JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        console.error('[FATAL] JWT_SECRET não definido em produção! Defina a variável de ambiente JWT_SECRET.');
        process.exit(1);
    } else {
        console.warn('[AVISO] JWT_SECRET não definido. Usando fallback de desenvolvimento.');
    }
}

const SECRET = JWT_SECRET || 'moriah_segredo_pdv_dev_APENAS';

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

module.exports = { authenticateJWT, JWT_SECRET: SECRET };
