import { describe, expect, it } from 'vitest'

import type { AnnotationState } from '../protocol'
import {
  applyLocalAnnotationDeletion,
  applyLocalAnnotationMutation,
  mergeAnnotationVersion,
} from '../protocol'
import { compareClocks, incrementClock, sortClockKeys } from '../vclock'
import { ANNOTATION, DEVICE_A, DEVICE_B, HLC_A, HLC_B } from './fixtures'

describe('vector clock comparison', () => {
  it('detects causal order, equality and concurrency', () => {
    expect(compareClocks({ a: 1 }, { a: 2 })).toBe('before')
    expect(compareClocks({ a: 2 }, { a: 1 })).toBe('after')
    expect(compareClocks({ a: 1 }, { a: 1 })).toBe('equal')
    expect(compareClocks({ a: 2 }, { a: 1, b: 1 })).toBe('concurrent')
    expect(compareClocks({}, {})).toBe('equal')
    expect(compareClocks({ a: 1 }, {})).toBe('after')
  })

  it('increments a single device entry', () => {
    expect(incrementClock({ a: 1 }, 'a')).toEqual({ a: 2 })
    expect(incrementClock({ a: 1 }, 'b')).toEqual({ a: 1, b: 1 })
  })

  it('sorts keys like the desktop BTreeMap serialization', () => {
    expect(Object.keys(sortClockKeys({ b: 1, a: 2 }))).toEqual(['a', 'b'])
  })
})

function annotation(patch: Partial<AnnotationState>): AnnotationState {
  return { ...ANNOTATION, clock: { ...ANNOTATION.clock }, ...patch }
}

describe('annotation merge', () => {
  it('replaces a causally older version and ignores newer/equal ones', () => {
    const current = annotation({ clock: { [DEVICE_A]: 1 } })
    const newer = annotation({ clock: { [DEVICE_A]: 2 }, note: 'new' })
    expect(mergeAnnotationVersion(current, newer)).toMatchObject({ changed: true, winner: newer })
    expect(mergeAnnotationVersion(newer, current)).toEqual({ changed: false })
    expect(mergeAnnotationVersion(current, current)).toEqual({ changed: false })
  })

  it('accepts unseen annotations', () => {
    expect(mergeAnnotationVersion(null, ANNOTATION)).toMatchObject({ changed: true, winner: ANNOTATION })
  })

  it('concurrent conflict: larger HLC wins, loser kept as conflict copy', () => {
    // Concurrent clocks: incoming has a device-A entry the current lacks and
    // vice versa.
    const current = annotation({ clock: { [DEVICE_A]: 2 }, updated_at: HLC_A })
    const incoming = annotation({
      clock: { [DEVICE_A]: 1, [DEVICE_B]: 1 },
      updated_at: HLC_B, // larger than HLC_A
      note: 'incoming wins',
    })

    const result = mergeAnnotationVersion(current, incoming)
    expect(result.changed).toBe(true)
    expect(result.winner).toBe(incoming)
    expect(result.conflictCopy).toBeDefined()
    expect(result.conflictCopy!.id).toBe(
      `${current.id}~conflict~${current.origin_device}~${HLC_A.wall_time_ms}-${HLC_A.counter}`,
    )
    // Intentional protocol quirk: conflict_of points at the INCOMING id.
    expect(result.conflictCopy!.conflict_of).toBe(incoming.id)
  })

  it('concurrent conflict: current wins on tie-or-smaller incoming HLC, incoming still copied', () => {
    const current = annotation({ clock: { [DEVICE_A]: 2 }, updated_at: HLC_B })
    const incoming = annotation({
      clock: { [DEVICE_A]: 1, [DEVICE_B]: 1 },
      updated_at: HLC_A, // smaller than current
    })

    const result = mergeAnnotationVersion(current, incoming)
    expect(result.winner).toBe(current)
    expect(result.conflictCopy!.id).toBe(
      `${incoming.id}~conflict~${incoming.origin_device}~${HLC_A.wall_time_ms}-${HLC_A.counter}`,
    )
    // Quirk again: the copy of the incoming loser points at its own id.
    expect(result.conflictCopy!.conflict_of).toBe(incoming.id)
  })

  it('does not copy a deleted loser (tombstones merge like any version)', () => {
    const current = annotation({ clock: { [DEVICE_A]: 2 }, updated_at: HLC_A, deleted_at: HLC_A })
    const incoming = annotation({ clock: { [DEVICE_A]: 1, [DEVICE_B]: 1 }, updated_at: HLC_B })
    const result = mergeAnnotationVersion(current, incoming)
    expect(result.winner).toBe(incoming)
    expect(result.conflictCopy).toBeUndefined()
  })

  it('does not copy a loser that is already a conflict copy', () => {
    const current = annotation({
      clock: { [DEVICE_A]: 2 },
      updated_at: HLC_A,
      conflict_of: 'some-parent',
    })
    const incoming = annotation({ clock: { [DEVICE_A]: 1, [DEVICE_B]: 1 }, updated_at: HLC_B })
    expect(mergeAnnotationVersion(current, incoming).conflictCopy).toBeUndefined()
  })

  it('rejects remote annotations with empty identity fields', () => {
    expect(() => mergeAnnotationVersion(null, annotation({ id: ' ' }))).toThrow()
    expect(() => mergeAnnotationVersion(null, annotation({ origin_device: '' }))).toThrow()
  })
})

describe('local annotation mutation', () => {
  it('modifying another device\'s annotation bumps own clock and reassigns origin', () => {
    const foreign = annotation({ clock: { [DEVICE_B]: 4 }, origin_device: DEVICE_B })
    const next = applyLocalAnnotationMutation(foreign, DEVICE_A, HLC_A, (draft) => {
      draft.note = 'edited locally'
    })
    expect(next.clock).toEqual({ [DEVICE_B]: 4, [DEVICE_A]: 1 })
    expect(next.origin_device).toBe(DEVICE_A)
    expect(next.note).toBe('edited locally')
    expect(next.updated_at).toBe(HLC_A)
  })

  it('deleting another device\'s annotation keeps a tombstone with own origin', () => {
    const foreign = annotation({ clock: { [DEVICE_B]: 4 }, origin_device: DEVICE_B })
    const next = applyLocalAnnotationDeletion(foreign, DEVICE_A, HLC_A)
    expect(next.deleted_at).toEqual(HLC_A)
    expect(next.clock[DEVICE_A]).toBe(1)
    expect(next.origin_device).toBe(DEVICE_A)
  })
})
