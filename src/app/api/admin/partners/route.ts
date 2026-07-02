import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/partners
 *
 * Returns partner analytics + paginated list.
 *
 * Query params:
 *   - tab: 'overview' | 'list' (default: 'overview')
 *   - type: 'all' | 'nbfc' | 'fmcg' | 'fintech' | 'other'
 *   - status: 'all' | 'onboarding' | 'active' | 'inactive' | 'terminated'
 *   - search: string (search by name, contactName, contactEmail)
 *   - page: number (default 1)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const type = url.searchParams.get('type') || 'all'
    const status = url.searchParams.get('status') || 'all'
    const search = url.searchParams.get('search') || ''
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = 20

    // ============ OVERVIEW TAB ============
    if (tab === 'overview') {
      const [activeCount, onboardingCount, inactiveCount, terminatedCount, totalLeads, totalRevenue, typeDist] = await Promise.all([
        withTimeout(db.partner.count({ where: { status: 'active' } }), 5000).catch(() => 0),
        withTimeout(db.partner.count({ where: { status: 'onboarding' } }), 5000).catch(() => 0),
        withTimeout(db.partner.count({ where: { status: 'inactive' } }), 5000).catch(() => 0),
        withTimeout(db.partner.count({ where: { status: 'terminated' } }), 5000).catch(() => 0),
        withTimeout(db.partner.aggregate({ _sum: { totalLeadsSent: true } }), 5000).catch(() => ({ _sum: { totalLeadsSent: 0 } })),
        withTimeout(db.partner.aggregate({ _sum: { totalRevenueShared: true } }), 5000).catch(() => ({ _sum: { totalRevenueShared: 0 } })),
        withTimeout(
          db.partner.groupBy({
            by: ['type'],
            where: { status: 'active' },
            _count: true,
            _sum: { totalLeadsSent: true, totalRevenueShared: true },
          }),
          5000
        ).catch(() => []),
      ])

      const typeMap: Record<string, { count: number; leads: number; revenue: number }> = {
        nbfc: { count: 0, leads: 0, revenue: 0 },
        fmcg: { count: 0, leads: 0, revenue: 0 },
        fintech: { count: 0, leads: 0, revenue: 0 },
        other: { count: 0, leads: 0, revenue: 0 },
      }
      for (const t of typeDist as any[]) {
        if (typeMap[t.type]) {
          typeMap[t.type] = {
            count: t._count,
            leads: t._sum.totalLeadsSent || 0,
            revenue: t._sum.totalRevenueShared || 0,
          }
        }
      }

      return NextResponse.json({
        success: true,
        overview: {
          activeCount,
          onboardingCount,
          inactiveCount,
          terminatedCount,
          totalLeadsSent: totalLeads._sum.totalLeadsSent || 0,
          totalRevenueShared: totalRevenue._sum.totalRevenueShared || 0,
        },
        typeDistribution: typeMap,
      })
    }

    // ============ LIST TAB ============
    const skip = (page - 1) * pageSize

    const where: any = {}
    if (type !== 'all') where.type = type
    if (status !== 'all') where.status = status
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { contactName: { contains: search, mode: 'insensitive' } },
        { contactEmail: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [partners, total] = await Promise.all([
      withTimeout(
        db.partner.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
        }),
        5000
      ).catch(() => []),
      withTimeout(db.partner.count({ where }), 5000).catch(() => 0),
    ])

    return NextResponse.json({
      success: true,
      partners: (partners as any[]).map((p: any) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        status: p.status,
        contactName: p.contactName,
        contactEmail: p.contactEmail,
        contactPhone: p.contactPhone,
        website: p.website,
        apiBaseUrl: p.apiBaseUrl,
        webhookUrl: p.webhookUrl,
        revenueSharePct: p.revenueSharePct,
        totalLeadsSent: p.totalLeadsSent,
        totalRevenueShared: p.totalRevenueShared,
        contractStartAt: p.contractStartAt?.toISOString() || null,
        contractEndAt: p.contractEndAt?.toISOString() || null,
        notes: p.notes,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    console.error('Partners fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch partners',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

/**
 * POST /api/admin/partners
 * Create a new partner.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const {
      name, type, status, contactName, contactEmail, contactPhone, website,
      apiBaseUrl, webhookUrl, revenueSharePct, contractStartAt, contractEndAt, notes,
    } = body

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const validTypes = ['nbfc', 'fmcg', 'fintech', 'other']
    if (type && !validTypes.includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    const validStatuses = ['onboarding', 'active', 'inactive', 'terminated']
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const partner = await db.partner.create({
      data: {
        name: name.trim(),
        type: type || 'nbfc',
        status: status || 'onboarding',
        contactName: contactName || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        website: website || null,
        apiBaseUrl: apiBaseUrl || null,
        webhookUrl: webhookUrl || null,
        revenueSharePct: parseFloat(revenueSharePct) || 0,
        contractStartAt: contractStartAt ? new Date(contractStartAt) : null,
        contractEndAt: contractEndAt ? new Date(contractEndAt) : null,
        notes: notes || null,
        createdBy: (session.user as any).id,
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'partner_create',
      description: `Created partner "${name}" (${type || 'nbfc'}, status: ${status || 'onboarding'})`,
      targetType: 'partner',
      targetId: partner.id,
    })

    return NextResponse.json({ success: true, partner })
  } catch (error) {
    console.error('Create partner error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to create partner',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
