/**
 * Adapter between the WebDAV sync engine (`./engine`) and the app's local
 * storage: the IndexedDB bookshelf (`rebook-local-library`) and the reader
 * annotation store (`rebook-annotations`).
 *
 * Mapping decisions
 * -----------------
 * Book id: the engine's book_id is the lowercase SHA-256 of the file bytes;
 * `local-library` already stores it as `contentHash` (computed lazily by
 * `listLocalBookSyncRecords` for older records).
 *
 * Progress (shelf locator ↔ LocatorV1): the shelf locator only knows
 * { unitIndex, fraction, totalFraction, tocLabel }, so the mapping is
 *   position          ↔ unitIndex
 *   progression       ↔ fraction
 *   total_progression ↔ totalFraction
 *   href.fragment     ↔ tocLabel
 * href.path stays empty and source/partial_cfi/text stay null — the shelf
 * locator simply has no equivalent data.
 *
 * Annotations (ReaderAnnotation ↔ AnnotationState): local annotation ids are
 * already RFC 4122 UUIDs (createClientUUID), so they are used as engine
 * annotation ids unchanged — no namespacing or migration needed. Conflict
 * copies produced by the engine (`<id>~conflict~…`) are inserted locally
 * under that same string id. The local `version` field doubles as the
 * "exported to the sync store" generation (0 = never exported).
 *
 * Ranges (BookPosition ↔ SourceRange): the wire anchor is { spine, node,
 * text_offset }; the mapping encodes the rebook location type into the spine:
 *   reflowable → spine = href (or `s:<sectionIndex>`), node = `c:<cfi>` /
 *                `b:<blockId>` / raw cfi, text_offset = offset
 *   fixed      → spine = `p:<format>:<pageIndex>`
 *   image      → spine = `i:<pageIndex>`
 *   text       → spine = `t:<sectionIndex>`, text_offset = offset
 * Only the note is round-tripped for edits (the engine's local mutation
 * operation is note-only, same as the desktop store); color/location edits
 * stay local.
 */
import { isBookRange, type BookLocation, type BookPosition } from 'rebook'

import {
  finalizeSyncedAnnotations,
  listAnnotations,
  markAnnotationDeletedBySync,
  upsertSyncedAnnotation,
} from '../../lib/annotations'
import type { ShelfItem } from '../../lib/api'
import {
  importSyncedBook,
  listLocalBookSyncRecords,
  updateLocalBookProgress,
} from '../../lib/local-library'
import type { LocalLibrary } from './engine'
import type { LocatorV1, SourceAnchor, SourceRange } from './protocol'
import type { SyncStateStore } from './store'

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

/** The app's bookshelf as the engine's LocalLibrary boundary. */
export function createLocalLibrary(): LocalLibrary {
  return {
    listBooks: async () => {
      const records = await listLocalBookSyncRecords()
      return records.map(record => {
        const file = record.file
        const cover = record.cover
        return {
          id: record.contentHash,
          title: record.title,
          authors: record.author ? record.author.split(',').map(name => name.trim()).filter(Boolean) : [],
          fileName: record.fileName,
          addedAt: Date.parse(record.addedAt) || Date.now(),
          getBytes: async () => new Uint8Array(await file.arrayBuffer()),
          getCover: cover ? async () => new Uint8Array(await cover.arrayBuffer()) : undefined,
        }
      })
    },
    saveDownloadedBook: book => importSyncedBook(book),
  }
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export function toLocatorV1(bookId: string, locator: ShelfItem['locator']): LocatorV1 {
  return {
    version: 1,
    publication_id: bookId,
    href: locator?.tocLabel ? { path: '', fragment: locator.tocLabel } : { path: '' },
    progression: locator?.fraction ?? null,
    total_progression: locator?.totalFraction ?? null,
    position: locator?.unitIndex ?? null,
    source: null,
    partial_cfi: null,
    text: null,
  }
}

export function fromLocatorV1(
  locator: LocatorV1,
  fallbackProgress: number,
): { progress: number; locator: ShelfItem['locator'] } {
  const progress = locator.total_progression ?? locator.progression ?? fallbackProgress
  return {
    progress: Math.max(0, Math.min(1, progress)),
    locator: {
      unitIndex: locator.position ?? undefined,
      fraction: locator.progression ?? undefined,
      totalFraction: locator.total_progression ?? undefined,
      tocLabel: locator.href.fragment,
    },
  }
}

/** Push local reading progress into the sync store where it is newer. */
export async function publishLocalProgress(store: SyncStateStore): Promise<void> {
  for (const record of await listLocalBookSyncRecords()) {
    if (!record.locator) continue
    const stored = await store.loadProgress(record.contentHash)
    const localMs = Date.parse(record.updatedAt) || 0
    if (stored && stored.updated_at.wall_time_ms >= localMs) continue
    await store.saveProgress(record.contentHash, toLocatorV1(record.contentHash, record.locator))
  }
}

/**
 * Apply progress merged from other devices to shelf records. The book
 * currently open in the reader is skipped so its position is never yanked
 * mid-reading; it picks the merged value up on next open.
 */
export async function applySyncedProgress(store: SyncStateStore, openBookId: string | null): Promise<number> {
  let applied = 0
  for (const record of await listLocalBookSyncRecords()) {
    if (record.id === openBookId) continue
    const stored = await store.loadProgress(record.contentHash)
    if (!stored) continue
    const localMs = Date.parse(record.updatedAt) || 0
    if (stored.updated_at.wall_time_ms <= localMs) continue
    const { progress, locator } = fromLocatorV1(stored.locator, record.progress)
    await updateLocalBookProgress(record.id, progress, locator)
    applied += 1
  }
  return applied
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

export interface ExportedAnnotations {
  bookKey: string
  ids: string[]
}

/**
 * Export dirty local annotations into the sync store so the engine publishes
 * them. Returns the exported ids per book; call `finalizeExportedAnnotations`
 * after a successful sync to clear dirty flags and drop local tombstones.
 */
export async function exportLocalAnnotations(store: SyncStateStore): Promise<ExportedAnnotations[]> {
  const exported: ExportedAnnotations[] = []
  for (const record of await listLocalBookSyncRecords()) {
    const dirty = (await listAnnotations(record.id, true)).filter(annotation => annotation.dirty)
    if (!dirty.length) continue
    const ids: string[] = []
    for (const annotation of dirty) {
      if (annotation.deletedAt) {
        // version 0 means the sync store never saw it: nothing to publish.
        if (annotation.version > 0) await store.deleteAnnotation(annotation.id)
        ids.push(annotation.id)
        continue
      }
      const note = annotation.note ?? undefined
      if (annotation.version > 0) {
        const updated = await store.updateAnnotationNote(annotation.id, note)
        // Unknown to the sync store (e.g. its database was rebuilt): recreate.
        if (!updated) await store.createAnnotation(createInput(record.contentHash, annotation))
      } else {
        await store.createAnnotation(createInput(record.contentHash, annotation))
      }
      ids.push(annotation.id)
    }
    exported.push({ bookKey: record.id, ids })
  }
  return exported
}

export async function finalizeExportedAnnotations(exported: ExportedAnnotations[]): Promise<void> {
  for (const { bookKey, ids } of exported) await finalizeSyncedAnnotations(bookKey, ids)
}

/**
 * Pull annotations merged by the engine back into the reader store: visible
 * annotations are upserted (conflict copies arrive as new ids), and locally
 * clean annotations that vanished from the visible set were tombstoned by
 * another device and are soft-deleted.
 */
export async function importSyncedAnnotations(store: SyncStateStore): Promise<void> {
  for (const record of await listLocalBookSyncRecords()) {
    const visible = await store.annotationsForBook(record.contentHash)
    const visibleIds = new Set(visible.map(annotation => annotation.id))
    for (const annotation of visible) {
      const range = annotation.ranges[0]
      if (!range) continue
      await upsertSyncedAnnotation(record.id, {
        id: annotation.id,
        location: fromSourceRange(range),
        quote: annotation.quote || null,
        note: annotation.note ?? null,
        createdAt: new Date(annotation.created_at).toISOString(),
        updatedAt: new Date(annotation.updated_at.wall_time_ms).toISOString(),
      })
    }
    const tombstonedAt = new Date().toISOString()
    for (const local of await listAnnotations(record.id)) {
      if (local.version > 0 && !local.dirty && !visibleIds.has(local.id)) {
        await markAnnotationDeletedBySync(record.id, local.id, tombstonedAt)
      }
    }
  }
}

function createInput(
  bookId: string,
  annotation: { id: string; location: BookPosition; quote: string | null; note: string | null; createdAt: string },
) {
  return {
    id: annotation.id,
    book_id: bookId,
    ranges: [toSourceRange(annotation.location)],
    quote: annotation.quote ?? '',
    note: annotation.note ?? undefined,
    created_at: Date.parse(annotation.createdAt) || Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Range mapping
// ---------------------------------------------------------------------------

export function toSourceRange(position: BookPosition): SourceRange {
  if (isBookRange(position)) {
    return {
      start: toSourceAnchor(position.start),
      end: toSourceAnchor(position.end ?? position.start),
    }
  }
  return { start: toSourceAnchor(position), end: toSourceAnchor(position) }
}

export function fromSourceRange(range: SourceRange): BookPosition {
  return { start: fromSourceAnchor(range.start), end: fromSourceAnchor(range.end) }
}

function toSourceAnchor(location: BookLocation): SourceAnchor {
  switch (location.type) {
    case 'reflowable':
      return {
        spine: location.href ?? `s:${location.sectionIndex}`,
        node: location.cfi ? `c:${location.cfi}` : location.blockId ? `b:${location.blockId}` : '',
        text_offset: location.offset ?? 0,
      }
    case 'fixed':
      return { spine: `p:${location.format ?? ''}:${location.pageIndex}`, node: '', text_offset: 0 }
    case 'image':
      return { spine: `i:${location.pageIndex}`, node: '', text_offset: 0 }
    case 'text':
      return { spine: `t:${location.sectionIndex}`, node: '', text_offset: location.offset }
  }
}

function fromSourceAnchor(anchor: SourceAnchor): BookLocation {
  const encoded = /^(s|p|i|t):(.*)$/.exec(anchor.spine)
  if (encoded) {
    const [, kind, rest] = encoded
    if (kind === 'p') {
      const separator = rest.lastIndexOf(':')
      const pageIndex = Number(rest.slice(separator + 1))
      return {
        type: 'fixed',
        format: rest.slice(0, separator) || undefined,
        pageIndex: Number.isSafeInteger(pageIndex) ? pageIndex : 0,
      }
    }
    if (kind === 'i') return { type: 'image', pageIndex: Number(rest) || 0 }
    if (kind === 't') return { type: 'text', sectionIndex: Number(rest) || 0, offset: anchor.text_offset }
    return {
      type: 'reflowable',
      sectionIndex: Number(rest) || 0,
      ...reflowableNode(anchor.node),
      offset: anchor.text_offset,
    }
  }
  // A plain spine is a content-document href (the desktop writer's shape).
  return {
    type: 'reflowable',
    sectionIndex: 0,
    href: anchor.spine,
    ...reflowableNode(anchor.node),
    offset: anchor.text_offset,
  }
}

function reflowableNode(node: string): { cfi?: string; blockId?: string } {
  if (node.startsWith('c:')) return { cfi: node.slice(2) }
  if (node.startsWith('b:')) return { blockId: node.slice(2) }
  return node ? { cfi: node } : {}
}
