import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/providers'

export const metadata: Metadata = {
  title: 'BahiKhata Pro Admin',
  description: 'Admin dashboard for BahiKhata Pro — authorized personnel only',
  robots: 'noindex, nofollow', // never index admin panel
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Tell Chrome: this page is designed for light mode only.
            Prevents Chrome's force-dark flag from applying a dark filter. */}
        <meta name="color-scheme" content="light" />
      </head>
      <body className="min-h-screen bg-background antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
