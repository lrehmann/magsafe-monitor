const base = '/magsafe-monitor';
const publicFiles = new Set([
  'index.html', 'style.css', 'capture.mjs', 'browser-uarp.mjs', 'uarp-replies.mjs',
  'charger-profiles.mjs', 'live-monitor.mjs', 'dotara-stream.mjs', 'live-field-labels.mjs',
  'local-transport.mjs', 'hosted-helper.mjs', 'magsafe-mac-helper.zip',
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === base) {
      url.pathname += '/';
      return Response.redirect(url, 308);
    }
    if (!url.pathname.startsWith(base + '/')) return fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const file = url.pathname.slice(base.length + 1) || 'index.html';
    if (!publicFiles.has(file)) return new Response('Not found', { status: 404 });
    url.pathname = '/' + file;
    const asset = await env.ASSETS.fetch(new Request(url, request));
    const response = new Response(asset.body, asset);
    response.headers.set('Content-Security-Policy', "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    response.headers.set('Permissions-Policy', 'hid=(self)');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    if (file === 'index.html') response.headers.set('Cache-Control', 'no-cache');
    if (file === 'magsafe-mac-helper.zip') response.headers.set('Content-Disposition', 'attachment; filename="magsafe-mac-helper.zip"');
    return response;
  },
};
