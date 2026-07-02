import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'
import { serializeScopes, VALID_SCOPES } from '@/lib/api-key-utils'

/**
 * GET /api/admin/api-keys/[id]
 * Returns a single API key (without rawKey — only stored as hash).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const apiKey = await withTimeout(
      db.apiKey.findUnique({
        where: { id },
        include: { partner: { select: { id: true, name: true, type: true } } },
      }),
      5000
    ).catch(() => null)

    if (!apiKey) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      apiKey: {
        ...apiKey,
        scopes: (() => {
          try { return JSON.parse(apiKey.scopes) } catch { return [] }
        })(),
        expiresAt: apiKey.expiresAt?.toISOString() || null,
        lastUsedAt: apiKey.lastUsedAt?.toISOString() || null,
        createdAt: apiKey.createdAt.toISOString(),
        updatedAt: apiKey.updatedAt.toISOString(),
        // NEVER include keyHash or rawKey in response
        keyHash: undefined,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch API key' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/api-keys/[id]
 * Update API key (name, scopes, status, expiresAt).
 * Cannot change the keyHash (to rotate, revoke + create new).
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
    const { name, scopes, status, expiresAt } = body

    const existing = await db.apiKey.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }

    // Validate scopes if provided
    if (scopes !== undefined) {
      if (!Array.isArray(scopes) || scopes.length === 0) {
        return NextResponse.json({ error: 'At least 1 scope is required' }, { status: 400 })
      }
      const invalidScopes = scopes.filter((s: string) => !VALID_SCOPES.includes(s))
      if (invalidScopes.length > 0) {
        return NextResponse.json({ error: `Invalid scopes: ${invalidScopes.join(', ')}` }, { status: 400 })
      }
    }

    const updated = await db.apiKey.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(scopes !== undefined && { scopes: serializeScopes(scopes) }),
        ...(status !== undefined && { status }),
        ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
      },
    })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'api_key_update',
      description: `Updated API key "${existing.name}" (prefix: ${existing.keyPrefix}...)`,
      targetType: 'api_key',
      targetId: id,
    })

    return NextResponse.json({ success: true, apiKey: updated })
  } catch (error) {
    console.error('Update API key error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to update API key',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/api-keys/[id]
 * Hard delete (use PATCH status=revoked for soft delete instead).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const existing = await db.apiKey.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }

    await db.apiKey.delete({ where: { id } })

    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'api_key_delete',
      description: `Deleted API key "${existing.name}" (prefix: ${existing.keyPrefix}...)`,
      targetType: 'api_key',
      targetId: id,
    })

    return NextResponse.json({ success: true, message: 'API key deleted' })
  } catch (error) {
    console.error('Delete API key error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to delete API key',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
