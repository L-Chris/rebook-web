/**
 * Vector clock comparison for the `webdav-sync-v1` protocol.
 *
 * Mirrors `compare_clocks` in torto/apps/desktop/src/sync/protocol.rs.
 */

/** Device id → counter. Serialized as a JSON object with sorted keys. */
export type VectorClock = Record<string, number>

export type ClockOrder = 'equal' | 'before' | 'after' | 'concurrent'

/**
 * Compare two vector clocks.
 *
 * Returns the order of `left` relative to `right`: `before` means `left` is
 * causally older and should be replaced by `right`.
 */
export function compareClocks(left: VectorClock, right: VectorClock): ClockOrder {
  let leftGreater = false
  let rightGreater = false
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    const leftValue = left[key] ?? 0
    const rightValue = right[key] ?? 0
    if (leftValue > rightValue) leftGreater = true
    if (rightValue > leftValue) rightGreater = true
  }
  if (leftGreater && rightGreater) return 'concurrent'
  if (leftGreater) return 'after'
  if (rightGreater) return 'before'
  return 'equal'
}

/** Return a copy of `clock` with the entry for `deviceId` incremented by one. */
export function incrementClock(clock: VectorClock, deviceId: string): VectorClock {
  return { ...clock, [deviceId]: (clock[deviceId] ?? 0) + 1 }
}

/** Sorted-key copy, matching the desktop's BTreeMap serialization order. */
export function sortClockKeys(clock: VectorClock): VectorClock {
  const sorted: VectorClock = {}
  for (const key of Object.keys(clock).sort()) sorted[key] = clock[key]
  return sorted
}

export function isValidVectorClock(value: unknown): value is VectorClock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every(
    entry => typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0,
  )
}
