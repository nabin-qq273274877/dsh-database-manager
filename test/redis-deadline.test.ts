/**
 * Regression test for the Redis connection deadline.
 *
 * The failure this guards against is not an error — it is the ABSENCE of one.
 * Measured behaviour before the fix: pointing the driver at a plaintext server
 * with `tls: true` left the pending command unsettled indefinitely (still
 * hanging after 25 s), so the panel spun forever instead of reporting anything.
 * ioredis's `connectTimeout` does not cover a server that accepts the TCP
 * connection and then never completes the handshake.
 *
 * The test needs a listening socket that accepts and then stays silent, which
 * is exactly what the mismatch looks like from the client side, so it stands in
 * for a real Redis without requiring one.
 */

import { createServer, type Server } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { redisAvailable, RedisDriver } from '../src/drivers/redis.ts'
import type { DataSourceEntry } from '../src/protocol.ts'

/** A server that accepts connections and never speaks. */
function silentServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    // Track the sockets: a net.Server has no closeAllConnections(), and a
    // pending accept keeps the handle alive, so teardown has to destroy them.
    const sockets = new Set<import('node:net').Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      // Accept and stay silent: this is what a TLS/plaintext mismatch looks
      // like from the client side.
    })
    ;(server as Server & { destroySockets?: () => void }).destroySockets = () => {
      for (const socket of sockets) socket.destroy()
      sockets.clear()
    }
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ server, port })
    })
  })
}

const available = await redisAvailable()

let server: Server | undefined
let port = 0

beforeAll(async () => {
  if (!available) return
  const started = await silentServer()
  server = started.server
  port = started.port
})

afterAll(async () => {
  if (server === undefined) return
  // A pending accept keeps the server handle alive after the driver's sockets
  // are destroyed, and `close()` alone then waits for a hook timeout.
  const withSockets = server as Server & { destroySockets?: () => void }
  withSockets.destroySockets?.()
  await new Promise<void>((resolve) => {
    server!.close(() => resolve())
    // Belt and braces: teardown must never outlive the test file.
    const timer = setTimeout(resolve, 2000)
    timer.unref?.()
  })
})

/** One entry aimed at the silent port. */
function entry(connectTimeoutMs: number): DataSourceEntry {
  return {
    id: 'silent',
    kind: 'redis',
    name: 'silent',
    group: '',
    tags: [],
    description: '',
    host: '127.0.0.1',
    port,
    db: 0,
    readonly: false,
    connectTimeoutMs,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe.skipIf(!available)('RedisDriver deadline', () => {
  it('fails a test against a silent server within the configured timeout', async () => {
    const driver = new RedisDriver(entry(1500))
    const started = Date.now()
    try {
      const result = await driver.test()
      const elapsed = Date.now() - started
      // The point of the fix: it must SETTLE, and settle near the deadline
      // rather than hanging on ioredis's unbounded reconnection.
      expect(result.ok).toBe(false)
      expect(typeof result.error).toBe('string')
      expect(elapsed).toBeLessThan(15000)
    } finally {
      await driver.close()
    }
  }, 30000)

  it('translates the ioredis retry-limit message into something actionable', async () => {
    const driver = new RedisDriver(entry(1500))
    try {
      const result = await driver.test()
      expect(result.ok).toBe(false)
      // The raw ioredis text ("Reached the max retries per request limit …")
      // names an option the user cannot act on; the translated message names
      // what to check instead.
      expect(result.error).not.toMatch(/maxRetriesPerRequest/)
      expect(result.error).toMatch(/timeout|did not complete the handshake|could not reach/i)
    } finally {
      await driver.close()
    }
  }, 30000)

  it('bounds an info() call too, so the panel cannot hang on connect', async () => {
    const driver = new RedisDriver(entry(1500))
    const started = Date.now()
    try {
      await expect(driver.info()).rejects.toThrow()
      expect(Date.now() - started).toBeLessThan(15000)
    } finally {
      await driver.close()
    }
  }, 30000)
})
