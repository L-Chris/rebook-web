/**
 * In-memory WebDAV server behind a fake `fetch`, mirroring the desktop's
 * FakeWebDav test server: MKCOL → 201, GET → 200/404 with ETag, PUT honoring
 * If-None-Match/If-Match with 412, PROPFIND → 207 multistatus.
 */

export interface FakeWebdavRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: Uint8Array
}

export interface FakeWebdavServer {
  fetch: typeof fetch
  requests: FakeWebdavRequest[]
  objects: Map<string, { bytes: Uint8Array; etag: string }>
}

export function createFakeWebdavServer(): FakeWebdavServer {
  const objects = new Map<string, { bytes: Uint8Array; etag: string }>()
  const requests: FakeWebdavRequest[] = []
  let nextEtag = 1

  const fake: FakeWebdavServer = {
    objects,
    requests,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input))
      const method = (init?.method ?? 'GET').toUpperCase()
      const headers: Record<string, string> = {}
      new Headers(init?.headers).forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })
      const body = init?.body instanceof Uint8Array
        ? init.body
        : new Uint8Array(init?.body ? await new Response(init.body as BodyInit).arrayBuffer() : new ArrayBuffer(0))
      requests.push({ method, url: url.toString(), headers, body })

      const path = url.pathname
      switch (method) {
        case 'MKCOL':
          return new Response(null, { status: 201 })
        case 'GET': {
          const object = objects.get(path)
          if (!object) return new Response(null, { status: 404 })
          return new Response(object.bytes as BodyInit, { status: 200, headers: { ETag: object.etag } })
        }
        case 'PUT': {
          const existing = objects.get(path)
          const preconditionFailed
            = (headers['if-none-match'] === '*' && existing !== undefined)
            || (headers['if-match'] !== undefined && existing?.etag !== headers['if-match'])
          if (preconditionFailed) {
            return new Response(null, {
              status: 412,
              headers: existing ? { ETag: existing.etag } : undefined,
            })
          }
          const etag = `"${nextEtag}"`
          nextEtag += 1
          objects.set(path, { bytes: body, etag })
          return new Response(null, { status: 201, headers: { ETag: etag } })
        }
        case 'PROPFIND': {
          const hrefs = [...objects.keys()]
            .filter((candidate) => {
              if (!candidate.startsWith(path)) return false
              const rest = candidate.slice(path.length).replace(/^\/+|\/+$/g, '')
              return rest !== '' && !rest.includes('/')
            })
            .sort()
          const responses = hrefs
            .map(href => `<d:response><d:href>${href}</d:href></d:response>`)
            .join('')
          const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`
          return new Response(xml, { status: 207, headers: { 'Content-Type': 'application/xml' } })
        }
        default:
          return new Response(null, { status: 405 })
      }
    }) as typeof fetch,
  }
  return fake
}
