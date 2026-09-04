import { Context, Next } from 'hono'

type Bindings = {
  DB: D1Database
}

// این middleware باید فقط روی route هایی بذاریم که کاربر باید لاگین باشه
export async function requireAuth(c: Context<{ Bindings: Bindings; Variables: { userId: number } }>, next: Next) {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token) {
    return c.json({ error: 'no token provided' }, 401)
  }

  const session = await c.env.DB.prepare(
    'SELECT user_id FROM sessions WHERE token = ?'
  )
    .bind(token)
    .first<{ user_id: number }>()

  if (!session) {
    return c.json({ error: 'invalid or expired session' }, 401)
  }

  c.set('userId', session.user_id) // این‌طوری بقیه‌ی route ها می‌تونن c.get('userId') بزنن
  await next()
}