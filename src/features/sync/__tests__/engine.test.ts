import { describe, expect, it } from 'vitest'

import { runSync, sha256Hex, type LocalSyncBook } from '../engine'
import type { SyncSettings } from '../providers'
import { createInMemoryStateStore, type SyncStateStore } from '../store'
import { DEVICE_A, DEVICE_B } from './fixtures'
import { createFakeWebdavServer } from './fake-webdav'

const CONTENT = new TextEncoder().encode('direct web webdav fixture')

function settings(deviceId: string, deviceName: string): SyncSettings {
  return {
    enabled: true,
    provider: 'custom',
    baseUrl: 'http://127.0.0.1:9/dav',
    proxyPrefix: '',
    username: 'reader',
    password: 'app-password',
    deviceId,
    deviceName,
    intervalMinutes: 30,
  }
}

function memoryLibrary(initial: LocalSyncBook[] = []) {
  const books = [...initial]
  const saved: string[] = []
  return {
    books,
    saved,
    library: {
      listBooks: () => Promise.resolve(books),
      saveDownloadedBook: (download: Parameters<Parameters<typeof runSync>[0]['library']['saveDownloadedBook']>[0]) => {
        saved.push(download.id)
        books.push({
          id: download.id,
          title: download.title,
          authors: download.authors,
          fileName: download.fileName,
          addedAt: download.addedAt,
          getBytes: () => Promise.resolve(download.content),
          getCover: () => Promise.resolve(download.cover),
        })
        return Promise.resolve()
      },
    },
  }
}

function locator(bookId: string, progression: number) {
  return {
    version: 1,
    publication_id: bookId,
    href: { path: 'chapter.xhtml' },
    progression,
    total_progression: null,
    position: null,
    source: null,
    partial_cfi: null,
    text: null,
  }
}

describe('runSync', () => {
  it('two devices exchange a content-addressed book, progress and annotations', async () => {
    const server = createFakeWebdavServer()
    const bookId = await sha256Hex(CONTENT)

    // Device A: owns the book, has progress and one annotation.
    const storeA = createInMemoryStateStore(DEVICE_A)
    const localA = memoryLibrary([{
      id: bookId,
      title: 'Fixture',
      authors: ['Rebook'],
      fileName: 'fixture.epub',
      addedAt: 42,
      getBytes: () => Promise.resolve(CONTENT),
      getCover: () => Promise.resolve(null),
    }])
    await storeA.saveProgress(bookId, locator(bookId, 0.5))
    const annotation = await storeA.createAnnotation({
      id: '0c1f2f1e-9c8b-4a7b-8c6d-5e4f3a2b1c09',
      book_id: bookId,
      ranges: [{
        start: { spine: 'chapter', node: 'p', text_offset: 0 },
        end: { spine: 'chapter', node: 'p', text_offset: 5 },
      }],
      quote: 'quote',
      note: 'from A',
      created_at: 1,
    })

    const reportA = await runSync({
      settings: settings(DEVICE_A, 'First web'),
      library: localA.library,
      store: storeA,
      fetchImpl: server.fetch,
    })
    expect(reportA.uploadedBooks).toBe(1)

    // The remote layout matches the desktop layout exactly.
    const paths = [...server.objects.keys()]
    expect(paths).toContain('/dav/Rebook/v1/protocol.json')
    expect(paths).toContain(`/dav/Rebook/v1/library/devices/${DEVICE_A}.json`)
    expect(paths).toContain(`/dav/Rebook/v1/books/${bookId}/manifest.json`)
    expect(paths).toContain(`/dav/Rebook/v1/books/${bookId}/content.epub`)
    expect(paths).toContain(`/dav/Rebook/v1/state/${bookId}/devices/${DEVICE_A}.json`)

    // Device B: empty library downloads the book and merges A's state.
    const storeB = createInMemoryStateStore(DEVICE_B)
    const localB = memoryLibrary()
    const reportB = await runSync({
      settings: settings(DEVICE_B, 'Second web'),
      library: localB.library,
      store: storeB,
      fetchImpl: server.fetch,
    })
    expect(reportB.downloadedBooks).toBe(1)
    expect(reportB.downloads[0].content).toEqual(CONTENT)
    expect(reportB.updatedProgress).toBe(1)
    expect(reportB.mergedAnnotations).toBe(1)
    expect(localB.saved).toEqual([bookId])

    const mergedProgress = await storeB.loadProgress(bookId)
    expect(mergedProgress?.locator.progression).toBe(0.5)
    const mergedAnnotations = await storeB.annotationsForBook(bookId)
    expect(mergedAnnotations.map(item => item.id)).toEqual([annotation.id])

    // A second sync on A pulls nothing back down and uploads nothing new.
    const reportA2 = await runSync({
      settings: settings(DEVICE_A, 'First web'),
      library: localA.library,
      store: storeA,
      fetchImpl: server.fetch,
    })
    expect(reportA2.uploadedBooks).toBe(0)
    expect(reportA2.downloadedBooks).toBe(0)

    // A never sent a DELETE.
    expect(server.requests.some(request => request.method === 'DELETE')).toBe(false)
  })

  it('does not re-download a locally removed book', async () => {
    const server = createFakeWebdavServer()
    const bookId = await sha256Hex(CONTENT)

    const storeA = createInMemoryStateStore(DEVICE_A)
    const localA = memoryLibrary([{
      id: bookId,
      title: 'Fixture',
      authors: [],
      fileName: 'fixture.epub',
      addedAt: 1,
      getBytes: () => Promise.resolve(CONTENT),
    }])
    await runSync({ settings: settings(DEVICE_A, 'A'), library: localA.library, store: storeA, fetchImpl: server.fetch })

    const storeB: SyncStateStore = createInMemoryStateStore(DEVICE_B)
    await storeB.setBookPresent(bookId, false) // tombstone: removed on B
    const localB = memoryLibrary()
    const report = await runSync({
      settings: settings(DEVICE_B, 'B'),
      library: localB.library,
      store: storeB,
      fetchImpl: server.fetch,
    })
    expect(report.downloadedBooks).toBe(0)
    // The tombstone is published in B's device library.
    const entries = await storeB.membershipEntries()
    expect(entries).toEqual([
      expect.objectContaining({ book_id: bookId, present: false }),
    ])
  })

  it('fails when local bytes do not match the book id', async () => {
    const server = createFakeWebdavServer()
    const store = createInMemoryStateStore(DEVICE_A)
    const local = memoryLibrary([{
      id: 'f'.repeat(64),
      title: 'Broken',
      authors: [],
      fileName: 'broken.epub',
      addedAt: 1,
      getBytes: () => Promise.resolve(CONTENT), // hashes to something else
    }])
    await expect(runSync({
      settings: settings(DEVICE_A, 'A'),
      library: local.library,
      store,
      fetchImpl: server.fetch,
    })).rejects.toThrow(/校验失败/)
  })
})
