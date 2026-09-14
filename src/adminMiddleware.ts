import { Context, Next } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { sessions, users } from './db/schema'

type Bindings = { DB: D1Database }
type Variables = { userId: number }

export async function requireAdmin(c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'no token provided' }, 401)

  const db = getDb(c.env.DB)
  const [session] = await db.select().from(sessions).where(eq(sessions.token, token))
  if (!session) return c.json({ error: 'invalid session' }, 401)

  const [user] = await db.select().from(users).where(eq(users.id, session.user_id))
  if (!user || user.role !== 'admin') {
    return c.json({ error: 'forbidden — admin only' }, 403)
  }

  c.set('userId', user.id)
  await next()
}