import { db } from '@/lib/db'
import { formatRelativeTime } from '@/lib/utils'
import { Flag } from 'lucide-react'

export const dynamic = 'force-dynamic'

async function getFeatureFlags() {
  const flags = await db.featureFlag.findMany({
    orderBy: { key: 'asc' },
  })
  return flags
}

export default async function FeaturesPage() {
  const flags = await getFeatureFlags()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Flag className="w-6 h-6 text-blue-600" />
          Feature Flags
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Toggle features on/off without code changes</p>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {flags.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Flag className="w-10 h-10 mx-auto mb-2 opacity-50" />
            No feature flags configured
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">Key</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">Label</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {flags.map(flag => (
                <tr key={flag.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{flag.key}</td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium">{flag.label}</p>
                    {flag.description && <p className="text-xs text-muted-foreground">{flag.description}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                      flag.enabled ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                    }`}>
                      {flag.enabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    {formatRelativeTime(flag.updatedAt)}
                    {flag.updatedBy && <div>by {flag.updatedBy}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900 p-4">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          💡 Feature flags let you disable features remotely without deploying new code.
          This is useful for: emergency kill switches, gradual rollouts, A/B testing.
          Toggle changes take effect immediately for all users.
        </p>
      </div>
    </div>
  )
}
