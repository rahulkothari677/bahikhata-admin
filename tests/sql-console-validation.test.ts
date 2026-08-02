/**
 * 🔒 AUDIT PASS-1 M5 — cover for the SQL console's query validator.
 *
 * The console was previously untested despite being the single most sensitive
 * endpoint in the panel (it can read every shopkeeper's financial data).
 *
 * Worth stating plainly: the REAL control is the read-only Postgres role in
 * READONLY_DATABASE_URL, which the route refuses to run without in production.
 * These tests cover the defence-in-depth layer, not the thing keeping the
 * console safe. A test suite passing here is not a licence to relax the role.
 */

import { describe, test, expect } from 'vitest'
import { validateQuery } from '@/lib/database-admin'

describe('validateQuery — whitelist', () => {
  test('accepts plain SELECT and WITH', () => {
    expect(validateQuery('SELECT 1').valid).toBe(true)
    expect(validateQuery('WITH x AS (SELECT 1) SELECT * FROM x').valid).toBe(true)
    expect(validateQuery('  select id from "User"  ').valid).toBe(true)
  })

  test('rejects anything that is not a read', () => {
    for (const sql of [
      'UPDATE "User" SET plan = \'elite\'',
      'DELETE FROM "Payment"',
      'DROP TABLE "Transaction"',
      'INSERT INTO "User" (id) VALUES (\'x\')',
      'TRUNCATE "AuditLog"',
      'ALTER TABLE "User" ADD COLUMN x int',
      'GRANT ALL ON "User" TO public',
    ]) {
      expect(validateQuery(sql).valid, sql).toBe(false)
    }
  })

  test('rejects a write smuggled after a leading SELECT', () => {
    expect(validateQuery('SELECT 1; DROP TABLE "User"').valid).toBe(false)
    expect(validateQuery('SELECT 1 UNION SELECT 1; DELETE FROM "Payment"').valid).toBe(false)
  })

  test('rejects comments, which can hide the rest of a statement', () => {
    expect(validateQuery('SELECT 1 -- DROP TABLE "User"').valid).toBe(false)
    expect(validateQuery('SELECT /* sneaky */ 1').valid).toBe(false)
  })

  test('allows a single trailing semicolon', () => {
    expect(validateQuery('SELECT 1;').valid).toBe(true)
  })
})

describe('validateQuery — filesystem / large-object / remote function families (M5)', () => {
  test('blocks pg_read_binary_file, which the exact-word blocklist missed', () => {
    // \bPG_READ_FILE\b does not match pg_read_binary_file — a different
    // identifier. This was the specific gap the audit found.
    expect(validateQuery(`SELECT pg_read_binary_file('/etc/passwd')`).valid).toBe(false)
  })

  test('blocks the rest of the same families', () => {
    for (const sql of [
      `SELECT pg_read_file('/etc/passwd')`,
      `SELECT pg_ls_dir('/')`,
      `SELECT pg_ls_logdir()`,
      `SELECT pg_stat_file('/etc/passwd')`,
      `SELECT lo_import('/etc/passwd')`,
      `SELECT lo_export(1, '/tmp/x')`,
      `SELECT dblink_connect('host=evil.example.com')`,
    ]) {
      expect(validateQuery(sql).valid, sql).toBe(false)
    }
  })

  test('does not block ordinary columns that merely start with similar text', () => {
    // Guard against the prefix rule being so broad it blocks real queries.
    expect(validateQuery('SELECT "page_views" FROM "DailyStats"').valid).toBe(true)
    expect(validateQuery('SELECT "logo_url" FROM "Setting"').valid).toBe(true)
  })
})
