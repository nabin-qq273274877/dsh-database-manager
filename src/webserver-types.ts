/**
 * Structural copies of the host web-server route contract.
 *
 * The plugin deliberately does NOT depend on `@deepseek-ai/dsh-host-webserver`
 * at build time: a dual-face plugin must stay installable into any profile, and
 * the host half only ever calls `ctx.webServer.register()` with this shape. The
 * types are restated here so the source typechecks standalone; the runtime
 * object comes from the host context.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' matches p and p/<anything>. */
export type WebRouteKind = 'exact' | 'prefix'

/** One named route registration. */
export interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle. */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** One exact-path HTTP upgrade registration. */
export interface WebUpgradeRoute {
  path: string
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

/** The slice of the web-server service this plugin uses. */
export interface WebServerService {
  register(route: WebRoute): () => void
  registerUpgrade(route: WebUpgradeRoute): () => void
}
