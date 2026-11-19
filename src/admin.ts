import { Hono } from 'hono'
import { eq, sql, desc, asc, ne, and } from 'drizzle-orm'
import { getDb } from './db'
import { users, rooms, sessions, roomPlayers, telegramGroups } from './db/schema'
import { requireAdmin } from './adminMiddleware'
import { markRoomFinishedAndClearPlayers } from './db/roomCleanup'
import { runWeeklyReminderJob, sendTestReminder } from './bot/reminderJob'
import { tgCall } from './bot/telegramApi'

type Bindings = { DB: D1Database; ROOM_DO: DurableObjectNamespace; TELEGRAM_BOT_TOKEN: string ,WEBHOOK_SECRET?: string}
type Variables = { userId: number }

export const adminRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

adminRoutes.use('*', requireAdmin)

async function closeRoomDO(env: Bindings, roomId: string) {
  const id = env.ROOM_DO.idFromName(roomId)
  const stub = env.ROOM_DO.get(id)
  await stub.fetch('https://internal/admin-close')
}

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
    .set({ status: 'closed' })
    .where(and(eq(rooms.created_by, id), ne(rooms.status, 'closed')))
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

  if (body.status === 'closed') {
    // این بخش اضافه شد: هم D1 هم DO با هم هماهنگ بسته بشن
    await markRoomFinishedAndClearPlayers(c.env.DB, id)
    await closeRoomDO(c.env, id)
    if ('name' in body) {
      // اگه ادمین همزمان اسم رو هم عوض کرده بود، چون markRoomFinishedAndClearPlayers فقط status رو دست می‌زنه، اسم رو جدا آپدیت می‌کنیم
      await db.update(rooms).set({ name: body.name }).where(eq(rooms.id, id))
    }
  } else {
    await db.update(rooms).set(allowed).where(eq(rooms.id, id))
  }

  const [updated] = await db.select().from(rooms).where(eq(rooms.id, id))
  return c.json({ room: updated })
})

adminRoutes.delete('/rooms/:id', async (c) => {
  const db = getDb(c.env.DB)
  const id = c.req.param('id')

  // ۱. بستن Durable Object مربوط به روم در حافظه
  await closeRoomDO(c.env, id)

  // ۲. پاک کردن بازیکنان این روم از جدول واسط
  await db.delete(roomPlayers).where(eq(roomPlayers.room_id, id))

  // ۳. آزاد کردن کاربرانی که در این روم بودند (تا در روم گیر نکنند)
  await db.update(users).set({ active_room_id: null }).where(eq(users.active_room_id, id))

  // ۴. آزاد کردن گروه‌هایی که به این روم متصل بودند
  // (اگر جدول telegramGroups در فایل شما ایمپورت شده باشد)
  await db.update(telegramGroups).set({ active_room_id: null }).where(eq(telegramGroups.active_room_id, id))

  // ۵. حالا با خیال راحت روم را حذف می‌کنیم
  await db.delete(rooms).where(eq(rooms.id, id))

  return c.json({ ok: true })
})

adminRoutes.post('/test-reminder/:userId', async (c) => {
  const userId = Number(c.req.param('userId'))
  const sent = await sendTestReminder(c.env.DB, c.env.TELEGRAM_BOT_TOKEN, userId)
  return c.json({ sent })
})

const BOT_COMMANDS = [
  { command: 'start', description: 'شروع و ورود به بازی' },
  { command: 'play', description: 'ورود به بازی' },
  { command: 'stats', description: 'آمار من / برترین‌های گروه' },
  { command: 'close', description: 'بستن میز بازی گروه (ادمین)' },
]

async function botReport(env: Bindings, origin: string) {
  const token = env.TELEGRAM_BOT_TOKEN
  const [me, hook] = await Promise.all([tgCall<any>(token, 'getMe'), tgCall<any>(token, 'getWebhookInfo')])
  const expected = `${origin}/bot/webhook`
  return {
    bot: me.result?.username ?? null,
    expectedUrl: expected,
    urlMatches: hook.result?.url === expected,
    pendingUpdates: hook.result?.pending_update_count,
    lastError: hook.result?.last_error_message ?? null, // اگر ربات جواب نمی‌دهد، اینجا دلیل را می‌نویسد
  }
}

adminRoutes.get('/bot/status', async (c) => c.json(await botReport(c.env, new URL(c.req.url).origin)))

adminRoutes.post('/bot/setup', async (c) => {
  const origin = new URL(c.req.url).origin
  const token = c.env.TELEGRAM_BOT_TOKEN
  const webhook = await tgCall(token, 'setWebhook', {
    url: `${origin}/bot/webhook`,
    allowed_updates: ['message', 'my_chat_member'],
    drop_pending_updates: true,   // update‌های انباشته‌ی قدیمی دور ریخته می‌شوند
    ...(c.env.WEBHOOK_SECRET ? { secret_token: c.env.WEBHOOK_SECRET } : {}),
  })
  const commands = await tgCall(token, 'setMyCommands', { commands: BOT_COMMANDS })
  return c.json({ webhook: webhook.ok, commands: commands.ok, ...(await botReport(c.env, origin)) })
})