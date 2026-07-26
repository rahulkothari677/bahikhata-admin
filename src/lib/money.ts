/**
 * ⚠️ VENDORED COPY — DO NOT EDIT HERE.
 *
 * Verbatim copy of bahikhata-pro/src/lib/money.ts at commit b186503.
 * The two apps share ONE database, so they must agree exactly on how paise
 * convert to rupees. If you change this, change it in bahikhata-pro FIRST
 * and re-copy — a fork between the two is a silent 100x bug waiting to happen.
 *
 * Re-sync with:  cp ~/bahikhata-pro/src/lib/money.ts ~/bahikhata-admin/src/lib/money.ts
 *
 * ── original header ────────────────────────────────────────────────────────
 * Money helpers — the ONLY file that should do money conversion/rounding.
 *
 * 🔒 HONEST STATUS (corrected per V6 audit):
 * Money fields are STILL stored as Float (42 fields in schema.prisma).
 * A full Decimal(18,2) migration was attempted but reverted because it
 * created 126 type errors across 13 files (Prisma Decimal objects don't
 * support JS arithmetic operators — each needs a manual Number() wrapper,
 * and missing one = runtime crash in a financial app).
 *
 * Instead, these helpers apply roundMoney() at every calculation point to
 * eliminate float precision drift (e.g. itemGst / 2 → 9.000000000000002
 * becomes 9.00). This is a MITIGATION, not a structural fix.
 *
 * Phase 8 (this commit): Applied roundMoney()/splitGst() to ALL 15 money-
 * handling routes (was only in 1 of 15 before — the V6 audit caught this).
 *
 * Future: A full Decimal/paise migration should be done as a separate,
 * carefully tested phase with comprehensive test coverage.
 *
 * Rules:
 * 1. All money math must go through these helpers (not raw +/-/*)
 * 2. Every money calculation is rounded to 2 decimal places (1 paisa precision)
 * 3. Display uses formatINR() — never template literals for money
 * 4. Never use parseFloat() on money — use toMoney() instead
 */

/**
 * Safely convert a Prisma Decimal / number / string to a native number.
 * Returns 0 for null/undefined/NaN.
 *
 * Use this whenever reading a money value from the database.
 */
export function toMoney(value: any): number {
  if (value == null) return 0
  if (typeof value === 'number') return isNaN(value) ? 0 : value
  // Prisma Decimal objects have a toNumber() method
  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    return value.toNumber()
  }
  // String fallback
  const n = Number(value)
  return isNaN(n) ? 0 : n
}

/**
 * Round a money value to 2 decimal places (1 paisa precision).
 *
 * This is the core fix for the Float precision issue: instead of
 * `itemGst / 2` producing 9.000000000000002, we get exactly 9.00.
 *
 * 🔒 AUDIT FIX M0a+M0b (v2 audit) + V9 2.3:
 * - M0a: Fixed the epsilon bug. Was: `Math.round(value * 100) / 100` which
 *   fails on `1.005` because `1.005 * 100 = 100.49999999999999` → rounds to
 *   `100` → returns `1.00` instead of `1.01`.
 * - M0b: Fixed negative rounding to be truly symmetric.
 * - V9 2.3: The auditor noted the comment claimed Number.EPSILON but code
 *   used 1e-9. We tested Number.EPSILON (2.22e-16) — it's too small to fix
 *   1.005 because the float representation error (1.07e-16) is close in
 *   magnitude, and toFixed() re-rounds. 1e-9 is empirically the smallest
 *   nudge that reliably fixes all test cases (1.005→1.01, 2.675→2.68, etc).
 *   For very large values (>₹90 trillion) 1e-9 falls below the ULP and is
 *   a no-op — but at that scale toFixed(2) already rounds correctly because
 *   the float precision is coarser than 1 paisa.
 *   The real fix is the paise migration (D1) which eliminates decimal
 *   rounding entirely. Until then, 1e-9 is the empirically correct nudge.
 *
 * Uses "round half away from zero" (standard rounding, not banker's rounding)
 * to match GST invoice norms.
 */
export function roundMoney(value: number): number {
  if (isNaN(value) || !isFinite(value)) return 0
  // Symmetric rounding with float correction.
  // For symmetric negative rounding: apply sign separately.
  const sign = value < 0 ? -1 : 1
  const absVal = Math.abs(value)
  const rounded = parseFloat((absVal + 1e-9).toFixed(2))
  return sign * rounded
}

/**
 * Add two or more money values, rounding the result to 2 decimal places.
 * Prevents float drift from accumulating across many additions.
 *
 * Usage: const total = addMoney(subtotal, cgst, sgst, igst, -discount)
 */
export function addMoney(...values: number[]): number {
  return roundMoney(values.reduce((sum, v) => sum + toMoney(v), 0))
}

/**
 * Multiply quantity by unit price, rounding to 2 decimal places.
 * Use for line-item total calculation.
 */
export function multiplyMoney(quantity: number, unitPrice: number): number {
  return roundMoney(toMoney(quantity) * toMoney(unitPrice))
}

/**
 * Calculate GST amount for a line item.
 * Returns the rounded GST amount (2 decimal places).
 *
 * @param amount - the taxable amount (qty × unitPrice - discount)
 * @param gstRate - the GST percentage (0, 5, 12, 18, 28)
 */
export function calculateGst(amount: number, gstRate: number): number {
  return roundMoney(toMoney(amount) * toMoney(gstRate) / 100)
}

/**
 * Split GST into CGST and SGST (each is half of total GST).
 * Both are rounded to 2 decimal places to prevent drift.
 *
 * If the GST is an odd number of paise, the extra paisa goes to CGST
 * (arbitrary but consistent rule — document in GST filing notes).
 */
export function splitGst(totalGst: number): { cgst: number; sgst: number } {
  const gst = toMoney(totalGst)
  const half = gst / 2
  const cgst = roundMoney(half)
  const sgst = roundMoney(gst - cgst) // ensures cgst + sgst === gst exactly
  return { cgst, sgst }
}

/**
 * 🔒 V10 §2.1: Distribute an order-level discount proportionally across line
 * items, returning the per-item discount amount for each item.
 *
 * WHY: GST law (CGST Act §15(3)) requires GST to be charged on the POST-
 * discount taxable value when the discount is shown on the invoice. The UI
 * collects a single order-level discount; previously this was subtracted
 * AFTER GST was computed on the full pre-discount amount — making GST
 * non-filable. Now the order-level discount is split proportionally across
 * items (by each item's gross amount) BEFORE GST is computed, so:
 *
 *   taxableValue(item) = (qty × unitPrice) − proportionalDiscount(item)
 *   GST(item)          = taxableValue(item) × rate
 *   tax = taxable × rate  ← holds per item, per slab, per invoice
 *
 * The last item absorbs any rounding residual so the sum of per-item
 * discounts EXACTLY equals the order-level discount (no ₹0.01 drift).
 *
 * @param grossAmounts - array of each item's gross amount (qty × unitPrice)
 * @param orderDiscount - the order-level discount to distribute
 * @returns array of per-item discount amounts (same length as input)
 */
export function distributeDiscountProportionally(
  grossAmounts: number[],
  orderDiscount: number,
): number[] {
  const discount = toMoney(orderDiscount)
  if (discount <= 0) return grossAmounts.map(() => 0)

  const grossValues = grossAmounts.map(toMoney)
  const totalGross = grossValues.reduce((s, v) => s + v, 0)
  if (totalGross <= 0) return grossAmounts.map(() => 0)

  // Step 1: compute proportional share per item, rounded to 2dp.
  // Clamp each share to [0, grossValues[i]] so an item's discount can never
  // exceed its gross amount (which would produce a negative taxable value —
  // nonsensical on a real invoice). This also covers the degenerate case
  // where orderDiscount > totalGross (e.g. user typo) without crashing.
  const shares = grossValues.map(g =>
    Math.min(g, Math.max(0, roundMoney((g / totalGross) * discount))),
  )

  // Step 2: absorb any rounding residual (positive or negative) into the LAST
  // item with a non-zero gross. This guarantees Σ(shares) === discount exactly.
  const sumShares = shares.reduce((s, v) => s + v, 0)
  const residual = roundMoney(discount - sumShares)
  if (residual !== 0) {
    // Find last non-zero-gross item (cannot push discount below 0 or above gross)
    for (let i = shares.length - 1; i >= 0; i--) {
      if (grossValues[i] > 0) {
        const adjusted = roundMoney(shares[i] + residual)
        // Clamp to [0, grossValues[i]] to be safe
        shares[i] = Math.min(grossValues[i], Math.max(0, adjusted))
        break
      }
    }
  }

  return shares
}

/**
 * Format a money value as an Indian Rupee string for display.
 *
 * Usage: formatINR(1234.5) → "₹1,234.50"
 *        formatINR(0) → "₹0.00"
 *        formatINR(-500) → "-₹500.00"
 */
export function formatINR(value: number): string {
  const n = toMoney(value)
  const isNegative = n < 0
  const absVal = Math.abs(n)
  // Indian number formatting (lakh/crore system): 1,23,456.78
  const formatted = absVal.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return isNegative ? `-₹${formatted}` : `₹${formatted}`
}

/**
 * Format a money value as a plain number string (no ₹ symbol, no formatting).
 * Use when sending to APIs that expect raw numbers.
 *
 * Usage: toMoneyString(1234.5) → "1234.50"
 */
export function toMoneyString(value: number): string {
  return toMoney(value).toFixed(2)
}

/**
 * Parse a user-entered money string to a number.
 * Handles: "1234", "1234.50", "1,234.50", "₹1,234.50", "1234.5"
 * Returns 0 for invalid input.
 */
export function parseMoney(input: string | number | any): number {
  if (typeof input === 'number') return roundMoney(input)
  if (!input) return 0
  // Remove ₹ symbol, commas, spaces, and any non-numeric chars except . and -
  const cleaned = String(input).replace(/[₹,\s]/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : roundMoney(n)
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 V17 PAISE MIGRATION — Phase 1: Additive helpers (zero-risk)
// ═══════════════════════════════════════════════════════════════════════════
//
// These helpers exist ALONGSIDE the existing rupee helpers. No existing code
// is changed. They will be used incrementally as we migrate each model from
// Float (rupees) to BigInt (paise).
//
// CONVENTION:
//   - Rupees (Float):    1234.56  ← current storage (being migrated away)
//   - Paise (BigInt):    123456   ← future storage (integer, no float drift)
//   - 1 rupee = 100 paise
//
// The migration plan (7 phases):
//   Phase 1: Add these helpers (DONE in this commit) ← zero-risk, additive
//   Phase 2: Migrate read paths (SQL queries) — each query independently
//   Phase 3: Migrate write paths (POST/PUT handlers, Zod transforms)
//   Phase 4: Run Prisma migration (74 columns Float → BigInt)
//   Phase 5: Migrate UI display (.toFixed → formatPaise)
//   Phase 6: Delete workarounds (180 roundMoney calls)
//   Phase 7: Update tests (16 test files with rupee fixtures)
//
// Each phase is independently deployable. No big-bang cutover.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert rupees (Float) to paise (integer).
 *
 * Uses Math.round to handle float representation errors:
 *   1.005 * 100 = 100.49999999999999 → Math.round → 101 (correct: 1.01 rupees)
 *
 * @param rupees - a money value in rupees (e.g., 1234.56)
 * @returns the same value in paise as an integer (e.g., 123456)
 *
 * Examples:
 *   toPaise(1234.56) → 123456
 *   toPaise(0) → 0
 *   toPaise(1.005) → 101  (float-safe: 1.005 * 100 = 100.499... → rounds to 101)
 *   toPaise(-500.25) → -50025
 *   toPaise(null) → 0
 *   toPaise(undefined) → 0
 *   toPaise(NaN) → 0
 */
/**
 * 🔒 V18 (Paise Migration precondition): a BRANDED integer-paise type.
 *
 * `Paise` is structurally a `number`, so it widens to `number` freely (every
 * existing consumer keeps compiling — this is intentionally NON-breaking). The
 * value it adds NOW: the paise-producing helpers below are typed `Paise`, so a
 * money value's units are visible in the type, and a future, deliberate
 * refactor can flip the helper PARAMETERS to require `Paise` (a plain `number`
 * is NOT assignable to `Paise` without going through `toPaise`) — at which
 * point the compiler will catch any rupee/paise mix-up. That param-level
 * enforcement is the Phase-4 precondition; making it breaking is its own step.
 * Do NOT hand-cast arbitrary numbers to `Paise` — only `toPaise()` mints it.
 */
export type Paise = number & { readonly __brand: 'paise' }

export function toPaise(rupees: number | null | undefined | any): Paise {
  // 🔒 Use roundMoney FIRST to fix float representation errors (1.005 → 1.01),
  // THEN multiply by 100 and round to integer. This two-step process ensures:
  //   1.005 → roundMoney → 1.01 → × 100 → 101 (correct)
  //   Without roundMoney: 1.005 × 100 = 100.499... → Math.round → 100 (WRONG)
  const n = roundMoney(toMoney(rupees))
  if (isNaN(n) || !isFinite(n)) return 0 as Paise
  return Math.round(n * 100) as Paise
}

/**
 * Convert paise (integer) back to rupees (Float) for display.
 *
 * @param paise - a money value in paise (e.g., 123456)
 * @returns the same value in rupees as a Float (e.g., 1234.56)
 *
 * Examples:
 *   fromPaise(123456) → 1234.56
 *   fromPaise(0) → 0
 *   fromPaise(101) → 1.01
 *   fromPaise(-50025) → -500.25
 *   fromPaise(null) → 0
 *   fromPaise(undefined) → 0
 */
export function fromPaise(paise: number | null | undefined | any): number {
  const n = toMoney(paise)
  if (isNaN(n) || !isFinite(n)) return 0
  return n / 100
}

/**
 * Format paise (integer) as an Indian Rupee string for display.
 *
 * This is the paise equivalent of formatINR(). Once the migration is complete,
 * all display code will use formatPaise() instead of formatINR().
 *
 * @param paise - a money value in paise (e.g., 123456)
 * @returns formatted string (e.g., "₹1,234.56")
 *
 * Examples:
 *   formatPaise(123456) → "₹1,234.56"
 *   formatPaise(0) → "₹0.00"
 *   formatPaise(-50025) → "-₹500.25"
 *   formatPaise(101) → "₹1.01"
 */
export function formatPaise(paise: number | null | undefined | any): string {
  return formatINR(fromPaise(paise))
}

/**
 * Add two or more paise values (integer arithmetic — no float drift).
 *
 * This is the paise equivalent of addMoney(). Once the migration is complete,
 * all money addition will use addPaise() instead of addMoney().
 *
 * @param values - money values in paise (integers)
 * @returns the sum in paise (integer)
 *
 * Examples:
 *   addPaise(100, 200, 50) → 350
 *   addPaise(123456, -50000) → 73456
 *   addPaise() → 0
 */
export function addPaise(...values: number[]): Paise {
  return values.reduce((sum, v) => sum + toMoney(v), 0) as Paise
}

/**
 * Multiply a paise value by a quantity (integer arithmetic — no float drift).
 *
 * Use for line-item total calculation in paise mode.
 *
 * @param quantity - the quantity (can be fractional: 0.5 kg)
 * @param unitPricePaise - the unit price in paise (integer)
 * @returns the total in paise (integer, rounded)
 *
 * Examples:
 *   multiplyPaise(2, 5000) → 10000  (2 units × ₹50.00 = ₹100.00)
 *   multiplyPaise(0.5, 2000) → 1000  (0.5 kg × ₹20.00 = ₹10.00)
 *   multiplyPaise(3, 2800) → 8400  (3 pcs × ₹28.00 = ₹84.00)
 */
export function multiplyPaise(quantity: number, unitPricePaise: number): Paise {
  const qty = toMoney(quantity)
  const price = toMoney(unitPricePaise)
  return Math.round(qty * price) as Paise
}

/**
 * Calculate GST in paise from a paise taxable amount.
 *
 * @param amountPaise - the taxable amount in paise (integer)
 * @param gstRate - the GST percentage (0, 5, 12, 18, 28)
 * @returns the GST amount in paise (integer, rounded)
 *
 * Examples:
 *   calculateGstPaise(100000, 18) → 18000  (₹1000 × 18% = ₹180.00)
 *   calculateGstPaise(50000, 5) → 2500  (₹500 × 5% = ₹25.00)
 *   calculateGstPaise(100, 0) → 0
 */
export function calculateGstPaise(amountPaise: number, gstRate: number): Paise {
  const amount = toMoney(amountPaise)
  const rate = toMoney(gstRate)
  return Math.round(amount * rate / 100) as Paise
}

/**
 * Split GST (in paise) into CGST and SGST (in paise).
 *
 * @param totalGstPaise - the total GST in paise (integer)
 * @returns { cgst, sgst } — each in paise (integers that sum to totalGstPaise)
 *
 * If the GST is an odd number of paise, the extra paisa goes to CGST
 * (same rule as splitGst — arbitrary but consistent).
 *
 * Examples:
 *   splitGstPaise(18000) → { cgst: 9000, sgst: 9000 }
 *   splitGstPaise(18001) → { cgst: 9001, sgst: 9000 }  (extra paisa → CGST)
 *   splitGstPaise(0) → { cgst: 0, sgst: 0 }
 */
export function splitGstPaise(totalGstPaise: number): { cgst: Paise; sgst: Paise } {
  const gst = toMoney(totalGstPaise)
  const cgst = Math.ceil(gst / 2) as Paise  // extra paisa goes to CGST
  const sgst = (gst - cgst) as Paise  // ensures cgst + sgst === gst exactly
  return { cgst, sgst }
}
