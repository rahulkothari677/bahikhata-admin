import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string | number
  delta?: string
  deltaType?: 'positive' | 'negative' | 'neutral'
  icon?: LucideIcon
  iconColor?: string
  sublabel?: string
}

export function StatCard({ label, value, delta, deltaType = 'neutral', icon: Icon, iconColor = 'text-primary', sublabel }: StatCardProps) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
          {sublabel && <p className="text-[11px] text-muted-foreground mt-0.5">{sublabel}</p>}
        </div>
        {Icon && (
          <div className="w-10 h-10 rounded-lg bg-muted/50 flex items-center justify-center">
            <Icon className={cn('w-5 h-5', iconColor)} />
          </div>
        )}
      </div>
      {delta && (
        <div className="mt-3 flex items-center gap-1">
          <span className={cn(
            'text-xs font-medium px-1.5 py-0.5 rounded',
            deltaType === 'positive' && 'bg-success/10 text-success',
            deltaType === 'negative' && 'bg-destructive/10 text-destructive',
            deltaType === 'neutral' && 'bg-muted text-muted-foreground'
          )}>
            {delta}
          </span>
        </div>
      )}
    </div>
  )
}
