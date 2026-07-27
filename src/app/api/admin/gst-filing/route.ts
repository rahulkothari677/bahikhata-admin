import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/with-admin'
import { getGstOverview, generateGstReport } from '@/lib/gst-filing'

/**
 * GET /api/admin/gst-filing
 * Query: ?tab=overview|report&year=2026&month=0-11
 */
export const GET = withAdmin(
  'admin/gst-filing',
  async (req: NextRequest, ctx) => {
  try {
    const url = new URL(req.url)
    const tab = url.searchParams.get('tab') || 'overview'
    const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()), 10)
    const month = url.searchParams.get('month') !== null ? parseInt(url.searchParams.get('month')!, 10) : null

    if (tab === 'overview') {
      const overview = await getGstOverview()
      return NextResponse.json({ success: true, overview })
    }

    // Report tab
    if (month === null) {
      return NextResponse.json({ error: 'month parameter required for report tab' }, { status: 400 })
    }

    const report = await generateGstReport(year, month)
    return NextResponse.json({ success: true, report })
  } catch (error) {
    console.error('GST filing error:', error)
    return NextResponse.json({ error: 'Failed to generate GST report' }, { status: 500 })
  }
},
)
