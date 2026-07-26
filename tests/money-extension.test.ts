import { describe, it, expect } from 'vitest'
import { withMoneyConversion, __testing } from '../src/lib/prisma-money-extension'
import { toPaise, fromPaise } from '../src/lib/money'

/**
 * Guards for the money layer.
 *
 * WHY (audit 2026-07-26): the admin app read the shared database with a bare
 * PrismaClient and no money extension. Money is stored as integer PAISE, so a
 * ₹499 subscription read as 49900 and rendered as "₹49,900" — every revenue,
 * MRR, ARR, GMV, P&L and GST figure in the panel was 100x too large.
 *
 * The extension is a HAND-MAINTAINED WHITELIST. A model can be listed in
 * MONEY_COLUMNS and still have no query handler registered — in which case its
 * money silently isn't converted. That exact gap shipped once in the main app
 * (transactionItem.aggregate) and produced a GST reconciliation that compared
 * paise against rupees. A text-grep guard structurally CANNOT catch a missing
 * handler, so this test introspects the real extension config instead.
 */

/**
 * Captures the config object passed to $extends by calling the real
 * withMoneyConversion(). Behavioural: if a handler isn't registered, it isn't here.
 */
function captureExtensionConfig() {
  let captured: any = null
  const stub = {
    $extends(config: any) {
      captured = config
      return {}
    },
  }
  withMoneyConversion(stub as never)
  if (!captured) throw new Error('withMoneyConversion did not call $extends')
  return captured
}

/**
 * Every model.operation pair the admin app actually calls on a money-bearing
 * model. Operations that carry no money payload (count/delete/deleteMany) are
 * excluded deliberately.
 *
 * Regenerate with:
 *   grep -rhoE "db\.(product|party|transaction|transactionItem|payment|subscription|gstReturn|gstr1Snapshot|bankStatement|bankTransaction|gstr2bImport|gstr2bInvoice|aiUsageLog|dailyStats|revenueSchedule)\.[a-zA-Z]+" src/ --include=*.ts | sed 's/^db\.//' | sort -u
 */
const USED_MONEY_OPERATIONS: Array<[model: string, op: string]> = [
  ['aiUsageLog', 'aggregate'],
  ['aiUsageLog', 'findMany'],
  ['aiUsageLog', 'groupBy'],
  ['dailyStats', 'findFirst'],
  ['dailyStats', 'findMany'],
  ['dailyStats', 'upsert'],
  ['party', 'findMany'],
  ['product', 'findMany'],
  ['product', 'groupBy'],
  ['revenueSchedule', 'aggregate'],
  ['revenueSchedule', 'createMany'],
  ['revenueSchedule', 'findMany'],
  ['subscription', 'aggregate'],
  ['subscription', 'findMany'],
  ['subscription', 'findUnique'],
  ['subscription', 'groupBy'],
  ['transaction', 'aggregate'],
  ['transaction', 'findMany'],
  ['transaction', 'groupBy'],
  ['transactionItem', 'aggregate'],
]

describe('money extension — handler registration', () => {
  const config = captureExtensionConfig()

  it.each(USED_MONEY_OPERATIONS)(
    'registers a query handler for %s.%s',
    (model, op) => {
      expect(
        config.query?.[model],
        `No handlers at all registered for model "${model}". Its money columns are NOT converted.`,
      ).toBeDefined()
      expect(
        typeof config.query[model][op],
        `${model}.${op} has no handler — money returned by this call is raw PAISE.`,
      ).toBe('function')
    },
  )

  it('registers handlers for every model declared in MONEY_COLUMNS', () => {
    const declared = Object.keys(__testing.MONEY_COLUMNS)
    const unregistered = declared.filter((modelName) => {
      const key = modelName.charAt(0).toLowerCase() + modelName.slice(1)
      return !config.query?.[key]
    })
    expect(
      unregistered,
      `Declared in MONEY_COLUMNS but no query handlers: ${unregistered.join(', ')}`,
    ).toEqual([])
  })

  it('does NOT register top-level catch-all operation handlers', () => {
    // Regression guard for the M11 double-conversion bug: generateModelHandlers
    // once returned UNKEYED handlers, so ten spreads collided into top-level
    // `query.create` / `query.findMany` bound to the last model. Every model
    // with an `amount` column was then converted twice (₹100 -> 1,000,000 paise).
    for (const op of ['findMany', 'create', 'update', 'aggregate', 'upsert']) {
      expect(
        typeof config.query?.[op],
        `query.${op} is a top-level catch-all — this is the M11 double-conversion bug.`,
      ).not.toBe('function')
    }
  })
})

describe('money extension — conversion correctness', () => {
  it('converts a paise row to rupees on read', () => {
    const row = __testing.convertRowOnRead('Subscription', {
      id: 's1',
      amount: 49900, // ₹499 stored as paise
    })
    expect(row.amount).toBe(499)
  })

  it('converts a rupee payload to paise on write', () => {
    const data = __testing.convertDataOnWrite('Subscription', { amount: 499 })
    expect(data.amount).toBe(49900)
  })

  it('round-trips without drift', () => {
    for (const rupees of [0, 0.01, 1, 99.99, 499, 1000, 123456.78]) {
      expect(fromPaise(toPaise(rupees))).toBe(rupees)
    }
  })

  it('converts DailyStats money columns (mrr/arr/totalGmv)', () => {
    // compute-daily-stats writes these via upsert. If they were not converted,
    // the admin app would write RUPEES into a PAISE column and the main app —
    // which reads through the extension — would show 1/100th of real MRR.
    const row = __testing.convertRowOnRead('DailyStats', {
      mrr: 4990000,
      arr: 59880000,
      totalGmv: 1234500,
    })
    expect(row.mrr).toBe(49900)
    expect(row.arr).toBe(598800)
    expect(row.totalGmv).toBe(12345)
  })
})
