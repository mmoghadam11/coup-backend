import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { users } from './db/schema'
import { requireAuth } from './authMiddleware'
import { normalizeSkins, parseSkins, skinCatalog } from './game-logic/skins'

type Bindings = { DB: D1Database }
type Variables = { userId: number }

export const skinsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()
skinsRoutes.use('*', requireAuth)

// انتخاب فعلی + فهرست اسکین‌هایی که سرور می‌شناسد
skinsRoutes.get('/', async (c) => {
  const [row] = await getDb(c.env.DB)
    .select({ card_skins: users.card_skins })
    .from(users)
    .where(eq(users.id, c.get('userId')))
  return c.json({ selection: parseSkins(row?.card_skins), catalog: skinCatalog() })
})

// ذخیره؛ چیزی که برمی‌گردد نسخه‌ی تمیزشده است، نه آنچه فرستاده شد
skinsRoutes.on(['PUT', 'POST', 'PATCH'], '/', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  const { selection, rejected } = normalizeSkins(body?.selection)
  await getDb(c.env.DB)
    .update(users)
    .set({ card_skins: JSON.stringify(selection) })
    .where(eq(users.id, c.get('userId')))
  return c.json({ selection, rejected })
})