import { Hono } from 'hono'
import { eq, sql, desc, asc, ne, and } from 'drizzle-orm'
import { getDb } from './db'
import { users, rooms, sessions, roomPlayers, telegramGroups, reactions, userReactions } from './db/schema'
import { requireAdmin } from './adminMiddleware'
import { markRoomFinishedAndClearPlayers } from './db/roomCleanup'
import { runWeeklyReminderJob, sendTestReminder } from './bot/reminderJob'
import { tgCall } from './bot/telegramApi'
import { validateReactionInput, PREMIUM_CURRENCY, CATEGORY_LABELS } from './game-logic/reactionRules'
import { listReactionDefs, seedReactionsIfEmpty } from './db/reactionCatalogRepo'
import { getAllBooleanSettings, setBooleanSetting, SETTING_DEFAULTS } from './db/appSettings'

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
  await db.delete(userReactions).where(eq(userReactions.user_id, id))
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

// ---- reactions ----

// فهرست کامل (فعال و غیرفعال) + تعداد مالکان هر واکنش + اطلاعات لازم برای فرم
adminRoutes.get('/reactions', async (context) => {
  const db = getDb(context.env.DB)
  const [reactionDefs, ownerCountRows] = await Promise.all([
    listReactionDefs(context.env.DB, false),
    db.select({ reactionId: userReactions.reaction_id, total: sql<number>`count(*)` })
      .from(userReactions)
      .groupBy(userReactions.reaction_id),
  ])
  const ownerCountById = new Map(ownerCountRows.map((ownerCountRow) => [ownerCountRow.reactionId, Number(ownerCountRow.total)]))

  return context.json({
    reactions: reactionDefs.map((reactionDef) => ({ ...reactionDef, ownerCount: ownerCountById.get(reactionDef.id) ?? 0 })),
    categories: CATEGORY_LABELS,
    currency: PREMIUM_CURRENCY,
  })
})

// ساخت داده‌ی اولیه؛ اگر جدول خالی نباشد چیزی اضافه نمی‌کند
adminRoutes.post('/reactions/seed', async (context) =>
  context.json({ inserted: await seedReactionsIfEmpty(context.env.DB) }))

adminRoutes.post('/reactions', async (context) => {
  const { errorMessage, cleaned } = validateReactionInput(await context.req.json().catch(() => ({})), true)
  if (errorMessage || !cleaned) return context.json({ error: errorMessage }, 400)

  const db = getDb(context.env.DB)
  const [duplicateRow] = await db.select({ id: reactions.id }).from(reactions).where(eq(reactions.id, cleaned.id!))
  if (duplicateRow) return context.json({ error: 'این شناسه قبلاً وجود دارد' }, 409)

  await db.insert(reactions).values({
    id: cleaned.id!,
    glyph: cleaned.glyph!,
    label: cleaned.label!,
    category: cleaned.category ?? 'tease',
    comments: JSON.stringify(cleaned.comments),
    price: cleaned.price ?? 0,
    mature: cleaned.mature ? 1 : 0,
    active: cleaned.active === false ? 0 : 1,
    sort: cleaned.sort ?? 0,
    created_at: Date.now(),
  })
  return context.json({ ok: true })
})

adminRoutes.patch('/reactions/:id', async (context) => {
  const reactionId = context.req.param('id')
  const { errorMessage, cleaned } = validateReactionInput(await context.req.json().catch(() => ({})), false)
  if (errorMessage || !cleaned) return context.json({ error: errorMessage }, 400)

  const db = getDb(context.env.DB)
  const [existingRow] = await db.select({ id: reactions.id }).from(reactions).where(eq(reactions.id, reactionId))
  if (!existingRow) return context.json({ error: 'واکنش پیدا نشد' }, 404)

  // فقط فیلدهایی که فرستاده شده‌اند؛ شناسه هیچ‌وقت عوض نمی‌شود
  const changes: Partial<typeof reactions.$inferInsert> = {}
  if (cleaned.glyph !== undefined) changes.glyph = cleaned.glyph
  if (cleaned.label !== undefined) changes.label = cleaned.label
  if (cleaned.category !== undefined) changes.category = cleaned.category
  if (cleaned.comments !== undefined) changes.comments = JSON.stringify(cleaned.comments)
  if (cleaned.price !== undefined) changes.price = cleaned.price
  if (cleaned.mature !== undefined) changes.mature = cleaned.mature ? 1 : 0
  if (cleaned.active !== undefined) changes.active = cleaned.active ? 1 : 0
  if (cleaned.sort !== undefined) changes.sort = cleaned.sort
  if (!Object.keys(changes).length) return context.json({ error: 'تغییری ارسال نشده' }, 400)

  await db.update(reactions).set(changes).where(eq(reactions.id, reactionId))
  return context.json({ ok: true })
})

// حذف سخت فقط وقتی هیچ‌کس مالک نیست؛ وگرنه باید غیرفعال شود تا خرید کاربران از بین نرود
adminRoutes.delete('/reactions/:id', async (context) => {
  const reactionId = context.req.param('id')
  const db = getDb(context.env.DB)

  const [ownerRow] = await db.select({ userId: userReactions.user_id })
    .from(userReactions).where(eq(userReactions.reaction_id, reactionId)).limit(1)
  if (ownerRow) return context.json({ error: 'این واکنش مالک دارد؛ به‌جای حذف، غیرفعالش کن' }, 409)

  await db.delete(reactions).where(eq(reactions.id, reactionId))
  return context.json({ ok: true })
})

// دادن مالکیت به یک کاربر (برای تست واکنش‌های پولی؛ بعداً مسیر خرید همین کار را می‌کند)
adminRoutes.post('/reactions/:id/grant', async (context) => {
  const reactionId = context.req.param('id')
  const requestBody: any = await context.req.json().catch(() => ({}))
  const targetUserId = Number(requestBody.userId)
  if (!Number.isInteger(targetUserId)) return context.json({ error: 'شناسه‌ی کاربر نامعتبر است' }, 400)

  const db = getDb(context.env.DB)
  const [[reactionRow], [userRow]] = await Promise.all([
    db.select({ id: reactions.id }).from(reactions).where(eq(reactions.id, reactionId)),
    db.select({ id: users.id }).from(users).where(eq(users.id, targetUserId)),
  ])
  if (!reactionRow || !userRow) return context.json({ error: 'واکنش یا کاربر پیدا نشد' }, 404)

  await db.insert(userReactions)
    .values({ user_id: targetUserId, reaction_id: reactionId, acquired_at: Date.now() })
    .onConflictDoNothing()
  return context.json({ ok: true })
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

adminRoutes.get('/settings', async (context) => context.json({ settings: await getAllBooleanSettings(context.env.DB) }))

adminRoutes.put('/settings', async (context) => {
  const requestBody: any = await context.req.json().catch(() => ({}))
  for (const [settingKey, settingValue] of Object.entries(requestBody)) {
    // فقط کلیدهای شناخته‌شده؛ ورودی دلخواه نوشته نمی‌شود
    if (settingKey in SETTING_DEFAULTS && typeof settingValue === 'boolean') {
      await setBooleanSetting(context.env.DB, settingKey, settingValue)
    }
  }
  return context.json({ settings: await getAllBooleanSettings(context.env.DB) })
})