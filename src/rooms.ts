import { Hono } from 'hono'
import { eq, and, ne, count } from 'drizzle-orm'
import { getDb } from './db'
import { rooms, roomPlayers, users } from './db/schema'
import { requireAuth } from './authMiddleware'

type Bindings = { DB: D1Database }
type Variables = { userId: number }

export const roomsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

roomsRoutes.use('*', requireAuth)

// لیست روم‌های باز (با تعداد بازیکن هر کدوم)
roomsRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB)

  const roomList = await db
    .select({
      id: rooms.id,
      name: rooms.name,
      status: rooms.status,
      created_at: rooms.created_at,
      player_count: count(roomPlayers.user_id),
    })
    .from(rooms)
    .leftJoin(roomPlayers, eq(roomPlayers.room_id, rooms.id))
    .where(ne(rooms.status, 'finished'))
    .groupBy(rooms.id)

  return c.json({ rooms: roomList })
})

// ساخت روم جدید
roomsRoutes.post('/', async (c) => {
  const userId = c.get('userId')
  const db = getDb(c.env.DB)

  const [user] = await db.select().from(users).where(eq(users.id, userId))
  if (user?.active_room_id) {
    return c.json({ error: 'شما همین الان توی یه روم دیگه‌اید' }, 409)
  }

  const { name } = await c.req.json<{ name: string }>()
  const roomId = crypto.randomUUID()

  await db.batch([
    db.insert(rooms).values({
      id: roomId,
      name: name || 'بازی جدید',
      status: 'waiting',
      created_by: userId,
      created_at: Date.now(),
    }),
    db.insert(roomPlayers).values({ room_id: roomId, user_id: userId }),
    db.update(users).set({ active_room_id: roomId }).where(eq(users.id, userId)),
  ])

  return c.json({ roomId })
})

// join به روم موجود
roomsRoutes.post('/:id/join', async (c) => {
  const userId = c.get('userId')
  const roomId = c.req.param('id')
  const db = getDb(c.env.DB)

  const [user] = await db.select().from(users).where(eq(users.id, userId))
  if (user?.active_room_id) {
    return c.json({ error: 'شما همین الان توی یه روم دیگه‌اید' }, 409)
  }

  const [room] = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.id, roomId), ne(rooms.status, 'finished')))

  if (!room) return c.json({ error: 'room not found or finished' }, 404)

  await db.batch([
    db.insert(roomPlayers).values({ room_id: roomId, user_id: userId }),
    db.update(users).set({ active_room_id: roomId }).where(eq(users.id, userId)),
  ])

  return c.json({ ok: true, roomId })
})