import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'

/**
 * GET /api/admin/incidents
 *
 * Returns incident analytics + paginated list.
 *
 * Query params:
 *   - tab: 'overview' | 'list' (default: 'overview')
 *   - status: 'all' | 'investigating' | 'identified' | 'monitoring' | 'resolved'
 *   - severity: 'all' | 'minor' | 'major' | 'critical' | 'maintenance'
 *   - page: number (default 1)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const status = url.searchParams.get('status') || 'all'
    const severity = url.searchParams.get('severity') || 'all'
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = 20

    // ============ OVERVIEW TAB ============
    if (tab === 'overview') {
      const [activeCount, resolvedCount, criticalCount, maintenanceCount, recent7d] = await Promise.all([
        withTimeout(
          db.incident.count({ where: { status: { not: 'resolved' } } }),
          5000
        ).catch(() => 0),
        withTimeout(db.incident.count({ where: { status: 'resolved' } }), 5000).catch(() => 0),
        withTimeout(
          db.incident.count({ where: { severity: 'critical', status: { not: 'resolved' } } }),
          5000
        ).catch(() => 0),
        withTimeout(
          db.incident.count({ where: { severity: 'maintenance', status: { not: 'resolved' } } }),
          5000
        ).catch(() => 0),
        withTimeout(
          db.incident.count({
            where: { startedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
          }),
          5000
        ).catch(() => 0),
      ])

      return NextResponse.json({
        success: true,
        overview: {
          activeCount,
          resolvedCount,
          criticalCount,
          maintenanceCount,
          recent7d,
          totalCount: activeCount + resolvedCount,
        },
      })
    }

    // ============ LIST TAB ============
    const skip = (page - 1) * pageSize

    const where: any = {}
    if (status !== 'all') where.status = status
    if (severity !== 'all') where.severity = severity

    const [incidents, total] = await Promise.all([
      withTimeout(
        db.incident.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          skip,
          take: pageSize,
          include: {
            _count: { select: { updates: true } },
          },
        }),
        5000
      ).catch(() => []),
      withTimeout(db.incident.count({ where }), 5000).catch(() => 0),
    ])

    return NextResponse.json({
      success: true,
      incidents: (incidents as any[]).map((i: any) => ({
        id: i.id,
        title: i.title,
        description: i.description,
        severity: i.severity,
        status: i.status,
        service: i.service,
        startedAt: i.startedAt.toISOString(),
        resolvedAt: i.resolvedAt?.toISOString() || null,
        updateCount: i._count?.updates || 0,
        createdAt: i.createdAt.toISOString(),
        updatedAt: i.updatedAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    console.error('Incidents fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch incidents',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

/**
 * POST /api/admin/incidents
 * Create a new incident.
 *
 * Body:
 *   - title: string (required)
 *   - description: string (required)
 *   - severity: 'minor' | 'major' | 'critical' | 'maintenance' (default: minor)
 *   - status: 'investigating' | 'identified' | 'monitoring' | 'resolved' (default: investigating)
 *   - service: 'api' | 'database' | 'ai_providers' | 'payments' | 'all' (default: all)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { title, description, severity, status, service } = body

    if (!title || !description) {
      return NextResponse.json({ error: 'Title and description are required' }, { status: 400 })
    }

    const validSeverities = ['minor', 'major', 'critical', 'maintenance']
    const validStatuses = ['investigating', 'identified', 'monitoring', 'resolved']
    const validServices = ['api', 'database', 'ai_providers', 'payments', 'all']

    if (severity && !validSeverities.includes(severity)) {
      return NextResponse.json({ error: 'Invalid severity' }, { status: 400 })
    }
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    if (service && !validServices.includes(service)) {
      return NextResponse.json({ error: 'Invalid service' }, { status: 400 })
    }

    const incident = await db.incident.create({
      data: {
        title,
        description,
        severity: severity || 'minor',
        status: status || 'investigating',
        service: service || 'all',
        resolvedAt: status === 'resolved' ? new Date() : null,
        createdBy: (session.user as any).id,
        updates: {
          create: {
            message: description,
            status: status || 'investigating',
            createdBy: (session.user as any).id,
          },
        },
      },
      include: { updates: true },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'incident_create',
      description: `Created incident "${title}" (severity: ${severity || 'minor'}, service: ${service || 'all'})`,
      targetType: 'incident',
      targetId: incident.id,
    })

    return NextResponse.json({ success: true, incident })
  } catch (error) {
    console.error('Create incident error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to create incident',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
