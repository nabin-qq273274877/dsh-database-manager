/**
 * TTL countdown arithmetic.
 *
 * The countdown is derived from the server's reading plus the instant it was
 * taken, which is the part that can be wrong in ways a screenshot cannot show:
 * a drifting counter still LOOKS plausible. These tests pin the arithmetic
 * instead — including the two cases the design exists for (a throttled timer and
 * a reading re-anchored to the same value).
 */

import { describe, expect, it } from 'vitest'
import { countsDown, formatDuration, readTtl, remainingSeconds } from '../src/client/ttl.ts'

describe('readTtl and remainingSeconds', () => {
  it('reports the server reading at the instant it was taken', () => {
    const reading = readTtl(600, 1_000_000)
    expect(reading).toEqual({ seconds: 600, at: 1_000_000 })
    expect(remainingSeconds(reading, 1_000_000)).toBe(600)
  })

  it('derives the remainder from elapsed wall time, not from its own ticks', () => {
    // This is the property that makes the display survive a backgrounded tab:
    // the timer may fire far less often than once a second, but the number it
    // shows only depends on how much real time has passed.
    const reading = readTtl(600, 1_000_000)
    expect(remainingSeconds(reading, 1_001_000)).toBe(599)
    expect(remainingSeconds(reading, 1_060_000)).toBe(540)
    // A five-minute throttle gap is still reported correctly.
    expect(remainingSeconds(reading, 1_300_000)).toBe(300)
  })

  it('floors the elapsed time rather than rounding it', () => {
    // 599.9 s remaining must read as 599, never 600: a countdown that rounds up
    // shows a second that is already gone.
    const reading = readTtl(600, 1_000_000)
    expect(remainingSeconds(reading, 1_000_100)).toBe(600)
    expect(remainingSeconds(reading, 1_000_999)).toBe(600)
    expect(remainingSeconds(reading, 1_001_000)).toBe(599)
  })

  it('clamps at zero once the deadline passes', () => {
    // The key is gone by then; a negative countdown reads as a bug.
    const reading = readTtl(5, 1_000_000)
    expect(remainingSeconds(reading, 1_005_000)).toBe(0)
    expect(remainingSeconds(reading, 1_100_000)).toBe(0)
    expect(remainingSeconds(reading, 9_999_999)).toBe(0)
  })

  it('leaves a permanent key permanent, however much time passes', () => {
    const reading = readTtl(-1, 1_000_000)
    expect(remainingSeconds(reading, 1_000_000)).toBe(-1)
    expect(remainingSeconds(reading, 9_999_999_999)).toBe(-1)
  })

  it('leaves a missing key missing', () => {
    const reading = readTtl(-2, 1_000_000)
    expect(remainingSeconds(reading, 9_999_999)).toBe(-2)
  })

  it('does not count down a permanent or a missing key', () => {
    // Whether the timer should even be armed, kept separate from the arithmetic
    // so a permanent key can never spin an interval.
    expect(countsDown(readTtl(-1, 0))).toBe(false)
    expect(countsDown(readTtl(-2, 0))).toBe(false)
    expect(countsDown(readTtl(0, 0))).toBe(true)
    expect(countsDown(readTtl(1, 0))).toBe(true)
  })

  it('treats a zero reading as already expired', () => {
    const reading = readTtl(0, 1_000_000)
    expect(countsDown(reading)).toBe(true)
    expect(remainingSeconds(reading, 1_000_000)).toBe(0)
  })
})

describe('re-anchoring', () => {
  it('a re-read of the SAME ttl restarts the countdown from now', () => {
    // The bug this guards: keying the anchor on the ttl VALUE rather than on the
    // reading's identity. Setting 600 over an existing 600 returns 600 again, so
    // a value-keyed anchor would keep the old instant and show the countdown
    // short by however long ago that was.
    const first = readTtl(600, 1_000_000)
    expect(remainingSeconds(first, 1_100_000)).toBe(500)

    const second = readTtl(600, 1_100_000)
    expect(remainingSeconds(second, 1_100_000)).toBe(600)
    expect(remainingSeconds(second, 1_100_500)).toBe(600)
  })

  it('a shortened ttl is reflected immediately', () => {
    const reading = readTtl(30, 2_000_000)
    expect(remainingSeconds(reading, 2_000_000)).toBe(30)
    expect(remainingSeconds(reading, 2_029_000)).toBe(1)
    expect(remainingSeconds(reading, 2_030_000)).toBe(0)
  })
})

describe('formatDuration (the countdown label)', () => {
  it('scales the unit with the magnitude', () => {
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(90)).toBe('1m 30s')
    expect(formatDuration(3700)).toBe('1h 1m')
    expect(formatDuration(90061)).toBe('1d 1h')
  })

  it('renders a zero remainder without collapsing to an empty label', () => {
    // The countdown hits exactly 0 at the deadline, and an empty label would
    // look like the control had failed to render.
    expect(formatDuration(0)).toBe('0s')
  })

  it('counts the last minute down in seconds, so the final stretch is legible', () => {
    expect(formatDuration(59)).toBe('59s')
    expect(formatDuration(5)).toBe('5s')
    expect(formatDuration(1)).toBe('1s')
  })
})
