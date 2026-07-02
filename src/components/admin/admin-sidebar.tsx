'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, TrendingUp, Rocket, Users as UsersIcon,
  Brain, Shield, ShieldAlert, Handshake, Key, Webhook, FlaskConical, Swords, Layers, LogOut,
  Activity, BarChart3, AlertTriangle, CreditCard,
  Target, Users2, Gift, Megaphone,
  UserCog, Headphones, MessageSquare,
  Coins, Database, FileBarChart,
  Flag, ScrollText, Settings,
  ChevronDown, ChevronRight,
  Bell, Mail, Smartphone, Send,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// =====================================================================
// NAVIGATION STRUCTURE
// =====================================================================
// 6 logical groups, each with sub-items. New features get added to the
// appropriate group. This scales to 42+ features without clutter.
//
// Design principles:
// 1. Each group is collapsible (click to expand/collapse)
// 2. Active page is highlighted
// 3. Group containing active page auto-expands
// 4. Expanded state persists in localStorage
// 5. Max 6 groups visible — cognitive load stays low
// =====================================================================

interface NavItem {
  label: string
  href: string
  icon: any
  badge?: string // optional: show count badge
}

interface NavGroup {
  id: string
  label: string
  icon: any
  color: string // tailwind text color class for the group icon
  items: NavItem[]
}

const NAV_STRUCTURE: NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    color: 'text-blue-500',
    items: [
      { label: 'Dashboard', href: '/', icon: Activity },
      { label: 'Activity Log', href: '/activity', icon: ScrollText },
    ],
  },
  {
    id: 'revenue',
    label: 'Revenue',
    icon: TrendingUp,
    color: 'text-emerald-500',
    items: [
      { label: 'MRR & Forecast', href: '/revenue', icon: BarChart3 },
      { label: 'Subscriptions', href: '/subscriptions', icon: CreditCard },
      { label: 'Revenue Recognition', href: '/revenue-recognition', icon: FileBarChart },
      { label: 'Financial Reports', href: '/financial-reports', icon: TrendingUp },
    ],
  },
  {
    id: 'growth',
    label: 'Growth',
    icon: Rocket,
    color: 'text-amber-500',
    items: [
      { label: 'Funnel Analytics', href: '/growth', icon: Target },
      { label: 'User Segments', href: '/segments', icon: Users2 },
      { label: 'Feedback (NPS)', href: '/feedback', icon: MessageSquare },
      { label: 'A/B Testing', href: '/experiments', icon: FlaskConical },
      { label: 'Competitors', href: '/competitors', icon: Swords },
    ],
  },
  {
    id: 'engagement',
    label: 'Engagement',
    icon: Megaphone,
    color: 'text-pink-500',
    items: [
      { label: 'Notification Templates', href: '/notification-templates', icon: Bell },
      { label: 'Send Notifications', href: '/notifications', icon: Send },
      { label: 'Campaigns', href: '/campaigns', icon: Megaphone },
    ],
  },
  {
    id: 'users',
    label: 'Users',
    icon: UsersIcon,
    color: 'text-violet-500',
    items: [
      { label: 'All Users', href: '/users', icon: UserCog },
      { label: 'Support Tickets', href: '/support', icon: Headphones },
      { label: 'Bulk Operations', href: '/bulk-jobs', icon: Layers },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    icon: Brain,
    color: 'text-orange-500',
    items: [
      { label: 'AI Usage & Cost', href: '/ai-usage', icon: Coins },
      { label: 'Data Monetization', href: '/data', icon: Database },
      { label: 'Anomaly Detection', href: '/anomalies', icon: Activity },
      { label: 'Partners', href: '/partners', icon: Handshake },
      { label: 'API Keys', href: '/api-keys', icon: Key },
      { label: 'Webhooks', href: '/webhooks', icon: Webhook },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: Shield,
    color: 'text-slate-500',
    items: [
      { label: 'Feature Flags', href: '/features', icon: Flag },
      { label: 'Risk & Compliance', href: '/risk', icon: AlertTriangle },
      { label: 'Fraud Rules', href: '/fraud-rules', icon: ShieldAlert },
      { label: 'Anomaly Detection', href: '/anomalies', icon: Activity },
      { label: 'Status Page', href: '/incidents', icon: Activity },
      { label: 'Database Admin', href: '/database', icon: Database },
      { label: 'Audit Log', href: '/audit-log', icon: ScrollText },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
]

// Helper: find which group contains a given path
function findGroupForPath(pathname: string): string | null {
  for (const group of NAV_STRUCTURE) {
    for (const item of group.items) {
      // Match exact href, or href is a prefix (e.g., /segments/xxx matches /segments)
      if (pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))) {
        return group.id
      }
    }
  }
  return null
}

export function AdminSidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const activeGroup = findGroupForPath(pathname)

  // Load expanded state from localStorage, default to active group expanded
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const saved = localStorage.getItem('admin-sidebar-expanded')
      if (saved) {
        const savedArr = JSON.parse(saved) as string[]
        const savedSet = new Set<string>(savedArr)
        // Always include the active group
        if (activeGroup) savedSet.add(activeGroup)
        setExpandedGroups(savedSet)
      } else if (activeGroup) {
        setExpandedGroups(new Set([activeGroup]))
      }
    } catch {
      if (activeGroup) setExpandedGroups(new Set([activeGroup]))
    }
  }, [activeGroup])

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      // Persist to localStorage
      try {
        localStorage.setItem('admin-sidebar-expanded', JSON.stringify(Array.from(next)))
      } catch {}
      return next
    })
  }

  return (
    <aside className="w-60 bg-card border-r border-border flex flex-col h-screen sticky top-0 overflow-hidden">
      {/* Logo */}
      <div className="p-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center flex-shrink-0">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-sm truncate">BahiKhata Pro</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Admin Panel</p>
          </div>
        </div>
      </div>

      {/* Navigation — scrollable */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 scrollbar-hide">
        {NAV_STRUCTURE.map((group) => {
          const isExpanded = expandedGroups.has(group.id)
          const isActiveGroup = activeGroup === group.id
          const GroupIcon = group.icon

          return (
            <div key={group.id} className="mb-1">
              {/* Group header */}
              <button
                onClick={() => toggleGroup(group.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition',
                  isActiveGroup
                    ? 'text-foreground bg-muted/50'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                )}
              >
                <GroupIcon className={cn('w-4 h-4 flex-shrink-0', isActiveGroup && group.color)} />
                <span className="flex-1 text-left">{group.label}</span>
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                )}
              </button>

              {/* Sub-items */}
              {isExpanded && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
                  {group.items.map((item) => {
                    const isActive = pathname === item.href ||
                      (item.href !== '/' && pathname.startsWith(item.href))
                    const ItemIcon = item.icon
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition',
                          isActive
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                        )}
                      >
                        <ItemIcon className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Footer — user info + logout */}
      <div className="p-2 border-t border-border flex-shrink-0 space-y-2">
        <div className="px-3 py-2 rounded-lg bg-muted/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
              {session?.user?.name?.charAt(0).toUpperCase() || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{session?.user?.name || 'Admin'}</p>
              <p className="text-[10px] text-muted-foreground truncate">{session?.user?.email}</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
