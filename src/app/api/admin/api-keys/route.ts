import { NextRequest, NextResponse } from 'next/server'
import { assertPageDepth, PageTooDeepError } from '@/lib/pagination'
import { withAdmin } from '@/lib/with-admin'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { logAdminAction } from '@/lib/audit'
import { generateApiKey, serializeScopes, VALID_SCOPES, SCOPE_CONFIGS } from '@/lib/api-key-utils'

/**
 * GET /api/admin/api-keys
 *
 * Returns API key analytics + paginated list.
 * NOTE: Never returns the raw key (only stored as hash).
 *
 * Query params:
 *   - tab: 'overview' | 'list' (default: 'overview')
 *   - status: 'all' | 'active' | 'revoked' | 'expired'
 *   - partnerId: 'all' | specific partner ID
 *   - search: string (search by name or keyPrefix)
 *   - page: number (default 1)
 */
export const GET = withAdmin(
  'admin/api-keys',
  async (req: NextRequest, ctx) => {
  try {
    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const status = url.searchParams.get('status') || 'all'
    const partnerId = url.searchParams.get('partnerId') || 'all'
    const search = url.searchParams.get('search') || ''
    const page = assertPageDepth(url.searchParams.get('page'))
    const pageSize = 20

    // ============ OVERVIEW TAB ============
    if (tab === 'overview') {
      const [activeCount, revokedCount, expiredCount, totalUsage, partnerKeysCount, internalKeysCount] = await Promise.all([
        withTimeout(db.apiKey.count({ where: { status: 'active' } }), 5000).catch(ctx.degrade('apiKey.count', 0)),
        withTimeout(db.apiKey.count({ where: { status: 'revoked' } }), 5000).catch(ctx.degrade('apiKey.count', 0)),
        withTimeout(
          db.apiKey.count({
            where: {
              status: 'active',
              expiresAt: { lt: new Date() },
            },
          }),
          5000
        ).catch(ctx.degrade('apiKey.count', 0)),
        withTimeout(db.apiKey.aggregate({ _sum: { usageCount: true } }), 5000).catch(ctx.degrade('apiKey.aggregate', ({ _sum: { usageCount: 0 } }))),
        withTimeout(db.apiKey.count({ where: { partnerId: { not: null } } }), 5000).catch(ctx.degrade('apiKey.count', 0)),
        withTimeout(db.apiKey.count({ where: { partnerId: null } }), 5000).catch(ctx.degrade('apiKey.count', 0)),
      ])

      return NextResponse.json({
        success: true,
        overview: {
          activeCount,
          revokedCount,
          expiredCount,
          totalUsage: totalUsage._sum.usageCount || 0,
          partnerKeysCount,
          internalKeysCount,
          totalCount: activeCount + revokedCount,
        },
        scopeConfigs: SCOPE_CONFIGS,
      })
    }

    // ============ LIST TAB ============
    const skip = (page - 1) * pageSize

    const where: any = {}
    if (status !== 'all') where.status = status
    if (partnerId !== 'all') {
      where.partnerId = partnerId === 'internal' ? null : partnerId
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { keyPrefix: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [keys, total] = await Promise.all([
      withTimeout(
        db.apiKey.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          // NOTE: the Partner model was deleted with the lending pipeline.
          // partnerId is retained on ApiKey for backward compat, but there is
          // no relation to include. partnerName/partnerType below are always null.
        }),
        5000
      ).catch(ctx.degrade('apiKey.findMany', [])),
      withTimeout(db.apiKey.count({ where }), 5000).catch(ctx.degrade('apiKey.count', 0)),
    ])

    return NextResponse.json({
      success: true,
      apiKeys: (keys as any[]).map((k: any) => ({
        id: k.id,
        partnerId: k.partnerId,
        partnerName: k.partner?.name || null,
        partnerType: k.partner?.type || null,
        name: k.name,
        keyPrefix: k.keyPrefix,
        scopes: (() => {
          try { return JSON.parse(k.scopes) } catch { return [] }
        })(),
        status: k.status,
        expiresAt: k.expiresAt?.toISOString() || null,
        lastUsedAt: k.lastUsedAt?.toISOString() || null,
        usageCount: k.usageCount,
        createdAt: k.createdAt.toISOString(),
        updatedAt: k.updatedAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {

    // A page-depth refusal is a CLIENT error carrying a useful message.

    // Re-throw it so withAdmin returns a typed 400; otherwise this

    // handler flattens it into a generic "failed to fetch".

    if (error instanceof PageTooDeepError) throw error
    console.error('API keys fetch error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch API keys',    }, { status: 500 })
  }
},
)

/**
 * POST /api/admin/api-keys
 * Create a new API key.
 *
 * Body:
 *   - name: string (required)
 *   - partnerId: string (optional — null for internal keys)
 *   - scopes: string[] (required — array of scope keys)
 *   - expiresAt: ISO string (optional — null = never expires)
 *
 * Returns:
 *   - apiKey: the DB record (with keyHash, NOT rawKey)
 *   - rawKey: the FULL key — shown ONCE, admin must save it
 */
export const POST = withAdmin(
  'admin/api-keys',
  async (req: NextRequest, ctx) => {
  try {
    const body = await req.json()
    const { name, partnerId, scopes, expiresAt } = body

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    if (!Array.isArray(scopes) || scopes.length === 0) {
      return NextResponse.json({ error: 'At least 1 scope is required' }, { status: 400 })
    }

    // Validate scopes
    const invalidScopes = scopes.filter((s: string) => !VALID_SCOPES.includes(s))
    if (invalidScopes.length > 0) {
      return NextResponse.json({
        error: `Invalid scopes: ${invalidScopes.join(', ')}`,
        validScopes: VALID_SCOPES,
      }, { status: 400 })
    }

    // 🔒 AUDIT FIX: Partner model was deleted (lending pipeline removed).
    // Skip partner validation — partnerId is now optional/decorative.

    // Generate the key
    const { rawKey, keyHash, keyPrefix } = generateApiKey()

    // Save to DB (only hash + prefix, NEVER the raw key)
    const apiKey = await db.apiKey.create({
      data: {
        partnerId: partnerId || null,
        name: name.trim(),
        keyHash,
        keyPrefix,
        scopes: serializeScopes(scopes),
        status: 'active',
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy: ctx.adminId,
      },
    })

    await logAdminAction({
      adminId: ctx.adminId,
      action: 'api_key_create',
      description: `Created API key "${name}" (prefix: ${keyPrefix}..., scopes: ${scopes.join(', ')})`,
      targetType: 'api_key',
      targetId: apiKey.id,
    })

    // Return the raw key ONCE — admin must save it
    return NextResponse.json({
      success: true,
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        scopes,
        status: apiKey.status,
        expiresAt: apiKey.expiresAt?.toISOString() || null,
      },
      rawKey, // ⚠️ FULL KEY — shown only once, admin must save it
      warning: 'Save this key now — it will not be shown again.',
    })
  } catch (error) {
    console.error('Create API key error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to create API key',    }, { status: 500 })
  }
},
)
