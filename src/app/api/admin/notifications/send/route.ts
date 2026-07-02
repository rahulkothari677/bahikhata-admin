import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'
import { sendNotification, substituteVariables, type Channel } from '@/lib/notification-providers'
import { logAdminAction } from '@/lib/audit'

/**
 * POST /api/admin/notifications/send
 *
 * Sends a notification (SMS/Email/Push) to one or more users.
 *
 * Modes:
 *   1. Template-based: provide templateId + recipients (userIds)
 *      Variables are auto-substituted from user data (name, email, plan, etc.)
 *   2. Direct: provide channel + subject + body + recipients (raw addresses)
 *
 * Body:
 *   - mode: 'template' | 'direct'
 *   - templateId: string (required if mode=template)
 *   - channel: 'sms' | 'email' | 'push' (required if mode=direct)
 *   - subject: string (required if mode=direct AND channel=email)
 *   - body: string (required if mode=direct)
 *   - userIds: string[] (required if mode=template — array of user IDs)
 *   - recipients: string[] (required if mode=direct — raw phone/email/token)
 *   - customVariables: Record<string, string> (optional — overrides auto-substituted values)
 *
 * Returns:
 *   - totalSent: number of successful sends
 *   - totalFailed: number of failed sends
 *   - totalSkipped: number of dry-run skips (no provider configured)
 *   - results: per-recipient breakdown
 *
 * Rate limit: max 1000 recipients per request (prevents accidental mass send)
 */
const MAX_RECIPIENTS = 1000

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const {
      mode,
      templateId,
      channel,
      subject,
      body: rawBody,
      userIds,
      recipients,
      customVariables,
    } = body

    // ============ VALIDATE ============
    if (mode === 'template') {
      if (!templateId) {
        return NextResponse.json({ error: 'templateId is required for template mode' }, { status: 400 })
      }
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return NextResponse.json({ error: 'userIds must be a non-empty array' }, { status: 400 })
      }
    } else if (mode === 'direct') {
      if (!channel || !['sms', 'email', 'push'].includes(channel)) {
        return NextResponse.json({ error: 'Valid channel required for direct mode' }, { status: 400 })
      }
      if (!rawBody) {
        return NextResponse.json({ error: 'body is required for direct mode' }, { status: 400 })
      }
      if (channel === 'email' && !subject) {
        return NextResponse.json({ error: 'subject is required for email channel' }, { status: 400 })
      }
      if (!Array.isArray(recipients) || recipients.length === 0) {
        return NextResponse.json({ error: 'recipients must be a non-empty array' }, { status: 400 })
      }
    } else {
      return NextResponse.json({ error: 'mode must be "template" or "direct"' }, { status: 400 })
    }

    // ============ LOAD TEMPLATE (if template mode) ============
    let template: any = null
    let finalChannel: Channel
    let finalSubject: string | null = null
    let finalBody: string
    let category = 'general'

    if (mode === 'template') {
      template = await withTimeout(
        db.notificationTemplate.findUnique({ where: { id: templateId } }),
        5000
      ).catch(() => null)

      if (!template) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
      }

      if (template.status !== 'active') {
        return NextResponse.json({
          error: `Template is ${template.status} — must be active to send`,
        }, { status: 400 })
      }

      finalChannel = template.channel as Channel
      finalSubject = template.subject
      finalBody = template.body
      category = template.category
    } else {
      finalChannel = channel as Channel
      finalSubject = subject || null
      finalBody = rawBody
    }

    // ============ BUILD RECIPIENT LIST ============
    // Each recipient: { address, userId, variables }
    interface Recipient {
      address: string
      userId: string | null
      variables: Record<string, string>
    }

    let recipientList: Recipient[] = []

    if (mode === 'template') {
      // Cap recipients to prevent accidental mass send
      if (userIds.length > MAX_RECIPIENTS) {
        return NextResponse.json({
          error: `Too many recipients: ${userIds.length}. Max ${MAX_RECIPIENTS} per send.`,
        }, { status: 400 })
      }

      // Fetch user data in chunks (avoid 1M-row IN clause)
      const CHUNK = 5000
      const users: any[] = []
      for (let i = 0; i < userIds.length; i += CHUNK) {
        const chunk = userIds.slice(i, i + CHUNK)
        const fetched = await withTimeout(
          db.user.findMany({
            where: { id: { in: chunk } },
            select: {
              id: true,
              email: true,
              name: true,
              phone: true,
              plan: true,
              createdAt: true,
            },
          }),
          5000
        ).catch(() => [])
        users.push(...fetched)
      }

      for (const user of users) {
        // Determine address based on channel
        let address: string | null = null
        if (finalChannel === 'sms') address = user.phone
        else if (finalChannel === 'email') address = user.email
        else if (finalChannel === 'push') address = user.deviceToken || null // future field

        // Skip users without required contact info
        if (!address) continue

        // Build variables map
        const variables: Record<string, string> = {
          userName: user.name || 'User',
          userEmail: user.email,
          userPhone: user.phone || '',
          plan: user.plan,
          // Override with custom variables if provided
          ...(customVariables || {}),
        }

        recipientList.push({ address, userId: user.id, variables })
      }
    } else {
      // Direct mode — recipients are raw addresses
      if (recipients.length > MAX_RECIPIENTS) {
        return NextResponse.json({
          error: `Too many recipients: ${recipients.length}. Max ${MAX_RECIPIENTS} per send.`,
        }, { status: 400 })
      }

      recipientList = recipients.map((r: string) => ({
        address: r,
        userId: null,
        variables: customVariables || {},
      }))
    }

    if (recipientList.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No valid recipients found. Users may be missing phone (SMS) or email or device token (Push).',
      }, { status: 400 })
    }

    // ============ SEND TO ALL RECIPIENTS ============
    // Sequential (not parallel) to avoid rate-limit bans from providers.
    // At 1000 recipients × 200ms each = ~3 minutes max.
    // For production scale, move this to a background job queue.
    const results: Array<{
      recipient: string
      userId: string | null
      status: 'sent' | 'failed' | 'skipped'
      provider: string
      error?: string
    }> = []

    let totalSent = 0
    let totalFailed = 0
    let totalSkipped = 0

    for (const r of recipientList) {
      // Substitute variables in body
      const substitutedBody = substituteVariables(finalBody, r.variables)
      const substitutedSubject = finalSubject
        ? substituteVariables(finalSubject, r.variables)
        : null

      // Send via provider
      const sendResult = await sendNotification({
        to: r.address,
        channel: finalChannel,
        subject: substitutedSubject || undefined,
        body: substitutedBody,
      })

      // Determine status
      let status: 'sent' | 'failed' | 'skipped'
      if (sendResult.success) {
        status = 'sent'
        totalSent++
      } else if (sendResult.provider === 'dry-run') {
        status = 'skipped'
        totalSkipped++
      } else {
        status = 'failed'
        totalFailed++
      }

      // Log to NotificationLog (always — even failures, for audit)
      try {
        await db.notificationLog.create({
          data: {
            userId: r.userId,
            recipient: r.address,
            templateId: template?.id || null,
            templateName: template?.name || null,
            channel: finalChannel,
            subject: substitutedSubject,
            body: substitutedBody,
            status,
            provider: sendResult.provider,
            providerMessageId: sendResult.providerMessageId || null,
            errorMessage: sendResult.error || null,
            sentBy: (session.user as any).id,
            category,
          },
        })
      } catch (logErr) {
        console.error('Failed to log notification:', logErr)
        // Don't fail the send just because logging failed
      }

      results.push({
        recipient: r.address,
        userId: r.userId,
        status,
        provider: sendResult.provider,
        error: sendResult.error,
      })
    }

    // ============ AUDIT LOG ============
    await logAdminAction({
      adminId: (session.user as any).id,
      action: 'notification_send',
      description: `Sent ${finalChannel} to ${recipientList.length} recipient(s) via ${mode} mode — sent:${totalSent} failed:${totalFailed} skipped:${totalSkipped}`,
      targetType: mode === 'template' ? 'notification_template' : 'notification_direct',
      targetId: template?.id || null,
      metadata: { totalSent, totalFailed, totalSkipped, channel: finalChannel, category },
    })

    return NextResponse.json({
      success: true,
      totalSent,
      totalFailed,
      totalSkipped,
      totalRecipients: recipientList.length,
      results: results.slice(0, 100), // cap results array (full log is in NotificationLog)
    })
  } catch (error) {
    console.error('Send notification error:', error)
    return NextResponse.json({
      success: false,
      error: 'Failed to send notifications',
      detail: String(error).slice(0, 300),
    }, { status: 500 })
  }
}
