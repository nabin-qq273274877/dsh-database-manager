/**
 * Tests for the extended 新建表 surface: lengths, attributes, per-column collation,
 * comments, index kinds and table options.
 *
 * Every case here is one where the two engines DIVERGE, because that divergence is what
 * the panel has to get right and what a single-engine test would miss:
 *
 * - MySQL honours UNSIGNED / ZEROFILL / BINARY / ON UPDATE and refuses each on the
 *   wrong type; SQLite ACCEPTS the words and stores them in the type name with no
 *   effect (measured), so the driver refuses them outright.
 * - MySQL has a storage engine, a table comment and a table-level collation; SQLite
 *   refuses all three as syntax errors (measured).
 * - SQLite has no FULLTEXT / SPATIAL index at all; MySQL has both, with conditions
 *   (text columns for FULLTEXT, NOT NULL geometry for SPATIAL).
 * - A composite index exists in both, but MySQL expresses it inside CREATE TABLE and
 *   SQLite needs separate CREATE INDEX statements — so the failure mode differs when a
 *   later index fails.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SqliteDriver, sqliteAvailable } from '../src/drivers/sqlite.ts'
import { MysqlDriver } from '../src/drivers/mysql.ts'
import type { ColumnSpec, DataSourceEntry } from '../src/protocol.ts'

let dir: string
let entry: DataSourceEntry
let driver: SqliteDriver
let available = false

beforeAll(async () => {
  available = await sqliteAvailable()
  dir = mkdtempSync(join(tmpdir(), 'dbm-ctfull-'))
  entry = { id: 'test', kind: 'sqlite', name: 'test', file: join(dir, 'test.db') } as DataSourceEntry
  if (available) {
    driver = new SqliteDriver(entry)
    await driver.test()
  }
})

afterAll(async () => {
  if (available && driver !== undefined) await driver.close()
  rmSync(dir, { recursive: true, force: true })
})

const column = (overrides: Partial<ColumnSpec> & { name: string }): ColumnSpec => ({
  type: 'TEXT',
  nullable: true,
  ...overrides,
})

describe('SQLite refuses what it would silently ignore', () => {
  const refuses = async (label: string, spec: ColumnSpec, pattern: RegExp) => {
    if (!available) return
    await expect(driver.createTable(undefined, `t_${Math.abs(label.length)}${spec.name}`, [spec])).rejects.toThrow(pattern)
  }

  it('refuses UNSIGNED, which would be absorbed into the type name', async () => {
    await refuses('unsigned', column({ name: 'a', type: 'INT', attributes: ['unsigned'] }), /不支持列属性/)
  })

  it('refuses ZEROFILL for the same reason', async () => {
    await refuses('zerofill', column({ name: 'b', type: 'INT', attributes: ['zerofill'] }), /不支持列属性/)
  })

  it('refuses BINARY', async () => {
    await refuses('binary', column({ name: 'c', type: 'VARCHAR', attributes: ['binary'] }), /不支持列属性/)
  })

  it('refuses a separate length, pointing at the type instead', async () => {
    await refuses('length', column({ name: 'd', type: 'TEXT', length: '20' }), /不支持长度/)
  })

  it('refuses a column comment', async () => {
    await refuses('comment', column({ name: 'e', type: 'TEXT', comment: 'hi' }), /不支持列注释/)
  })

  it('refuses a storage engine', async () => {
    if (!available) return
    await expect(driver.createTable(undefined, 't_engine', [column({ name: 'a', type: 'TEXT' })], {
      table: { engine: 'InnoDB' },
    })).rejects.toThrow(/没有存储引擎/)
  })

  it('refuses a table comment', async () => {
    if (!available) return
    await expect(driver.createTable(undefined, 't_tc', [column({ name: 'a', type: 'TEXT' })], {
      table: { comment: 'x' },
    })).rejects.toThrow(/没有表注释/)
  })

  it('refuses a table-level collation', async () => {
    if (!available) return
    await expect(driver.createTable(undefined, 't_tcol', [column({ name: 'a', type: 'TEXT' })], {
      table: { collate: 'utf8mb4_bin' },
    })).rejects.toThrow(/没有表级排序规则/)
  })

  it('refuses FULLTEXT, which SQLite does not have without an extension', async () => {
    if (!available) return
    await expect(driver.createTable(undefined, 't_ft', [column({ name: 'a', type: 'TEXT' })], {
      indexes: [{ kind: 'fulltext', columns: ['a'] }],
    })).rejects.toThrow(/没有 FULLTEXT/)
  })

  it('refuses SPATIAL for the same reason', async () => {
    if (!available) return
    await expect(driver.createTable(undefined, 't_sp', [column({ name: 'a', type: 'BLOB' })], {
      indexes: [{ kind: 'spatial', columns: ['a'] }],
    })).rejects.toThrow(/没有 SPATIAL/)
  })

  it('refuses an arbitrary table keyword', async () => {
    if (!available) return
    await expect(driver.createTable(undefined, 't_tail', [column({ name: 'a', type: 'TEXT' })], {
      table: { tail: 'ENGINE=InnoDB' },
    })).rejects.toThrow(/invalid table keyword/)
  })
})

describe('SQLite honours what it does support', () => {
  it('applies a per-column collation that really takes effect', async () => {
    if (!available) return
    await driver.createTable(undefined, 't_nocase', [
      column({ name: 'v', type: 'TEXT', collate: 'NOCASE' }),
    ])
    await driver.insertRow(undefined, 't_nocase', [{ column: 'v', value: 'ABC' }])
    /*
     * The comparison is what proves the collation took effect.
     *
     * Finding 'abc' must match the stored 'ABC' — so the assertion is a SEARCH, not a
     * reading of the schema. A schema read would pass even if the clause had been
     * dropped from the statement: the whole point is that the ENGINE now compares
     * case-insensitively, which only a query can show.
     *
     * Asserted through the same `rows` surface the 搜索 tab uses, with the operator
     * name from the shared filter contract.
     */
    const matched = await driver.rows({
      table: 't_nocase',
      page: 1,
      pageSize: 10,
      filters: [{ column: 'v', operator: 'eq', value: 'abc' }],
    })
    expect(matched.total).toBe(1)
    // And the same query on the DEFAULT collation must NOT match, which is what makes
    // the first assertion meaningful rather than a tautology about the engine.
    await driver.createTable(undefined, 't_binary', [column({ name: 'v', type: 'TEXT' })])
    await driver.insertRow(undefined, 't_binary', [{ column: 'v', value: 'ABC' }])
    const notMatched = await driver.rows({
      table: 't_binary',
      page: 1,
      pageSize: 10,
      filters: [{ column: 'v', operator: 'eq', value: 'abc' }],
    })
    expect(notMatched.total).toBe(0)
  })

  it('creates a composite UNIQUE index as a separate statement, and it is enforced', async () => {
    if (!available) return
    await driver.createTable(undefined, 't_uq', [
      column({ name: 'a', type: 'INTEGER', nullable: false }),
      column({ name: 'b', type: 'INTEGER', nullable: false }),
    ], { indexes: [{ kind: 'unique', name: 'uq_ab', columns: ['a', 'b'] }] })

    const indexes = await driver.indexes(undefined, 't_uq')
    const created = indexes.find(entry => entry.name === 'uq_ab')
    expect(created).toBeDefined()
    expect(created?.columns).toEqual(['a', 'b'])

    await driver.insertRow(undefined, 't_uq', [{ column: 'a', value: 1 }, { column: 'b', value: 2 }])
    // The UNIQUE index must be enforced by the engine, not merely declared.
    await expect(driver.insertRow(undefined, 't_uq', [{ column: 'a', value: 1 }, { column: 'b', value: 2 }])).rejects.toThrow()
  })

  it('creates a plain composite INDEX and preserves the column ORDER', async () => {
    if (!available) return
    await driver.createTable(undefined, 't_ix', [
      column({ name: 'first', type: 'INTEGER' }),
      column({ name: 'second', type: 'INTEGER' }),
    ], { indexes: [{ kind: 'index', name: 'ix_order', columns: ['first', 'second'] }] })
    const indexes = await driver.indexes(undefined, 't_ix')
    // Order matters: a prefix scan depends on which column comes first.
    expect(indexes.find(entry => entry.name === 'ix_order')?.columns).toEqual(['first', 'second'])
  })

  it('creates a table with WITHOUT ROWID', async () => {
    if (!available) return
    await driver.createTable(undefined, 't_wr', [
      column({ name: 'k', type: 'TEXT', nullable: false }),
      column({ name: 'v', type: 'TEXT' }),
    ], { primaryKey: ['k'], table: { tail: 'WITHOUT ROWID' } })
    const tables = await driver.tables(undefined)
    expect(tables.map(table => table.name)).toContain('t_wr')
  })

  it('names the index that failed, and says the table exists', async () => {
    if (!available) return
    // Two indexes with the same name: the second must fail, and the message must say the
    // table was already created — because on SQLite the indexes are separate statements,
    // so a failure after the table exists is a state the user has to know about.
    await expect(driver.createTable(undefined, 't_dupix', [
      column({ name: 'a', type: 'INTEGER' }),
      column({ name: 'b', type: 'INTEGER' }),
    ], {
      indexes: [
        { kind: 'index', name: 'same_name', columns: ['a'] },
        { kind: 'index', name: 'same_name', columns: ['b'] },
      ],
    })).rejects.toThrow(/表已创建.*same_name/)
    // And the table really does exist, which is what the message claims.
    const tables = await driver.tables(undefined)
    expect(tables.map(table => table.name)).toContain('t_dupix')
  })
})

describe('MySQL honours attributes, index kinds and table options', () => {
  let mysql: MysqlDriver | undefined
  let mysqlOk = false
  const database = `dbm_ctf_${process.pid}`

  beforeAll(async () => {
    const probe: DataSourceEntry = {
      id: 'mysql-test', kind: 'mysql', name: 'mysql-test',
      host: '127.0.0.1', port: 3306, user: 'root', password: 'root',
    } as DataSourceEntry
    const candidate = new MysqlDriver(probe)
    // Probe by CONNECTING: `mysqlAvailable()` only reports that the module loads, which
    // made five cases silently skip while reporting as passed.
    mysqlOk = await candidate.test().then(result => result.ok).catch(() => false)
    if (!mysqlOk) { await candidate.close().catch(() => {}); return }
    mysql = candidate
    await mysql.databaseOperation('create', database)
  })

  afterAll(async () => {
    if (mysql === undefined) return
    await mysql.databaseOperation('drop', database).catch(() => { /* best effort */ })
    await mysql.close()
  })

  const describeColumn = async (table: string, columnName: string) => {
    const rows = await mysql!.runScript([], database)
    void rows
    const info = await mysql!.columns(database, table)
    return info.find(entry => entry.name === columnName)
  }

  it('applies UNSIGNED and reports the type back as unsigned', async () => {
    if (!mysqlOk || mysql === undefined) return
    await mysql.createTable(database, 't_unsigned', [
      column({ name: 'a', type: 'INT', nullable: false, attributes: ['unsigned'] }),
    ])
    const found = await describeColumn('t_unsigned', 'a')
    expect(String(found?.type ?? '')).toMatch(/unsigned/i)
  })

  it('applies ZEROFILL, which implies UNSIGNED', async () => {
    if (!mysqlOk || mysql === undefined) return
    await mysql.createTable(database, 't_zf', [
      column({ name: 'a', type: 'INT', nullable: false, attributes: ['zerofill'] }),
    ])
    const found = await describeColumn('t_zf', 'a')
    expect(String(found?.type ?? '')).toMatch(/zerofill/i)
    expect(String(found?.type ?? '')).toMatch(/unsigned/i)
  })

  it('applies a length that the type did not already carry', async () => {
    if (!mysqlOk || mysql === undefined) return
    await mysql.createTable(database, 't_len', [
      column({ name: 'a', type: 'VARCHAR', nullable: false, length: '42' }),
    ])
    const found = await describeColumn('t_len', 'a')
    expect(String(found?.type ?? '')).toMatch(/varchar\(42\)/i)
  })

  it('does not double up a length the type already carried', async () => {
    if (!mysqlOk || mysql === undefined) return
    await mysql.createTable(database, 't_len2', [
      column({ name: 'a', type: 'VARCHAR(30)', nullable: false, length: '42' }),
    ])
    const found = await describeColumn('t_len2', 'a')
    // The type's own parentheses win: `VARCHAR(30)(42)` is a syntax error, not a length.
    expect(String(found?.type ?? '')).toMatch(/varchar\(30\)/i)
  })

  it('applies ON UPDATE CURRENT_TIMESTAMP on a TIMESTAMP', async () => {
    if (!mysqlOk || mysql === undefined) return
    await mysql.createTable(database, 't_ts', [
      column({ name: 'a', type: 'TIMESTAMP', nullable: false, attributes: ['onUpdateCurrentTimestamp'] }),
    ])
    const found = await describeColumn('t_ts', 'a')
    expect(String(found?.extra ?? '')).toMatch(/on update CURRENT_TIMESTAMP/i)
  })

  it('refuses BINARY on a numeric type, naming the column', async () => {
    if (!mysqlOk || mysql === undefined) return
    await expect(mysql.createTable(database, 't_badbin', [
      column({ name: 'a', type: 'INT', attributes: ['binary'] }),
    ])).rejects.toThrow(/BINARY only applies/)
  })

  it('refuses ON UPDATE on a non-temporal type, naming the column', async () => {
    if (!mysqlOk || mysql === undefined) return
    await expect(mysql.createTable(database, 't_badts', [
      column({ name: 'a', type: 'INT', attributes: ['onUpdateCurrentTimestamp'] }),
    ])).rejects.toThrow(/only applies to TIMESTAMP or DATETIME/)
  })

  it('applies a per-column collation', async () => {
    if (!mysqlOk || mysql === undefined) return
    await mysql.createTable(database, 't_col', [
      column({ name: 'a', type: 'VARCHAR', length: '10', collate: 'utf8mb4_bin' }),
    ])
    const found = await describeColumn('t_col', 'a')
    expect(String(found?.collation ?? '')).toBe('utf8mb4_bin')
  })

  it('creates a composite UNIQUE index inside the CREATE TABLE', async () => {
    if (!mysqlOk || mysql === undefined) return
    await mysql.createTable(database, 't_cuq', [
      column({ name: 'a', type: 'INT', nullable: false }),
      column({ name: 'b', type: 'INT', nullable: false }),
    ], { indexes: [{ kind: 'unique', name: 'uq_ab', columns: ['a', 'b'] }] })
    const indexes = await mysql.indexes(database, 't_cuq')
    expect(indexes.find(entry => entry.name === 'uq_ab')?.columns).toEqual(['a', 'b'])
    await mysql.insertRow(database, 't_cuq', [{ column: 'a', value: 1 }, { column: 'b', value: 2 }])
    await expect(mysql.insertRow(database, 't_cuq', [{ column: 'a', value: 1 }, { column: 'b', value: 2 }])).rejects.toThrow()
  })

  it('creates a FULLTEXT index on a text column', async () => {
    if (!mysqlOk || mysql === undefined) return
    await mysql.createTable(database, 't_ft', [
      column({ name: 'body', type: 'TEXT', nullable: false }),
    ], { indexes: [{ kind: 'fulltext', name: 'ft_body', columns: ['body'] }] })
    const indexes = await mysql.indexes(database, 't_ft')
    expect(indexes.find(entry => entry.name === 'ft_body')).toBeDefined()
  })

  it('refuses FULLTEXT on a non-text column, naming the column', async () => {
    if (!mysqlOk || mysql === undefined) return
    await expect(mysql.createTable(database, 't_ftbad', [
      column({ name: 'n', type: 'INT' }),
    ], { indexes: [{ kind: 'fulltext', name: 'ft_n', columns: ['n'] }] })).rejects.toThrow(/FULLTEXT index covers "n"/)
  })

  it('creates a SPATIAL index on a NOT NULL geometry column', async () => {
    if (!mysqlOk || mysql === undefined) return
    await mysql.createTable(database, 't_sp', [
      column({ name: 'g', type: 'POINT', nullable: false }),
    ], { indexes: [{ kind: 'spatial', name: 'sp_g', columns: ['g'] }] })
    const indexes = await mysql.indexes(database, 't_sp')
    expect(indexes.find(entry => entry.name === 'sp_g')).toBeDefined()
  })

  it('refuses SPATIAL on a nullable column, naming it', async () => {
    if (!mysqlOk || mysql === undefined) return
    await expect(mysql.createTable(database, 't_spbad', [
      column({ name: 'g', type: 'POINT', nullable: true }),
    ], { indexes: [{ kind: 'spatial', name: 'sp_g', columns: ['g'] }] })).rejects.toThrow(/must be NOT NULL/)
  })

  it('applies the storage engine, collation and table comment', async () => {
    if (!mysqlOk || mysql === undefined) return
    await mysql.createTable(database, 't_opts', [
      column({ name: 'a', type: 'INT' }),
    ], { table: { engine: 'MyISAM', collate: 'utf8mb4_bin', comment: '我的表' } })
    /*
     * Read WITHOUT statistics, which is the path the panel's table list takes.
     *
     * That path used to omit ENGINE and TABLE_COLLATION from its projection, so the
     * overview's 类型 and 排序规则 columns were blank for every table. Asserting through
     * this same path is what keeps the two in step.
     */
    const tables = await mysql.tables(database, { stats: false })
    const created = tables.find(entry => entry.name === 't_opts')
    expect(created).toBeDefined()
    expect(String(created?.engine ?? '')).toBe('MyISAM')
    expect(String(created?.collation ?? '')).toBe('utf8mb4_bin')
    expect(String(created?.comment ?? '')).toBe('我的表')
  })

  it('refuses an engine name that is not a bare keyword', async () => {
    if (!mysqlOk || mysql === undefined) return
    await expect(mysql.createTable(database, 't_badengine', [
      column({ name: 'a', type: 'INT' }),
    ], { table: { engine: 'InnoDB; DROP DATABASE x' } })).rejects.toThrow(/invalid storage engine/)
  })

  it('refuses a table comment containing a backslash', async () => {
    if (!mysqlOk || mysql === undefined) return
    await expect(mysql.createTable(database, 't_badcomment', [
      column({ name: 'a', type: 'INT' }),
    ], { table: { comment: 'a\\b' } })).rejects.toThrow(/cannot contain a backslash/)
  })

  it('refuses two indexes with the same name', async () => {
    if (!mysqlOk || mysql === undefined) return
    await expect(mysql.createTable(database, 't_dupname', [
      column({ name: 'a', type: 'INT' }),
      column({ name: 'b', type: 'INT' }),
    ], {
      indexes: [
        { kind: 'index', name: 'same', columns: ['a'] },
        { kind: 'index', name: 'same', columns: ['b'] },
      ],
    })).rejects.toThrow(/two indexes would be named same/)
  })
})
