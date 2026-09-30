/**
 * The MySQL columns read against an OLD server's schema.
 *
 * The bug this file exists for, reported from a MySQL 5.5.62 server (05老库): every column
 * read failed with
 *
 *     Unknown column 'GENERATION_EXPRESSION' in 'field list'
 *
 * because the statement asked `information_schema.COLUMNS` for a column that only exists
 * from MySQL 5.7.6 / MariaDB 10.2 on. `columns()` is the read behind the 结构 tab, the 浏览
 * grid, 搜索, 插入 and the row editor, so on that server the whole panel answered with that
 * one error — the reported symptom was "读表时报错，例如 my_daily_work 表".
 *
 * The real server cannot be reached from a test run, so the SERVER is faked here: a stub
 * pool answers the capability probe, the column read and the key-order read, and the
 * assertions are on the statements the driver actually sent. That is the part the fix
 * lives in — "which statement does this server get" — and the legacy statement itself was
 * run against the real 5.5.62 server by hand (it returns the rows, comments included; see
 * the note on `columnsSelect`).
 *
 * No network, no mysql2 instance and no server: `open()` returns the injected pool as soon
 * as one is present, so nothing else is reached.
 */

import { describe, expect, it } from 'vitest'
import { MysqlDriver, columnsSelect } from '../src/drivers/mysql.ts'
import type { DataSourceEntry } from '../src/protocol.ts'

/** One recorded statement. */
interface Sent {
  sql: string
  values: unknown[]
}

/** A column row as the driver's aliases expect it. */
function columnRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'day_time',
    type: 'varchar(10)',
    nullable: 'NO',
    dflt: null,
    col_key: '',
    comment: '年月日',
    extra: '',
    collation: 'utf8_general_ci',
    ...overrides,
  }
}

/**
 * A stand-in for the pool, answering the three reads `columns()` makes.
 *
 * @param options.hasGenerationExpression - what the capability probe reports.
 * @param options.lie - true to answer the probe "yes" and then REJECT the statement that
 *   asks for the column, which is what a server whose probe cannot be trusted looks like.
 * @param options.rows - the rows the column read returns.
 */
function stubPool(options: {
  hasGenerationExpression: boolean
  lie?: boolean
  rows?: Array<Record<string, unknown>>
}): { pool: unknown; sent: Sent[] } {
  const sent: Sent[] = []
  const pool = {
    async query(request: { sql: string; values?: unknown[] }): Promise<[unknown, unknown]> {
      sent.push({ sql: request.sql, values: request.values ?? [] })
      if (request.sql.startsWith('SHOW COLUMNS FROM information_schema.COLUMNS')) {
        return [options.hasGenerationExpression ? [{ Field: 'GENERATION_EXPRESSION' }] : [], undefined]
      }
      // The key-order read that `columns()` pairs with the column read.
      if (request.sql.includes('information_schema.STATISTICS')) return [[], undefined]
      if (request.sql.includes('information_schema.COLUMNS')) {
        if (options.lie === true && request.sql.includes('GENERATION_EXPRESSION')) {
          throw Object.assign(
            new Error("Unknown column 'GENERATION_EXPRESSION' in 'field list'"),
            { code: 'ER_BAD_FIELD_ERROR', errno: 1054 },
          )
        }
        return [options.rows ?? [columnRow()], undefined]
      }
      throw new Error(`unexpected statement: ${request.sql}`)
    },
    getConnection(): never { throw new Error('the stub pool hands out no connections') },
    async end(): Promise<void> { /* nothing to close */ },
    on(): void { /* no listeners are registered in this path */ },
  }
  return { pool, sent }
}

/** A driver whose pool is the injected stub, so no server is contacted. */
function driverWith(pool: unknown): MysqlDriver {
  const entry: DataSourceEntry = {
    id: 'stub',
    kind: 'mysql',
    name: 'stub',
    group: '',
    tags: [],
    description: '',
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    readonly: false,
    createdAt: 0,
    updatedAt: 0,
  }
  const driver = new MysqlDriver(entry)
  // The pool is private because nothing outside the driver may replace it in production;
  // a test is exactly the caller that needs to.
  ;(driver as unknown as { pool: unknown }).pool = pool
  return driver
}

/** The statements that actually read COLUMNS (the probe and the key read are separate). */
function columnReads(sent: Sent[]): Sent[] {
  return sent.filter(entry => entry.sql.includes('information_schema.COLUMNS') && entry.sql.startsWith('SELECT'))
}

describe('columnsSelect: the two variants', () => {
  it('asks for GENERATION_EXPRESSION only on the variant for servers that have it', () => {
    expect(columnsSelect(true)).toContain('GENERATION_EXPRESSION AS generation')
    expect(columnsSelect(false)).not.toContain('GENERATION_EXPRESSION')
  })

  it('keeps everything else identical, so the two cannot drift apart', () => {
    const without = columnsSelect(false)
    const withIt = columnsSelect(true).replace(', GENERATION_EXPRESSION AS generation', '')
    expect(withIt).toBe(without)
    // Both bind the schema and the table rather than pasting them in.
    expect(without).toContain('TABLE_SCHEMA = ? AND TABLE_NAME = ?')
    expect(without).toContain('ORDER BY ORDINAL_POSITION')
  })
})

describe('MysqlDriver.columns on a server WITHOUT GENERATION_EXPRESSION (MySQL 5.5)', () => {
  it('probes once, then reads columns without that column', async () => {
    const { pool, sent } = stubPool({ hasGenerationExpression: false })
    const driver = driverWith(pool)

    const columns = await driver.columns('my91jf', 'my_daily_work')
    // The comment survives: on 5.5 it is the only thing that says what `day_time` means,
    // and it is read from a column that predates 5.7.
    expect(columns.map(column => column.name)).toEqual(['day_time'])
    expect(columns[0]?.comment).toBe('年月日')

    expect(sent[0]?.sql).toBe("SHOW COLUMNS FROM information_schema.COLUMNS LIKE 'GENERATION_EXPRESSION'")
    const reads = columnReads(sent)
    expect(reads).toHaveLength(1)
    expect(reads[0]?.sql).not.toContain('GENERATION_EXPRESSION')
    expect(reads[0]?.values).toEqual(['my91jf', 'my_daily_work'])
  })

  it('does not report a generated column, because 5.5 has none to report', async () => {
    const { pool } = stubPool({ hasGenerationExpression: false })
    const columns = await driverWith(pool).columns('my91jf', 'my_daily_work')
    expect(columns[0]?.generated).toBeUndefined()
    expect(columns[0]?.generatedExpression).toBeUndefined()
  })

  it('remembers the answer, so the probe is not repeated per read', async () => {
    const { pool, sent } = stubPool({ hasGenerationExpression: false })
    const driver = driverWith(pool)
    await driver.columns('my91jf', 'a')
    await driver.columns('my91jf', 'b')
    const probes = sent.filter(entry => entry.sql.startsWith('SHOW COLUMNS'))
    expect(probes).toHaveLength(1)
    expect(columnReads(sent)).toHaveLength(2)
  })
})

describe('MysqlDriver.columns on a server WITH GENERATION_EXPRESSION (MySQL 5.7+)', () => {
  it('reads the expression, which is what marks a column as generated', async () => {
    const { pool, sent } = stubPool({
      hasGenerationExpression: true,
      rows: [columnRow({ name: 'doubled', extra: 'STORED GENERATED', generation: '(`base` * 2)' })],
    })
    const columns = await driverWith(pool).columns('db', 't')

    expect(columns[0]?.generated).toBe(true)
    expect(columns[0]?.generatedExpression).toBe('(`base` * 2)')
    expect(columnReads(sent)[0]?.sql).toContain('GENERATION_EXPRESSION AS generation')
  })
})

describe('MysqlDriver.columns when the probe cannot be trusted', () => {
  it('retries without the column, and stops asking for it afterwards', async () => {
    const { pool, sent } = stubPool({ hasGenerationExpression: true, lie: true })
    const driver = driverWith(pool)

    // The server says it has the column and then rejects it. The read must still succeed
    // rather than failing the 结构 tab on a capability answer that was wrong.
    const columns = await driver.columns('db', 't')
    expect(columns.map(column => column.name)).toEqual(['day_time'])

    const reads = columnReads(sent)
    expect(reads).toHaveLength(2)
    expect(reads[0]?.sql).toContain('GENERATION_EXPRESSION')
    expect(reads[1]?.sql).not.toContain('GENERATION_EXPRESSION')

    // The correction is cached: the next read does not repeat the mistake.
    await driver.columns('db', 't')
    const after = columnReads(sent)
    expect(after).toHaveLength(3)
    expect(after[2]?.sql).not.toContain('GENERATION_EXPRESSION')
  })

  it('does not swallow an unrelated error', async () => {
    const { pool } = stubPool({ hasGenerationExpression: true })
    const failing = {
      ...(pool as Record<string, unknown>),
      async query(request: { sql: string }): Promise<[unknown, unknown]> {
        if (request.sql.startsWith('SHOW COLUMNS')) return [[{ Field: 'GENERATION_EXPRESSION' }], undefined]
        throw Object.assign(new Error('Table does not exist'), { code: 'ER_NO_SUCH_TABLE', errno: 1146 })
      },
    }
    await expect(driverWith(failing).columns('db', 'missing')).rejects.toThrow(/Table does not exist/)
  })
})
