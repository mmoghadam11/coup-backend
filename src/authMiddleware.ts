import { Context, Next } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { sessions } from './db/schema'

type Bindings = { DB: D1Database }
type Variables = { userId: number }

export async function requireAuth(c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token) {
    return c.json({ error: 'no token provided' }, 401)
  }

  const db = getDb(c.env.DB)
  const [session] = await db.select().from(sessions).where(eq(sessions.token, token))

  if (!session) {
    return c.json({ error: 'invalid or expired session' }, 401)
  }

  c.set('userId', session.user_id)
  await next()
}