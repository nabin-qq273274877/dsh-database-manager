/**
 * Store, gate and protocol unit tests. These run without a harness process:
 * the store is pure file I/O, the gate is pure decision logic, and the SQL
 * helpers are pure string work — exactly the parts where a silent bug would
 * weaken the write protection rather than merely look wrong.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DataSourceStore } from '../src/store.ts'
import { decideCall, DEFAULT_GATE_SETTINGS, isWriteTool, sourceIdOf } from '../src/auth.ts'
import { assertSingleStatement, groupSameColumns, isSafeIdentifier, looksReadOnly, pushDownLimit, qualifyMysql, quoteMysql, quoteSqlite, toWireValue } from '../src/sql-util.ts'
import { isRedisReadCommand } from '../src/drivers/redis.ts'
import { splitCommand } from '../src/client/command.ts'

let dir: string
let storePath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dbm-test-'))
  storePath = join(dir, 'dsh-database.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('DataSourceStore', () => {
  it('starts empty when the file is absent', () => {
    const store = new DataSourceStore(storePath)
    expect(store.list()).toEqual([])
    expect(store.settings()).toEqual(DEFAULT_GATE_SETTINGS)
  })

  it('creates a sqlite source and derives an id from the name', () => {
    const store = new DataSourceStore(storePath)
    const entry = store.create({ kind: 'sqlite', name: 'My App DB', file: 'D:/data/app.db' })
    expect(entry.id).toBe('my-app-db')
    expect(store.list()).toHaveLength(1)
    expect(store.find('my-app-db')?.file).toBe('D:/data/app.db')
  })

  it('rejects a sqlite source without a file and a mysql source without a host', () => {
    const store = new DataSourceStore(storePath)
    expect(() => store.create({ kind: 'sqlite', name: 'x' })).toThrow(/file is required/)
    expect(() => store.create({ kind: 'mysql', name: 'y', user: 'root' })).toThrow(/host is required/)
    expect(() => store.create({ kind: 'redis', name: 'z' })).toThrow(/host is required/)
  })

  it('deduplicates a colliding id with a numeric suffix', () => {
    const store = new DataSourceStore(storePath)
    store.create({ kind: 'sqlite', name: 'dup', file: ':memory:' })
    const second = store.create({ kind: 'sqlite', name: 'dup', file: ':memory:' })
    expect(second.id).toBe('dup-2')
  })

  it('refuses an explicitly requested id that is already taken', () => {
    const store = new DataSourceStore(storePath)
    store.create({ kind: 'sqlite', id: 'fixed', name: 'a', file: ':memory:' })
    expect(() => store.create({ kind: 'sqlite', id: 'fixed', name: 'b', file: ':memory:' })).toThrow(/already exists/)
  })

  it('keeps the stored password when an update omits it, and clears it on an explicit empty string', () => {
    const store = new DataSourceStore(storePath)
    const entry = store.create({ kind: 'mysql', name: 'db', host: 'h', port: 3306, user: 'root', password: 'secret' })
    expect(entry.password).toBe('secret')

    const same = store.update(entry.id, { name: 'db2' })
    expect(same.password).toBe('secret')

    const cleared = store.update(entry.id, { password: '' })
    expect(cleared.password).toBeUndefined()
  })

  it('drops fields that belong to a different engine when the kind changes', () => {
    const store = new DataSourceStore(storePath)
    const entry = store.create({ kind: 'mysql', name: 'db', host: 'h', user: 'root', database: 'app' })
    const switched = store.update(entry.id, { kind: 'redis' })
    expect(switched.kind).toBe('redis')
    expect(switched.user).toBeUndefined()
    expect(switched.database).toBeUndefined()
    expect(switched.host).toBe('h')
  })

  it('persists settings across instances and keeps them when sources change', () => {
    const store = new DataSourceStore(storePath)
    store.saveSettings({ allowAgentWrite: true, requireApproval: false })
    store.create({ kind: 'sqlite', name: 'later', file: ':memory:' })

    const reopened = new DataSourceStore(storePath)
    expect(reopened.settings()).toEqual({ allowAgentWrite: true, requireApproval: false })
    expect(reopened.list()).toHaveLength(1)
  })

  it('writes the settings section into the file', () => {
    const store = new DataSourceStore(storePath)
    store.saveSettings({ allowAgentWrite: true })
    const raw = JSON.parse(readFileSync(storePath, 'utf8')) as { settings?: { allowAgentWrite?: boolean } }
    expect(raw.settings?.allowAgentWrite).toBe(true)
  })

  it('survives a damaged file instead of throwing', () => {
    writeFileSync(storePath, '{ this is not json', 'utf8')
    const store = new DataSourceStore(storePath)
    expect(store.list()).toEqual([])
  })

  it('removes a source and reports whether it existed', () => {
    const store = new DataSourceStore(storePath)
    const entry = store.create({ kind: 'sqlite', name: 'gone', file: ':memory:' })
    expect(store.remove(entry.id)).toBe(true)
    expect(store.remove(entry.id)).toBe(false)
    expect(store.list()).toEqual([])
  })

  it('validates port and db ranges', () => {
    const store = new DataSourceStore(storePath)
    expect(() => store.create({ kind: 'mysql', name: 'p', host: 'h', port: 99999 })).toThrow(/port must be/)
    expect(() => store.create({ kind: 'redis', name: 'd', host: 'h', db: 99 })).toThrow(/db must be/)
  })
})

describe('authorization gate', () => {
  const makeStore = (readonly = false): DataSourceStore => {
    const store = new DataSourceStore(storePath)
    store.create({ kind: 'sqlite', name: 'app', id: 'app', file: ':memory:', readonly })
    return store
  }

  it('classifies only db_exec as a write tool', () => {
    expect(isWriteTool('db_exec')).toBe(true)
    expect(isWriteTool('db_query')).toBe(false)
    expect(isWriteTool('db_list')).toBe(false)
    expect(isWriteTool('bash')).toBe(false)
  })

  it('passes a read tool through untouched', () => {
    const store = makeStore()
    expect(decideCall('db_query', { source: 'app', sql: 'SELECT 1' }, store, DEFAULT_GATE_SETTINGS)).toEqual({ kind: 'pass' })
  })

  it('denies a write while agent writes are disabled', () => {
    const store = makeStore()
    const decision = decideCall('db_exec', { source: 'app', sql: 'DELETE FROM t' }, store, DEFAULT_GATE_SETTINGS)
    expect(decision.kind).toBe('deny')
    expect(decision.kind === 'deny' && decision.reason).toMatch(/agent writes are disabled/)
  })

  it('denies a write against a readonly source even when agent writes are enabled', () => {
    const store = makeStore(true)
    const decision = decideCall('db_exec', { source: 'app', sql: 'DELETE FROM t' }, store, {
      allowAgentWrite: true,
      requireApproval: true,
    })
    expect(decision.kind).toBe('deny')
    expect(decision.kind === 'deny' && decision.reason).toMatch(/readonly/)
  })

  it('asks for approval when writes are enabled on a writable source', () => {
    const store = makeStore()
    const decision = decideCall('db_exec', { source: 'app', sql: 'DELETE FROM t' }, store, {
      allowAgentWrite: true,
      requireApproval: true,
    })
    expect(decision.kind).toBe('ask')
  })

  it('denies a write naming an unknown source', () => {
    const store = makeStore()
    const decision = decideCall('db_exec', { source: 'nope', sql: 'SELECT 1' }, store, {
      allowAgentWrite: true,
      requireApproval: false,
    })
    expect(decision.kind).toBe('deny')
    expect(decision.kind === 'deny' && decision.reason).toMatch(/no data source/)
  })

  it('denies a write with no source argument at all', () => {
    const store = makeStore()
    const decision = decideCall('db_exec', { sql: 'DELETE FROM t' }, store, { allowAgentWrite: true, requireApproval: false })
    expect(decision.kind).toBe('deny')
  })

  it('extracts the source id from whichever parameter name the tool used', () => {
    expect(sourceIdOf({ source: 'a' })).toBe('a')
    expect(sourceIdOf({ sourceId: 'b' })).toBe('b')
    expect(sourceIdOf({ id: 'c' })).toBe('c')
    expect(sourceIdOf({ other: 'd' })).toBeUndefined()
    expect(sourceIdOf(null)).toBeUndefined()
  })
})

describe('SQL identifier and statement guards', () => {
  it('accepts ordinary identifiers', () => {
    expect(isSafeIdentifier('users')).toBe(true)
    expect(isSafeIdentifier('user_log_2')).toBe(true)
    expect(isSafeIdentifier('a b')).toBe(true)
  })

  it('rejects identifiers that could escape a quoted context', () => {
    expect(isSafeIdentifier('users`; DROP TABLE x; --')).toBe(false)
    expect(isSafeIdentifier('a"b')).toBe(false)
    expect(isSafeIdentifier('a\\b')).toBe(false)
    expect(isSafeIdentifier('')).toBe(false)
    expect(isSafeIdentifier('a'.repeat(200))).toBe(false)
  })

  it('quotes with each engine escape rule', () => {
    expect(quoteMysql('a`b')).toBe('`a``b`')
    expect(quoteSqlite('a"b')).toBe('"a""b"')
    expect(qualifyMysql('shop', 'orders')).toBe('`shop`.`orders`')
    expect(qualifyMysql(undefined, 'orders')).toBe('`orders`')
  })

  it('classifies read-only statements', () => {
    expect(looksReadOnly('SELECT 1')).toBe(true)
    expect(looksReadOnly('  -- comment\n SELECT 1')).toBe(true)
    expect(looksReadOnly('/* c */ WITH x AS (SELECT 1) SELECT * FROM x')).toBe(true)
    expect(looksReadOnly('SHOW TABLES')).toBe(true)
    expect(looksReadOnly('DELETE FROM t')).toBe(false)
    expect(looksReadOnly('UPDATE t SET a=1')).toBe(false)
    expect(looksReadOnly('DROP TABLE t')).toBe(false)
    expect(looksReadOnly('')).toBe(false)
  })

  it('refuses multi-statement payloads but allows a trailing semicolon', () => {
    expect(() => assertSingleStatement('SELECT 1;')).not.toThrow()
    expect(() => assertSingleStatement('SELECT 1; DELETE FROM t')).toThrow(/one statement/)
    // A semicolon inside a literal or a comment is not a separator.
    expect(() => assertSingleStatement("SELECT ';' AS s")).not.toThrow()
    expect(() => assertSingleStatement('SELECT 1 -- ; not a separator')).not.toThrow()
  })
})

/**
 * The SQL editor's row cap used to be applied only on the host: a driver read
 * the whole result set and then sliced it, so a `SELECT *` over a large table
 * still pulled every row into memory before discarding all but the first page.
 * These cases pin the rewrite that moves the cap into the statement, and just
 * as importantly pin the shapes it must REFUSE — a `LIMIT` appended to a PRAGMA
 * or an EXPLAIN is a syntax error, and appending a second LIMIT to a statement
 * that already has one silently changes what the user asked for.
 */
describe('LIMIT push-down', () => {
  it('appends a LIMIT to a plain read', () => {
    expect(pushDownLimit('SELECT * FROM users', 100)).toBe('SELECT * FROM users\nLIMIT 100')
    expect(pushDownLimit('SELECT a FROM t WHERE b = 1', 10)).toBe('SELECT a FROM t WHERE b = 1\nLIMIT 10')
  })

  it('caps a CTE and a set operation, which both accept a trailing LIMIT', () => {
    expect(pushDownLimit('WITH c AS (SELECT 1 AS a) SELECT a FROM c', 5)).toContain('LIMIT 5')
    expect(pushDownLimit('SELECT a FROM t UNION SELECT a FROM t', 5)).toContain('LIMIT 5')
  })

  it('replaces a trailing terminator or blank line rather than appending after it', () => {
    expect(pushDownLimit('SELECT a FROM t;', 3)).toBe('SELECT a FROM t\nLIMIT 3')
    expect(pushDownLimit('SELECT a FROM t\n\n  ', 3)).toBe('SELECT a FROM t\nLIMIT 3')
    // A trailing comment stays attached; the clause goes after it.
    expect(pushDownLimit('SELECT a FROM t -- note', 3)).toBe('SELECT a FROM t -- note\nLIMIT 3')
  })

  it('refuses a statement that already has an outer LIMIT', () => {
    // The author's own budget is not ours to shrink.
    expect(pushDownLimit('SELECT a FROM t LIMIT 2', 100)).toBeUndefined()
    expect(pushDownLimit('SELECT a FROM t LIMIT 2 OFFSET 1', 100)).toBeUndefined()
    expect(pushDownLimit('SELECT a FROM t ORDER BY a LIMIT 1', 100)).toBeUndefined()
  })

  it('does not mistake an inner LIMIT for the outer one', () => {
    // A subquery's LIMIT is at depth 1 and does not stop the outer rewrite.
    expect(pushDownLimit('SELECT a FROM (SELECT a FROM t LIMIT 1)', 100)).toContain('\nLIMIT 100')
    expect(pushDownLimit('SELECT a FROM t WHERE a IN (SELECT a FROM t LIMIT 1)', 100)).toContain('\nLIMIT 100')
  })

  it('ignores a LIMIT that only appears inside a literal, identifier or comment', () => {
    expect(pushDownLimit("SELECT b FROM t WHERE b <> 'limit 1'", 100)).toContain('\nLIMIT 100')
    expect(pushDownLimit('SELECT "limit" FROM t', 100)).toContain('\nLIMIT 100')
    expect(pushDownLimit('SELECT a FROM t /* limit 1 */', 100)).toContain('\nLIMIT 100')
  })

  it('refuses the shapes where a trailing LIMIT is a syntax error or means something else', () => {
    // Verified against SQLite 3.50: each of these rejects the appended clause.
    expect(pushDownLimit('PRAGMA table_info(t)', 100)).toBeUndefined()
    expect(pushDownLimit('EXPLAIN SELECT * FROM t', 100)).toBeUndefined()
    expect(pushDownLimit('SHOW TABLES', 100)).toBeUndefined()
    expect(pushDownLimit('DESCRIBE t', 100)).toBeUndefined()
    expect(pushDownLimit('VALUES (1),(2)', 100)).toBeUndefined()
    expect(pushDownLimit('TABLE t', 100)).toBeUndefined()
  })

  it('refuses a clause that has to stay last', () => {
    expect(pushDownLimit('SELECT a FROM t FOR UPDATE', 100)).toBeUndefined()
    expect(pushDownLimit('SELECT a INTO OUTFILE "/tmp/x" FROM t', 100)).toBeUndefined()
  })

  it('refuses writes and a non-positive cap', () => {
    expect(pushDownLimit('DELETE FROM t', 100)).toBeUndefined()
    expect(pushDownLimit('INSERT INTO t VALUES (1)', 100)).toBeUndefined()
    expect(pushDownLimit('SELECT a FROM t', 0)).toBeUndefined()
    expect(pushDownLimit('SELECT a FROM t', -1)).toBeUndefined()
    expect(pushDownLimit('SELECT a FROM t', Number.NaN)).toBeUndefined()
  })

  it('truncates a fractional cap instead of emitting invalid syntax', () => {
    expect(pushDownLimit('SELECT a FROM t', 2.9)).toBe('SELECT a FROM t\nLIMIT 2')
  })
})

describe('wire value projection', () => {
  it('keeps scalars and stringifies everything else losslessly', () => {
    expect(toWireValue(null)).toBeNull()
    expect(toWireValue(undefined)).toBeNull()
    expect(toWireValue('a')).toBe('a')
    expect(toWireValue(7)).toBe(7)
    expect(toWireValue(true)).toBe(true)
    expect(toWireValue(10n)).toBe('10')
    expect(toWireValue(new Date('2020-01-01T00:00:00Z'))).toBe('2020-01-01T00:00:00.000Z')
    expect(toWireValue(Buffer.from('hello'))).toBe('<binary 5 bytes>')
    expect(toWireValue(Number.POSITIVE_INFINITY)).toBe('Infinity')
  })
})

describe('Redis command classification', () => {
  it('treats read commands as reads and everything else as a write', () => {
    for (const name of ['GET', 'hgetall', 'LRANGE', 'scan', 'INFO', 'TYPE', 'TTL']) {
      expect(isRedisReadCommand(name)).toBe(true)
    }
    for (const name of ['SET', 'del', 'FLUSHALL', 'HSET', 'EXPIRE', 'RENAME', 'CONFIG']) {
      expect(isRedisReadCommand(name)).toBe(false)
    }
  })
})

describe('Redis command-line splitting', () => {
  it('splits on whitespace', () => {
    expect(splitCommand('GET mykey')).toEqual(['GET', 'mykey'])
    expect(splitCommand('  SET   a   b  ')).toEqual(['SET', 'a', 'b'])
  })

  it('honours quotes and escapes so a key with spaces stays one argument', () => {
    expect(splitCommand('SET "my key" "my value"')).toEqual(['SET', 'my key', 'my value'])
    expect(splitCommand("GET 'a b'")).toEqual(['GET', 'a b'])
    expect(splitCommand('SET k "a\\"b"')).toEqual(['SET', 'k', 'a"b'])
  })

  it('drops empty segments and handles an empty line', () => {
    expect(splitCommand('')).toEqual([])
    expect(splitCommand('   ')).toEqual([])
    expect(splitCommand('""')).toEqual([''])
  })
})

describe('groupSameColumns: rows a multi-row INSERT can share', () => {
  const row = (...names: string[]): Array<{ column: string }> => names.map(name => ({ column: name }))

  it('puts rows with the same column list in one group', () => {
    const groups = groupSameColumns([row('a', 'b'), row('a', 'b'), row('a', 'b')])
    expect(groups.length).toBe(1)
    expect(groups[0]!.length).toBe(3)
  })

  it('splits where the column list changes', () => {
    const groups = groupSameColumns([row('a', 'b'), row('a'), row('a', 'b')])
    expect(groups.map(group => group.length)).toEqual([1, 1, 1])
  })

  it('groups only CONSECUTIVE equal rows, so the order is preserved', () => {
    /*
     * The order is what assigns AUTO_INCREMENT ids, so grouping every row with an
     * equal column list would reorder the inserts: this input has an 'a'-only row
     * between two 'a','b' rows, and it must stay in the middle.
     */
    const groups = groupSameColumns([row('a', 'b'), row('a'), row('a', 'b')])
    expect(groups[0]![0]!.map(item => item.column)).toEqual(['a', 'b'])
    expect(groups[1]![0]!.map(item => item.column)).toEqual(['a'])
    expect(groups[2]![0]!.map(item => item.column)).toEqual(['a', 'b'])
  })

  it('distinguishes the same names in a different ORDER', () => {
    // Column order is part of the statement's shape: (a, b) values and (b, a)
    // values are different lists even though they name the same columns.
    const groups = groupSameColumns([row('a', 'b'), row('b', 'a')])
    expect(groups.length).toBe(2)
  })

  it('returns nothing for no rows', () => {
    expect(groupSameColumns([])).toEqual([])
  })

  it('reads the names through a caller-supplied accessor', () => {
    // The drivers pass the real row shape, whose column name lives one level down.
    const groups = groupSameColumns<[{ column: string }]>(
      [[{ column: 'a' }], [{ column: 'a' }]],
      entries => entries.map(entry => entry.column),
    )
    expect(groups.length).toBe(1)
    expect(groups[0]!.length).toBe(2)
  })
})
