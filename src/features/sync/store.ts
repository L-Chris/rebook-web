/**
 * Local sync state for the `webdav-sync-v1` protocol.
 *
 * Persists the hybrid logical clock, reading progress, annotations (including
 * tombstones) and book membership tombstones in an IndexedDB database named
 * `rebook-sync-v1` (raw IDB, like the rest of this project). The merge and
 * mutation semantics mirror torto/apps/desktop/src/sync/store.rs.
 *
 * `SyncStateStore` is the abstract boundary the sync engine depends on; the
 * UI wiring phase drives the mutation methods (saveProgress,
 * createAnnotation, updateAnnotationNote, deleteAnnotation, setBookPresent)
 * from the reader and shelf code.
 */
import { tickHlc, type HybridTimestamp } from './hlc'
import {
  applyLocalAnnotationDeletion,
  applyLocalAnnotationMutation,
  createAnnotationState,
  mergeAnnotationVersion,
  validateLocator,
  type AnnotationState,
  type DeviceBookEntry,
  type LocatorV1,
  type ProgressState,
  type SourceRange,
} from './protocol'

const DATABASE_NAME = 'rebook-sync-v1'
const DATABASE_VERSION = 1

export interface StoredProgress {
  locator: LocatorV1
  updated_at: HybridTimestamp
}

export interface CreateAnnotationInput {
  id: string
  book_id: string
  ranges: SourceRange[]
  quote: string
  note?: string
  created_at: number
}

/** Abstract sync-state boundary consumed by the sync engine. */
export interface SyncStateStore {
  readonly deviceId: string

  /** Produce and persist the next HLC, optionally observing a remote wall time. */
  tick(observedWallMs?: number): Promise<HybridTimestamp>
  /** Observe a remote timestamp so future ticks never go backwards. */
  observe(timestamp: HybridTimestamp): Promise<void>

  /** Record local shelf membership; `present: false` writes a tombstone. */
  setBookPresent(bookId: string, present: boolean): Promise<void>
  /** All membership entries, sorted by book_id, tombstones included. */
  membershipEntries(): Promise<DeviceBookEntry[]>
  isLocallyRemoved(bookId: string): Promise<boolean>

  saveProgress(bookId: string, locator: LocatorV1): Promise<void>
  loadProgress(bookId: string): Promise<StoredProgress | null>
  /** Progress to publish in the own state file; null unless this device wrote it last. */
  progressState(bookId: string): Promise<ProgressState | null>
  /** Merge remote progress; returns true when the local value was replaced. */
  mergeProgress(progress: ProgressState): Promise<boolean>

  createAnnotation(input: CreateAnnotationInput): Promise<AnnotationState>
  updateAnnotationNote(id: string, note: string | undefined): Promise<boolean>
  deleteAnnotation(id: string): Promise<boolean>
  /** Own-originated annotations (incl. tombstones) for the state file, sorted by id. */
  annotationsForDeviceBook(bookId: string): Promise<AnnotationState[]>
  /** Visible (non-deleted) annotations for a book, newest first. */
  annotationsForBook(bookId: string): Promise<AnnotationState[]>
  /** Merge remote annotation versions; returns the number of changes applied. */
  mergeAnnotations(annotations: AnnotationState[]): Promise<number>
}

/**
 * Shared merge/mutation semantics. Subclasses provide raw persistence only,
 * so the IDB store and the in-memory test store cannot drift apart.
 */
abstract class BaseSyncStateStore implements SyncStateStore {
  constructor(
    readonly deviceId: string,
    private readonly now: () => number,
  ) {}

  protected abstract readHlc(): Promise<HybridTimestamp | null>
  protected abstract writeHlc(timestamp: HybridTimestamp): Promise<void>
  protected abstract readProgress(bookId: string): Promise<StoredProgress | null>
  protected abstract writeProgress(bookId: string, progress: StoredProgress): Promise<void>
  protected abstract readAnnotation(id: string): Promise<AnnotationState | null>
  protected abstract writeAnnotation(annotation: AnnotationState): Promise<void>
  protected abstract listAnnotations(): Promise<AnnotationState[]>
  protected abstract readMembership(bookId: string): Promise<DeviceBookEntry | null>
  protected abstract writeMembership(entry: DeviceBookEntry): Promise<void>
  protected abstract listMemberships(): Promise<DeviceBookEntry[]>

  async tick(observedWallMs?: number): Promise<HybridTimestamp> {
    const timestamp = tickHlc(await this.readHlc(), this.deviceId, this.now(), observedWallMs)
    await this.writeHlc(timestamp)
    return timestamp
  }

  async observe(timestamp: HybridTimestamp): Promise<void> {
    await this.tick(timestamp.wall_time_ms)
  }

  async setBookPresent(bookId: string, present: boolean): Promise<void> {
    const current = await this.readMembership(bookId)
    if (current && current.present === present) return
    await this.writeMembership({ book_id: bookId, present, changed_at: await this.tick() })
  }

  async membershipEntries(): Promise<DeviceBookEntry[]> {
    const entries = await this.listMemberships()
    entries.sort((left, right) => (left.book_id < right.book_id ? -1 : left.book_id > right.book_id ? 1 : 0))
    return entries
  }

  async isLocallyRemoved(bookId: string): Promise<boolean> {
    return (await this.readMembership(bookId))?.present === false
  }

  async saveProgress(bookId: string, locator: LocatorV1): Promise<void> {
    validateLocator(locator)
    await this.writeProgress(bookId, { locator, updated_at: await this.tick() })
  }

  loadProgress(bookId: string): Promise<StoredProgress | null> {
    return this.readProgress(bookId)
  }

  async progressState(bookId: string): Promise<ProgressState | null> {
    const progress = await this.readProgress(bookId)
    if (!progress || progress.updated_at.device_id !== this.deviceId) return null
    return progress
  }

  async mergeProgress(progress: ProgressState): Promise<boolean> {
    validateLocator(progress.locator)
    const bookId = progress.locator.publication_id
    const current = await this.readProgress(bookId)
    await this.observe(progress.updated_at)
    if (current && compareUpdatedAt(current.updated_at, progress.updated_at) >= 0) return false
    await this.writeProgress(bookId, { locator: progress.locator, updated_at: progress.updated_at })
    return true
  }

  async createAnnotation(input: CreateAnnotationInput): Promise<AnnotationState> {
    const annotation = createAnnotationState(input, this.deviceId, await this.tick())
    await this.writeAnnotation(annotation)
    return annotation
  }

  async updateAnnotationNote(id: string, note: string | undefined): Promise<boolean> {
    const current = await this.readAnnotation(id)
    if (!current || current.deleted_at !== null) return false
    const next = applyLocalAnnotationMutation(current, this.deviceId, await this.tick(), (draft) => {
      if (note === undefined) delete draft.note
      else draft.note = note
    })
    await this.writeAnnotation(next)
    return true
  }

  async deleteAnnotation(id: string): Promise<boolean> {
    const current = await this.readAnnotation(id)
    if (!current || current.deleted_at !== null) return false
    await this.writeAnnotation(applyLocalAnnotationDeletion(current, this.deviceId, await this.tick()))
    return true
  }

  async annotationsForDeviceBook(bookId: string): Promise<AnnotationState[]> {
    return (await this.listAnnotations())
      .filter(annotation => annotation.book_id === bookId && annotation.origin_device === this.deviceId)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  }

  async annotationsForBook(bookId: string): Promise<AnnotationState[]> {
    return (await this.listAnnotations())
      .filter(annotation => annotation.book_id === bookId && annotation.deleted_at === null)
      .sort((left, right) => right.created_at - left.created_at)
  }

  async mergeAnnotations(annotations: AnnotationState[]): Promise<number> {
    let changed = 0
    for (const incoming of annotations) {
      await this.observe(incoming.updated_at)
      const current = await this.readAnnotation(incoming.id)
      const result = mergeAnnotationVersion(current, incoming)
      if (!result.changed) continue
      if (result.conflictCopy && !(await this.readAnnotation(result.conflictCopy.id))) {
        await this.writeAnnotation(result.conflictCopy)
      }
      if (result.winner) await this.writeAnnotation(result.winner)
      changed += 1
    }
    return changed
  }
}

function compareUpdatedAt(left: HybridTimestamp, right: HybridTimestamp): number {
  if (left.wall_time_ms !== right.wall_time_ms) return left.wall_time_ms - right.wall_time_ms
  if (left.counter !== right.counter) return left.counter - right.counter
  return left.device_id < right.device_id ? -1 : left.device_id > right.device_id ? 1 : 0
}

// ---------------------------------------------------------------------------
// IndexedDB implementation (database `rebook-sync-v1`)
// ---------------------------------------------------------------------------

const META_STORE = 'meta'
const PROGRESS_STORE = 'progress'
const ANNOTATION_STORE = 'annotations'
const MEMBERSHIP_STORE = 'membership'

interface StoredMembershipRecord {
  book_id: string
  present: boolean
  changed_at: HybridTimestamp
}

class IdbSyncStateStore extends BaseSyncStateStore {
  private constructor(
    private readonly database: IDBDatabase,
    deviceId: string,
    now: () => number,
  ) {
    super(deviceId, now)
  }

  static open(deviceId: string, now: () => number = () => Date.now()): Promise<IdbSyncStateStore> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: 'key' })
        }
        if (!database.objectStoreNames.contains(PROGRESS_STORE)) {
          database.createObjectStore(PROGRESS_STORE, { keyPath: 'book_id' })
        }
        if (!database.objectStoreNames.contains(ANNOTATION_STORE)) {
          const store = database.createObjectStore(ANNOTATION_STORE, { keyPath: 'id' })
          store.createIndex('book_id', 'book_id')
          store.createIndex('origin_device', 'origin_device')
        }
        if (!database.objectStoreNames.contains(MEMBERSHIP_STORE)) {
          database.createObjectStore(MEMBERSHIP_STORE, { keyPath: 'book_id' })
        }
      }
      request.onsuccess = () => resolve(new IdbSyncStateStore(request.result, deviceId, now))
      request.onerror = () => reject(request.error ?? new Error('无法打开同步数据库'))
    })
  }

  protected async readHlc(): Promise<HybridTimestamp | null> {
    const record = await this.request<{ key: string; value: HybridTimestamp } | undefined>(
      META_STORE, 'readonly', store => store.get('hlc'),
    )
    return record?.value ?? null
  }

  protected writeHlc(timestamp: HybridTimestamp): Promise<void> {
    return this.run(META_STORE, 'readwrite', store => store.put({ key: 'hlc', value: timestamp }))
  }

  protected readProgress(bookId: string): Promise<StoredProgress | null> {
    return this.request<StoredProgress | undefined>(PROGRESS_STORE, 'readonly', store => store.get(bookId))
      .then(record => record ?? null)
  }

  protected writeProgress(bookId: string, progress: StoredProgress): Promise<void> {
    return this.run(PROGRESS_STORE, 'readwrite', store => store.put({ book_id: bookId, ...progress }))
  }

  protected readAnnotation(id: string): Promise<AnnotationState | null> {
    return this.request<AnnotationState | undefined>(ANNOTATION_STORE, 'readonly', store => store.get(id))
      .then(record => record ?? null)
  }

  protected writeAnnotation(annotation: AnnotationState): Promise<void> {
    return this.run(ANNOTATION_STORE, 'readwrite', store => store.put(annotation))
  }

  protected listAnnotations(): Promise<AnnotationState[]> {
    return this.request<AnnotationState[]>(ANNOTATION_STORE, 'readonly', store => store.getAll())
  }

  protected readMembership(bookId: string): Promise<DeviceBookEntry | null> {
    return this.request<StoredMembershipRecord | undefined>(MEMBERSHIP_STORE, 'readonly', store => store.get(bookId))
      .then(record => record ?? null)
  }

  protected writeMembership(entry: DeviceBookEntry): Promise<void> {
    return this.run(MEMBERSHIP_STORE, 'readwrite', store => store.put(entry))
  }

  protected listMemberships(): Promise<DeviceBookEntry[]> {
    return this.request<DeviceBookEntry[]>(MEMBERSHIP_STORE, 'readonly', store => store.getAll())
  }

  private request<T>(
    storeName: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(storeName, mode)
      const request = run(transaction.objectStore(storeName))
      request.onsuccess = () => resolve(request.result as T)
      request.onerror = () => reject(request.error ?? new Error('同步数据库读取失败'))
    })
  }

  private run(
    storeName: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(storeName, mode)
      run(transaction.objectStore(storeName))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('同步数据库写入失败'))
      transaction.onabort = () => reject(transaction.error ?? new Error('同步数据库写入失败'))
    })
  }
}

/** Open the persistent sync store (IndexedDB `rebook-sync-v1`). */
export function openSyncStore(deviceId: string): Promise<SyncStateStore> {
  return IdbSyncStateStore.open(deviceId)
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests, and a reference for the UI wiring phase)
// ---------------------------------------------------------------------------

class MemorySyncStateStore extends BaseSyncStateStore {
  private hlc: HybridTimestamp | null = null
  private readonly progress = new Map<string, StoredProgress>()
  private readonly annotations = new Map<string, AnnotationState>()
  private readonly membership = new Map<string, DeviceBookEntry>()

  protected readHlc(): Promise<HybridTimestamp | null> {
    return Promise.resolve(this.hlc)
  }

  protected writeHlc(timestamp: HybridTimestamp): Promise<void> {
    this.hlc = timestamp
    return Promise.resolve()
  }

  protected readProgress(bookId: string): Promise<StoredProgress | null> {
    return Promise.resolve(this.progress.get(bookId) ?? null)
  }

  protected writeProgress(bookId: string, progress: StoredProgress): Promise<void> {
    this.progress.set(bookId, progress)
    return Promise.resolve()
  }

  protected readAnnotation(id: string): Promise<AnnotationState | null> {
    return Promise.resolve(this.annotations.get(id) ?? null)
  }

  protected writeAnnotation(annotation: AnnotationState): Promise<void> {
    this.annotations.set(annotation.id, annotation)
    return Promise.resolve()
  }

  protected listAnnotations(): Promise<AnnotationState[]> {
    return Promise.resolve([...this.annotations.values()])
  }

  protected readMembership(bookId: string): Promise<DeviceBookEntry | null> {
    return Promise.resolve(this.membership.get(bookId) ?? null)
  }

  protected writeMembership(entry: DeviceBookEntry): Promise<void> {
    this.membership.set(entry.book_id, entry)
    return Promise.resolve()
  }

  protected listMemberships(): Promise<DeviceBookEntry[]> {
    return Promise.resolve([...this.membership.values()])
  }
}

/** In-memory SyncStateStore; `now` is injectable for deterministic tests. */
export function createInMemoryStateStore(deviceId: string, now: () => number = () => Date.now()): SyncStateStore {
  return new MemorySyncStateStore(deviceId, now)
}
