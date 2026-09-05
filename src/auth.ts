import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { users, sessions } from './db/schema'
import { verifyTelegramInitData } from './telegram'

type Bindings = {
  TELEGRAM_BOT_TOKEN: string
  DB: D1Database
}

export const authRoutes = new Hono<{ Bindings: Bindings }>()

authRoutes.post('/telegram', async (c) => {
  const { initData } = await c.req.json<{ initData: string }>()
  if (!initData) return c.json({ error: 'initData is required' }, 400)

  const tgUser = await verifyTelegramInitData(initData, c.env.TELEGRAM_BOT_TOKEN)
  if (!tgUser) return c.json({ error: 'invalid initData' }, 401)

  const db = getDb(c.env.DB)

  let [user] = await db.select().from(users).where(eq(users.telegram_id, tgUser.id))

  if (!user) {
    await db.insert(users).values({
      telegram_id: tgUser.id,
      username: tgUser.username ?? null,
      first_name: tgUser.first_name,
      last_name: tgUser.last_name ?? null,
      photo_url: tgUser.photo_url ?? null,
      created_at: Date.now(),
    })

    ;[user] = await db.select().from(users).where(eq(users.telegram_id, tgUser.id))
  }

  const sessionToken = crypto.randomUUID()
  await db.insert(sessions).values({
    token: sessionToken,
    user_id: user.id,
    created_at: Date.now(),
  })

  return c.json({ user, sessionToken })
})