/**
 * Pure helpers for the Redis console. Kept free of React so the command-line
 * parser is directly unit-testable without a DOM or a React runtime.
 */

/**
 * Split a command line into argv, honouring single and double quotes so a key
 * or value containing spaces can still be typed.
 */
export function splitCommand(line: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let started = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quote !== undefined) {
      if (ch === '\\' && i + 1 < line.length) {
        current += line[i + 1]
        i++
        continue
      }
      if (ch === quote) {
        quote = undefined
        continue
      }
      current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
      continue
    }
    if (/\s/.test(ch)) {
      if (started) args.push(current)
      current = ''
      started = false
      continue
    }
    current += ch
    started = true
  }
  if (started) args.push(current)
  return args
}

/** The key a command most likely touched, so the panel can refresh just it. */
export function keyFromCommand(args: string[]): string | undefined {
  if (args.length < 2) return undefined
  return args[1]
}
