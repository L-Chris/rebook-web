import { describe, expect, it } from 'vitest'

import { compareHlc, tickHlc } from '../hlc'

const DEVICE = 'device-a'

describe('hybrid logical clock', () => {
  it('starts at wall time with counter 0', () => {
    const ts = tickHlc(null, DEVICE, 1000)
    expect(ts).toEqual({ wall_time_ms: 1000, counter: 0, device_id: DEVICE })
  })

  it('increments the counter while wall time does not advance', () => {
    const first = tickHlc(null, DEVICE, 1000)
    const second = tickHlc(first, DEVICE, 1000)
    const third = tickHlc(second, DEVICE, 999) // clock skew backwards
    expect(second.counter).toBe(1)
    expect(third).toEqual({ wall_time_ms: 1000, counter: 2, device_id: DEVICE })
  })

  it('resets the counter when wall time advances', () => {
    const first = tickHlc(null, DEVICE, 1000)
    const second = tickHlc(first, DEVICE, 1001)
    expect(second).toEqual({ wall_time_ms: 1001, counter: 0, device_id: DEVICE })
  })

  it('observing a remote wall time moves the clock forward', () => {
    const first = tickHlc(null, DEVICE, 1000)
    const observed = tickHlc(first, DEVICE, 1000, 5000)
    expect(observed).toEqual({ wall_time_ms: 5000, counter: 0, device_id: DEVICE })
    // Ticks after the observation never go below the observed wall time.
    const next = tickHlc(observed, DEVICE, 1000)
    expect(next.wall_time_ms).toBe(5000)
    expect(next.counter).toBe(1)
  })

  it('orders lexicographically on (wall_time_ms, counter, device_id)', () => {
    const base = { wall_time_ms: 10, counter: 0, device_id: 'b' }
    expect(compareHlc(base, { wall_time_ms: 11, counter: 0, device_id: 'a' })).toBeLessThan(0)
    expect(compareHlc(base, { wall_time_ms: 10, counter: 1, device_id: 'a' })).toBeLessThan(0)
    expect(compareHlc(base, { wall_time_ms: 10, counter: 0, device_id: 'a' })).toBeGreaterThan(0)
    expect(compareHlc(base, { ...base })).toBe(0)
  })
})
