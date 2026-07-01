'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'

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
            <pre className="text-red-700 dark:text-red-300 whitespace-pre-wrap break-all">{JSON.stringify(before, null, 2)}</pre>
          </div>
          <div>
            <p className="text-emerald-600 dark:text-emerald-400 font-bold mb-1">After:</p>
            <pre className="text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap break-all">{JSON.stringify(after, null, 2)}</pre>
          </div>
        </div>
      ) : (
        <pre className="whitespace-pre-wrap break-all">{JSON.stringify(metadata, null, 2)}</pre>
      )}
    </div>
  )
}

export function AuditRow({ action }: { action: any }) {
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
