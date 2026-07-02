import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'
import { getExperimentResults } from '@/lib/ab-testing'

/**
 * GET /api/admin/experiments/[id]
 * Returns a single experiment with full results.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const experiment = await withTimeout(
      db.experiment.findUnique({
        where: { id },
        include: {
          _count: { select: { assignments: true } },
        },
      }),
      5000
    ).catch(() => null)

    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 })
    }

    let variants: any[] = []
    try { variants = JSON.parse(experiment.variants) } catch {}

    const results = await getExperimentResults(id).catch(() => null)

    return NextResponse.json({
      success: true,
      experiment: {
        ...experiment,
        variants,
        startAt: experiment.startAt?.toISOString() || null,
        endAt: experiment.endAt?.toISOString() || null,
        createdAt: experiment.createdAt.toISOString(),
        updatedAt: experiment.updatedAt.toISOString(),
        assignmentCount: experiment._count?.assignments || 0,
        results,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch experiment' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/experiments/[id]
 * Update experiment (status changes, conclusion, end date).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await req.json()
    const { name, description, status, trafficPct, startAt, endAt, winnerVariant, conclusion } = body

    const existing = await db.experiment.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 })
    }

    // If completing, auto-determine winner if not provided
    let finalWinner = winnerVariant
    if (status === 'completed' && !finalWinner) {
      const results = await getExperimentResults(id).catch(() => null)
      if (results?.winnerVariant) {
        finalWinner = results.winnerVariant
      }
    }

    const updated = await db.experiment.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(trafficPct !== undefined && { trafficPct }),
        ...(startAt !== undefined && { startAt: startAt ? new Date(startAt) : null }),
        ...(endAt !== undefined && { endAt: endAt ? new Date(endAt) : null }),
        ...(finalWinner !== undefined && { winnerVariant: finalWinner }),
        ...(conclusion !== undefined && { conclusion }),
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'experiment_update',
      description: `Updated experiment "${existing.name}" — status: ${status || existing.status}${finalWinner ? `, winner: ${finalWinner}` : ''}`,
      targetType: 'experiment',
      targetId: id,
    })

    return NextResponse.json({ success: true, experiment: updated })
  } catch (error) {
    console.error('Update experiment error:', error)
    return NextResponse.json({ error: 'Failed to update experiment' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/experiments/[id]
 * Hard delete (cascade assignments).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const existing = await db.experiment.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 })
    }

    await db.experiment.delete({ where: { id } })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'experiment_delete',
      description: `Deleted experiment "${existing.name}"`,
      targetType: 'experiment',
      targetId: id,
    })

    return NextResponse.json({ success: true, message: 'Experiment deleted' })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete experiment' }, { status: 500 })
  }
}
