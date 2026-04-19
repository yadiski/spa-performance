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
      // Copy headers but drop hop-by-hop and host — the upstream determines its own host.
      const headers = new Headers();
      for (const [k, v] of req.headers) {
        const key = k.toLowerCase();
        if (key === 'host' || key === 'connection' || key === 'content-length') continue;
        headers.set(k, v);
      }
      const init: RequestInit = {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
      };
      try {
        return await fetch(forwarded, init);
      } catch (err) {
        console.error('proxy error', forwarded.href, err);
        return new Response('upstream fetch failed', { status: 502 });
      }
    }

    // Serve static files; fall back to index.html for client-side routing.
    const candidate = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = Bun.file(dist + candidate);
    if (await file.exists()) return new Response(file);
    return new Response(Bun.file(`${dist}/index.html`));
  },
});

console.log(`web serving 0.0.0.0:${server.port} (api proxy: ${apiOrigin || 'none'})`);
