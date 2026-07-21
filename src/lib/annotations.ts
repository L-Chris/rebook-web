import type { BookPosition } from 'rebook'
import { apiRequest } from './api'
import { createClientUUID } from './client-id'

const DATABASE_NAME = 'rebook-annotations'
const DATABASE_VERSION = 1
const ANNOTATION_STORE = 'annotations'
const META_STORE = 'meta'

export type AnnotationSource = 'user' | 'ai'

export interface ReaderAnnotation {
  id: string
  bookKey: string
  serverBookId: string | null
  location: BookPosition
  quote: string | null
  note: string | null
  color: string | null
  source: AnnotationSource
  data: Record<string, unknown> | null
  version: number
  dirty: boolean
  syncError: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

type StoredAnnotation = ReaderAnnotation & { storageKey: string }

interface AnnotationSyncResponse {
  cursor: string
  hasMore: boolean
  items: ServerAnnotation[]
  conflicts: ServerAnnotation[]
}

interface ServerAnnotation {
  id: string
  bookId: string
  location: BookPosition
  quote: string | null
  note: string | null
  color: string | null
  source: AnnotationSource
  data: Record<string, unknown> | null
  version: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export async function listAnnotations(bookKey: string, includeDeleted = false): Promise<ReaderAnnotation[]> {
  const records = await getBookRecords(bookKey)
  return records
    .filter(record => includeDeleted || !record.deletedAt)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .map(stripStorageKey)
}

export async function getAnnotation(bookKey: string, id: string): Promise<ReaderAnnotation | null> {
  const database = await openDatabase()
  const record = await requestPromise<StoredAnnotation | undefined>(
    database.transaction(ANNOTATION_STORE).objectStore(ANNOTATION_STORE).get(storageKey(bookKey, id)),
  )
  return record ? stripStorageKey(record) : null
}

export async function createAnnotation(
  bookKey: string,
  input: {
    location: BookPosition
    quote?: string | null
    note?: string | null
    color?: string | null
    source?: AnnotationSource
    data?: Record<string, unknown> | null
    serverBookId?: string | null
  },
): Promise<ReaderAnnotation> {
  const now = new Date().toISOString()
  const id = createClientUUID()
  const record: StoredAnnotation = {
    storageKey: storageKey(bookKey, id),
    id,
    bookKey,
    serverBookId: input.serverBookId ?? null,
    location: input.location,
    quote: input.quote?.trim() || null,
    note: input.note?.trim() || null,
    color: normalizeAnnotationColor(input.color),
    source: input.source ?? 'user',
    data: input.data ?? null,
    version: 0,
    dirty: true,
    syncError: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await putRecord(record)
  notifyChanged(bookKey)
  return stripStorageKey(record)
}

export async function updateAnnotation(
  bookKey: string,
  id: string,
  patch: Partial<Pick<ReaderAnnotation, 'note' | 'color' | 'location' | 'data'>>,
): Promise<ReaderAnnotation | null> {
  const record = await getStoredRecord(bookKey, id)
  if (!record || record.deletedAt) return null
  if (patch.note !== undefined) record.note = patch.note?.trim() || null
  if (patch.color !== undefined) record.color = normalizeAnnotationColor(patch.color)
  if (patch.location !== undefined) record.location = patch.location
  if (patch.data !== undefined) record.data = patch.data
  record.dirty = true
  record.syncError = null
  record.updatedAt = new Date().toISOString()
  await putRecord(record)
  notifyChanged(bookKey)
  return stripStorageKey(record)
}

export async function deleteAnnotation(bookKey: string, id: string): Promise<void> {
  const record = await getStoredRecord(bookKey, id)
  if (!record) return
  const now = new Date().toISOString()
  record.deletedAt = now
  record.updatedAt = now
  record.dirty = true
  record.syncError = null
  await putRecord(record)
  notifyChanged(bookKey)
}

export async function syncAnnotations(bookKey: string, serverBookId: string): Promise<ReaderAnnotation[]> {
  const cursorKey = `cursor:${bookKey}:${serverBookId}`
  let cursor = await getMeta(cursorKey) ?? '0'
  let hasMore = true

  while (hasMore) {
    const local = await getBookRecords(bookKey)
    const dirty = local.filter(record => record.dirty).slice(0, 100)
    const response = await apiRequest<AnnotationSyncResponse>(
      `/books/${encodeURIComponent(serverBookId)}/annotations/sync`,
      {
        method: 'POST',
        json: {
          cursor,
          changes: dirty.map(record => ({
            id: record.id,
            baseVersion: record.version,
            deleted: Boolean(record.deletedAt),
            location: record.location,
            quote: record.quote,
            note: record.note,
            color: record.color,
            source: record.source,
            data: record.data,
          })),
        },
      },
    )

    const conflictIds = new Set(response.conflicts.map(item => item.id))
    for (const conflict of response.conflicts) {
      const localConflict = dirty.find(item => item.id === conflict.id)
      if (localConflict) await preserveConflictCopy(localConflict, serverBookId)
      await putRecord(fromServer(bookKey, serverBookId, conflict))
    }
    for (const item of response.items) {
      if (conflictIds.has(item.id)) continue
      await putRecord(fromServer(bookKey, serverBookId, item))
    }

    cursor = response.cursor
    await setMeta(cursorKey, cursor)
    const remainingDirty = (await getBookRecords(bookKey)).some(record => record.dirty)
    hasMore = response.hasMore || remainingDirty
  }

  notifyChanged(bookKey)
  return listAnnotations(bookKey)
}

async function preserveConflictCopy(record: StoredAnnotation, serverBookId: string) {
  if (record.deletedAt) return
  const copyId = createClientUUID()
  const now = new Date().toISOString()
  await putRecord({
    ...record,
    storageKey: storageKey(record.bookKey, copyId),
    id: copyId,
    serverBookId,
    note: record.note ? `${record.note}\n\n（本地冲突副本）` : '本地冲突副本',
    version: 0,
    dirty: true,
    syncError: null,
    createdAt: now,
    updatedAt: now,
  })
}

function fromServer(bookKey: string, serverBookId: string, item: ServerAnnotation): StoredAnnotation {
  return {
    storageKey: storageKey(bookKey, item.id),
    id: item.id,
    bookKey,
    serverBookId,
    location: item.location,
    quote: item.quote,
    note: item.note,
    color: item.color,
    source: item.source === 'ai' ? 'ai' : 'user',
    data: item.data,
    version: item.version,
    dirty: false,
    syncError: null,
    deletedAt: item.deletedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function stripStorageKey({ storageKey: _storageKey, ...record }: StoredAnnotation): ReaderAnnotation {
  return record
}

function storageKey(bookKey: string, id: string) {
  return `${bookKey}:${id}`
}

async function getStoredRecord(bookKey: string, id: string) {
  const database = await openDatabase()
  return requestPromise<StoredAnnotation | undefined>(
    database.transaction(ANNOTATION_STORE).objectStore(ANNOTATION_STORE).get(storageKey(bookKey, id)),
  )
}

async function getBookRecords(bookKey: string): Promise<StoredAnnotation[]> {
  const database = await openDatabase()
  const transaction = database.transaction(ANNOTATION_STORE)
  const index = transaction.objectStore(ANNOTATION_STORE).index('bookKey')
  return requestPromise<StoredAnnotation[]>(index.getAll(bookKey))
}

async function putRecord(record: StoredAnnotation): Promise<void> {
  const database = await openDatabase()
  await transactionPromise(database, ANNOTATION_STORE, 'readwrite', store => store.put(record))
}

async function getMeta(key: string): Promise<string | undefined> {
  const database = await openDatabase()
  const record = await requestPromise<{ key: string; value: string } | undefined>(
    database.transaction(META_STORE).objectStore(META_STORE).get(key),
  )
  return record?.value
}

async function setMeta(key: string, value: string): Promise<void> {
  const database = await openDatabase()
  await transactionPromise(database, META_STORE, 'readwrite', store => store.put({ key, value }))
}

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      const annotations = database.objectStoreNames.contains(ANNOTATION_STORE)
        ? request.transaction!.objectStore(ANNOTATION_STORE)
        : database.createObjectStore(ANNOTATION_STORE, { keyPath: 'storageKey' })
      if (!annotations.indexNames.contains('bookKey')) annotations.createIndex('bookKey', 'bookKey')
      if (!annotations.indexNames.contains('serverBookId')) annotations.createIndex('serverBookId', 'serverBookId')
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return databasePromise
}

function transactionPromise(
  database: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    run(transaction.objectStore(storeName))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function requestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function notifyChanged(bookKey: string) {
  window.dispatchEvent(new CustomEvent('rebook:annotations-changed', { detail: { bookKey } }))
}

function normalizeAnnotationColor(value?: string | null) {
  const color = value?.trim() || ''
  return /^(?:#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%+-]+\)|hsla?\([\d\s.,%+-]+\)|[a-zA-Z]{1,24})$/.test(color)
    ? color
    : 'rgba(96, 165, 250, 0.28)'
}
