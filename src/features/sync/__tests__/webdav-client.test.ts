import { describe, expect, it } from 'vitest'

import { WebdavClient, WebdavError, parsePropfindHrefs } from '../webdav-client'
import { createFakeWebdavServer, type FakeWebdavRequest } from './fake-webdav'

const OPTIONS = {
  baseUrl: 'http://127.0.0.1:9/dav',
  proxyPrefix: '',
  username: 'reader',
  password: 'app-password',
}

function createClient(fetchImpl: typeof fetch) {
  return new WebdavClient({ ...OPTIONS, fetchImpl })
}

describe('PROPFIND href parsing', () => {
  it('matches href elements by local-name across namespaces', () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:" xmlns:x="urn:example">
        <d:response><d:href>/dav/Rebook/v1/library/devices/a.json</d:href></d:response>
        <d:response><x:href>/dav/Rebook/v1/library/devices/b.json</x:href></d:response>
        <d:response><href>/dav/Rebook/v1/library/devices/c.json</href></d:response>
      </d:multistatus>`
    expect(parsePropfindHrefs(xml)).toEqual([
      '/dav/Rebook/v1/library/devices/a.json',
      '/dav/Rebook/v1/library/devices/b.json',
      '/dav/Rebook/v1/library/devices/c.json',
    ])
  })

  it('unescapes entities but never percent-decodes', () => {
    const xml = `<d:multistatus xmlns:d="DAV:">
      <d:response><d:href>/dav/x/a%20b.json</d:href></d:response>
      <d:response><d:href>/dav/x/&amp;&lt;&gt;&#x2F;&#47;.json</d:href></d:response>
    </d:multistatus>`
    expect(parsePropfindHrefs(xml)).toEqual(['/dav/x/a%20b.json', '/dav/x/&<>//.json'])
  })
})

describe('listJsonFiles', () => {
  it('keeps only .json file names, sorted and deduplicated', async () => {
    const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
      <d:response><d:href>/dav/Rebook/v1/library/devices/</d:href></d:response>
      <d:response><d:href>/dav/Rebook/v1/library/devices/device-b.json</d:href></d:response>
      <d:response><d:href>/dav/Rebook/v1/library/devices/device-a.JSON</d:href></d:response>
      <d:response><d:href>/dav/Rebook/v1/library/devices/device-b.json</d:href></d:response>
      <d:response><d:href>/dav/Rebook/v1/library/devices/notes.txt</d:href></d:response>
      <d:response><d:href>https://other.example/dav/Rebook/v1/library/devices/device-c.json</d:href></d:response>
    </d:multistatus>`
    const fetchImpl = (async () => new Response(xml, { status: 207 })) as typeof fetch
    const client = createClient(fetchImpl)
    await expect(client.listJsonFiles('library/devices/')).resolves.toEqual([
      'device-a.JSON',
      'device-b.json',
      'device-c.json',
    ])
  })

  it('treats 404 as an empty listing', async () => {
    const fetchImpl = (async () => new Response(null, { status: 404 })) as typeof fetch
    await expect(createClient(fetchImpl).listJsonFiles('library/devices/')).resolves.toEqual([])
  })
})

describe('request plumbing', () => {
  it('routes every request through the proxy prefix and sends Basic auth', async () => {
    const seen: string[] = []
    let auth = ''
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input))
      auth = new Headers(init?.headers).get('authorization') ?? ''
      return new Response(null, { status: 404 })
    }) as typeof fetch
    const client = new WebdavClient({
      ...OPTIONS,
      baseUrl: 'https://dav.example.com/dav',
      proxyPrefix: 'https://proxy.example.com/',
      fetchImpl,
    })
    await client.getOptional('protocol.json')
    expect(seen).toEqual(['https://proxy.example.com/https://dav.example.com/dav/Rebook/v1/protocol.json'])
    expect(auth).toBe(`Basic ${btoa('reader:app-password')}`)
  })

  it('rejects plain HTTP for non-local endpoints', () => {
    expect(() => new WebdavClient({ ...OPTIONS, baseUrl: 'http://dav.example.com' })).toThrow(WebdavError)
    expect(() => new WebdavClient({ ...OPTIONS, proxyPrefix: 'http://proxy.example.com' })).toThrow(WebdavError)
  })

  it('follows same-origin redirects but rejects cross-origin ones', async () => {
    let redirected = false
    const sameOrigin = (async () => {
      if (!redirected) {
        redirected = true
        return new Response(null, {
          status: 302,
          headers: { Location: '/dav/Rebook/v1/moved.json' },
        })
      }
      return new Response(null, { status: 404 })
    }) as typeof fetch
    // Follows once; the follow-up 404 ends the request as "not found".
    await expect(createClient(sameOrigin).getOptional('protocol.json')).resolves.toBeNull()

    const crossOrigin = (async () => new Response(null, {
      status: 302,
      headers: { Location: 'https://evil.example/steal' },
    })) as typeof fetch
    await expect(createClient(crossOrigin).getOptional('protocol.json')).rejects.toThrow(/重定向/)
  })
})

describe('putImmutable', () => {
  it('returns false on 412 (already exists) instead of throwing', async () => {
    const server = createFakeWebdavServer()
    const client = createClient(server.fetch)
    const bytes = new TextEncoder().encode('data')
    await expect(client.putImmutable('books/x/content.epub', bytes, 'application/octet-stream')).resolves.toBe(true)
    await expect(client.putImmutable('books/x/content.epub', bytes, 'application/octet-stream')).resolves.toBe(false)
    const puts = server.requests.filter(request => request.method === 'PUT')
    expect(puts.every(request => request.headers['if-none-match'] === '*')).toBe(true)
  })
})

describe('putMutableJson ETag flow', () => {
  it('creates with If-None-Match: * when the object does not exist', async () => {
    const server = createFakeWebdavServer()
    const client = createClient(server.fetch)
    await client.putMutableJson('library/devices/dev.json', { version: 1 })
    const put = server.requests.find(request => request.method === 'PUT')!
    expect(put.headers['if-none-match']).toBe('*')
    expect(put.headers['content-type']).toBe('application/json')
  })

  it('updates with If-Match from the preceding GET', async () => {
    const server = createFakeWebdavServer()
    const client = createClient(server.fetch)
    await client.putMutableJson('library/devices/dev.json', { version: 1 })
    await client.putMutableJson('library/devices/dev.json', { version: 2 })
    const puts = server.requests.filter((request: FakeWebdavRequest) => request.method === 'PUT')
    expect(puts[1].headers['if-match']).toBe('"1"')
  })

  it('retries the GET+PUT cycle once on 412, then fails', async () => {
    // A fake server that always reports a stale ETag on PUT: the first PUT
    // gets a 412 with a newer ETag, the retry succeeds.
    let puts = 0
    const retryThenSucceed = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET') {
        return new Response('{}', { status: 200, headers: { ETag: `"${puts + 1}"` } })
      }
      puts += 1
      if (puts === 1) return new Response(null, { status: 412 })
      expect(new Headers(init?.headers).get('if-match')).toBe('"2"')
      return new Response(null, { status: 201 })
    }) as typeof fetch
    await expect(createClient(retryThenSucceed).putMutableJson('x.json', {})).resolves.toBeUndefined()
    expect(puts).toBe(2)

    const alwaysConflict = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET') return new Response('{}', { status: 200, headers: { ETag: '"1"' } })
      return new Response(null, { status: 412 })
    }) as typeof fetch
    await expect(createClient(alwaysConflict).putMutableJson('x.json', {})).rejects.toThrow(/修改/)
  })
})

describe('ensureBaseLayout', () => {
  it('MKCOLs the full Rebook/v1 layout', async () => {
    const server = createFakeWebdavServer()
    await createClient(server.fetch).ensureBaseLayout()
    const paths = server.requests
      .filter(request => request.method === 'MKCOL')
      .map(request => new URL(request.url).pathname)
    expect(paths).toEqual([
      '/dav/Rebook/',
      '/dav/Rebook/v1/',
      '/dav/Rebook/v1/library/',
      // library/ is MKCOL'd again as a path prefix of library/devices/,
      // matching the desktop's per-segment walk (405 is success).
      '/dav/Rebook/v1/library/',
      '/dav/Rebook/v1/library/devices/',
      '/dav/Rebook/v1/books/',
      '/dav/Rebook/v1/state/',
      '/dav/Rebook/v1/tmp/',
    ])
  })
})
