import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { GlobalErrorBoundary } from '@/components/admin/global-error-boundary'
import { StepUpProvider } from '@/components/admin/step-up-provider'

/**
 * Layout for all admin pages (everything except /login).
 * Wraps everything in GlobalErrorBoundary so the panel NEVER shows
 * a white screen — always a friendly error message instead.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/login')
  }

  return (
    <GlobalErrorBoundary>
      {/* 🐛 2026-10-01: the screen that asks for an authenticator code when a
          sensitive route needs one. Without it, 24 routes refused every
          operator with no way through. See components/admin/step-up-provider. */}
      <StepUpProvider>
        <div className="flex min-h-screen bg-muted/30">
          <AdminSidebar />
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </StepUpProvider>
    </GlobalErrorBoundary>
  )
}
