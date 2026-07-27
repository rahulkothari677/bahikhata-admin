import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'
import { serializeScopes, VALID_SCOPES } from '@/lib/api-key-utils'

/**
 * GET /api/admin/api-keys/[id]
 * Returns a single API key (without rawKey — only stored as hash).
 */
export const GET = withAdmin(
  'admin/api-keys/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const apiKey = await withTimeout(
      db.apiKey.findUnique({
        where: { id },
        // NOTE: Partner model deleted with the lending pipeline — no relation to include.
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
},
)

/**
 * PATCH /api/admin/api-keys/[id]
 * Update API key (name, scopes, status, expiresAt).
 * Cannot change the keyHash (to rotate, revoke + create new).
 */
export const PATCH = withAdmin(
  'admin/api-keys/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
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
      adminId: ctx.adminId,
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
      error: 'Failed to update API key',    }, { status: 500 })
  }
},
)

/**
 * DELETE /api/admin/api-keys/[id]
 * Hard delete (use PATCH status=revoked for soft delete instead).
 */
export const DELETE = withAdmin(
  'admin/api-keys/[id]',
  async (req: NextRequest, ctx, { params }) => {
  try {
    const { id } = await params
    const existing = await db.apiKey.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }

    await db.apiKey.delete({ where: { id } })

    await logAdminAction({
      adminId: ctx.adminId,
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
      error: 'Failed to delete API key',    }, { status: 500 })
  }
},
)
