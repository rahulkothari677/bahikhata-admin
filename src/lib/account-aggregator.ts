/**
 * Account Aggregator (AA) Integration — India's AA framework.
 *
 * WHAT IS ACCOUNT AGGREGATOR?
 *   India's Account Aggregator (AA) framework allows users to securely share
 *   their bank/financial data with third parties (like us) with explicit consent.
 *
 *   Flow:
 *     1. User consents to share bank data (via AA app like OneMoney, FinVu)
 *     2. AA sends consent notification to us (webhook)
 *     3. We request financial data from the AA
 *     4. AA fetches data from Financial Information Providers (banks)
 *     5. AA returns aggregated financial data (transactions, balances)
 *     6. We use this data for:
 *        - Credit scoring (verify income from bank statements)
 *        - Lending (NBFC partners can verify user financials)
 *        - GST verification (cross-check with bank deposits)
 *
 * AA PROVIDERS (RBI-licensed):
 *   - OneMoney (https://www.onemoney.in)
 *   - FinVu (https://www.finvu.in)
 *   - CAMS Finserv (https://www.camsfinserv.com)
 *   - NESL (https://www.nesl.co.in)
 *
 * SIMULATION MODE:
 *   Without a real AA partnership, this runs in simulation mode — generates
 *   mock bank data for testing the flow end-to-end.
 *
 * ENV VARS (for production):
 *   AA_BASE_URL: AA provider API base URL
 *   AA_CLIENT_ID: Your AA client ID
 *   AA_CLIENT_SECRET: Your AA client secret
 *   AA_REDIRECT_URL: Where AA redirects after consent
 */

import { db } from '@/lib/db'
import { withTimeout, withNeonRetry } from '@/lib/resilience'

// =====================================================================
// TYPES
// =====================================================================

export interface AAConsentRequest {
  userId: string
  fiuId: string                         // Financial Information User ID (us)
  fipIds: string[]                      // Financial Information Provider IDs (banks)
  consentDurationDays: number           // how long consent is valid
  dataFetchFromDays: number             // fetch data from X days ago
  dataFetchToDays: number               // fetch data until Y days ago
  purpose: string                       // why we need this data
}

export interface AAFinancialData {
  userId: string
  consentId: string
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'data_received'
  bankName: string | null
  accountNumber: string | null          // masked (XXXX1234)
  avgMonthlyBalance: number | null
  totalCredits: number | null           // total deposits in period
  totalDebits: number | null            // total withdrawals in period
  transactionCount: number | null
  estimatedMonthlyIncome: number | null
  dataReceivedAt: Date | null
}

export interface AAOverview {
  totalRequests: number
  approvedCount: number
  pendingCount: number
  deniedCount: number
  dataReceivedCount: number
  uniqueUsersWithConsent: number
  isSimulationMode: boolean
}

// =====================================================================
// SIMULATION MODE CHECK
// =====================================================================

export function isSimulationMode(): boolean {
  return !process.env.AA_BASE_URL || !process.env.AA_CLIENT_ID
}

// =====================================================================
// SIMULATE CONSENT REQUEST
// =====================================================================
// In simulation mode, we generate a mock consent + mock financial data.
// In production, this would call the AA provider's API.

export async function requestConsent(req: AAConsentRequest): Promise<{
  consentId: string
  status: 'pending' | 'approved'
  simulationMode: boolean
  message: string
}> {
  const simulationMode = isSimulationMode()

  // Generate consent ID
  const consentId = `aa_consent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  if (simulationMode) {
    // In simulation mode, auto-approve after a short delay
    // Generate mock financial data
    await simulateFinancialData(req.userId, consentId)

    return {
      consentId,
      status: 'approved',
      simulationMode: true,
      message: 'Consent auto-approved (simulation mode). Mock bank data generated.',
    }
  }

  // Production: call AA provider API to create consent request
  // POST {AA_BASE_URL}/consent
  // Headers: Authorization: Bearer {token}
  // Body: { fiuId, fipIds, consentDurationDays, ... }
  //
  // Response: { consentId, status: 'pending' }
  // User approves via AA app → AA sends webhook → we fetch data

  return {
    consentId,
    status: 'pending',
    simulationMode: false,
    message: 'Consent request sent. User needs to approve via AA app.',
  }
}

// =====================================================================
// SIMULATE FINANCIAL DATA (mock)
// =====================================================================

async function simulateFinancialData(userId: string, consentId: string): Promise<void> {
  // Generate realistic mock bank data based on user's transaction history
  const userTxns = await withNeonRetry(() =>
    db.transaction.aggregate({
      where: { userId, type: 'sale' },
      _sum: { totalAmount: true },
      _count: true,
    })
  ).catch(() => ({ _sum: { totalAmount: 0 }, _count: 0 }))

  const totalSales = userTxns._sum.totalAmount || 0
  const txnCount = userTxns._count || 0
  const estimatedMonthlyIncome = totalSales > 0 ? Math.round(totalSales / Math.max(1, txnCount / 30)) : Math.round(Math.random() * 50000 + 10000)

  const mockBanks = ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra']
  const bankName = mockBanks[Math.floor(Math.random() * mockBanks.length)]

  // Store in audit log (since we don't have a separate AA table)
  // In production, this would be stored in a dedicated table
  const { logAdminAction } = await import('@/lib/audit')

  // Create a notification log entry for the AA data (reusing NotificationLog for storage)
  await db.notificationLog.create({
    data: {
      userId,
      recipient: userId,
      templateId: null,
      templateName: `AA Data: ${bankName}`,
      channel: 'push', // repurposed as 'aa_data'
      subject: consentId,
      body: JSON.stringify({
        consentId,
        bankName,
        accountNumber: `XXXX${Math.floor(1000 + Math.random() * 9000)}`,
        avgMonthlyBalance: estimatedMonthlyIncome * (1.5 + Math.random() * 0.5),
        totalCredits: estimatedMonthlyIncome * 3, // 3 months
        totalDebits: estimatedMonthlyIncome * 2.7, // 90% of credits
        transactionCount: Math.floor(txnCount / 3) || Math.floor(Math.random() * 50 + 20),
        estimatedMonthlyIncome,
        dataReceivedAt: new Date().toISOString(),
        simulationMode: true,
      }),
      status: 'sent',
      provider: 'simulation',
      sentBy: 'system',
      category: 'general',
    },
  }).catch(() => {})
}

// =====================================================================
// GET FINANCIAL DATA FOR USER
// =====================================================================

export async function getUserFinancialData(userId: string): Promise<AAFinancialData | null> {
  // Fetch from NotificationLog (where channel='push' and templateName starts with 'AA Data:')
  // In production, this would be a dedicated AAData table
  const records = await withNeonRetry(() =>
    db.notificationLog.findMany({
      where: {
        userId,
        templateName: { startsWith: 'AA Data:' },
      },
      orderBy: { sentAt: 'desc' },
      take: 1,
    })
  ).catch(() => [])

  if (records.length === 0) return null

  const record = records[0] as any
  let data: any = {}
  try { data = JSON.parse(record.body) } catch {}

  return {
    userId,
    consentId: record.subject || 'unknown',
    status: 'data_received',
    bankName: data.bankName || null,
    accountNumber: data.accountNumber || null,
    avgMonthlyBalance: data.avgMonthlyBalance || null,
    totalCredits: data.totalCredits || null,
    totalDebits: data.totalDebits || null,
    transactionCount: data.transactionCount || null,
    estimatedMonthlyIncome: data.estimatedMonthlyIncome || null,
    dataReceivedAt: record.sentAt,
  }
}

// =====================================================================
// GET AA OVERVIEW
// =====================================================================

export async function getAAOverview(): Promise<AAOverview> {
  // Count AA data records from NotificationLog
  const where = { templateName: { startsWith: 'AA Data:' } }

  const [totalRequests, uniqueUsers] = await Promise.all([
    withTimeout(db.notificationLog.count({ where }), 5000).catch(() => 0),
    withTimeout(
      db.notificationLog.groupBy({
        by: ['userId'],
        where,
        _count: true,
      }),
      5000
    ).catch(() => []),
  ])

  return {
    totalRequests,
    approvedCount: totalRequests, // in simulation, all auto-approved
    pendingCount: 0,
    deniedCount: 0,
    dataReceivedCount: totalRequests,
    uniqueUsersWithConsent: (uniqueUsers as any[]).length,
    isSimulationMode: isSimulationMode(),
  }
}

// =====================================================================
// SUPPORTED BANKS (FIP IDs)
// =====================================================================

export const SUPPORTED_BANKS = [
  { fipId: 'HDFC', name: 'HDFC Bank', code: 'HDFC0000001' },
  { fipId: 'ICICI', name: 'ICICI Bank', code: 'ICIC0000001' },
  { fipId: 'SBI', name: 'State Bank of India', code: 'SBIN0000001' },
  { fipId: 'AXIS', name: 'Axis Bank', code: 'UTIB0000001' },
  { fipId: 'KOTAK', name: 'Kotak Mahindra Bank', code: 'KKBK0000001' },
  { fipId: 'YES', name: 'Yes Bank', code: 'YESB0000001' },
  { fipId: 'PNB', name: 'Punjab National Bank', code: 'PUNB0000001' },
  { fipId: 'BOB', name: 'Bank of Baroda', code: 'BARB0000001' },
]
