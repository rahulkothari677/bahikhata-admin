import { db } from '@/lib/db'
import { formatRelativeTime } from '@/lib/utils'
import { ScrollText, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

export const dynamic = 'force-dynamic'

async function getAuditLog() {
  const actions = await db.adminAction.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      admin: { select: { email: true, name: true } },
    },
  })
  return actions
}

function DiffViewer({ metadata }: { metadata: any }) {
  if (!metadata) return null
  const before = metadata.before
  const after = metadata.after

  return (
    <div className="mt-2 p-2 bg-muted/30 rounded text-xs font-mono">
      {before && after ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-red-600 dark:text-red-400 font-bold mb-1">Before:</p>
            <pre className="text-red-700 dark:text-red-300">{JSON.stringify(before, null, 2)}</pre>
          </div>
          <div>
            <p className="text-emerald-600 dark:text-emerald-400 font-bold mb-1">After:</p>
            <pre className="text-emerald-700 dark:text-emerald-300">{JSON.stringify(after, null, 2)}</pre>
          </div>
        </div>
      ) : (
        <pre>{JSON.stringify(metadata, null, 2)}</pre>
      )}
    </div>
  )
}

function AuditRow({ action }: { action: any }) {
  const [expanded, setExpanded] = useState(false)
  const hasMetadata = action.metadata && Object.keys(action.metadata).length > 0

  return (
    <>
      <tr className="hover:bg-muted/30 cursor-pointer" onClick={() => hasMetadata && setExpanded(!expanded)}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            {hasMetadata && (expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)}
            <code className="text-xs bg-muted px-2 py-0.5 rounded">{action.action}</code>
          </div>
        </td>
        <td className="px-4 py-3">
          <p className="text-sm font-medium">{action.admin?.name || 'Unknown'}</p>
          <p className="text-xs text-muted-foreground">{action.admin?.email}</p>
        </td>
        <td className="px-4 py-3 text-sm">{action.description}</td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          {action.targetType && <div>{action.targetType}</div>}
          {action.targetId && <div className="font-mono">{action.targetId.slice(0, 8)}...</div>}
        </td>
        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
          {formatRelativeTime(action.createdAt)}
          {action.ip && <div className="text-[10px]">{action.ip}</div>}
        </td>
      </tr>
      {expanded && hasMetadata && (
        <tr>
          <td colSpan={5} className="px-4 pb-3">
            <DiffViewer metadata={action.metadata} />
          </td>
        </tr>
      )}
    </>
  )
}

export default async function AuditLogPage() {
  const actions = await getAuditLog()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ScrollText className="w-6 h-6 text-slate-600" />
          Audit Log
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every admin action is permanently recorded. Click a row to see before/after changes.
        </p>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {actions.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <ScrollText className="w-10 h-10 mx-auto mb-2 opacity-50" />
            No admin actions logged yet
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Action</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Admin</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Description</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Target</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase px-4 py-3">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {actions.map((action: any) => (
                <AuditRow key={action.id} action={action} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-4">
        <p className="text-xs text-amber-700 dark:text-amber-300">
          🔒 Audit logs are permanent and cannot be deleted. Click any row with a ▶ arrow to see the before/after diff.
          Required for: DPDP Act compliance, security forensics, dispute resolution, investor due diligence.
        </p>
      </div>
    </div>
  )
}
