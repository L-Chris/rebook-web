/**
 * Wire types, writers and validators for the `webdav-sync-v1` protocol.
 *
 * Every document here is field-for-field compatible with the desktop writer
 * in torto/apps/desktop/src/sync/protocol.rs. Type field names use the
 * snake_case wire names on purpose so serialization cannot drift from the
 * desktop layout. Documents are written with two-space pretty printing,
 * matching `serde_json::to_vec_pretty`.
 */
import { compareHlc, isValidHlc, type HybridTimestamp } from './hlc'
import { compareClocks, isValidVectorClock, sortClockKeys, type VectorClock } from './vclock'

export const PROTOCOL_VERSION = 1
export const PROTOCOL_NAME = 'rebook-webdav'

export type { HybridTimestamp, VectorClock }

// ---------------------------------------------------------------------------
// Shared structures
// ---------------------------------------------------------------------------

export interface SourceAnchor {
  spine: string
  node: string
  text_offset: number
}

export interface SourceRange {
  start: SourceAnchor
  end: SourceAnchor
}

export interface TextQuote {
  before: string
  highlight: string
  after: string
}

export interface LocatorHref {
  path: string
  /** Omitted from the wire document when undefined. */
  fragment?: string
}

export interface LocatorV1 {
  version: number
  publication_id: string
  href: LocatorHref
  progression: number | null
  total_progression: number | null
  position: number | null
  source: SourceRange | null
  partial_cfi: string | null
  text: TextQuote | null
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface ProtocolDocument {
  version: number
  protocol: string
}

export interface DeviceBookEntry {
  book_id: string
  present: boolean
  changed_at: HybridTimestamp
}

export interface DeviceLibrary {
  version: number
  device_id: string
  device_name: string
  updated_at: HybridTimestamp
  /** Sorted by book_id, includes present:false tombstones. */
  books: DeviceBookEntry[]
}

export interface BookManifest {
  version: number
  book_id: string
  title: string
  authors: string[]
  file_name: string
  content_path: string
  content_sha256: string
  content_length: number
  cover_path: string | null
  added_at: number
}

export interface ProgressState {
  locator: LocatorV1
  updated_at: HybridTimestamp
}

export interface AnnotationState {
  id: string
  book_id: string
  ranges: SourceRange[]
  quote: string
  /** Omitted from the wire document when undefined. */
  note?: string
  created_at: number
  updated_at: HybridTimestamp
  clock: VectorClock
  /** Always serialized, may be null. */
  deleted_at: HybridTimestamp | null
  origin_device: string
  /** Omitted from the wire document when undefined. */
  conflict_of?: string
}

export interface DeviceBookState {
  version: number
  device_id: string
  book_id: string
  updated_at: HybridTimestamp
  progress: ProgressState | null
  annotations: AnnotationState[]
}

// ---------------------------------------------------------------------------
// Writers (exact desktop byte layout)
// ---------------------------------------------------------------------------

/** Two-space pretty JSON, matching serde_json::to_vec_pretty. */
export function writeJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function locatorToWire(locator: LocatorV1): Record<string, unknown> {
  const href: Record<string, unknown> = { path: locator.href.path }
  if (locator.href.fragment !== undefined) href.fragment = locator.href.fragment
  return {
    version: locator.version,
    publication_id: locator.publication_id,
    href,
    progression: locator.progression,
    total_progression: locator.total_progression,
    position: locator.position,
    source: locator.source,
    partial_cfi: locator.partial_cfi,
    text: locator.text,
  }
}

function annotationToWire(annotation: AnnotationState): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    id: annotation.id,
    book_id: annotation.book_id,
    ranges: annotation.ranges,
    quote: annotation.quote,
  }
  if (annotation.note !== undefined) wire.note = annotation.note
  wire.created_at = annotation.created_at
  wire.updated_at = annotation.updated_at
  wire.clock = sortClockKeys(annotation.clock)
  wire.deleted_at = annotation.deleted_at
  wire.origin_device = annotation.origin_device
  if (annotation.conflict_of !== undefined) wire.conflict_of = annotation.conflict_of
  return wire
}

export function writeProtocolDocument(document: ProtocolDocument): string {
  return writeJson({ version: document.version, protocol: document.protocol })
}

export function writeDeviceLibrary(library: DeviceLibrary): string {
  return writeJson({
    version: library.version,
    device_id: library.device_id,
    device_name: library.device_name,
    updated_at: library.updated_at,
    books: library.books,
  })
}

export function writeBookManifest(manifest: BookManifest): string {
  return writeJson({
    version: manifest.version,
    book_id: manifest.book_id,
    title: manifest.title,
    authors: manifest.authors,
    file_name: manifest.file_name,
    content_path: manifest.content_path,
    content_sha256: manifest.content_sha256,
    content_length: manifest.content_length,
    cover_path: manifest.cover_path,
    added_at: manifest.added_at,
  })
}

export function writeDeviceBookState(state: DeviceBookState): string {
  return writeJson({
    version: state.version,
    device_id: state.device_id,
    book_id: state.book_id,
    updated_at: state.updated_at,
    progress: state.progress
      ? { locator: locatorToWire(state.progress.locator), updated_at: state.progress.updated_at }
      : null,
    annotations: state.annotations.map(annotationToWire),
  })
}

// ---------------------------------------------------------------------------
// Field readers
// ---------------------------------------------------------------------------

function fail(message: string): never {
  throw new Error(`webdav-sync-v1: ${message}`)
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${what} 必须是 JSON 对象`)
  return value as Record<string, unknown>
}

function readString(record: Record<string, unknown>, key: string, what: string): string {
  const value = record[key]
  if (typeof value !== 'string') fail(`${what} 缺少字符串字段 ${key}`)
  return value
}

function readOptionalString(record: Record<string, unknown>, key: string, what: string): string | undefined {
  const value = record[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') fail(`${what} 字段 ${key} 必须是字符串`)
  return value
}

function readStringOrNull(record: Record<string, unknown>, key: string, what: string): string | null {
  const value = record[key]
  if (value === null) return null
  if (typeof value !== 'string') fail(`${what} 字段 ${key} 必须是字符串或 null`)
  return value
}

function readNumber(record: Record<string, unknown>, key: string, what: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${what} 缺少数字字段 ${key}`)
  return value
}

function readHlc(value: unknown, what: string): HybridTimestamp {
  if (!isValidHlc(value)) fail(`${what} 包含无效的混合时间戳`)
  return value
}

function readHlcOrNull(value: unknown, what: string): HybridTimestamp | null {
  if (value === null || value === undefined) return null
  return readHlc(value, what)
}

function readSourceRange(value: unknown, what: string): SourceRange {
  const record = asRecord(value, what)
  const anchor = (key: string): SourceAnchor => {
    const raw = asRecord(record[key], what)
    const offset = raw.text_offset
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
      fail(`${what} 包含无效的 text_offset`)
    }
    return {
      spine: readString(raw, 'spine', what),
      node: readString(raw, 'node', what),
      text_offset: offset,
    }
  }
  return { start: anchor('start'), end: anchor('end') }
}

function readTextQuote(value: unknown, what: string): TextQuote {
  const record = asRecord(value, what)
  return {
    before: readString(record, 'before', what),
    highlight: readString(record, 'highlight', what),
    after: readString(record, 'after', what),
  }
}

function readNumberOrNull(record: Record<string, unknown>, key: string, what: string): number | null {
  const value = record[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${what} 字段 ${key} 必须是数字或 null`)
  return value
}

// ---------------------------------------------------------------------------
// Parsers (accept the desktop wire format, reject anything structurally off)
// ---------------------------------------------------------------------------

export function parseLocator(value: unknown): LocatorV1 {
  const what = 'LocatorV1'
  const record = asRecord(value, what)
  const hrefRecord = asRecord(record.href, what)
  const source = record.source === null || record.source === undefined
    ? null
    : readSourceRange(record.source, what)
  const text = record.text === null || record.text === undefined
    ? null
    : readTextQuote(record.text, what)
  const partialCfi = record.partial_cfi
  if (partialCfi !== null && partialCfi !== undefined && typeof partialCfi !== 'string') {
    fail(`${what} 字段 partial_cfi 必须是字符串或 null`)
  }
  const href: LocatorHref = { path: readString(hrefRecord, 'path', what) }
  const fragment = readOptionalString(hrefRecord, 'fragment', what)
  if (fragment !== undefined) href.fragment = fragment
  return {
    version: readNumber(record, 'version', what),
    publication_id: readString(record, 'publication_id', what),
    href,
    progression: readNumberOrNull(record, 'progression', what),
    total_progression: readNumberOrNull(record, 'total_progression', what),
    position: readNumberOrNull(record, 'position', what),
    source,
    partial_cfi: partialCfi ?? null,
    text,
  }
}

export function validateLocator(locator: LocatorV1): void {
  if (locator.version !== 1) fail(`不支持的定位器版本：${locator.version}`)
  for (const progression of [locator.progression, locator.total_progression]) {
    if (progression !== null && (progression < 0 || progression > 1 || !Number.isFinite(progression))) {
      fail(`阅读进度超出范围：${progression}`)
    }
  }
}

export function parseAnnotation(value: unknown): AnnotationState {
  const what = 'AnnotationState'
  const record = asRecord(value, what)
  const ranges = record.ranges
  if (!Array.isArray(ranges)) fail(`${what} 缺少 ranges 数组`)
  const clock = record.clock === undefined ? {} : record.clock
  if (!isValidVectorClock(clock)) fail(`${what} 包含无效的向量时钟`)
  const annotation: AnnotationState = {
    id: readString(record, 'id', what),
    book_id: readString(record, 'book_id', what),
    ranges: ranges.map(range => readSourceRange(range, what)),
    quote: readString(record, 'quote', what),
    created_at: readNumber(record, 'created_at', what),
    updated_at: readHlc(record.updated_at, what),
    clock: { ...clock },
    deleted_at: readHlcOrNull(record.deleted_at, what),
    origin_device: readString(record, 'origin_device', what),
  }
  const note = readOptionalString(record, 'note', what)
  if (note !== undefined) annotation.note = note
  const conflictOf = readOptionalString(record, 'conflict_of', what)
  if (conflictOf !== undefined) annotation.conflict_of = conflictOf
  return annotation
}

export function parseProgressState(value: unknown): ProgressState {
  const what = 'ProgressState'
  const record = asRecord(value, what)
  return {
    locator: parseLocator(record.locator),
    updated_at: readHlc(record.updated_at, what),
  }
}

export function parseProtocolDocument(value: unknown): ProtocolDocument {
  const record = asRecord(value, 'protocol.json')
  return {
    version: readNumber(record, 'version', 'protocol.json'),
    protocol: readString(record, 'protocol', 'protocol.json'),
  }
}

export function parseDeviceLibrary(value: unknown): DeviceLibrary {
  const what = 'DeviceLibrary'
  const record = asRecord(value, what)
  const books = record.books
  if (!Array.isArray(books)) fail(`${what} 缺少 books 数组`)
  return {
    version: readNumber(record, 'version', what),
    device_id: readString(record, 'device_id', what),
    device_name: readString(record, 'device_name', what),
    updated_at: readHlc(record.updated_at, what),
    books: books.map((entry) => {
      const item = asRecord(entry, what)
      if (typeof item.present !== 'boolean') fail(`${what} 条目缺少 present 布尔值`)
      return {
        book_id: readString(item, 'book_id', what),
        present: item.present,
        changed_at: readHlc(item.changed_at, what),
      }
    }),
  }
}

export function parseBookManifest(value: unknown): BookManifest {
  const what = 'BookManifest'
  const record = asRecord(value, what)
  const authors = record.authors
  if (!Array.isArray(authors) || authors.some(author => typeof author !== 'string')) {
    fail(`${what} 缺少 authors 字符串数组`)
  }
  return {
    version: readNumber(record, 'version', what),
    book_id: readString(record, 'book_id', what),
    title: readString(record, 'title', what),
    authors: [...authors],
    file_name: readString(record, 'file_name', what),
    content_path: readString(record, 'content_path', what),
    content_sha256: readString(record, 'content_sha256', what),
    content_length: readNumber(record, 'content_length', what),
    cover_path: readStringOrNull(record, 'cover_path', what),
    added_at: readNumber(record, 'added_at', what),
  }
}

export function parseDeviceBookState(value: unknown): DeviceBookState {
  const what = 'DeviceBookState'
  const record = asRecord(value, what)
  const annotations = record.annotations
  if (!Array.isArray(annotations)) fail(`${what} 缺少 annotations 数组`)
  return {
    version: readNumber(record, 'version', what),
    device_id: readString(record, 'device_id', what),
    book_id: readString(record, 'book_id', what),
    updated_at: readHlc(record.updated_at, what),
    progress: record.progress === null || record.progress === undefined
      ? null
      : parseProgressState(record.progress),
    annotations: annotations.map(parseAnnotation),
  }
}

export function parseJsonDocument<T>(bytes: Uint8Array, parse: (value: unknown) => T): T {
  let decoded: unknown
  try {
    decoded = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    fail('远端 JSON 文档无法解析')
  }
  return parse(decoded)
}

// ---------------------------------------------------------------------------
// Cross-field validators (engine rules, mirroring the desktop engine)
// ---------------------------------------------------------------------------

const BOOK_ID_PATTERN = /^[0-9a-f]{64}$/

export function isValidBookId(bookId: string): boolean {
  return BOOK_ID_PATTERN.test(bookId)
}

export function validateBookId(bookId: string): void {
  if (!isValidBookId(bookId)) fail(`书籍内容哈希无效：${bookId}`)
}

/** Lowercased ASCII-alphanumeric extension, required (mirrors storage_extension). */
export function storageExtension(fileName: string): string {
  const extension = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? ''
  if (!extension || !/^[a-z0-9]+$/.test(extension)) fail(`书籍扩展名无效：${fileName}`)
  return extension
}

export function validateManifest(manifest: BookManifest, expectedBookId: string): void {
  validateBookId(manifest.book_id)
  if (
    manifest.version !== PROTOCOL_VERSION
    || manifest.book_id !== expectedBookId
    || manifest.content_sha256 !== expectedBookId
  ) {
    fail('远端书籍清单与内容标识不一致')
  }
  const contentPrefix = `books/${expectedBookId}/content.`
  const extension = manifest.content_path.startsWith(contentPrefix)
    ? manifest.content_path.slice(contentPrefix.length)
    : null
  if (
    extension === null
    || !/^[A-Za-z0-9]*$/.test(extension)
    || (manifest.cover_path !== null && manifest.cover_path !== `books/${expectedBookId}/cover.bin`)
  ) {
    fail('远端书籍清单包含非法路径')
  }
}

export function validateState(state: DeviceBookState, expectedBookId: string): void {
  if (
    state.version !== PROTOCOL_VERSION
    || state.book_id !== expectedBookId
    || state.device_id.trim() === ''
    || (state.progress !== null && state.progress.locator.publication_id !== expectedBookId)
    || state.annotations.some(annotation => annotation.book_id !== expectedBookId)
  ) {
    fail('远端阅读状态与书籍标识不一致')
  }
}

export function validateDeviceLibrary(library: DeviceLibrary): void {
  if (library.version !== PROTOCOL_VERSION || library.device_id.trim() === '') {
    fail('远端书架清单版本或设备标识无效')
  }
  for (const entry of library.books) validateBookId(entry.book_id)
}

// ---------------------------------------------------------------------------
// Annotation operations (pure; shared by the IDB store and the memory store)
// ---------------------------------------------------------------------------

/** Create a locally-originated annotation (clock starts at { device: 1 }). */
export function createAnnotationState(
  input: {
    id: string
    book_id: string
    ranges: SourceRange[]
    quote: string
    note?: string
    created_at: number
  },
  deviceId: string,
  updatedAt: HybridTimestamp,
): AnnotationState {
  const annotation: AnnotationState = {
    id: input.id,
    book_id: input.book_id,
    ranges: input.ranges,
    quote: input.quote,
    created_at: input.created_at,
    updated_at: updatedAt,
    clock: { [deviceId]: 1 },
    deleted_at: null,
    origin_device: deviceId,
  }
  if (input.note !== undefined) annotation.note = input.note
  return annotation
}

/**
 * Apply a local modification to an annotation: bump this device's clock entry
 * and reassign origin_device to this device (even when the annotation came
 * from another device), matching the desktop store.
 */
export function applyLocalAnnotationMutation(
  annotation: AnnotationState,
  deviceId: string,
  updatedAt: HybridTimestamp,
  mutate: (draft: AnnotationState) => void,
): AnnotationState {
  const next: AnnotationState = {
    ...annotation,
    ranges: annotation.ranges.map(range => ({ start: { ...range.start }, end: { ...range.end } })),
    clock: { ...annotation.clock, [deviceId]: (annotation.clock[deviceId] ?? 0) + 1 },
    updated_at: updatedAt,
    origin_device: deviceId,
  }
  mutate(next)
  return next
}

/** Local deletion keeps a tombstone that still participates in merges. */
export function applyLocalAnnotationDeletion(
  annotation: AnnotationState,
  deviceId: string,
  updatedAt: HybridTimestamp,
): AnnotationState {
  return applyLocalAnnotationMutation(annotation, deviceId, updatedAt, (draft) => {
    draft.deleted_at = updatedAt
  })
}

/** `<id>~conflict~<origin_device>~<wall_time_ms>-<counter>`, from the loser. */
export function conflictCopyId(annotation: AnnotationState): string {
  return `${annotation.id}~conflict~${annotation.origin_device}~${annotation.updated_at.wall_time_ms}-${annotation.updated_at.counter}`
}

export interface AnnotationMergeResult {
  /** True when the local record set changed. */
  changed: boolean
  /** Winning version to store under `incoming.id` (absent when nothing changed). */
  winner?: AnnotationState
  /** Retained visible loser, to store under its new conflict id when absent. */
  conflictCopy?: AnnotationState
}

/**
 * Merge one incoming annotation version into the current one.
 *
 * Mirrors SyncStore::merge_annotations on the desktop, including the quirk
 * that a conflict copy's `conflict_of` always points at the *incoming*
 * annotation id, even when the incoming version lost.
 */
export function mergeAnnotationVersion(
  current: AnnotationState | null,
  incoming: AnnotationState,
): AnnotationMergeResult {
  if (incoming.id.trim() === '' || incoming.book_id.trim() === '' || incoming.origin_device.trim() === '') {
    fail('远端批注标识无效')
  }
  if (!current) return { changed: true, winner: incoming }
  switch (compareClocks(current.clock, incoming.clock)) {
    case 'before':
      return { changed: true, winner: incoming }
    case 'after':
    case 'equal':
      return { changed: false }
    case 'concurrent': {
      const incomingWins = compareHlc(incoming.updated_at, current.updated_at) > 0
      const winner = incomingWins ? incoming : current
      const loser = incomingWins ? current : incoming
      let conflictCopy: AnnotationState | undefined
      if (loser.deleted_at === null && loser.conflict_of === undefined) {
        conflictCopy = { ...loser, clock: { ...loser.clock } }
        conflictCopy.id = conflictCopyId(loser)
        conflictCopy.conflict_of = incoming.id
      }
      return { changed: true, winner, conflictCopy }
    }
  }
}
