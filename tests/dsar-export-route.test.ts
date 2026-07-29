import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Route-level test for the DPDP s.11 subject-access export.
 *
 * It CONSUMES the streamed response body and asserts the bytes, rather than
 * checking that the handler looks right. The admin panel enforces TOTP, so a
 * full browser run is not practical here; reading the actual stream is the
 * closest thing to it and covers what matters — that the export is complete,
 * correctly escaped, and says so at the end.
 */

const dbState: {
  exportReq: Record<string, unknown> | null
  user: Record<string, unknown> | null
  transactions: Array<Record<string, unknown>>
  updates: Array<Record<string, unknown>>
  failTransactionsAfter: number | null
} = {
  exportReq: null, user: null, transactions: [], updates: [], failTransactionsAfter: null,
}

let txCallCount = 0

vi.mock('@/lib/db', () => ({
  db: {
    dataExportRequest: {
      findUnique: async () => dbState.exportReq,
      update: async (args: Record<string, unknown>) => {
        dbState.updates.push((args as { data: Record<string, unknown> }).data)
        return {}
      },
    },
    user: { findUnique: async () => dbState.user },
    transaction: {
      findMany: async (args: { take: number; cursor?: { id: string } }) => {
        txCallCount++
        if (dbState.failTransactionsAfter !== null && txCallCount > dbState.failTransactionsAfter) {
          throw new Error('connection reset mid-export')
        }
        const start = args.cursor ? dbState.transactions.findIndex(t => t.id === args.cursor!.id) + 1 : 0
        return dbState.transactions.slice(start, start + args.take)
      },
    },
    product: { findMany: async () => [] },
    party: { findMany: async () => [] },
  },
}))

vi.mock('@/lib/resilience', () => ({
  withNeonRetry: (fn: () => Promise<unknown>) => fn(),
  withTimeout: (p: Promise<unknown>) => p,
}))

vi.mock('@/lib/audit', () => ({ logAdminAction: vi.fn().mockResolvedValue(undefined) }))

// Pass straight through to the handler — access control is covered elsewhere.
vi.mock('@/lib/with-admin', () => ({
  withAdmin: (_key: string, handler: (req: unknown, ctx: unknown) => Promise<Response>) =>
    (req: unknown, _routeParams?: unknown) =>
      handler(req, { adminId: 'admin-1', degrade: (_l: string, f: unknown) => f, audit: vi.fn() }),
}))

import { POST } from '@/app/api/admin/data-exports/generate/route'

const makeReq = () => ({ json: async () => ({ id: 'exp-1' }) })

const readAll = async (res: Response) => {
  const reader = res.body!.getReader()
  const chunks: Uint8Array[] = []
  let chunkCount = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) { chunks.push(value); chunkCount++ }
  }
  const merged = Buffer.concat(chunks.map(c => Buffer.from(c)))
  return { text: merged.toString('utf8'), chunkCount }
}

beforeEach(() => {
  txCallCount = 0
  dbState.updates = []
  dbState.failTransactionsAfter = null
  dbState.exportReq = { id: 'exp-1', status: 'pending', type: 'user_data', userId: 'user-abc' }
  dbState.user = { id: 'user-abc', email: 'shop@example.com', name: 'Sharma, Ram', phone: '9812345678', plan: 'pro' }
  dbState.transactions = []
})

describe('the streamed subject-access export', () => {
  it('ends with an explicit marker, so a truncated file is detectable', async () => {
    // Streaming sends headers before the body, so a mid-stream death cannot
    // change the status code. Without a marker the recipient holds a file that
    // looks fine and is short — the exact defect this route exists to prevent.
    dbState.transactions = [
      { id: 't1', amount: 100, note: 'first' },
      { id: 't2', amount: 0, note: 'zero value bill' },
    ]

    const res = await POST(makeReq() as never, { params: Promise.resolve({}) } as never)
    const { text } = await readAll(res as unknown as Response)

    expect(text).toContain('=== END OF EXPORT')
    expect(text).toMatch(/=== END OF EXPORT — \d+ ROWS TOTAL ===/)
  })

  it('exports a zero amount as 0, not as an empty cell', async () => {
    // The old hand-built CSV used String(v || ''), so every zero silently
    // became blank — in a document produced to satisfy a legal request.
    dbState.transactions = [{ id: 't1', amount: 0, note: 'zero' }]

    const res = await POST(makeReq() as never, { params: Promise.resolve({}) } as never)
    const { text } = await readAll(res as unknown as Response)

    const dataLine = text.split('\n').find(l => l.startsWith('t1,'))
    expect(dataLine).toBeDefined()
    expect(dataLine!.split(',')[1]).toBe('0')
  })

  it('quotes a name containing a comma so the columns do not shift', async () => {
    const res = await POST(makeReq() as never, { params: Promise.resolve({}) } as never)
    const { text } = await readAll(res as unknown as Response)
    expect(text).toContain('"Sharma, Ram"')
  })

  it('reports a row count per section and marks the request completed', async () => {
    dbState.transactions = [{ id: 't1', amount: 1 }, { id: 't2', amount: 2 }]

    const res = await POST(makeReq() as never, { params: Promise.resolve({}) } as never)
    const { text } = await readAll(res as unknown as Response)

    expect(text).toContain('--- TRANSACTIONS ROW COUNT: 2 ---')

    const completed = dbState.updates.find(u => u.status === 'completed')
    expect(completed).toBeDefined()
    expect(completed!.rowCount).toBe(3) // profile + 2 transactions
    expect(Number(completed!.fileSizeBytes)).toBeGreaterThan(0)
  })

  it('serves the body in multiple chunks rather than one buffered blob', async () => {
    // 2,500 rows spans three pages of 1,000, so the body must arrive in
    // several writes — proof the rows are not all assembled first.
    dbState.transactions = Array.from({ length: 2500 }, (_v, i) => ({
      id: `t${String(i).padStart(5, '0')}`, amount: i, note: `bill ${i}`,
    }))

    const res = await POST(makeReq() as never, { params: Promise.resolve({}) } as never)
    const { text, chunkCount } = await readAll(res as unknown as Response)

    expect(chunkCount).toBeGreaterThan(1)
    expect(text).toContain('--- TRANSACTIONS ROW COUNT: 2500 ---')
    expect(text).toContain('=== END OF EXPORT — 2501 ROWS TOTAL ===')
  })

  it('marks the export FAILED and aborts the body when a page dies mid-stream', async () => {
    dbState.transactions = Array.from({ length: 2500 }, (_v, i) => ({ id: `t${String(i).padStart(5, '0')}`, amount: i }))
    dbState.failTransactionsAfter = 1 // first page succeeds, second throws

    const res = await POST(makeReq() as never, { params: Promise.resolve({}) } as never)

    await expect(readAll(res as unknown as Response)).rejects.toThrow('connection reset mid-export')
    expect(dbState.updates.some(u => u.status === 'failed')).toBe(true)
    expect(dbState.updates.some(u => u.status === 'completed')).toBe(false)
  })
})
