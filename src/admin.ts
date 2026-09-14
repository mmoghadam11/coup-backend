import { Hono } from 'hono'
import { eq, sql, desc, asc, ne, and } from 'drizzle-orm'
import { getDb } from './db'
import { users, rooms, sessions, roomPlayers } from './db/schema'
import { requireAdmin } from './adminMiddleware'

type Bindings = { DB: D1Database }
type Variables = { userId: number }

export const adminRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

adminRoutes.use('*', requireAdmin)

function parsePagination(c: any) {
  const page = Math.max(1, Number(c.req.query('page') || '1'))
  const size = Math.min(100, Math.max(1, Number(c.req.query('size') || '10')))
  const sortBy = c.req.query('sortBy') as string | undefined
  const sortDir = c.req.query('sortDir') as string | undefined
  return { page, size, offset: (page - 1) * size, sortBy, sortDir }
}

// ---- users ----

const USER_SORT_COLUMNS: Record<string, any> = {
  id: users.id,
  telegram_id: users.telegram_id,
  first_name: users.first_name,
  username: users.username,
  role: users.role,
  created_at: users.created_at,
}

adminRoutes.get('/users', async (c) => {
  const { page, size, offset, sortBy, sortDir } = parsePagination(c)
  const db = getDb(c.env.DB)

  const telegramIdSearch = c.req.query('telegram_id')

  // چون telegram_id عددیه، برای سرچ جزئی (نه فقط تطابق کامل) باید به متن تبدیلش کنیم
  const whereClause = telegramIdSearch
    ? sql`CAST(${users.telegram_id} AS TEXT) LIKE ${`%${telegramIdSearch}%`}`
    : sql`1=1` // یه شرط همیشه-درست، برای وقتی فیلتری نیست

  const orderColumn = (sortBy && USER_SORT_COLUMNS[sortBy]) || users.id
  const orderFn = sortDir === 'desc' ? desc : asc

  const [allUsers, [{ count: total }]] = await Promise.all([
    db.select().from(users).where(whereClause).orderBy(orderFn(orderColumn)).limit(size).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(users).where(whereClause),
  ])

  return c.json({ users: allUsers, totalElements: Number(total), page, size })
})

adminRoutes.patch('/users/:id', async (c) => {
  const db = getDb(c.env.DB)
  const id = Number(c.req.param('id'))
  const body = await c.req.json()

  const allowed: Partial<typeof users.$inferInsert> = {}
  if ('role' in body) allowed.role = body.role
  if ('active_room_id' in body) allowed.active_room_id = body.active_room_id
  if ('first_name' in body) allowed.first_name = body.first_name
  if ('last_name' in body) allowed.last_name = body.last_name
  if ('username' in body) allowed.username = body.username

  await db.update(users).set(allowed).where(eq(users.id, id))
  const [updated] = await db.select().from(users).where(eq(users.id, id))
  return c.json({ user: updated })
})

adminRoutes.delete('/users/:id', async (c) => {
  const db = getDb(c.env.DB)
  const id = Number(c.req.param('id'))
  // اول همه‌ی چیزهایی که به این کاربر وابسته‌ن رو پاک/جدا کن
  await db.delete(sessions).where(eq(sessions.user_id, id))
  await db.delete(roomPlayers).where(eq(roomPlayers.user_id, id))
  // روم‌های فعالی که این کاربر ساخته رو پایان بده (قبل از اینکه created_by رو null کنیم)
  await db
    .update(rooms)
    .set({ status: 'finished' })
    .where(and(eq(rooms.created_by, id), ne(rooms.status, 'finished')))
  // روم‌هایی که این کاربر ساخته رو حذف نمی‌کنیم (چون داده‌ی تاریخی مهمه)، فقط created_by رو خالی می‌کنیم
  await db.update(rooms).set({ created_by: null }).where(eq(rooms.created_by, id))
  await db.delete(users).where(eq(users.id, id))
  return c.json({ ok: true })
})

// ---- rooms ----

const ROOM_SORT_COLUMNS: Record<string, any> = {
  id: rooms.id,
  name: rooms.name,
  status: rooms.status,
  created_at: rooms.created_at,
}

adminRoutes.get('/rooms', async (c) => {
  const { page, size, offset, sortBy, sortDir } = parsePagination(c)
  const db = getDb(c.env.DB)

  const orderColumn = (sortBy && ROOM_SORT_COLUMNS[sortBy]) || rooms.created_at
  const orderFn = sortDir === 'asc' ? asc : desc

  const [allRooms, [{ count: total }]] = await Promise.all([
    db.select().from(rooms).orderBy(orderFn(orderColumn)).limit(size).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(rooms),
  ])

  return c.json({ rooms: allRooms, totalElements: Number(total), page, size })
})

adminRoutes.patch('/rooms/:id', async (c) => {
  const db = getDb(c.env.DB)
  const id = c.req.param('id')
  const body = await c.req.json()

  const allowed: Partial<typeof rooms.$inferInsert> = {}
  if ('status' in body) allowed.status = body.status
  if ('name' in body) allowed.name = body.name

  await db.update(rooms).set(allowed).where(eq(rooms.id, id))
  const [updated] = await db.select().from(rooms).where(eq(rooms.id, id))
  return c.json({ room: updated })
})

adminRoutes.delete('/rooms/:id', async (c) => {
  const db = getDb(c.env.DB)
  const id = c.req.param('id')
  await db.delete(rooms).where(eq(rooms.id, id))
  return c.json({ ok: true })
})