/**
 * Sync loop for the `webdav-sync-v1` protocol.
 *
 * Mirrors torto/apps/desktop/src/sync/engine.rs step for step:
 *  1. validate settings, open the client
 *  2. ensure base layout, write protocol.json (immutable)
 *  3. verify + upload local books (content-addressed, immutable PUTs)
 *  4. publish own device library (mutable JSON, membership incl. tombstones)
 *  5. discover remote books from every device library file
 *  6. download books unknown locally and not locally removed
 *  7. for every known book: publish own state file, read every other
 *     device's state file, merge progress and annotations
 *
 * The engine depends only on abstract boundaries (`LocalLibrary`,
 * `SyncStateStore`) so the UI wiring phase can adapt the real IndexedDB
 * library and annotations without touching this file.
 */
import { createSHA256 } from 'hash-wasm'

import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  parseJsonDocument,
  parseBookManifest,
  parseDeviceBookState,
  parseDeviceLibrary,
  storageExtension,
  validateBookId,
  validateDeviceLibrary,
  validateManifest,
  validateState,
  writeDeviceBookState,
  writeDeviceLibrary,
  writeBookManifest,
  writeProtocolDocument,
  type BookManifest,
  type DeviceBookState,
  type DeviceLibrary,
} from './protocol'
import { normalizeSyncSettings, validateSyncSettings, type SyncSettings } from './providers'
import type { SyncStateStore } from './store'
import { WebdavClient } from './webdav-client'

// ---------------------------------------------------------------------------
// Boundaries implemented by the UI wiring phase
// ---------------------------------------------------------------------------

export interface LocalSyncBook {
  /** Lowercase hex SHA-256 of the exact file bytes (the book_id). */
  id: string
  title: string
  authors: string[]
  fileName: string
  /** Unix epoch milliseconds when the book was added locally. */
  addedAt: number
  getBytes(): Promise<Uint8Array>
  getCover?(): Promise<Uint8Array | null>
}

export interface DownloadedBook {
  id: string
  title: string
  authors: string[]
  fileName: string
  contentSha256: string
  addedAt: number
  content: Uint8Array
  cover: Uint8Array | null
}

export interface LocalLibrary {
  listBooks(): Promise<LocalSyncBook[]>
  saveDownloadedBook(book: DownloadedBook): Promise<void>
}

export interface SyncReport {
  uploadedBooks: number
  downloadedBooks: number
  mergedAnnotations: number
  updatedProgress: number
  downloads: DownloadedBook[]
}

export interface RunSyncOptions {
  settings: SyncSettings
  library: LocalLibrary
  store: SyncStateStore
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

// ---------------------------------------------------------------------------
// Sync loop
// ---------------------------------------------------------------------------

export async function runSync(options: RunSyncOptions): Promise<SyncReport> {
  const settings = normalizeSyncSettings(options.settings)
  validateSyncSettings(settings)
  const { library, store } = options
  const client = new WebdavClient({
    baseUrl: settings.baseUrl,
    proxyPrefix: settings.proxyPrefix,
    username: settings.username,
    password: settings.password,
    fetchImpl: options.fetchImpl,
  })

  // Step 2: base layout + immutable protocol document.
  await client.ensureBaseLayout()
  await client.putImmutable(
    'protocol.json',
    new TextEncoder().encode(writeProtocolDocument({ version: PROTOCOL_VERSION, protocol: PROTOCOL_NAME })),
    'application/json',
  )

  const report: SyncReport = {
    uploadedBooks: 0,
    downloadedBooks: 0,
    mergedAnnotations: 0,
    updatedProgress: 0,
    downloads: [],
  }

  // Step 3: verify and upload local books.
  const localBooks = await library.listBooks()
  const localIds = new Set<string>()
  for (const book of localBooks) {
    validateBookId(book.id)
    await store.setBookPresent(book.id, true)
    if (await uploadBook(client, book)) report.uploadedBooks += 1
    localIds.add(book.id)
  }

  // Step 4: publish own device library (device registration).
  const deviceLibrary: DeviceLibrary = {
    version: PROTOCOL_VERSION,
    device_id: settings.deviceId,
    device_name: settings.deviceName,
    updated_at: await store.tick(),
    books: await store.membershipEntries(),
  }
  await client.putMutableJson(
    `library/devices/${settings.deviceId}.json`,
    JSON.parse(writeDeviceLibrary(deviceLibrary)),
  )

  // Step 5: discover remote books from all device library files.
  const remoteBookIds = await discoverRemoteBooks(client, store, settings.deviceId)

  // Step 6: download books unknown locally and not locally removed.
  for (const bookId of [...remoteBookIds].sort()) {
    if (localIds.has(bookId) || await store.isLocallyRemoved(bookId)) continue
    const download = await downloadBook(client, bookId)
    await library.saveDownloadedBook(download)
    report.downloadedBooks += 1
    report.downloads.push(download)
  }

  // Step 7: publish own per-book state, read other devices' state, merge.
  const allBookIds = new Set([...remoteBookIds, ...localIds])
  for (const bookId of [...allBookIds].sort()) {
    validateBookId(bookId)
    await client.ensureCollection(`state/${bookId}/devices/`)
    const state: DeviceBookState = {
      version: PROTOCOL_VERSION,
      device_id: settings.deviceId,
      book_id: bookId,
      updated_at: await store.tick(),
      progress: await store.progressState(bookId),
      annotations: await store.annotationsForDeviceBook(bookId),
    }
    await client.putMutableJson(
      `state/${bookId}/devices/${settings.deviceId}.json`,
      JSON.parse(writeDeviceBookState(state)),
    )

    const stateFiles = await client.listJsonFiles(`state/${bookId}/devices/`)
    for (const fileName of stateFiles) {
      if (fileName === `${settings.deviceId}.json`) continue
      const object = await client.getOptional(`state/${bookId}/devices/${fileName}`)
      if (!object) continue
      const remote = parseJsonDocument(object.bytes, parseDeviceBookState)
      validateState(remote, bookId)
      await store.observe(remote.updated_at)
      if (remote.progress) {
        if (await store.mergeProgress(remote.progress)) report.updatedProgress += 1
      }
      report.mergedAnnotations += await store.mergeAnnotations(remote.annotations)
    }
  }

  return report
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function uploadBook(client: WebdavClient, book: LocalSyncBook): Promise<boolean> {
  const extension = storageExtension(book.fileName)
  const directory = `books/${book.id}/`
  await client.ensureCollection(directory)
  const contentPath = `${directory}content.${extension}`
  const content = await book.getBytes()
  const digest = await sha256Hex(content)
  if (digest !== book.id) {
    throw new Error(`本地书籍内容校验失败：${book.fileName}`)
  }
  const uploaded = await client.putImmutable(contentPath, content, 'application/octet-stream')
  const cover = (await book.getCover?.()) ?? null
  const coverPath = cover ? `${directory}cover.bin` : null
  if (cover && coverPath) {
    await client.putImmutable(coverPath, cover, 'application/octet-stream')
  }
  const manifest: BookManifest = {
    version: PROTOCOL_VERSION,
    book_id: book.id,
    title: book.title,
    authors: book.authors,
    file_name: book.fileName,
    content_path: contentPath,
    content_sha256: book.id,
    content_length: content.byteLength,
    cover_path: coverPath,
    added_at: book.addedAt,
  }
  await client.putImmutable(
    `${directory}manifest.json`,
    new TextEncoder().encode(writeBookManifest(manifest)),
    'application/json',
  )
  return uploaded
}

async function discoverRemoteBooks(
  client: WebdavClient,
  store: SyncStateStore,
  ownDeviceId: string,
): Promise<Set<string>> {
  const books = new Set<string>()
  for (const fileName of await client.listJsonFiles('library/devices/')) {
    const object = await client.getOptional(`library/devices/${fileName}`)
    if (!object) continue
    const library = parseJsonDocument(object.bytes, parseDeviceLibrary)
    validateDeviceLibrary(library)
    if (library.device_id !== ownDeviceId) await store.observe(library.updated_at)
    for (const entry of library.books) {
      if (entry.present) books.add(entry.book_id)
    }
  }
  return books
}

async function downloadBook(client: WebdavClient, bookId: string): Promise<DownloadedBook> {
  validateBookId(bookId)
  const manifestPath = `books/${bookId}/manifest.json`
  const manifestObject = await client.getOptional(manifestPath)
  if (!manifestObject) throw new Error(`远端书籍清单不存在：${manifestPath}`)
  const manifest = parseJsonDocument(manifestObject.bytes, parseBookManifest)
  validateManifest(manifest, bookId)

  const contentObject = await client.getOptional(manifest.content_path)
  if (!contentObject) throw new Error(`远端书籍内容不存在：${manifest.content_path}`)
  const content = contentObject.bytes
  if (content.byteLength !== manifest.content_length || await sha256Hex(content) !== manifest.content_sha256) {
    throw new Error(`远端书籍内容校验失败：${bookId}`)
  }

  let cover: Uint8Array | null = null
  if (manifest.cover_path) {
    const coverObject = await client.getOptional(manifest.cover_path)
    if (!coverObject) throw new Error(`远端书籍封面不存在：${manifest.cover_path}`)
    cover = coverObject.bytes
  }

  return {
    id: manifest.book_id,
    title: manifest.title,
    authors: manifest.authors,
    fileName: manifest.file_name,
    contentSha256: manifest.content_sha256,
    addedAt: manifest.added_at,
    content,
    cover,
  }
}

/** Streaming SHA-256 (hash-wasm) — safe for large book files. */
export async function sha256Hex(...chunks: Uint8Array[]): Promise<string> {
  const hasher = await createSHA256()
  for (const chunk of chunks) hasher.update(chunk)
  return hasher.digest('hex')
}
