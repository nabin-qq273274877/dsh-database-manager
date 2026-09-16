// Load the built host half against a mock cordis context and report what it
// registered: agent tools, web routes, and the prompt section. This is the
// direct evidence that the plugin's full surface mounted — the route family is
// only half of it.
import { pathToFileURL } from 'node:url'

const entry = process.argv[2]
const mod = await import(pathToFileURL(entry).href)

const tools = []
const routes = []
const sections = []
const effects = []
const listeners = []

const ctx = {
  effect(fn) {
    effects.push(fn)
    return fn() ?? (() => {})
  },
  on(name, listener) {
    listeners.push({ name, listener })
    return () => {}
  },
  get(name) {
    if (name === 'tools') return { guard: () => () => {} }
    return undefined
  },
  tools: {
    register(definition) {
      tools.push(definition)
      return () => {}
    },
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  systemPrompt: {
    section(section) {
      sections.push(section)
      return () => {}
    },
  },
}

const instance = mod.default ?? mod
await (instance.apply ?? instance)(ctx, {})

console.log('plugin name:', instance.name)
console.log('inject:', JSON.stringify(instance.inject))
console.log('tools registered:', tools.length)
for (const tool of tools) console.log(`  - ${tool.name}`)
console.log('routes registered:', routes.length)
for (const route of routes) console.log(`  - ${route.kind} ${route.path}`)
console.log('prompt sections:', sections.length)
for (const section of sections) console.log(`  - ${section.name} (order ${section.order})`)
console.log('effects:', effects.length)
console.log('event listeners:', listeners.map((l) => l.name).join(', '))
