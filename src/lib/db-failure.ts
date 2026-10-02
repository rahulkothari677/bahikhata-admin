/**
 * Turn a database failure into a reason an operator can act on.
 *
 * 🐛 2026-10-02. Rahul upgraded a user to elite on the live panel and got
 * "Failed to update user" — the route's catch-all. The same change worked on a
 * local copy, so the cause was something only production has, and the response
 * said nothing about which. The real error went to Vercel's logs, on an account
 * neither the operator at the screen nor the engineer debugging could see from
 * where they were.
 *
 * The leading suspect is the one 20cab9b found for webhooks: the production
 * role is PURPOSE-SCOPED (db.ts recommends exactly that), and a table the panel
 * now writes may not be in its grant. Prisma has no error code for a permission
 * failure — it arrives as an unclassified error — so every such route fails
 * identically and silently. This reads the Postgres reason out of it.
 *
 * Safe to show: the panel is founder/staff-only, and a table name plus a class
 * of failure is what the person at the screen needs. No SQL, no values, no
 * connection details are ever included.
 *
 * A plain function over an unknown error, so it is tested against the real
 * shapes Prisma produces, both ways (CLAUDE.md, Cause 7).
 */

export type DbFailureKind = 'permission' | 'busy' | 'constraint' | 'unknown'

export interface DbFailure {
  kind: DbFailureKind
  /** The table Postgres named, when it named one. */
  table?: string
  /** One sentence, written for the operator. */
  message: string
}

function textOf(err: unknown): string {
  if (err instanceof Error) return `${err.message} ${(err as { code?: string }).code ?? ''}`
  return String(err ?? '')
}

export function describeDbFailure(err: unknown): DbFailure {
  const text = textOf(err)

  // 42501 — the role is not allowed to do this to this table.
  const perm = text.match(/permission denied for (?:table|relation) "?([A-Za-z_][\w]*)"?/i)
  if (perm || /\b42501\b/.test(text)) {
    const table = perm?.[1]
    return {
      kind: 'permission',
      table,
      message: table
        ? `The database login used by the admin panel is not allowed to write to "${table}". A database grant is needed — nothing was changed.`
        : 'The database login used by the admin panel is not allowed to make this change. A database grant is needed — nothing was changed.',
    }
  }

  // P2028 / P2024 — the transaction or the connection pool ran out of time.
  if (/\bP20(28|24)\b|Transaction already closed|Unable to start a transaction|Timed out fetching a new connection/i.test(text)) {
    return {
      kind: 'busy',
      message: 'The database was too busy to finish this change, so nothing was saved. Try again in a moment.',
    }
  }

  // 23xxx — a rule in the database rejected the row.
  const rule = text.match(/violates (?:not-null|check|foreign key|unique) constraint "?([\w]+)"?/i)
  if (rule || /\bP2002\b|\bP2003\b|\bP2011\b/.test(text)) {
    return {
      kind: 'constraint',
      message: `The database rejected the change${rule ? ` (rule "${rule[1]}")` : ''}. Nothing was saved.`,
    }
  }

  return { kind: 'unknown', message: 'The change could not be saved. Nothing was changed.' }
}
