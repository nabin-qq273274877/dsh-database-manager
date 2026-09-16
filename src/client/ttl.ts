/**
 * TTL countdown arithmetic — pure, with no rendering dependency.
 *
 * Deliberately separate from the UI module that draws it. Redis reports a
 * remaining TTL in whole seconds, and that number is only true at the instant it
 * was read; this module is where "how much is left now" is decided, and it must
 * be testable without a DOM or a React runtime — a countdown that drifts still
 * LOOKS plausible in a screenshot, so the arithmetic needs its own tests.
 *
 * The UI module re-exports these helpers, so call sites keep one import.
 */

/**
 * A TTL reading anchored to the moment it was taken.
 *
 * A countdown that decrements its own copy drifts: a backgrounded tab has its
 * timers throttled (Chrome runs them about once a minute), so a self-decrementing
 * counter falls behind the server and keeps promising time on a key Redis has
 * already deleted.
 *
 * Storing the reading together with the wall-clock instant it was taken lets
 * every redraw derive the remaining seconds as `reading - elapsed`. Sampled from
 * the clock rather than accumulated from ticks, so throttling, a sleeping
 * machine, or a slow frame changes only when the number is repainted — never
 * what it says.
 */
export interface TtlReading {
  /** Seconds remaining as the server reported them. -1 = no expiry, -2 = gone. */
  seconds: number
  /** `Date.now()` when {@link seconds} was received. */
  at: number
}

/** Wrap a server TTL reading with the instant it was taken. */
export function readTtl(seconds: number, now: number = Date.now()): TtlReading {
  return { seconds, at: now }
}

/**
 * Seconds actually remaining, derived from the reading and the wall clock.
 *
 * Never returns less than 0: once the deadline passes the key is gone, and a
 * negative countdown reads as a bug. A key that had no expiry stays -1 forever,
 * and a key that was already missing stays -2, so callers can distinguish
 * "permanent" from "expired" without extra state.
 */
export function remainingSeconds(reading: TtlReading, now: number = Date.now()): number {
  if (reading.seconds < 0) return reading.seconds
  const elapsed = Math.floor((now - reading.at) / 1000)
  return Math.max(0, reading.seconds - elapsed)
}

/** Whether a reading counts down at all (a permanent or missing key does not). */
export function countsDown(reading: TtlReading): boolean {
  return reading.seconds >= 0
}

/**
 * Format a duration for the countdown label.
 *
 * Shares the shape of the panel's other TTL renderings so the countdown and the
 * headline read as one value rather than two conventions. Kept here rather than
 * in the i18n-aware UI module because it is pure arithmetic over a duration; the
 * two non-counting states are the caller's to name, since they are copy.
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}
