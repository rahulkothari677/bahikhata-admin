import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withNeonRetry, withTimeout } from '@/lib/resilience'
import { validateQuery, executeSafeQuery, exportToCsv } from '@/lib/database-admin'
import { logAdminAction } from '@/lib/audit'
import { fetchAllPaged, fetchWithTruncationFlag } from '@/lib/export-pagination'

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
          const user = await withNeonRetry(() =>
            db.user.findUnique({
              where: { id: exportReq.userId! },
              select: { id: true, email: true, name: true, phone: true, plan: true, createdAt: true, updatedAt: true },
            })
          ).catch(() => null)

          if (!user) throw new Error('User not found')

          const targetUserId = exportReq.userId!

          // 🔴 DPDP s.11 (audit 2026-07-26). This previously read:
          //     findMany({ where: { userId }, take: 1000 }).catch(() => [])
          // Two separate legal defects in one line. `take: 1000` silently
          // truncated — a shopkeeper with 4,000 transactions received 1,000
          // with no indication the rest existed. And `.catch(() => [])` meant
          // a failed query produced an export MISSING that section entirely,
          // indistinguishable from "this user has no transactions".
          //
          // A subject access request must return ALL of the Data Principal's
          // data, or fail loudly. It must never quietly be neither. Failures
          // now propagate to the catch below, which marks the request `failed`
          // rather than delivering a partial document that looks complete.
          const [transactions, products, parties] = await Promise.all([
            fetchAllPaged('transactions', (cursor, take) =>
              withNeonRetry(() =>
                db.transaction.findMany({
                  where: { userId: targetUserId },
                  take,
                  orderBy: { id: 'asc' },
                  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                }),
              ),
            ),
            fetchAllPaged('products', (cursor, take) =>
              withNeonRetry(() =>
                db.product.findMany({
                  where: { userId: targetUserId },
                  take,
                  orderBy: { id: 'asc' },
                  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                }),
              ),
            ),
            fetchAllPaged('parties', (cursor, take) =>
              withNeonRetry(() =>
                db.party.findMany({
                  where: { userId: targetUserId },
                  take,
                  orderBy: { id: 'asc' },
                  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                }),
              ),
            ),
          ])

          // Build CSV: user profile + sections
          csvContent = '=== USER PROFILE ===\n'
          csvContent += Object.keys(user).join(',') + '\n'
          csvContent += Object.values(user).map((v: any) => String(v || '')).join(',') + '\n\n'
          csvContent += `=== TRANSACTIONS (${transactions.length}) ===\n`
          if (transactions.length > 0) {
            csvContent += Object.keys(transactions[0]).join(',') + '\n'
            for (const t of transactions) csvContent += Object.values(t).map((v: any) => String(v || '')).join(',') + '\n'
          }
          csvContent += `\n=== PRODUCTS (${products.length}) ===\n`
          if (products.length > 0) {
            csvContent += Object.keys(products[0]).join(',') + '\n'
            for (const p of products) csvContent += Object.values(p).map((v: any) => String(v || '')).join(',') + '\n'
          }
          csvContent += `\n=== PARTIES (${parties.length}) ===\n`
          if (parties.length > 0) {
            csvContent += Object.keys(parties[0]).join(',') + '\n'
            for (const p of parties) csvContent += Object.values(p).map((v: any) => String(v || '')).join(',') + '\n'
          }

          rowCount = 1 + transactions.length + products.length + parties.length
          fileName = `user_data_${exportReq.userId!.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.csv`
          break
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
      error: 'Export generation failed',    }, { status: 500 })
  }
},
)
