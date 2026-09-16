import * as React from 'react'
/**
 * The ticking half of the TTL countdown.
 *
 * Kept apart from the value editor because the interesting part is not the
 * markup but WHEN the timer runs and when it stops — the parts that are easy to
 * get quietly wrong (a timer that keeps firing forever on a permanent key, a
 * countdown that drifts while the tab is backgrounded).
 *
 * The displayed number is always derived from the server reading plus the wall
 * clock (see `remainingSeconds`), so throttled timers, a sleeping machine, or a
 * long frame change only how often the label is REPAINTED, never what it says.
 */

import { countsDown, remainingSeconds, type TtlReading } from './ttl.ts'

/**
 * The seconds remaining, re-sampled on a one-second interval.
 *
 * The timer is armed only while a real countdown is running:
 *
 * - a permanent key (-1) or a missing one (-2) never arms it, so an idle panel
 *   with a permanent key selected does no work at all;
 * - once zero is reached the timer disarms, because there is nothing left to
 *   count and a key that has expired does not come back;
 * - a new reading (after a write, or after a reload) re-arms it.
 *
 * @param reading - the server's TTL reading, anchored to when it arrived.
 * @returns the seconds remaining, clamped at zero.
 */
export function useTtlCountdown(reading: TtlReading): number {
  const [left, setLeft] = React.useState(() => remainingSeconds(reading))

  React.useEffect(() => {
    // Re-sample immediately so a new reading is reflected without waiting a
    // whole second for the first tick.
    setLeft(remainingSeconds(reading))

    if (!countsDown(reading)) return

    const timer = setInterval(() => {
      const next = remainingSeconds(reading)
      setLeft(current => (current === next ? current : next))
    }, 1000)

    // Returning the cleanup from the effect stops the timer whenever the
    // reading changes, the key changes, or the editor unmounts.
    return () => clearInterval(timer)
  }, [reading])

  return left
}
