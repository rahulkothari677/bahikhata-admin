/**
 * Webhook Delivery Engine — sends event notifications to partner webhook endpoints.
 *
 * HOW IT WORKS:
 *   1. When an event occurs (lead created, payment received, etc.), call dispatchEvent()
 *   2. For each active endpoint subscribed to that event, create a WebhookDelivery (status=pending)
 *   3. Attempt delivery: POST payload to endpoint URL with HMAC signature
 *   4. If response is 2xx → mark as success
 *   5. If response is non-2xx or network error → mark as retrying, schedule nextRetryAt
 *   6. Exponential backoff: 1min → 5min → 25min (3 max attempts)
 *   7. After max attempts → mark as failed
 *
 * HMAC SIGNATURE:
 *   Each request includes X-Webhook-Signature header = HMAC-SHA256(secret, payload)
 *   Partner verifies signature to ensure request came from us (not a spoof)
 *
 * EVENT TYPES:
 *   - lead.created: New credit-scored lead available
 *   - lead.updated: Lead status changed
 *   - payment.received: Subscription payment received
 *   - user.churned: User cancelled subscription
 *   - campaign.completed: Campaign finished all steps
 *   - anomaly.detected: Anomaly detected
 */

import crypto from 'crypto'
import { db } from '@/lib/db'
import { withTimeout } from '@/lib/resilience'

// =====================================================================
// EVENT TYPE DEFINITIONS
// =====================================================================

export interface EventConfig {
  key: string
  label: string
  description: string
}

export const EVENT_CONFIGS: EventConfig[] = [
  {
    key: 'lead.created',
    label: 'Lead Created',
    description: 'New credit-scored lead available for lending partners',
  },
  {
    key: 'lead.updated',
    label: 'Lead Updated',
    description: 'Lead status changed (e.g. user\'s credit score improved)',
  },
  {
    key: 'payment.received',
    label: 'Payment Received',
    description: 'Subscription payment received from a user',
  },
  {
    key: 'user.churned',
    label: 'User Churned',
    description: 'User cancelled their subscription',
  },
  {
    key: 'campaign.completed',
    label: 'Campaign Completed',
    description: 'A notification campaign finished sending all steps',
  },
  {
    key: 'anomaly.detected',
    label: 'Anomaly Detected',
    description: 'An anomaly was detected (high-priority partners only)',
  },
]

export const VALID_EVENTS = EVENT_CONFIGS.map(e => e.key)

// =====================================================================
// BACKOFF SCHEDULE (exponential)
// =====================================================================
// Attempt 1: immediate
// Attempt 2: 1 minute later
// Attempt 3: 5 minutes later
// Attempt 4: 25 minutes later (max 3 retries = 4 total attempts)
const BACKOFF_MINUTES = [0, 1, 5, 25]
const MAX_ATTEMPTS = 4

// =====================================================================
// HMAC SIGNATURE
// =====================================================================

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

// =====================================================================
// DISPATCH EVENT
// =====================================================================
// Creates WebhookDelivery records for all endpoints subscribed to the event.
// Does NOT send immediately — a background job (or manual trigger) sends them.
// This separation ensures the event source isn't blocked by slow endpoints.

export async function dispatchEvent(
  eventType: string,
  payload: any
): Promise<{ endpointsNotified: number; deliveryIds: string[] }> {
  if (!VALID_EVENTS.includes(eventType)) {
    throw new Error(`Invalid event type: ${eventType}`)
  }

  const payloadStr = JSON.stringify(payload)

  // Find all active endpoints subscribed to this event
  // We store events as JSON array, so we need to filter in JS (Prisma can't query JSON contains easily)
  const endpoints = await withTimeout(
    db.webhookEndpoint.findMany({
      where: { status: 'active' },
    }),
    5000
  ).catch(() => [])

  const deliveryIds: string[] = []

  for (const endpoint of endpoints as any[]) {
    // Check if this endpoint is subscribed to the event
    let events: string[] = []
    try {
      events = JSON.parse(endpoint.events)
    } catch {}

    if (!events.includes(eventType)) continue

    // Create delivery record
    const delivery = await db.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        eventType,
        payload: payloadStr,
        status: 'pending',
        maxAttempts: MAX_ATTEMPTS,
      },
    })

    deliveryIds.push(delivery.id)
  }

  return {
    endpointsNotified: deliveryIds.length,
    deliveryIds,
  }
}

// =====================================================================
// SEND DELIVERY (single attempt)
// =====================================================================

export async function sendDelivery(deliveryId: string): Promise<{
  success: boolean
  status: string
  responseStatus?: number
  error?: string
}> {
  const delivery = await withTimeout(
    db.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    }),
    5000
  ).catch(() => null)

  if (!delivery || !delivery.endpoint) {
    return { success: false, status: 'failed', error: 'Delivery or endpoint not found' }
  }

  if (delivery.status === 'success') {
    return { success: true, status: 'success' }
  }

  const attemptNumber = delivery.attemptCount + 1
  const now = new Date()

  try {
    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': delivery.eventType,
      'X-Webhook-Delivery': delivery.id,
      'X-Webhook-Attempt': String(attemptNumber),
    }

    // Add HMAC signature if secret is set
    if (delivery.endpoint.secret) {
      headers['X-Webhook-Signature'] = signPayload(delivery.payload, delivery.endpoint.secret)
    }

    // Send the request with 10s timeout
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(delivery.endpoint.url, {
      method: 'POST',
      headers,
      body: delivery.payload,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    const responseStatus = response.status
    const responseText = await response.text().catch(() => '')

    // Update delivery record
    const isSuccess = responseStatus >= 200 && responseStatus < 300

    if (isSuccess) {
      await db.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'success',
          attemptCount: attemptNumber,
          responseStatus,
          responseBody: responseText.slice(0, 1024) || null,
          firstAttemptAt: delivery.firstAttemptAt || now,
          lastAttemptAt: now,
          deliveredAt: now,
          nextRetryAt: null,
        },
      })

      // Update endpoint stats
      await db.webhookEndpoint.update({
        where: { id: delivery.endpoint.id },
        data: {
          totalSent: { increment: 1 },
          totalSuccess: { increment: 1 },
          lastSentAt: now,
        },
      })

      return { success: true, status: 'success', responseStatus }
    } else {
      // Non-2xx response — schedule retry if attempts remain
      const shouldRetry = attemptNumber < delivery.maxAttempts
      const nextRetryMinutes = shouldRetry ? BACKOFF_MINUTES[attemptNumber] || 25 : 0
      const nextRetryAt = shouldRetry ? new Date(now.getTime() + nextRetryMinutes * 60 * 1000) : null

      await db.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: shouldRetry ? 'retrying' : 'failed',
          attemptCount: attemptNumber,
          responseStatus,
          responseBody: responseText.slice(0, 1024) || null,
          errorMessage: `HTTP ${responseStatus}`,
          firstAttemptAt: delivery.firstAttemptAt || now,
          lastAttemptAt: now,
          nextRetryAt,
        },
      })

      // Update endpoint stats
      await db.webhookEndpoint.update({
        where: { id: delivery.endpoint.id },
        data: {
          totalSent: { increment: 1 },
          totalFailed: { increment: 1 },
          lastSentAt: now,
        },
      })

      return {
        success: false,
        status: shouldRetry ? 'retrying' : 'failed',
        responseStatus,
        error: `HTTP ${responseStatus}`,
      }
    }
  } catch (error) {
    // Network error, timeout, etc.
    const errorMessage = error instanceof Error ? error.message : String(error)
    const shouldRetry = attemptNumber < delivery.maxAttempts
    const nextRetryMinutes = shouldRetry ? BACKOFF_MINUTES[attemptNumber] || 25 : 0
    const nextRetryAt = shouldRetry ? new Date(now.getTime() + nextRetryMinutes * 60 * 1000) : null

    await db.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: shouldRetry ? 'retrying' : 'failed',
        attemptCount: attemptNumber,
        errorMessage,
        firstAttemptAt: delivery.firstAttemptAt || now,
        lastAttemptAt: now,
        nextRetryAt,
      },
    })

    // Update endpoint stats
    await db.webhookEndpoint.update({
      where: { id: delivery.endpoint.id },
      data: {
        totalSent: { increment: 1 },
        totalFailed: { increment: 1 },
        lastSentAt: now,
      },
    })

    return {
      success: false,
      status: shouldRetry ? 'retrying' : 'failed',
      error: errorMessage,
    }
  }
}

// =====================================================================
// PROCESS PENDING DELIVERIES
// =====================================================================
// Called by background job or manual trigger.
// Sends all pending deliveries + retries that are due.

export async function processPendingDeliveries(): Promise<{
  processed: number
  succeeded: number
  failed: number
  retrying: number
}> {
  const now = new Date()

  // Find deliveries that need sending:
  // - status = pending (never sent)
  // - status = retrying AND nextRetryAt <= now
  const deliveries = await withTimeout(
    db.webhookDelivery.findMany({
      where: {
        OR: [
          { status: 'pending' },
          {
            status: 'retrying',
            nextRetryAt: { lte: now },
          },
        ],
      },
      take: 50, // Process in batches to avoid overload
      orderBy: { createdAt: 'asc' },
    }),
    5000
  ).catch(() => [])

  let processed = 0
  let succeeded = 0
  let failed = 0
  let retrying = 0

  for (const delivery of deliveries as any[]) {
    const result = await sendDelivery(delivery.id)
    processed++

    if (result.success) succeeded++
    else if (result.status === 'retrying') retrying++
    else failed++
  }

  return { processed, succeeded, failed, retrying }
}
