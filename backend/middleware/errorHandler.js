'use strict';

/**
 * Handler global de erros — captura qualquer erro não tratado nas rotas.
 * Substitui os try/catch individuais que só fazem res.status(500).json({ error: err.message })
 */
function errorHandler(err, req, res, next) {
    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Erro interno do servidor.';

    // Não loga erros 4xx (validação) poluindo o log
    if (status >= 500) {
        console.error(`[ERROR] ${req.method} ${req.path} →`, err);
    }

    res.status(status).json({ error: message });
}

/**
 * Middleware para rotas não encontradas (404)
 */
function notFound(req, res) {
    res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.path}` });
}

module.exports = { errorHandler, notFound };
