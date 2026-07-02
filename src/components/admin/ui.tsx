'use client'

import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'

// =====================================================================
// PAGE HEADER
// =====================================================================
// Standard header for every admin page. Contains:
// - Title (required)
// - Description (optional)
// - Actions (buttons on the right — export, filter, create, etc.)
//
// Usage:
// <PageHeader title="Users" description="Manage all users" actions={<Button>Export</Button>} />
// =====================================================================

interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 flex-shrink-0">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight truncate">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {actions}
        </div>
      )}
    </div>
  )
}

// =====================================================================
// KPI CARD
// =====================================================================
// Standard metric card. Used in grids of 2-4 max per page.
// Shows: label, value, optional delta, optional icon, optional sublabel
//
// Usage:
// <KPICard label="Total Users" value="1,234" delta="+5%" deltaType="positive" icon={Users} />
// =====================================================================

interface KPICardProps {
  label: string
  value: string | number
  delta?: string
  deltaType?: 'positive' | 'negative' | 'neutral'
  icon?: LucideIcon
  iconColor?: string
  sublabel?: string
}

export function KPICard({ label, value, delta, deltaType = 'neutral', icon: Icon, iconColor = 'text-primary', sublabel }: KPICardProps) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">{value}</p>
          {sublabel && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sublabel}</p>}
        </div>
        {Icon && (
          <div className="w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0">
            <Icon className={cn('w-4.5 h-4.5', iconColor)} />
          </div>
        )}
      </div>
      {delta && (
        <div className="mt-2">
          <span className={cn(
            'text-xs font-medium px-1.5 py-0.5 rounded',
            deltaType === 'positive' && 'bg-emerald-500/10 text-emerald-600',
            deltaType === 'negative' && 'bg-red-500/10 text-red-600',
            deltaType === 'neutral' && 'bg-muted text-muted-foreground'
          )}>
            {delta}
          </span>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// KPI GRID
// =====================================================================
// Wrapper for KPI cards — max 4, responsive grid.
// Automatically handles 2, 3, or 4 cards.
//
// Usage:
// <KPIGrid>
//   <KPICard label="Users" value="1234" />
//   <KPICard label="MRR" value="₹50K" />
// </KPIGrid>
// =====================================================================

export function KPIGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
      {children}
    </div>
  )
}

// =====================================================================
// CONTENT CARD
// =====================================================================
// Standard container for main content (tables, charts, lists).
// Has a header (title + optional action) and body.
//
// Usage:
// <ContentCard title="Recent Users" action={<Button>View All</Button>}>
//   <table>...</table>
// </ContentCard>
// =====================================================================

interface ContentCardProps {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function ContentCard({ title, action, children, className }: ContentCardProps) {
  return (
    <div className={cn('bg-card rounded-xl border border-border overflow-hidden', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

// =====================================================================
// EMPTY STATE
// =====================================================================
// Shown when a list/table has no data. Prevents "blank page" confusion.
//
// Usage:
// <EmptyState icon={Users} title="No users found" description="Try adjusting filters" />
// =====================================================================

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
}

export function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <div className="py-16 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-3">
        <Icon className="w-6 h-6 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{description}</p>}
    </div>
  )
}

// =====================================================================
// PAGINATION
// =====================================================================
// Standard pagination control. Used at the bottom of every list/table.
// Shows: "Showing X-Y of Z" + prev/next buttons.
// Client-side pagination (data already loaded, just slicing).
//
// Usage:
// <Pagination page={1} totalPages={5} total={100} pageSize={20} onPageChange={setPage} />
// =====================================================================

interface PaginationProps {
  page: number
  totalPages: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, totalPages, total, pageSize, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border">
      <p className="text-xs text-muted-foreground">
        Showing {start}-{end} of {total}
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          ← Prev
        </button>
        <span className="text-sm font-medium tabular-nums">{page} / {totalPages}</span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          Next →
        </button>
      </div>
    </div>
  )
}

// =====================================================================
// SEARCH BAR
// =====================================================================
// Standard search input with icon. Debounced in the parent component.
//
// Usage:
// <SearchBar value={search} onChange={setSearch} placeholder="Search users..." />
// =====================================================================

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function SearchBar({ value, onChange, placeholder = 'Search...' }: SearchBarProps) {
  return (
    <div className="relative flex-1">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  )
}

// =====================================================================
// LOADING STATE
// =====================================================================
// Skeleton loader for data being fetched. Prevents layout shift.
//
// Usage:
// {isLoading ? <LoadingSkeleton /> : <table>...</table>}
// =====================================================================

export function LoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 animate-pulse">
          <div className="w-8 h-8 rounded-full bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 bg-muted rounded w-1/3" />
            <div className="h-2 bg-muted rounded w-1/2" />
          </div>
          <div className="h-3 bg-muted rounded w-16" />
        </div>
      ))}
    </div>
  )
}

// =====================================================================
// BADGE
// =====================================================================
// Small status label. Color variants for different statuses.
//
// Usage:
// <Badge variant="success">Active</Badge>
// <Badge variant="warning">At Risk</Badge>
// =====================================================================

interface BadgeProps {
  variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
  children: React.ReactNode
}

export function Badge({ variant, children }: BadgeProps) {
  const variants = {
    success: 'bg-emerald-500/10 text-emerald-600',
    warning: 'bg-amber-500/10 text-amber-600',
    danger: 'bg-red-500/10 text-red-600',
    info: 'bg-blue-500/10 text-blue-600',
    neutral: 'bg-muted text-muted-foreground',
  }
  return (
    <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide', variants[variant])}>
      {children}
    </span>
  )
}
