import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withNeonRetry, withTimeout } from '@/lib/resilience'
import { validateQuery, executeSafeQuery, exportToCsv, escapeCsv } from '@/lib/database-admin'
import { logAdminAction } from '@/lib/audit'
import { streamAllPaged, fetchWithTruncationFlag } from '@/lib/export-pagination'

/**
 * Row cap for BULK (analytics) exports. These are operational extracts, not
 * subject access requests, so a cap is legitimate — but it must be REPORTED.
 * Subject-access exports are never capped; see fetchAllPaged.
 */
const BULK_EXPORT_LIMIT = 10_000

/**
 * POST /api/admin/data-exports/generate
 *
 * Processes a pending export request — fetches data, generates CSV/JSON,
 * updates the request with file info.
 *
 * Body: { id: exportRequestId }
 */
export const POST = withAdmin(
  'admin/data-exports/generate',
  async (req: NextRequest, ctx) => {
  try {
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'Export ID required' }, { status: 400 })

    const exportReq = await withTimeout(db.dataExportRequest.findUnique({ where: { id } }), 5000)
    if (!exportReq) return NextResponse.json({ error: 'Export not found' }, { status: 404 })
    if (exportReq.status !== 'pending') return NextResponse.json({ error: 'Export already processed' }, { status: 400 })

    // Mark as processing
    await db.dataExportRequest.update({ where: { id }, data: { status: 'processing', processedBy: ctx.adminId } })

    let csvContent = ''
    let rowCount = 0
    let fileName = ''

    try {
      switch (exportReq.type) {
        case 'user_data': {
          // Fetch all data for a single user
          // NOT wrapped in a degrade/catch, deliberately. Swallowing a failure
          // here turns "the database is unreachable" into "User not found" —
          // a misleading answer on a legal request, and one that would send an
          // operator looking for a deleted account instead of a broken query.
          // Let it propagate; the outer handler marks the export failed.
          const user = await withNeonRetry(() =>
            db.user.findUnique({
              where: { id: exportReq.userId! },
              select: { id: true, email: true, name: true, phone: true, plan: true, createdAt: true, updatedAt: true },
            })
          )

          if (!user) throw new Error('User not found')

          const targetUserId = exportReq.userId!

          // 🐛 STREAMED (audit 2026-07-28). This case used to fetch every row
          // into arrays and then concatenate them into one `csvContent` string
          // — two full copies of the shopkeeper's ledger alive at once inside a
          // serverless function with a fixed memory ceiling. It worked for a
          // corner shop and would be killed for a successful one, which is the
          // opposite of who you want it to work for. And it failed on a legal
          // access request, for the users with the most data.
          //
          // Now the response IS the stream: rows are written as they are read
          // and never accumulated, so memory stays flat at one batch (1,000
          // rows) whatever the total.
          //
          // TRUNCATION IS THE HAZARD STREAMING INTRODUCES. Headers go out
          // before the body, so a mid-stream failure cannot change the status
          // code — the recipient would hold a file that looks fine and is
          // short. This route exists because exports used to be silently
          // incomplete, so that is precisely the failure it must not
          // reintroduce. Two defences:
          //   1. an explicit end marker with the row count. No marker = not a
          //      complete export, and it is checkable by eye.
          //   2. controller.error() on failure, which aborts the HTTP response
          //      mid-body so the client sees a broken download rather than a
          //      plausible file.
          // The request is marked `completed` only after the last byte.
          const encoder = new TextEncoder()
          const csvRow = (values: unknown[]) => values.map(escapeCsv).join(',') + '\n'

          let streamedRows = 0
          let streamedBytes = 0
          const fName = `user_data_${targetUserId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.csv`

          const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
              const write = (s: string) => {
                const bytes = encoder.encode(s)
                streamedBytes += bytes.byteLength
                controller.enqueue(bytes)
              }

              try {
                write('=== USER PROFILE ===\n')
                write(csvRow(Object.keys(user)))
                write(csvRow(Object.values(user)))
                streamedRows += 1

                const sections: Array<[string, (cursor: string | undefined, take: number) => Promise<Array<Record<string, unknown> & { id: string }>>]> = [
                  ['TRANSACTIONS', (cursor, take) =>
                    withNeonRetry(() => db.transaction.findMany({
                      where: { userId: targetUserId },
                      take, orderBy: { id: 'asc' },
                      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                    })) as Promise<Array<Record<string, unknown> & { id: string }>>],
                  ['PRODUCTS', (cursor, take) =>
                    withNeonRetry(() => db.product.findMany({
                      where: { userId: targetUserId },
                      take, orderBy: { id: 'asc' },
                      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                    })) as Promise<Array<Record<string, unknown> & { id: string }>>],
                  ['PARTIES', (cursor, take) =>
                    withNeonRetry(() => db.party.findMany({
                      where: { userId: targetUserId },
                      take, orderBy: { id: 'asc' },
                      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                    })) as Promise<Array<Record<string, unknown> & { id: string }>>],
                ]

                for (const [label, fetchBatch] of sections) {
                  // The count is not known up front any more — that was only
                  // possible because everything was in memory. It is reported
                  // after the section instead, which is the honest order.
                  write(`\n=== ${label} ===\n`)
                  let headerWritten = false

                  const count = await streamAllPaged(label.toLowerCase(), fetchBatch, batch => {
                    if (batch.length === 0) return
                    if (!headerWritten) {
                      write(csvRow(Object.keys(batch[0])))
                      headerWritten = true
                    }
                    // Built per batch rather than per row so the encoder is not
                    // called thousands of times for a few bytes each.
                    write(batch.map(r => csvRow(Object.values(r))).join(''))
                  })

                  write(`--- ${label} ROW COUNT: ${count} ---\n`)
                  streamedRows += count
                }

                // The marker that makes truncation detectable.
                write(`\n=== END OF EXPORT — ${streamedRows} ROWS TOTAL ===\n`)

                await db.dataExportRequest.update({
                  where: { id },
                  data: {
                    status: 'completed',
                    fileName: fName,
                    fileSizeBytes: streamedBytes,
                    rowCount: streamedRows,
                    completedAt: new Date(),
                  },
                })

                await logAdminAction({
                  adminId: ctx.adminId,
                  action: 'data_export_complete',
                  description: `Generated ${exportReq.type} export: ${fName} (${streamedRows} rows, ${(streamedBytes / 1024).toFixed(1)} KB, streamed)`,
                  targetType: 'data_export',
                  targetId: id,
                })

                controller.close()
              } catch (err) {
                // Mark failed, then abort the body so the operator cannot mistake
                // a partial file for a finished one.
                try {
                  await db.dataExportRequest.update({
                    where: { id },
                    data: {
                      status: 'failed',
                      errorMessage: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
                    },
                  })
                } catch (recordErr) {
                  // The export has already failed. Failing to RECORD that must
                  // not mask the original error, which is about to reach the
                  // client via controller.error() — but it must still be
                  // visible, or the request is left stuck on "processing" with
                  // no explanation anywhere.
                  console.error('[data-export] could not mark export failed:', recordErr)
                }
                controller.error(err)
              }
            },
          })

          return new NextResponse(stream, {
            headers: {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="${fName}"`,
              // Streamed: length is unknown until the last row is read.
              'Cache-Control': 'no-store',
            },
          })
        }

        // NOTE on the bulk exports below (audit 2026-07-26): each applied a
        // `take` limit and then set `truncated: false` LITERALLY in the result.
        // The export asserted it was complete while being truncated, and the
        // CSV header rendered from that flag. fetchWithTruncationFlag asks for
        // limit+1 rows and reports what it actually found.
        //
        // The `.catch(() => [])` wrappers are also gone: a failed query used to
        // produce an empty export that looked like "there is no data".
        case 'all_users': {
          const { rows: users, truncated } = await fetchWithTruncationFlag(
            (take) =>
              withNeonRetry(() =>
                db.user.findMany({
                  select: { id: true, email: true, name: true, phone: true, plan: true, createdAt: true, updatedAt: true },
                  take,
                  orderBy: { id: 'asc' },
                }),
              ),
            BULK_EXPORT_LIMIT,
          )
          const result = { columns: ['id', 'email', 'name', 'phone', 'plan', 'createdAt', 'updatedAt'], rows: users.map((u: any) => [u.id, u.email, u.name, u.phone, u.plan, u.createdAt?.toISOString(), u.updatedAt?.toISOString()]), rowCount: users.length, truncated, durationMs: 0 }
          csvContent = exportToCsv(result)
          rowCount = users.length
          fileName = `all_users_${new Date().toISOString().slice(0, 10)}.csv`
          break
        }

        case 'transactions': {
          const { rows: txns, truncated } = await fetchWithTruncationFlag(
            (take) =>
              withNeonRetry(() =>
                db.transaction.findMany({
                  select: { id: true, userId: true, type: true, totalAmount: true, paidAmount: true, date: true, createdAt: true },
                  take,
                  orderBy: { createdAt: 'desc' },
                }),
              ),
            BULK_EXPORT_LIMIT,
          )
          const result = { columns: ['id', 'userId', 'type', 'totalAmount', 'paidAmount', 'date', 'createdAt'], rows: txns.map((t: any) => [t.id, t.userId, t.type, t.totalAmount, t.paidAmount, t.date?.toISOString(), t.createdAt?.toISOString()]), rowCount: txns.length, truncated, durationMs: 0 }
          csvContent = exportToCsv(result)
          rowCount = txns.length
          fileName = `transactions_${new Date().toISOString().slice(0, 10)}.csv`
          break
        }

        case 'subscriptions': {
          const { rows: subs, truncated } = await fetchWithTruncationFlag(
            (take) =>
              withNeonRetry(() =>
                db.subscription.findMany({ take, orderBy: { createdAt: 'desc' } }),
              ),
            BULK_EXPORT_LIMIT,
          )
          if (subs.length > 0) {
            const result = { columns: Object.keys(subs[0]), rows: subs.map((s: any) => Object.values(s).map((v: any) => String(v ?? ''))), rowCount: subs.length, truncated, durationMs: 0 }
            csvContent = exportToCsv(result)
          }
          rowCount = subs.length
          fileName = `subscriptions_${new Date().toISOString().slice(0, 10)}.csv`
          break
        }

        case 'ai_usage': {
          const { rows: logs, truncated } = await fetchWithTruncationFlag(
            (take) =>
              withNeonRetry(() =>
                db.aiUsageLog.findMany({ take, orderBy: { createdAt: 'desc' } }),
              ),
            BULK_EXPORT_LIMIT,
          )
          if (logs.length > 0) {
            const result = { columns: Object.keys(logs[0]), rows: logs.map((l: any) => Object.values(l).map((v: any) => String(v ?? ''))), rowCount: logs.length, truncated, durationMs: 0 }
            csvContent = exportToCsv(result)
          }
          rowCount = logs.length
          fileName = `ai_usage_${new Date().toISOString().slice(0, 10)}.csv`
          break
        }

        case 'custom': {
          const validation = validateQuery(exportReq.customQuery!)
          if (!validation.valid) throw new Error(validation.error)
          const result = await executeSafeQuery(exportReq.customQuery!)
          csvContent = exportToCsv(result)
          rowCount = result.rowCount
          fileName = `custom_export_${new Date().toISOString().slice(0, 10)}.csv`
          break
        }

        default:
          throw new Error(`Unknown export type: ${exportReq.type}`)
      }

      // Store the CSV content in the database (as the file name, content is returned via download endpoint)
      // In production, this would be stored in S3/Vercel Blob. For now, we store metadata only.
      const fileSizeBytes = Buffer.byteLength(csvContent, 'utf-8')

      await db.dataExportRequest.update({
        where: { id },
        data: {
          status: 'completed',
          fileName,
          fileSizeBytes,
          rowCount,
          completedAt: new Date(),
        },
      })

      await logAdminAction({
        adminId: ctx.adminId,
        action: 'data_export_complete',
        description: `Generated ${exportReq.type} export: ${fileName} (${rowCount} rows, ${(fileSizeBytes / 1024).toFixed(1)} KB)`,
        targetType: 'data_export',
        targetId: id,
      })

      // Return the CSV content for direct download
      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        },
      })
    } catch (error) {
      await db.dataExportRequest.update({
        where: { id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        },
      })
      throw error
    }
  } catch (error) {
    console.error('Export generation error:', error)
    return NextResponse.json({
      success: false,
      error: 'Export generation failed',
    }, { status: 500 })
  }
},
)
