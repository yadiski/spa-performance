// Tiny static file server with SPA fallback + /api reverse proxy.
// Binds to 0.0.0.0:$PORT so Railway's edge router can reach it.

const port = Number(process.env.PORT) || 3000;
const apiOrigin = process.env.API_ORIGIN ?? '';
const dist = `${import.meta.dir}/dist`;

const server = Bun.serve({
  port,
  hostname: '0.0.0.0',
  async fetch(req) {
    const url = new URL(req.url);

    // Proxy /api and /api/auth to the API service.
    if ((url.pathname === '/api' || url.pathname.startsWith('/api/')) && apiOrigin) {
      const forwarded = new URL(url.pathname + url.search, apiOrigin);
      const init: RequestInit = {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
        redirect: 'manual',
      };
      return fetch(forwarded, init);
    }

    // Serve static files; fall back to index.html for client-side routing.
    const candidate = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = Bun.file(dist + candidate);
    if (await file.exists()) return new Response(file);
    return new Response(Bun.file(dist + '/index.html'));
  },
});

console.log(`web serving 0.0.0.0:${server.port} (api proxy: ${apiOrigin || 'none'})`);
