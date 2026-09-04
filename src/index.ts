import { Hono } from 'hono'
import { verifyTelegramInitData } from './telegram'
import { cors } from 'hono/cors'
import { roomsRoutes } from './rooms'

type Bindings = {
  TELEGRAM_BOT_TOKEN: string
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('*', cors({
  origin: ['https://telegram-coup-frontend.pages.dev', 'http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.get('/', (c) => c.text('Hello Hono!'))

app.post('/auth/telegram', async (c) => {
  const { initData } = await c.req.json<{ initData: string }>()
  if (!initData) return c.json({ error: 'initData is required' }, 400)

  const tgUser = await verifyTelegramInitData(initData, c.env.TELEGRAM_BOT_TOKEN)
  if (!tgUser) return c.json({ error: 'invalid initData' }, 401)

  // کاربر رو پیدا کن یا بساز
  let user = await c.env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?')
    .bind(tgUser.id)
    .first()

  if (!user) {
    await c.env.DB.prepare(
      `INSERT INTO users (telegram_id, username, first_name, last_name, photo_url)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(tgUser.id, tgUser.username ?? null, tgUser.first_name, tgUser.last_name ?? null, tgUser.photo_url ?? null)
      .run()

    user = await c.env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?')
      .bind(tgUser.id)
      .first()
  }

  // ساخت session جدید
  const sessionToken = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)')
    .bind(sessionToken, (user as any).id)
    .run()

  return c.json({ user, sessionToken })
})
app.route('/rooms', roomsRoutes)

export default app