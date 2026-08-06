// torto-webdav-proxy — Deno Deploy 版（与 worker/src/index.js 逻辑保持一致，改动需同步）。
// 坚果云封锁了 Cloudflare IP 段，因此坚果云流量走 Deno Deploy（非 CF 机房）。
//
// 用法: https://<app>.deno.net/<完整的上游 URL>
// 仅放行白名单 WebDAV 域名，请求/响应流式转发，不跟随重定向。

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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
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
  headers.delete('host');
  headers.delete('origin');
  headers.delete('referer');
  headers.delete('x-forwarded-for');
  headers.delete('x-forwarded-proto');

  const upstreamResp = await fetch(upstream.toString(), {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual', // 不跟随重定向，避免凭据泄露到其他源
  });

  const respHeaders = new Headers(upstreamResp.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) respHeaders.set(k, v);

  return new Response(upstreamResp.body, {
    status: upstreamResp.status,
    statusText: upstreamResp.statusText,
    headers: respHeaders,
  });
});
