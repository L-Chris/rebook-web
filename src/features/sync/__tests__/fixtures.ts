/**
 * Wire fixtures written exactly as the desktop (torto/apps/desktop/src/sync)
 * writes them: snake_case keys in struct declaration order, two-space pretty
 * printing, `note`/`conflict_of`/`fragment` omitted when absent, `deleted_at`
 * always present.
 */
import type {
  AnnotationState,
  BookManifest,
  DeviceBookState,
  DeviceLibrary,
  ProtocolDocument,
} from '../protocol'

export const DEVICE_A = 'd6e21c7d-6f6b-40db-a87c-bef85c12fa47'
export const DEVICE_B = '7c9e2f10-3a4b-4c5d-8e6f-1a2b3c4d5e6f'
export const BOOK_ID = 'a'.repeat(64)

export const HLC_A = { wall_time_ms: 1717000000000, counter: 0, device_id: DEVICE_A }
export const HLC_B = { wall_time_ms: 1717000005000, counter: 2, device_id: DEVICE_B }

export const PROTOCOL_DOCUMENT: ProtocolDocument = { version: 1, protocol: 'rebook-webdav' }

export const PROTOCOL_JSON = `{
  "version": 1,
  "protocol": "rebook-webdav"
}`

export const DEVICE_LIBRARY: DeviceLibrary = {
  version: 1,
  device_id: DEVICE_A,
  device_name: 'Torto Desktop',
  updated_at: HLC_A,
  books: [
    { book_id: BOOK_ID, present: true, changed_at: HLC_A },
    { book_id: 'b'.repeat(64), present: false, changed_at: HLC_B },
  ],
}

export const DEVICE_LIBRARY_JSON = `{
  "version": 1,
  "device_id": "${DEVICE_A}",
  "device_name": "Torto Desktop",
  "updated_at": {
    "wall_time_ms": 1717000000000,
    "counter": 0,
    "device_id": "${DEVICE_A}"
  },
  "books": [
    {
      "book_id": "${BOOK_ID}",
      "present": true,
      "changed_at": {
        "wall_time_ms": 1717000000000,
        "counter": 0,
        "device_id": "${DEVICE_A}"
      }
    },
    {
      "book_id": "${'b'.repeat(64)}",
      "present": false,
      "changed_at": {
        "wall_time_ms": 1717000005000,
        "counter": 2,
        "device_id": "${DEVICE_B}"
      }
    }
  ]
}`

export const BOOK_MANIFEST: BookManifest = {
  version: 1,
  book_id: BOOK_ID,
  title: 'Fixture Book',
  authors: ['Rebook', 'Torto'],
  file_name: 'fixture.epub',
  content_path: `books/${BOOK_ID}/content.epub`,
  content_sha256: BOOK_ID,
  content_length: 29,
  cover_path: `books/${BOOK_ID}/cover.bin`,
  added_at: 1716999900000,
}

export const BOOK_MANIFEST_JSON = `{
  "version": 1,
  "book_id": "${BOOK_ID}",
  "title": "Fixture Book",
  "authors": [
    "Rebook",
    "Torto"
  ],
  "file_name": "fixture.epub",
  "content_path": "books/${BOOK_ID}/content.epub",
  "content_sha256": "${BOOK_ID}",
  "content_length": 29,
  "cover_path": "books/${BOOK_ID}/cover.bin",
  "added_at": 1716999900000
}`

export const ANNOTATION: AnnotationState = {
  id: '0c1f2f1e-9c8b-4a7b-8c6d-5e4f3a2b1c09',
  book_id: BOOK_ID,
  ranges: [
    {
      start: { spine: 'chapter-1', node: 'p/4', text_offset: 12 },
      end: { spine: 'chapter-1', node: 'p/4', text_offset: 48 },
    },
  ],
  quote: 'a highlighted sentence',
  note: 'a note',
  created_at: 1716999950000,
  updated_at: HLC_A,
  clock: { [DEVICE_A]: 3, [DEVICE_B]: 1 },
  deleted_at: null,
  origin_device: DEVICE_A,
}

export const DEVICE_BOOK_STATE: DeviceBookState = {
  version: 1,
  device_id: DEVICE_A,
  book_id: BOOK_ID,
  updated_at: HLC_A,
  progress: {
    locator: {
      version: 1,
      publication_id: BOOK_ID,
      href: { path: 'OEBPS/chapter-1.xhtml', fragment: 'start' },
      progression: 0.5,
      total_progression: 0.25,
      position: null,
      source: {
        start: { spine: 'chapter-1', node: 'p/4', text_offset: 12 },
        end: { spine: 'chapter-1', node: 'p/4', text_offset: 48 },
      },
      partial_cfi: null,
      text: { before: 'before ', highlight: 'highlight', after: ' after' },
    },
    updated_at: HLC_A,
  },
  annotations: [ANNOTATION],
}

export const DEVICE_BOOK_STATE_JSON = `{
  "version": 1,
  "device_id": "${DEVICE_A}",
  "book_id": "${BOOK_ID}",
  "updated_at": {
    "wall_time_ms": 1717000000000,
    "counter": 0,
    "device_id": "${DEVICE_A}"
  },
  "progress": {
    "locator": {
      "version": 1,
      "publication_id": "${BOOK_ID}",
      "href": {
        "path": "OEBPS/chapter-1.xhtml",
        "fragment": "start"
      },
      "progression": 0.5,
      "total_progression": 0.25,
      "position": null,
      "source": {
        "start": {
          "spine": "chapter-1",
          "node": "p/4",
          "text_offset": 12
        },
        "end": {
          "spine": "chapter-1",
          "node": "p/4",
          "text_offset": 48
        }
      },
      "partial_cfi": null,
      "text": {
        "before": "before ",
        "highlight": "highlight",
        "after": " after"
      }
    },
    "updated_at": {
      "wall_time_ms": 1717000000000,
      "counter": 0,
      "device_id": "${DEVICE_A}"
    }
  },
  "annotations": [
    {
      "id": "0c1f2f1e-9c8b-4a7b-8c6d-5e4f3a2b1c09",
      "book_id": "${BOOK_ID}",
      "ranges": [
        {
          "start": {
            "spine": "chapter-1",
            "node": "p/4",
            "text_offset": 12
          },
          "end": {
            "spine": "chapter-1",
            "node": "p/4",
            "text_offset": 48
          }
        }
      ],
      "quote": "a highlighted sentence",
      "note": "a note",
      "created_at": 1716999950000,
      "updated_at": {
        "wall_time_ms": 1717000000000,
        "counter": 0,
        "device_id": "${DEVICE_A}"
      },
      "clock": {
        "${DEVICE_B}": 1,
        "${DEVICE_A}": 3
      },
      "deleted_at": null,
      "origin_device": "${DEVICE_A}"
    }
  ]
}`
