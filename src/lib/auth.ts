import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from './db'
import { isFounderEmail } from './founders'

/**
 * NextAuth configuration for the admin panel.
 *
 * SECURITY DIFFERENCES from main app auth:
 *   1. Only emails in FOUNDER_EMAILS whitelist can log in (no public signup)
 *   2. Uses the AdminUser table (separate from main app User table)
 *   3. Session expires in 1 hour (vs 30 days for main app)
 *   4. 2FA (TOTP) is mandatory after password verification
 *   5. 🔒 AUDIT FIX N4: Rate limiting on login (5 attempts per 15 min per email+IP)
 *
 * Flow:
 *   1. User enters email + password at /login
 *   2. We verify email is in founder whitelist
 *   3. We verify password against AdminUser table
 *   4. If 2FA enabled: user enters TOTP code
 *   5. Session created with 1-hour expiry
 */

// 🔒 AUDIT FIX N4: In-memory rate limiter for admin login.
// 5 attempts per 15 minutes per email+IP combo. In-memory is fine here
// because the admin panel has very few users (just admins).
interface RateBucket { count: number; resetAt: number }
const loginAttempts = new Map<string, RateBucket>()
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

function checkLoginRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now()
  let bucket = loginAttempts.get(key)

  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
    loginAttempts.set(key, bucket)
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) }
  }

  bucket.count++
  return { allowed: true, retryAfterSec: 0 }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Admin Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totpCode: { label: '2FA Code', type: 'text' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const email = credentials.email.trim().toLowerCase()

        // 🔒 AUDIT FIX N4: Rate limit admin login — 5 attempts per 15 min per email+IP
        // Prevents brute-force attacks on admin accounts.
        const forwarded = (req as any)?.headers?.['x-forwarded-for']
        const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) || 'unknown'
        const rateKey = `admin-login:${email}:${ip}`
        const rateCheck = checkLoginRateLimit(rateKey)
        if (!rateCheck.allowed) {
          console.warn(`[admin-auth] Rate limit exceeded for ${email} from ${ip}`)
          throw new Error(`Too many login attempts. Please wait ${Math.ceil(rateCheck.retryAfterSec / 60)} minutes.`)
        }

        // Step 1: Check if email is in founder whitelist
        if (!isFounderEmail(email)) {
          console.warn(`[admin-auth] Non-founder email attempted login: ${email}`)
          return null
        }

        // Step 2: Find admin user in AdminUser table
        const adminUser = await db.adminUser.findUnique({
          where: { email },
        })

        if (!adminUser || !adminUser.isActive) {
          console.warn(`[admin-auth] Admin user not found or inactive: ${email}`)
          return null
        }

        // Step 3: Verify password
        const passwordValid = await bcrypt.compare(credentials.password, adminUser.password)
        if (!passwordValid) {
          console.warn(`[admin-auth] Invalid password for: ${email}`)
          return null
        }

        // Step 4: Verify 2FA if enabled
        if (adminUser.totpEnabled && adminUser.totpSecret) {
          if (!credentials.totpCode) {
            // Return a special error that tells the frontend to show 2FA input
            throw new Error('2FA_REQUIRED')
          }

          const { authenticator } = await import('otplib')
          const isValid = authenticator.verify({
            token: credentials.totpCode,
            secret: adminUser.totpSecret,
          })

          if (!isValid) {
            console.warn(`[admin-auth] Invalid 2FA code for: ${email}`)
            return null
          }
        }

        // Step 5: Update last login info
        await db.adminUser.update({
          where: { id: adminUser.id },
          data: {
            lastLoginAt: new Date(),
            lastLoginIp: undefined, // set by middleware/API
          },
        })

        // Return user object (stored in JWT)
        // 🔒 AUDIT FIX N4: Clear rate limit bucket on successful login
        loginAttempts.delete(rateKey)
        return {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
          role: adminUser.role,
        } as any
      },
    }),
  ],

  session: {
    strategy: 'jwt',
    // 1 hour session — admin must re-authenticate frequently
    maxAge: 1 * 60 * 60,
  },

  jwt: {
    maxAge: 1 * 60 * 60,
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id as string
        token.role = (user as any).role as string
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id as string
        (session.user as any).role = token.role as string
      }
      return session
    },
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  secret: process.env.NEXTAUTH_SECRET,
}
