import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withNeonRetry, withTimeout } from '@/lib/resilience'
import { validateQuery, executeSafeQuery, exportToCsv } from '@/lib/database-admin'
import { logAdminAction } from '@/lib/audit'

/**
 * POST /api/admin/data-exports/generate
 *
 * Processes a pending export request — fetches data, generates CSV/JSON,
 * updates the request with file info.
 *
 * Body: { id: exportRequestId }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'Export ID required' }, { status: 400 })

    const exportReq = await withTimeout(db.dataExportRequest.findUnique({ where: { id } }), 5000)
    if (!exportReq) return NextResponse.json({ error: 'Export not found' }, { status: 404 })
    if (exportReq.status !== 'pending') return NextResponse.json({ error: 'Export already processed' }, { status: 400 })

    // Mark as processing
    await db.dataExportRequest.update({ where: { id }, data: { status: 'processing', processedBy: (session.user as any).id } })

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
          const [transactions, products, parties] = await Promise.all([
            withNeonRetry(() => db.transaction.findMany({ where: { userId: targetUserId }, take: 1000 })).catch(() => []),
            withNeonRetry(() => db.product.findMany({ where: { userId: targetUserId }, take: 1000 })).catch(() => []),
            withNeonRetry(() => db.party.findMany({ where: { userId: targetUserId }, take: 1000 })).catch(() => []),
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

        case 'all_users': {
          const users = await withNeonRetry(() =>
            db.user.findMany({ select: { id: true, email: true, name: true, phone: true, plan: true, createdAt: true, updatedAt: true }, take: 10000 })
          ).catch(() => [])
          const result = { columns: ['id', 'email', 'name', 'phone', 'plan', 'createdAt', 'updatedAt'], rows: users.map((u: any) => [u.id, u.email, u.name, u.phone, u.plan, u.createdAt?.toISOString(), u.updatedAt?.toISOString()]), rowCount: users.length, truncated: false, durationMs: 0 }
          csvContent = exportToCsv(result)
          rowCount = users.length
          fileName = `all_users_${new Date().toISOString().slice(0, 10)}.csv`
          break
        }

        case 'transactions': {
          const txns = await withNeonRetry(() =>
            db.transaction.findMany({ select: { id: true, userId: true, type: true, totalAmount: true, paidAmount: true, date: true, createdAt: true }, take: 10000, orderBy: { createdAt: 'desc' } })
          ).catch(() => [])
          const result = { columns: ['id', 'userId', 'type', 'totalAmount', 'paidAmount', 'date', 'createdAt'], rows: txns.map((t: any) => [t.id, t.userId, t.type, t.totalAmount, t.paidAmount, t.date?.toISOString(), t.createdAt?.toISOString()]), rowCount: txns.length, truncated: false, durationMs: 0 }
          csvContent = exportToCsv(result)
          rowCount = txns.length
          fileName = `transactions_${new Date().toISOString().slice(0, 10)}.csv`
          break
        }

        case 'subscriptions': {
          const subs = await withNeonRetry(() =>
            db.subscription.findMany({ take: 10000, orderBy: { createdAt: 'desc' } })
          ).catch(() => [])
          if (subs.length > 0) {
            const result = { columns: Object.keys(subs[0]), rows: subs.map((s: any) => Object.values(s).map((v: any) => String(v ?? ''))), rowCount: subs.length, truncated: false, durationMs: 0 }
            csvContent = exportToCsv(result)
          }
          rowCount = subs.length
          fileName = `subscriptions_${new Date().toISOString().slice(0, 10)}.csv`
          break
        }

        case 'ai_usage': {
          const logs = await withNeonRetry(() =>
            db.aiUsageLog.findMany({ take: 10000, orderBy: { createdAt: 'desc' } })
          ).catch(() => [])
          if (logs.length > 0) {
            const result = { columns: Object.keys(logs[0]), rows: logs.map((l: any) => Object.values(l).map((v: any) => String(v ?? ''))), rowCount: logs.length, truncated: false, durationMs: 0 }
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
        adminId: (session.user as any).id,
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
      detail: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    }, { status: 500 })
  }
}
