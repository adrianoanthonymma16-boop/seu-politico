const CACHE_NAME = 'seu-politico-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/ranking.html',
    '/empresas.html',
    '/politico.html',
    '/senador.html',
    '/src/css/style.css',
    '/src/js/theme.js',
];

// Install — cacheia assets estáticos.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate — limpa caches antigos.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch — network-first para APIs, cache-first para assets estáticos.
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // APIs e dados dinâmicos: network first, fallback para cache.
    if (url.pathname.startsWith('/api/') || url.pathname.includes('camara.leg.br') || url.pathname.includes('legis.senado.leg.br')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // Assets estáticos: cache first, fallback para network.
    event.respondWith(
        caches.match(request)
            .then((cached) => cached || fetch(request)
                .then((response) => {
                    if (response.ok && request.method === 'GET') {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
            )
    );
});
