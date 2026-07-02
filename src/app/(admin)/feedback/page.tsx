'use client'

import { useQuery } from '@tanstack/react-query'
import { MessageSquare, Loader2, Star } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'

export default function FeedbackPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-nps'],
    queryFn: async () => {
      const r = await fetch('/api/admin/nps')
      return r.json()
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  if (!data?.success) return <div className="p-6 text-muted-foreground">Failed to load feedback</div>

  const { feedback, summary } = data

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-blue-600" />
          User Feedback (NPS)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Net Promoter Score and user satisfaction feedback
        </p>
      </div>

      {/* NPS Score Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className={`rounded-lg border p-4 ${summary.npsScore >= 50 ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900' : summary.npsScore >= 0 ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900' : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900'}`}>
          <p className="text-xs text-muted-foreground uppercase">NPS Score</p>
          <p className={`text-3xl font-bold mt-1 ${summary.npsScore >= 50 ? 'text-emerald-600' : summary.npsScore >= 0 ? 'text-amber-600' : 'text-red-600'}`}>
            {summary.npsScore > 0 ? '+' : ''}{summary.npsScore}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">{summary.npsScore >= 50 ? 'Excellent' : summary.npsScore >= 0 ? 'Room to improve' : 'Needs attention'}</p>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground uppercase">Avg Score</p>
          <p className="text-3xl font-bold mt-1">{summary.avgScore}/10</p>
          <p className="text-[10px] text-muted-foreground mt-1">{summary.total} responses</p>
        </div>
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 p-4 bg-emerald-50 dark:bg-emerald-950/20">
          <p className="text-xs text-emerald-700 dark:text-emerald-400 uppercase">Promoters</p>
          <p className="text-2xl font-bold mt-1 text-emerald-600">{summary.promoters}</p>
          <p className="text-[10px] text-muted-foreground">9-10 score</p>
        </div>
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 p-4 bg-amber-50 dark:bg-amber-950/20">
          <p className="text-xs text-amber-700 dark:text-amber-400 uppercase">Passives</p>
          <p className="text-2xl font-bold mt-1 text-amber-600">{summary.passives}</p>
          <p className="text-[10px] text-muted-foreground">7-8 score</p>
        </div>
        <div className="rounded-lg border border-red-200 dark:border-red-900 p-4 bg-red-50 dark:bg-red-950/20">
          <p className="text-xs text-red-700 dark:text-red-400 uppercase">Detractors</p>
          <p className="text-2xl font-bold mt-1 text-red-600">{summary.detractors}</p>
          <p className="text-[10px] text-muted-foreground">0-6 score</p>
        </div>
      </div>

      {/* Feedback list */}
      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold mb-3">All Feedback ({feedback.length})</h2>
        {feedback.length === 0 ? (
          <div className="py-8 text-center">
            <MessageSquare className="w-10 h-10 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">No feedback collected yet</p>
            <p className="text-xs text-muted-foreground mt-1">Add an NPS survey to the main app to start collecting</p>
          </div>
        ) : (
          <div className="space-y-2">
            {feedback.map((f: any) => (
              <div key={f.id} className="flex items-start gap-3 py-3 border-b border-border last:border-0">
                <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${
                  f.score >= 9 ? 'bg-emerald-100 text-emerald-700' :
                  f.score >= 7 ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {f.score}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{f.userName || f.userEmail || 'Anonymous'}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${
                      f.category === 'promoter' ? 'bg-emerald-100 text-emerald-700' :
                      f.category === 'passive' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>{f.category}</span>
                  </div>
                  {f.feedback && <p className="text-sm text-muted-foreground mt-1">"{f.feedback}"</p>}
                  <p className="text-[10px] text-muted-foreground mt-0.5">{formatRelativeTime(f.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* NPS explainer */}
      <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900 p-4">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          💡 NPS = % Promoters (9-10) − % Detractors (0-6). Score range: -100 to +100.
          50+ = Excellent, 0-49 = Good, below 0 = Needs improvement.
          To collect feedback, add an NPS survey widget to the main app.
        </p>
      </div>
    </div>
  )
}
