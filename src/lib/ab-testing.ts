/**
 * A/B Testing Engine — experiment assignment + metric tracking.
 *
 * HOW IT WORKS:
 *   1. Admin creates an experiment with variants (control + 1+ treatments)
 *   2. When a user visits, call assignUser(experimentId, userId)
 *      - Deterministic assignment: same user always gets same variant
 *      - Uses hash(userId + experimentId) % 100 < trafficPct → included
 *      - If included, hash(userId + experimentId) % 100 → variant based on weights
 *   3. When user completes goal, call trackConversion(experimentId, userId, value)
 *   4. Admin views results: conversion rate per variant, statistical significance
 *
 * VARIANTS JSON FORMAT:
 *   [
 *     { "key": "control", "name": "Default", "weight": 50 },
 *     { "key": "treatment_a", "name": "New UI", "weight": 50 }
 *   ]
 *   Weights must sum to 100. Control must have key "control".
 */

import crypto from 'crypto'
import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'

// =====================================================================
// TYPES
// =====================================================================

export interface Variant {
  key: string
  name: string
  weight: number  // 0-100, all weights must sum to 100
}

export interface ExperimentResults {
  experimentId: string
  status: string
  totalAssigned: number
  variants: Array<{
    key: string
    name: string
    assigned: number
    converted: number
    conversionRate: number  // percentage
    totalValue: number      // sum of conversionValue
    avgValue: number        // totalValue / converted
  }>
  winnerVariant: string | null
  hasSignificantResult: boolean
}

// =====================================================================
// DETERMINISTIC HASH (for stable assignment)
// =====================================================================
// Same user + same experiment → same hash → same variant.
// This ensures users don't flip between variants on refresh.

function hashString(input: string): number {
  const hash = crypto.createHash('sha256').update(input).digest('hex')
  // Use first 8 hex chars (32-bit) as a number 0-4294967295
  return parseInt(hash.slice(0, 8), 16)
}

// =====================================================================
// ASSIGN USER TO VARIANT
// =====================================================================

export async function assignUser(
  experimentId: string,
  userId: string
): Promise<{ variantKey: string | null; assigned: boolean }> {
  // Check if already assigned (idempotent)
  const existing = await withNeonRetry(() =>
    db.experimentAssignment.findUnique({
      where: {
        experimentId_userId: { experimentId, userId },
      },
      select: { variantKey: true },
    })
  ).catch(() => null)

  if (existing) {
    return { variantKey: existing.variantKey, assigned: true }
  }

  // Fetch experiment
  const experiment = await withNeonRetry(() =>
    db.experiment.findUnique({
      where: { id: experimentId },
      select: { status: true, trafficPct: true, variants: true },
    })
  ).catch(() => null)

  if (!experiment || experiment.status !== 'running') {
    return { variantKey: null, assigned: false }
  }

  // Check traffic allocation
  const trafficHash = hashString(`${userId}:${experimentId}`) % 100
  if (trafficHash >= experiment.trafficPct) {
    // User is NOT included in the experiment
    return { variantKey: null, assigned: false }
  }

  // Parse variants
  let variants: Variant[] = []
  try {
    variants = JSON.parse(experiment.variants)
  } catch {
    return { variantKey: null, assigned: false }
  }

  if (variants.length === 0) {
    return { variantKey: null, assigned: false }
  }

  // Determine variant using hash
  const variantHash = hashString(`${userId}:${experimentId}:variant`) % 100
  let cumulativeWeight = 0
  let selectedVariant: Variant = variants[0]

  for (const v of variants) {
    cumulativeWeight += v.weight
    if (variantHash < cumulativeWeight) {
      selectedVariant = v
      break
    }
  }

  // Create assignment (unique constraint prevents race conditions)
  try {
    await db.experimentAssignment.create({
      data: {
        experimentId,
        userId,
        variantKey: selectedVariant.key,
      },
    })
  } catch {
    // If unique constraint violation, another request already assigned — fetch it
    const existing2 = await withNeonRetry(() =>
      db.experimentAssignment.findUnique({
        where: {
          experimentId_userId: { experimentId, userId },
        },
        select: { variantKey: true },
      })
    ).catch(() => null)
    return { variantKey: existing2?.variantKey || null, assigned: !!existing2 }
  }

  return { variantKey: selectedVariant.key, assigned: true }
}

// =====================================================================
// TRACK CONVERSION
// =====================================================================

export async function trackConversion(
  experimentId: string,
  userId: string,
  conversionValue: number = 0
): Promise<boolean> {
  try {
    const result = await db.experimentAssignment.updateMany({
      where: {
        experimentId,
        userId,
        convertedAt: null,  // only update if not already converted
      },
      data: {
        convertedAt: new Date(),
        conversionValue,
      },
    })
    return result.count > 0
  } catch {
    return false
  }
}

// =====================================================================
// GET EXPERIMENT RESULTS
// =====================================================================

export async function getExperimentResults(experimentId: string): Promise<ExperimentResults | null> {
  const experiment = await withNeonRetry(() =>
    db.experiment.findUnique({
      where: { id: experimentId },
      select: { status: true, variants: true, winnerVariant: true },
    })
  ).catch(() => null)

  if (!experiment) return null

  let variants: Variant[] = []
  try {
    variants = JSON.parse(experiment.variants)
  } catch {}

  // Fetch assignment stats per variant
  const statsRaw = await withNeonRetry(() =>
    db.experimentAssignment.groupBy({
      by: ['variantKey'],
      where: { experimentId },
      _count: true,
      _sum: { conversionValue: true },
    })
  ).catch(() => [])

  // Fetch conversion counts per variant
  const convertedRaw = await withNeonRetry(() =>
    db.experimentAssignment.groupBy({
      by: ['variantKey'],
      where: { experimentId, convertedAt: { not: null } },
      _count: true,
    })
  ).catch(() => [])

  // Build lookup maps
  const statsMap = new Map<string, { count: number; totalValue: number }>()
  for (const s of statsRaw as any[]) {
    statsMap.set(s.variantKey, {
      count: s._count,
      totalValue: s._sum.conversionValue || 0,
    })
  }

  const convertedMap = new Map<string, number>()
  for (const c of convertedRaw as any[]) {
    convertedMap.set(c.variantKey, c._count)
  }

  const totalAssigned = (statsRaw as any[]).reduce((sum, s) => sum + s._count, 0)

  // Build variant results
  const variantResults = variants.map(v => {
    const stats = statsMap.get(v.key) || { count: 0, totalValue: 0 }
    const converted = convertedMap.get(v.key) || 0
    const conversionRate = stats.count > 0 ? Math.round((converted / stats.count) * 1000) / 10 : 0
    const avgValue = converted > 0 ? Math.round((stats.totalValue / converted) * 100) / 100 : 0
    return {
      key: v.key,
      name: v.name,
      assigned: stats.count,
      converted,
      conversionRate,
      totalValue: stats.totalValue,
      avgValue,
    }
  })

  // Determine winner (highest conversion rate, with minimum sample size)
  const MIN_SAMPLE = 30  // need at least 30 users per variant for significance
  const eligibleVariants = variantResults.filter(v => v.assigned >= MIN_SAMPLE)
  const hasSignificantResult = eligibleVariants.length >= 2

  let winnerVariant: string | null = experiment.winnerVariant
  if (experiment.status === 'completed' && eligibleVariants.length > 0) {
    const winner = eligibleVariants.reduce((best, v) =>
      v.conversionRate > best.conversionRate ? v : best
    )
    winnerVariant = winner.key
  }

  return {
    experimentId,
    status: experiment.status,
    totalAssigned,
    variants: variantResults,
    winnerVariant,
    hasSignificantResult,
  }
}

// =====================================================================
// STATISTICAL SIGNIFICANCE (simplified Z-test for proportions)
// =====================================================================
// Returns p-value for the difference between two conversion rates.
// p < 0.05 is considered statistically significant.

export function calculatePValue(
  conversions1: number,
  samples1: number,
  conversions2: number,
  samples2: number
): number {
  if (samples1 === 0 || samples2 === 0) return 1

  const p1 = conversions1 / samples1
  const p2 = conversions2 / samples2
  const pPooled = (conversions1 + conversions2) / (samples1 + samples2)

  if (pPooled === 0 || pPooled === 1) return 1

  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / samples1 + 1 / samples2))
  if (se === 0) return 1

  const zScore = Math.abs(p1 - p2) / se

  // Approximate two-tailed p-value from z-score using error function
  // p = 2 * (1 - Φ(|z|))
  // Simplified approximation:
  if (zScore > 3.29) return 0.001
  if (zScore > 2.58) return 0.01
  if (zScore > 1.96) return 0.05
  if (zScore > 1.64) return 0.10
  return 1 - zScore / 4  // rough linear approximation for small z
}
