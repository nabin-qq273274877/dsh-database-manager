/**
 * Dev aid: seed two MySQL databases for the browser probe.
 *
 * Two databases that both contain a table named `t` are the point: they make
 * "which database is this pane showing?" unambiguous, which is what the panel's
 * phpMyAdmin-style tree has to get right.
 *
 * Usage: node scripts/seed-mysql.mjs [host:port:user:password]
 */

import mysql from 'mysql2/promise'

const raw = process.argv[2] ?? '127.0.0.1:3306:root:root'
const [host, port, user, password] = raw.split(':')

const DB_A = 'dbm_probe_a'
const DB_B = 'dbm_probe_b'

const connection = await mysql.createConnection({
  host: host ?? '127.0.0.1',
  port: Number(port ?? 3306),
  user: user ?? 'root',
  password: password ?? '',
})

try {
  for (const db of [DB_A, DB_B]) {
    await connection.query(`DROP DATABASE IF EXISTS \`${db}\``)
    await connection.query(`CREATE DATABASE \`${db}\` DEFAULT CHARACTER SET utf8mb4`)
  }
  // A shared table name `t` in both, with different shapes and rows.
  await connection.query(`CREATE TABLE \`${DB_A}\`.t (id INT PRIMARY KEY, name VARCHAR(50), note TEXT)`)
  await connection.query(`INSERT INTO \`${DB_A}\`.t VALUES (1, 'alice', 'first'), (2, 'bob', NULL)`)
  await connection.query(`CREATE TABLE \`${DB_A}\`.orders (id INT PRIMARY KEY, total INT)`)
  await connection.query(`CREATE TABLE \`${DB_B}\`.t (id INT PRIMARY KEY, other VARCHAR(50))`)
  await connection.query(`INSERT INTO \`${DB_B}\`.t VALUES (1, 'second-db')`)
  await connection.query(`CREATE TABLE \`${DB_B}\`.widgets (id INT PRIMARY KEY, label VARCHAR(50))`)

  const [rows] = await connection.query('SHOW DATABASES')
  const names = rows
    .map((row) => Object.values(row)[0])
    .filter((name) => !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(name))
  console.log(`seeded. user databases: ${names.join(', ')}`)
} finally {
  await connection.end()
}
