/**
 * Shared JSON body/response helpers for the host route family: one lenient
 * bounded body reader, one JSON-object narrow, and one JSON writer. Kept
 * deliberately small — this plugin owns a single route prefix.
 */

import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'

/** Default body cap: 1 MiB, sized for SQL text and bulk row payloads. */
const DEFAULT_JSON_BODY_MAX_BYTES = 1024 * 1024

/** Family-default JSON response headers. */
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
} satisfies OutgoingHttpHeaders

/** Whether a value is a JSON object: typeof object, not null, not an array. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Lenient bounded body reader: parse a request body as JSON, or null on an
 * empty body, invalid JSON, or a body past maxBytes.
 */
export async function readJsonBody(
  req: IncomingMessage,
  opts: { maxBytes?: number } = {},
): Promise<unknown | null> {
  const maxBytes = opts.maxBytes ?? DEFAULT_JSON_BODY_MAX_BYTES
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > maxBytes) {
      req.destroy()
      return null
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Narrow a value to a JSON object, or undefined when it is not one. */
export function asJsonObject(value: unknown): Record<string, unknown> | undefined {
  return isJsonObject(value) ? value : undefined
}

/** Write one JSON response. */
export function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: OutgoingHttpHeaders = {},
): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { ...JSON_HEADERS, ...headers })
  res.end(payload)
}

/** Write one JSON error response. */
export function writeError(res: ServerResponse, status: number, message: string): void {
  writeJson(res, status, { error: message })
}

/** Human-readable message from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
