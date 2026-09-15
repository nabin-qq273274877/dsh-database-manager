/**
 * Build script for dsh-database-manager.
 *
 * Two outputs, matching the dual-face plugin contract:
 *
 *  - `lib/index.js` — the host half: ESM, bundled, with the harness SDK and the
 *    database drivers kept EXTERNAL (the loader resolves them from the profile's
 *    node_modules chain; bundling a native-backed driver would break it).
 *  - `lib/client.js` — the browser half: bundled for the browser and wrapped in
 *    the harness's `window.__ModuleLoader__.load({ id, factory })` factory form,
 *    with `react` external so the module system supplies the one React instance
 *    the shell already uses. Two Reacts would break hooks.
 *
 * Usage:  npx tsx scripts/build.ts
 */

import { build, type Plugin } from 'esbuild-wasm'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
const OUT = resolve(ROOT, 'lib')

/** Packages the host runtime provides; bundling them would duplicate state. */
const HOST_EXTERNAL = [
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/cordis',
  '@deepseek-ai/schemastery',
  // Database drivers resolve from the profile's node_modules so a native build
  // problem is fixable without rebuilding this plugin.
  'mysql2',
  'mysql2/promise',
  'ioredis',
  // Node builtins are always external on the node platform.
  'node:sqlite',
]

/** Packages the browser module system owns. */
const CLIENT_EXTERNAL = ['react', 'react-dom', 'react/jsx-runtime']

/**
 * esbuild plugin: import a `.css` file as a string export, so the stylesheet
 * can travel inside `client.js` without a second served asset.
 */
const cssAsString: Plugin = {
  name: 'css-as-string',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const fs = await import('node:fs/promises')
      const css = await fs.readFile(args.path, 'utf8')
      return { contents: `export default ${JSON.stringify(css)}`, loader: 'js' }
    })
  },
}

/** Wrap a browser bundle in the harness's module-loader factory envelope. */
function wrapClientFactory(id: string, code: string): string {
  return `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(id)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n${indent(code, 2)}\n\t\treturn module.exports;\n\t}\n});\n`
}

/** Indent every non-empty line by N tabs. */
function indent(code: string, tabs: number): string {
  const prefix = '\t'.repeat(tabs)
  return code
    .split('\n')
    .map(line => (line.trim() === '' ? '' : prefix + line))
    .join('\n')
}

/** The package's own name, used as the client module id. */
async function packageName(): Promise<string> {
  const fs = await import('node:fs/promises')
  const raw = await fs.readFile(resolve(ROOT, 'package.json'), 'utf8')
  return (JSON.parse(raw) as { name: string }).name
}

async function main(): Promise<void> {
  const id = await packageName()

  console.log('Cleaning lib/ …')
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  console.log('Building host half → lib/index.js')
  await build({
    entryPoints: [resolve(ROOT, 'src/index.ts')],
    outfile: resolve(OUT, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'es2022',
    format: 'esm',
    sourcemap: true,
    external: HOST_EXTERNAL,
    logLevel: 'warning',
  })

  console.log('Building browser half → lib/client.js')
  const clientResult = await build({
    entryPoints: [resolve(ROOT, 'src/client/index.ts')],
    write: false,
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'cjs',
    sourcemap: false,
    minify: false,
    plugins: [cssAsString],
    define: { 'process.env.NODE_ENV': '"production"' },
    external: CLIENT_EXTERNAL,
    logLevel: 'warning',
  })

  const bundled = clientResult.outputFiles[0]!.text
  writeFileSync(resolve(OUT, 'client.js'), wrapClientFactory(id, bundled), 'utf8')

  console.log('Build complete ✓')
  console.log('  host:   lib/index.js')
  console.log(`  client: lib/client.js  (module id "${id}")`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
