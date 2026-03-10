'use strict';
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false
});

const checkoutLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: 'Muitas requisições. Aguarde um minuto.' },
    standardHeaders: true,
    legacyHeaders: false
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    message: { error: 'Limite de requisições atingido. Aguarde.' },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = { loginLimiter, checkoutLimiter, apiLimiter };
