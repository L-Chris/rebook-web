/**
 * Hybrid logical clock for the `webdav-sync-v1` protocol.
 *
 * Mirrors `HybridTimestamp` in torto/apps/desktop/src/sync (protocol.rs,
 * store.rs): ordering is lexicographic on (wall_time_ms, counter, device_id)
 * and a tick takes `wall = max(now, previous_wall, observed_remote_wall)` with
 * `counter = wall === previous_wall ? previous_counter + 1 : 0`.
 */
export interface HybridTimestamp {
  wall_time_ms: number
  counter: number
  device_id: string
}

/** Lexicographic comparison on (wall_time_ms, counter, device_id). */
export function compareHlc(left: HybridTimestamp, right: HybridTimestamp): number {
  if (left.wall_time_ms !== right.wall_time_ms) return left.wall_time_ms - right.wall_time_ms
  if (left.counter !== right.counter) return left.counter - right.counter
  return left.device_id < right.device_id ? -1 : left.device_id > right.device_id ? 1 : 0
}

export function hlcEquals(left: HybridTimestamp, right: HybridTimestamp): boolean {
  return compareHlc(left, right) === 0
}

/**
 * Produce the next timestamp for `deviceId`.
 *
 * `previous` is the last timestamp this device persisted (or observed through
 * a tick). `observedWallMs` is the wall time of a remote timestamp being
 * merged, so local time never falls behind a remote writer.
 */
export function tickHlc(
  previous: HybridTimestamp | null,
  deviceId: string,
  now: number,
  observedWallMs?: number,
): HybridTimestamp {
  const previousWall = previous?.wall_time_ms ?? 0
  const wall = Math.max(now, previousWall, observedWallMs ?? 0)
  const counter = wall === previousWall && previous ? previous.counter + 1 : 0
  return { wall_time_ms: wall, counter, device_id: deviceId }
}

export function isValidHlc(value: unknown): value is HybridTimestamp {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.wall_time_ms === 'number'
    && Number.isSafeInteger(record.wall_time_ms)
    && record.wall_time_ms >= 0
    && typeof record.counter === 'number'
    && Number.isSafeInteger(record.counter)
    && record.counter >= 0
    && typeof record.device_id === 'string'
  )
}
