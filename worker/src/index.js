/**
 * torto-webdav-proxy — CORS reverse proxy for WebDAV providers.
 *
 * Usage: https://<worker-host>/<full upstream URL>
 *   e.g. https://<worker-host>/https://dav.jianguoyun.com/dav/Rebook/v1/protocol.json
 *
 * - Only whitelisted WebDAV hosts are proxied (prevents open-proxy abuse).
 * - Request/response bodies are streamed (no buffering), so large books pass through.
 * - All WebDAV methods and conditional headers are forwarded.
 */

// Allowed upstream hosts (exact match or subdomain suffix).
const ALLOWED_HOSTS = [
  'dav.jianguoyun.com',        // 坚果云
  '.infini-cloud.net',         // InfiniCLOUD（个人节点为子域名）
  'app.koofr.net',             // Koofr
  'webdav.hidrive.strato.com', // STRATO HiDrive
  'webdav.yandex.com',         // Yandex Disk
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, MKCOL, PROPFIND, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Depth, If-Match, If-None-Match, Destination, Overwrite',
  'Access-Control-Expose-Headers': 'ETag, Content-Length, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function isAllowedHost(hostname) {
  const host = hostname.toLowerCase();
  return ALLOWED_HOSTS.some((h) =>
    h.startsWith('.') ? host.endsWith(h) : host === h
  );
}

export default {
  async fetch(request) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    // Upstream URL is everything after the leading slash, e.g. "/https://dav.example.com/..."
    const upstreamRaw = url.pathname.slice(1) + url.search;

    let upstream;
    try {
      upstream = new URL(upstreamRaw);
    } catch {
      return new Response('Invalid upstream URL. Use /<full https url>.', {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    if (upstream.protocol !== 'https:' || !isAllowedHost(upstream.hostname)) {
      return new Response('Upstream host is not allowed.', {
        status: 403,
        headers: CORS_HEADERS,
      });
    }

    const headers = new Headers(request.headers);
    headers.delete('Host');
    headers.delete('Origin');
    headers.delete('Referer');
    // Remove hop-by-hop / Cloudflare-injected headers
    for (const h of ['cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'x-forwarded-for', 'x-forwarded-proto']) {
      headers.delete(h);
    }

    const upstreamResp = await fetch(upstream.toString(), {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual', // never follow redirects: credentials must not leak cross-origin
    });

    const respHeaders = new Headers(upstreamResp.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) respHeaders.set(k, v);

    return new Response(upstreamResp.body, {
      status: upstreamResp.status,
      statusText: upstreamResp.statusText,
      headers: respHeaders,
    });
  },
};
