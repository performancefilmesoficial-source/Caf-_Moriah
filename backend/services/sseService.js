'use strict';

/**
 * sseService.js — Server-Sent Events para sincronização em tempo real.
 *
 * Como funciona:
 *  1. PDV e e-commerce conectam em GET /api/sse/stock
 *  2. Quando qualquer venda é finalizada (PDV ou e-commerce), chama broadcast()
 *  3. Todos os clientes conectados recebem o evento e atualizam o estoque localmente
 *
 * Não requer WebSocket — funciona via HTTP padrão, sem pacotes extras.
 */

const clients = new Set();

/**
 * Middleware Express para abrir um stream SSE com o cliente.
 * Registra o cliente e remove quando a conexão fecha.
 */
function sseMiddleware(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Nginx: desativa buffering
    res.flushHeaders();

    // Ping a cada 25s para manter a conexão viva (proxies matam idle após 30s)
    const ping = setInterval(() => {
        res.write(': ping\n\n');
    }, 25000);

    clients.add(res);

    req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
    });
}

/**
 * Envia um evento SSE para todos os clientes conectados.
 * @param {string} event - Nome do evento (ex: 'stock-update')
 * @param {object} data  - Payload JSON
 */
function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
        try {
            client.write(payload);
        } catch (_) {
            clients.delete(client);
        }
    }
}

/**
 * Broadcast de atualização de estoque após uma venda.
 * @param {Array} items - Array de { product_id, quantity } deduzidos do estoque
 */
function broadcastStockUpdate(items) {
    broadcast('stock-update', { items, ts: Date.now() });
}

module.exports = { sseMiddleware, broadcast, broadcastStockUpdate };
