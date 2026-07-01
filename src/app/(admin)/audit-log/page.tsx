import { db } from '@/lib/db'
import { formatRelativeTime } from '@/lib/utils'
import { ScrollText } from 'lucide-react'

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

export default async function AuditLogPage() {
  const actions = await getAuditLog()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ScrollText className="w-6 h-6 text-slate-600" />
          Audit Log
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Every admin action is permanently recorded (last 100)</p>
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
              {actions.map(action => (
                <tr key={action.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <code className="text-xs bg-muted px-2 py-0.5 rounded">{action.action}</code>
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
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900 p-4">
        <p className="text-xs text-amber-700 dark:text-amber-300">
          🔒 Audit logs are permanent and cannot be deleted. They're required for:
          DPDP Act compliance, security forensics, dispute resolution, and investor due diligence.
        </p>
      </div>
    </div>
  )
}
