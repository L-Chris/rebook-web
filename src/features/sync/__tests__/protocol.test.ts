import { describe, expect, it } from 'vitest'

import {
  parseBookManifest,
  parseDeviceBookState,
  parseDeviceLibrary,
  parseProtocolDocument,
  storageExtension,
  validateDeviceLibrary,
  validateManifest,
  validateState,
  writeBookManifest,
  writeDeviceBookState,
  writeDeviceLibrary,
  writeProtocolDocument,
} from '../protocol'
import {
  BOOK_ID,
  BOOK_MANIFEST,
  BOOK_MANIFEST_JSON,
  DEVICE_BOOK_STATE,
  DEVICE_BOOK_STATE_JSON,
  DEVICE_LIBRARY,
  DEVICE_LIBRARY_JSON,
  PROTOCOL_DOCUMENT,
  PROTOCOL_JSON,
} from './fixtures'

describe('wire writers', () => {
  it('writes protocol.json exactly like the desktop', () => {
    expect(writeProtocolDocument(PROTOCOL_DOCUMENT)).toBe(PROTOCOL_JSON)
  })

  it('writes a device library exactly like the desktop', () => {
    expect(writeDeviceLibrary(DEVICE_LIBRARY)).toBe(DEVICE_LIBRARY_JSON)
  })

  it('writes a book manifest exactly like the desktop', () => {
    expect(writeBookManifest(BOOK_MANIFEST)).toBe(BOOK_MANIFEST_JSON)
  })

  it('writes a device book state exactly like the desktop', () => {
    expect(writeDeviceBookState(DEVICE_BOOK_STATE)).toBe(DEVICE_BOOK_STATE_JSON)
  })
})

describe('parsers and validators', () => {
  it('accepts every desktop fixture and round-trips it', () => {
    expect(parseProtocolDocument(JSON.parse(PROTOCOL_JSON))).toEqual(PROTOCOL_DOCUMENT)
    expect(parseDeviceLibrary(JSON.parse(DEVICE_LIBRARY_JSON))).toEqual(DEVICE_LIBRARY)
    expect(parseBookManifest(JSON.parse(BOOK_MANIFEST_JSON))).toEqual(BOOK_MANIFEST)
    const state = parseDeviceBookState(JSON.parse(DEVICE_BOOK_STATE_JSON))
    expect(state).toEqual(DEVICE_BOOK_STATE)
    expect(writeDeviceBookState(state)).toBe(DEVICE_BOOK_STATE_JSON)

    expect(() => validateDeviceLibrary(DEVICE_LIBRARY)).not.toThrow()
    expect(() => validateManifest(BOOK_MANIFEST, BOOK_ID)).not.toThrow()
    expect(() => validateState(DEVICE_BOOK_STATE, BOOK_ID)).not.toThrow()
  })

  it('accepts a manifest without a cover', () => {
    const manifest = { ...BOOK_MANIFEST, cover_path: null }
    expect(() => validateManifest(manifest, BOOK_ID)).not.toThrow()
  })

  it('rejects manifests that break the content-addressed invariants', () => {
    const wrongVersion = { ...BOOK_MANIFEST, version: 2 }
    expect(() => validateManifest(wrongVersion, BOOK_ID)).toThrow()

    const wrongSha = { ...BOOK_MANIFEST, content_sha256: 'b'.repeat(64) }
    expect(() => validateManifest(wrongSha, BOOK_ID)).toThrow()

    const traversal = { ...BOOK_MANIFEST, content_path: '../secrets.txt' }
    expect(() => validateManifest(traversal, BOOK_ID)).toThrow()

    const badExtension = { ...BOOK_MANIFEST, content_path: `books/${BOOK_ID}/content.e-pub` }
    expect(() => validateManifest(badExtension, BOOK_ID)).toThrow()

    const wrongCover = { ...BOOK_MANIFEST, cover_path: `books/${BOOK_ID}/other.bin` }
    expect(() => validateManifest(wrongCover, BOOK_ID)).toThrow()

    const uppercaseId = { ...BOOK_MANIFEST, book_id: 'A'.repeat(64) }
    expect(() => validateManifest(uppercaseId, BOOK_ID)).toThrow()
  })

  it('rejects device libraries with the wrong version or an empty device id', () => {
    expect(() => validateDeviceLibrary({ ...DEVICE_LIBRARY, version: 2 })).toThrow()
    expect(() => validateDeviceLibrary({ ...DEVICE_LIBRARY, device_id: '  ' })).toThrow()
    const badEntry = {
      ...DEVICE_LIBRARY,
      books: [{ book_id: 'not-a-hash', present: true, changed_at: DEVICE_LIBRARY.updated_at }],
    }
    expect(() => validateDeviceLibrary(badEntry)).toThrow()
  })

  it('rejects state files that do not belong to the book directory', () => {
    expect(() => validateState({ ...DEVICE_BOOK_STATE, version: 2 }, BOOK_ID)).toThrow()
    expect(() => validateState({ ...DEVICE_BOOK_STATE, book_id: 'b'.repeat(64) }, BOOK_ID)).toThrow()
    expect(() => validateState({ ...DEVICE_BOOK_STATE, device_id: '' }, BOOK_ID)).toThrow()

    const wrongPublication = structuredClone(DEVICE_BOOK_STATE)
    wrongPublication.progress!.locator.publication_id = 'b'.repeat(64)
    expect(() => validateState(wrongPublication, BOOK_ID)).toThrow()

    const wrongAnnotation = structuredClone(DEVICE_BOOK_STATE)
    wrongAnnotation.annotations[0].book_id = 'b'.repeat(64)
    expect(() => validateState(wrongAnnotation, BOOK_ID)).toThrow()
  })

  it('rejects structurally broken documents', () => {
    expect(() => parseDeviceBookState({ version: 1 })).toThrow()
    expect(() => parseDeviceLibrary(null)).toThrow()
    expect(() => parseBookManifest({ ...JSON.parse(BOOK_MANIFEST_JSON), authors: 'nope' })).toThrow()
    const brokenClock = JSON.parse(DEVICE_BOOK_STATE_JSON)
    brokenClock.annotations[0].clock = 'nope'
    expect(() => parseDeviceBookState(brokenClock)).toThrow()
  })

  it('derives storage extensions like the desktop', () => {
    expect(storageExtension('Book.EPUB')).toBe('epub')
    expect(storageExtension('archive.tar.gz')).toBe('gz')
    expect(() => storageExtension('no-extension')).toThrow()
    expect(() => storageExtension('bad.é-pub')).toThrow()
  })
})
