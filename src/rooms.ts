import { Hono } from 'hono'
import { eq, and, ne, like, count, desc } from 'drizzle-orm'
import { getDb } from './db'
import { rooms, roomPlayers, users } from './db/schema'
import { requireAuth } from './authMiddleware'
import { MAX_PLAYERS_PER_ROOM, generateJoinCode } from './game-logic/matchmakingConfig'
import { currentRoomOf } from './db/activeRoom'

type Bindings = { DB: D1Database }
type Variables = { userId: number }
type Db = ReturnType<typeof getDb>

export const roomsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()
roomsRoutes.use('*', requireAuth)

// لیست روم‌های عمومی لابی؛ صفحه‌بندی و جستجوی اسم سمت سرور
roomsRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB)
  const page = Math.max(1, Number(c.req.query('page') || '1'))
  const size = Math.min(50, Math.max(1, Number(c.req.query('size') || '10')))
  const q = (c.req.query('q') || '').trim().slice(0, 40)

  // and() آرگومان undefined را نادیده می‌گیرد؛ پس بدون q فیلتر اسم اعمال نمی‌شود
  const where = and(
    eq(rooms.origin, 'lobby'),
    eq(rooms.visibility, 'public'),
    ne(rooms.status, 'closed'),
    q ? like(rooms.name, `%${q}%`) : undefined
  )

  const [list, [{ total }]] = await Promise.all([
    db
      .select({
        id: rooms.id,
        name: rooms.name,
        status: rooms.status,
        created_at: rooms.created_at,
        creator_name: users.first_name,
        player_count: count(roomPlayers.user_id),
      })
      .from(rooms)
      .leftJoin(roomPlayers, eq(roomPlayers.room_id, rooms.id))
      .leftJoin(users, eq(users.id, rooms.created_by))
      .where(where)
      .groupBy(rooms.id)
      .orderBy(desc(rooms.created_at))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ total: count(rooms.id) }).from(rooms).where(where),
  ])

  return c.json({ rooms: list, totalElements: Number(total), page, size })
})

// ساخت روم؛ برای خصوصی، کد ۶ حرفی ساخته می‌شود
roomsRoutes.post('/', async (c) => {
  const userId = c.get('userId')
  const db = getDb(c.env.DB)

  const [user] = await db.select().from(users).where(eq(users.id, userId))
  if (user && (await currentRoomOf(db, user))) return c.json({ error: 'شما همین الان توی یه روم دیگه‌اید' }, 409)

  const body = await c.req.json<{ name?: string; visibility?: string }>().catch(() => ({} as any))
  const name = (body.name || '').trim().slice(0, 40) || 'بازی جدید'
  const visibility = body.visibility === 'private' ? 'private' : 'public'

  // ایندکس یکتای join_code ممکن است (به‌ندرت) برخورد کند؛ برای خصوصی چند بار تلاش می‌کنیم
  for (let attempt = 0; attempt < 5; attempt++) {
    const roomId = crypto.randomUUID()
    const joinCode = visibility === 'private' ? generateJoinCode() : null
    try {
      await db.batch([
        db.insert(rooms).values({
          id: roomId, name, status: 'waiting', origin: 'lobby', visibility,
          join_code: joinCode, cost_required: 0, created_by: userId, created_at: Date.now(),
        }),
        db.insert(roomPlayers).values({ room_id: roomId, user_id: userId }),
        db.update(users).set({ active_room_id: roomId }).where(eq(users.id, userId)),
      ])
      return c.json({ roomId, joinCode })
    } catch (e) {
      if (visibility !== 'private') throw e
    }
  }
  return c.json({ error: 'ساخت روم ناموفق بود، دوباره امتحان کنید' }, 500)
})

// منطق مشترک ورود (برای ورود با id و با کد)
export async function tryJoin(db: Db, userId: number, room: typeof rooms.$inferSelect) {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  if (!user) return { status: 404, body: { error: 'کاربر پیدا نشد' } }

  const active = await currentRoomOf(db, user)
  if (active === room.id) return { status: 200, body: { ok: true, roomId: room.id } }
  if (active) return { status: 409, body: { error: 'شما همین الان توی یه روم دیگه‌اید' } }

  if (room.status === 'playing') return { status: 409, body: { error: 'بازی در جریان است؛ بعد از پایان دست دوباره امتحان کنید' } }
  if (room.status !== 'waiting' && room.status !== 'starting') return { status: 409, body: { error: 'این روم بسته است' } }

  const [{ n }] = await db.select({ n: count(roomPlayers.user_id) }).from(roomPlayers).where(eq(roomPlayers.room_id, room.id))
  if (Number(n) >= MAX_PLAYERS_PER_ROOM) return { status: 409, body: { error: 'روم پر است' } }

  await db.batch([
    db.insert(roomPlayers).values({ room_id: room.id, user_id: userId }).onConflictDoNothing(),
    db.update(users).set({ active_room_id: room.id }).where(eq(users.id, userId)),
  ])
  return { status: 200, body: { ok: true, roomId: room.id } }
}

// ورود با کد (روم خصوصی). این مسیر باید قبل از '/:id/join' تعریف شود
roomsRoutes.post('/join-by-code', async (c) => {
  const db = getDb(c.env.DB)
  const { code } = await c.req.json<{ code?: string }>().catch(() => ({} as any))
  const clean = String(code || '').trim().toUpperCase()

  // پاسخ «کد اشتباه» و «روم بسته» یکسان است تا کسی نتواند کدها را حدس بزند
  if (clean.length !== 6) return c.json({ error: 'کدی با این مشخصات پیدا نشد' }, 404)
  const [room] = await db.select().from(rooms).where(and(eq(rooms.join_code, clean), ne(rooms.status, 'closed')))
  if (!room) return c.json({ error: 'کدی با این مشخصات پیدا نشد' }, 404)

  const r = await tryJoin(db, c.get('userId'), room)
  return c.json(r.body, r.status as any)
})

// ورود با id؛ فقط روم عمومی لابی
roomsRoutes.post('/:id/join', async (c) => {
  const db = getDb(c.env.DB)
  const [room] = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.id, c.req.param('id')), eq(rooms.origin, 'lobby'), eq(rooms.visibility, 'public')))
  if (!room || room.status === 'closed') return c.json({ error: 'روم پیدا نشد' }, 404)

  const r = await tryJoin(db, c.get('userId'), room)
  return c.json(r.body, r.status as any)
})