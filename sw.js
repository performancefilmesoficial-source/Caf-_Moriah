/**
 * sw.js — Service Worker do PDV Moriah Café
 *
 * Estratégia:
 *  - Cache-First para assets estáticos (JS, CSS, imagens do CDN)
 *  - Network-First com fallback para API de produtos (/api/products)
 *  - Fila offline para vendas: salva no IndexedDB e sincroniza ao reconectar
 *
 * Registre no index.html com:
 *   if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
 */

const CACHE_NAME   = 'moriah-pdv-v2';
const OFFLINE_QUEUE_DB = 'moriah-offline-queue';

// Assets que devem funcionar offline
const PRECACHE = [
    '/',
    '/index.html',
    // React, Babel, Tailwind, Lucide via CDN são cacheados na primeira visita
];

// ─── Install: pré-carrega assets críticos ────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
    );
    self.skipWaiting();
});

// ─── Activate: limpa caches antigos ─────────────────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// ─── Fetch: intercepta requisições ───────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Ignora: SSE, WebSocket, POST de checkout/sales (tratado pela fila offline)
    if (request.method !== 'GET') return;
    if (url.pathname === '/api/sse/stock') return;

    // API de produtos: Network-First com fallback para cache
    if (url.pathname === '/api/products' || url.pathname === '/api/products/online') {
        event.respondWith(networkFirstWithCache(request));
        return;
    }

    // Assets estáticos e CDN: Cache-First
    if (
        url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?)$/) ||
        url.hostname !== location.hostname
    ) {
        event.respondWith(cacheFirst(request));
        return;
    }

    // Tudo mais: Network-First
    event.respondWith(networkFirstWithCache(request));
});

// ─── Background Sync: fila de vendas offline ─────────────────────────────────
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-offline-sales') {
        event.waitUntil(syncOfflineSales());
    }
});

// ─── Strategies ──────────────────────────────────────────────────────────────

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch (_) {
        return new Response('Offline', { status: 503 });
    }
}

async function networkFirstWithCache(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch (_) {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'Sem conexão. Dados em cache podem estar desatualizados.' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// ─── IndexedDB: fila de vendas offline ───────────────────────────────────────

function openQueueDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(OFFLINE_QUEUE_DB, 1);
        req.onupgradeneeded = (e) => {
            e.target.result.createObjectStore('sales', { keyPath: 'localId', autoIncrement: true });
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror   = (e) => reject(e.target.error);
    });
}

async function syncOfflineSales() {
    const db = await openQueueDb();
    const tx = db.transaction('sales', 'readwrite');
    const store = tx.objectStore('sales');

    const pending = await new Promise((res, rej) => {
        const req = store.getAll();
        req.onsuccess = () => res(req.result);
        req.onerror   = () => rej(req.error);
    });

    for (const sale of pending) {
        try {
            const response = await fetch('/api/sales', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sale._token}`
                },
                body: JSON.stringify(sale.data)
            });
            if (response.ok) {
                store.delete(sale.localId);
                console.log('[SW] Venda offline sincronizada:', sale.localId);
            }
        } catch (err) {
            console.warn('[SW] Falha ao sincronizar venda offline:', err.message);
        }
    }
}

// ─── Mensagens do cliente ─────────────────────────────────────────────────────
// O PDV envia mensagem { type: 'QUEUE_SALE', data, token } quando offline
self.addEventListener('message', async (event) => {
    if (event.data?.type === 'QUEUE_SALE') {
        try {
            const db = await openQueueDb();
            const tx = db.transaction('sales', 'readwrite');
            tx.objectStore('sales').add({ data: event.data.sale, _token: event.data.token });
            event.source?.postMessage({ type: 'SALE_QUEUED', success: true });
        } catch (err) {
            event.source?.postMessage({ type: 'SALE_QUEUED', success: false, error: err.message });
        }
    }
});
