import { describe, expect, it } from 'vitest'

import { createInMemoryStateStore } from '../store'
import { DEVICE_A, DEVICE_B } from './fixtures'

const BOOK = 'a'.repeat(64)

function locator(progression: number) {
  return {
    version: 1,
    publication_id: BOOK,
    href: { path: 'chapter.xhtml' },
    progression,
    total_progression: null,
    position: null,
    source: null,
    partial_cfi: null,
    text: null,
  }
}

describe('sync state store', () => {
  it('publishes progress only when this device was the last writer', async () => {
    const store = createInMemoryStateStore(DEVICE_A)
    await store.saveProgress(BOOK, locator(0.5))
    expect(await store.progressState(BOOK)).not.toBeNull()

    // A newer progress from another device replaces the local value...
    const merged = await store.mergeProgress({
      locator: locator(0.9),
      updated_at: { wall_time_ms: Date.now() + 60_000, counter: 0, device_id: DEVICE_B },
    })
    expect(merged).toBe(true)
    expect((await store.loadProgress(BOOK))?.locator.progression).toBe(0.9)
    // ...and is then no longer published as this device's own state.
    expect(await store.progressState(BOOK)).toBeNull()
  })

  it('keeps newer local progress when an older remote one arrives', async () => {
    const store = createInMemoryStateStore(DEVICE_A)
    await store.saveProgress(BOOK, locator(0.5))
    const merged = await store.mergeProgress({
      locator: locator(0.1),
      updated_at: { wall_time_ms: 1, counter: 0, device_id: DEVICE_B },
    })
    expect(merged).toBe(false)
    expect((await store.loadProgress(BOOK))?.locator.progression).toBe(0.5)
  })

  it('publishes only own-origin annotations, tombstones included', async () => {
    const store = createInMemoryStateStore(DEVICE_A)
    const own = await store.createAnnotation({
      id: '11111111-1111-4111-8111-111111111111',
      book_id: BOOK,
      ranges: [],
      quote: 'mine',
      created_at: 1,
    })
    await store.mergeAnnotations([{
      id: '22222222-2222-4222-8222-222222222222',
      book_id: BOOK,
      ranges: [],
      quote: 'theirs',
      created_at: 2,
      updated_at: { wall_time_ms: 1, counter: 0, device_id: DEVICE_B },
      clock: { [DEVICE_B]: 1 },
      deleted_at: null,
      origin_device: DEVICE_B,
    }])
    await store.deleteAnnotation(own.id)

    const published = await store.annotationsForDeviceBook(BOOK)
    expect(published.map(annotation => annotation.id)).toEqual([own.id])
    expect(published[0].deleted_at).not.toBeNull()
    expect(published[0].origin_device).toBe(DEVICE_A)
    // The visible list hides the tombstone but keeps the foreign annotation.
    expect((await store.annotationsForBook(BOOK)).map(annotation => annotation.quote)).toEqual(['theirs'])
  })

  it('tracks membership tombstones', async () => {
    const store = createInMemoryStateStore(DEVICE_A)
    await store.setBookPresent(BOOK, true)
    await store.setBookPresent(BOOK, false)
    expect(await store.isLocallyRemoved(BOOK)).toBe(true)
    const entries = await store.membershipEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].present).toBe(false)
  })
})
