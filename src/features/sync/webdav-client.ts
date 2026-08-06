/**
 * Minimal WebDAV client for the `webdav-sync-v1` protocol, over fetch.
 *
 * Wire-compatible with torto/apps/desktop/src/sync/webdav.rs:
 * - Basic auth on every request
 * - GET: 404 → null, ETag captured verbatim
 * - Immutable PUT: `If-None-Match: *`, 412 means "already exists"
 * - Mutable JSON PUT: GET → PUT with `If-Match` (or `If-None-Match: *` on
 *   creation), one 412 retry, then fail
 * - PROPFIND Depth:1 requesting only getetag; hrefs parsed by XML local-name
 * - MKCOL treats 201/200/405 as success; DELETE is never sent
 *
 * Browsers cannot talk to most WebDAV endpoints directly (CORS), so every
 * request URL is routed through a per-provider proxy prefix:
 * `proxiedUrl = proxyPrefix + '/' + upstreamUrl`. An empty prefix means a
 * direct request (only viable for CORS-enabled endpoints and tests).
 *
 * Cross-origin redirects are rejected so credentials are never forwarded to
 * a different origin.
 */
import { writeJson } from './protocol'

export interface WebdavClientOptions {
  baseUrl: string
  /** Proxy prefix, may be empty for direct requests. */
  proxyPrefix: string
  username: string
  password: string
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

export interface RemoteObject {
  bytes: Uint8Array
  etag: string | null
}

export class WebdavError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'WebdavError'
    this.status = status
  }
}

const MAX_SAME_ORIGIN_REDIRECTS = 5

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
            <d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`

export class WebdavClient {
  /** Upstream (un-proxied) remote root: `{baseUrl}/Rebook/v1/`. */
  readonly root: string

  private readonly proxyPrefix: string
  private readonly authorization: string
  private readonly fetchImpl: typeof fetch

  constructor(options: WebdavClientOptions) {
    if (!options.password) throw new WebdavError('请输入 WebDAV 密码')
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, '')
    assertSecureUrl(baseUrl, 'WebDAV 地址')
    this.proxyPrefix = options.proxyPrefix.trim().replace(/\/+$/, '')
    if (this.proxyPrefix) assertSecureUrl(this.proxyPrefix, 'WebDAV 代理地址')
    this.root = `${baseUrl}/Rebook/v1/`
    this.authorization = `Basic ${base64EncodeUtf8(`${options.username}:${options.password}`)}`
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args))
  }

  /** MKCOLs Rebook/, Rebook/v1/, library/, library/devices/, books/, state/, tmp/. */
  async ensureBaseLayout(): Promise<void> {
    await this.mkcolAbsolute(`${this.root}../`)
    await this.mkcolAbsolute(this.root)
    for (const path of ['library/', 'library/devices/', 'books/', 'state/', 'tmp/']) {
      await this.ensureCollection(path)
    }
  }

  async ensureCollection(path: string): Promise<void> {
    let current = this.root
    for (const segment of path.split('/').filter(Boolean)) {
      current += `${segment}/`
      await this.mkcolAbsolute(current)
    }
  }

  /** GET; 404 → null. ETag is captured verbatim. */
  async getOptional(path: string): Promise<RemoteObject | null> {
    const response = await this.request('GET', this.url(path))
    if (response.status === 404) return null
    if (!response.ok) throw new WebdavError(`GET ${path} 失败：HTTP ${response.status}`, response.status)
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      etag: response.headers.get('etag'),
    }
  }

  /**
   * PUT with `If-None-Match: *`.
   * Returns false when the object already exists (412) — not an error.
   */
  async putImmutable(path: string, bytes: Uint8Array, contentType: string): Promise<boolean> {
    const response = await this.request('PUT', this.url(path), {
      'If-None-Match': '*',
      'Content-Type': contentType,
    }, bytes)
    if (response.status === 412) return false
    if (!response.ok) throw new WebdavError(`PUT ${path} 失败：HTTP ${response.status}`, response.status)
    return true
  }

  /**
   * Read-modify-write for mutable JSON documents: GET first, then PUT with
   * `If-Match: <etag>` when an ETag is present or `If-None-Match: *` when the
   * object does not exist. A 412 restarts the GET+PUT cycle once, then fails.
   */
  async putMutableJson(path: string, value: unknown): Promise<void> {
    const bytes = new TextEncoder().encode(writeJson(value))
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const existing = await this.getOptional(path)
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (existing?.etag) headers['If-Match'] = existing.etag
      else headers['If-None-Match'] = '*'
      const response = await this.request('PUT', this.url(path), headers, bytes)
      if (response.status === 412) continue
      if (!response.ok) throw new WebdavError(`PUT ${path} 失败：HTTP ${response.status}`, response.status)
      return
    }
    throw new WebdavError(`WebDAV 文件在写入时被其他客户端修改：${path}`)
  }

  /**
   * PROPFIND Depth:1; returns sorted, deduplicated file names (last path
   * segment, not percent-decoded) with a `.json` extension. 404 → [].
   */
  async listJsonFiles(path: string): Promise<string[]> {
    const response = await this.request('PROPFIND', this.url(path), {
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
    }, new TextEncoder().encode(PROPFIND_BODY))
    if (response.status === 404) return []
    if (!response.ok) {
      throw new WebdavError(`PROPFIND ${path} 失败：HTTP ${response.status}`, response.status)
    }
    const names = parsePropfindHrefs(await response.text())
      .map(lastPathSegment)
      .filter((name): name is string => name !== null && /\.json$/i.test(name))
    names.sort()
    return [...new Set(names)]
  }

  private url(path: string): string {
    return this.root + path.replace(/^\/+/, '')
  }

  private proxiedUrl(upstreamUrl: string): string {
    return this.proxyPrefix ? `${this.proxyPrefix}/${upstreamUrl}` : upstreamUrl
  }

  private async mkcolAbsolute(upstreamUrl: string): Promise<void> {
    const response = await this.request('MKCOL', upstreamUrl)
    if (response.status === 201 || response.status === 200 || response.status === 405) return
    throw new WebdavError(`MKCOL ${upstreamUrl} 失败：HTTP ${response.status}`, response.status)
  }

  /**
   * Send one request with Basic auth, following only same-origin redirects
   * (relative to the *upstream* origin, so the proxy hop itself is exempt).
   */
  private async request(
    method: string,
    upstreamUrl: string,
    headers: Record<string, string> = {},
    body?: Uint8Array,
  ): Promise<Response> {
    let current = upstreamUrl
    for (let redirect = 0; ; redirect += 1) {
      const response = await this.fetchImpl(this.proxiedUrl(current), {
        method,
        headers: { Authorization: this.authorization, ...headers },
        body: (body ?? null) as BodyInit | null,
        redirect: 'manual',
      })
      if (!isRedirect(response.status)) return response
      const location = response.headers.get('location')
      if (!location) {
        throw new WebdavError(`WebDAV 重定向缺少 Location 头：HTTP ${response.status}`, response.status)
      }
      const target = new URL(location, current)
      if (target.origin !== new URL(current).origin) {
        throw new WebdavError('WebDAV 重定向到了不同来源，已拒绝发送凭据', response.status)
      }
      if (redirect >= MAX_SAME_ORIGIN_REDIRECTS) {
        throw new WebdavError('WebDAV 重定向次数过多', response.status)
      }
      current = target.toString()
    }
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function assertSecureUrl(raw: string, what: string): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new WebdavError(`${what}无法解析：${raw}`)
  }
  if (url.protocol !== 'https:' && !isLocalHostname(url.hostname)) {
    throw new WebdavError(`${what}默认只允许 HTTPS：${raw}`)
  }
}

function base64EncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Keep the last path segment of an href; no percent-decoding. */
function lastPathSegment(href: string): string | null {
  const withoutQuery = href.split(/[?#]/, 1)[0]
  const segment = withoutQuery.split('/').pop() ?? ''
  return segment === '' ? null : segment
}

function unescapeXmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|lt|gt|amp|quot|apos);/g, (entity, body: string) => {
    switch (body) {
      case 'lt': return '<'
      case 'gt': return '>'
      case 'amp': return '&'
      case 'quot': return '"'
      case 'apos': return "'"
      default: {
        const codePoint = body.startsWith('#x') || body.startsWith('#X')
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
        return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint)
      }
    }
  })
}

/**
 * Extract `<href>` element contents from a PROPFIND multistatus response,
 * matching elements by XML local-name (any namespace prefix) and unescaping
 * entities. Hrefs are returned raw — never percent-decoded.
 */
export function parsePropfindHrefs(xml: string): string[] {
  const hrefs: string[] = []
  const pattern = /<\s*(?:[A-Za-z_][\w.-]*:)?href(?:\s[^>]*)?>([\s\S]*?)<\s*\/\s*(?:[A-Za-z_][\w.-]*:)?href\s*>/gi
  for (const match of xml.matchAll(pattern)) {
    const text = unescapeXmlEntities(match[1]).trim()
    if (text) hrefs.push(text)
  }
  return hrefs
}
