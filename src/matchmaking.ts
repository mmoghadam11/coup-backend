import { Hono } from 'hono'
import { eq, and, sql } from 'drizzle-orm'
import { getDb } from './db'
import { rooms } from './db/schema'
import { requireAuth } from './authMiddleware'
import { MAX_PLAYERS_PER_ROOM } from './game-logic/matchmakingConfig'

type Bindings = { DB: D1Database; ROOM_DO: DurableObjectNamespace }
type Variables = { userId: number }

export const matchmakingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

matchmakingRoutes.use('*', requireAuth)

matchmakingRoutes.post('/', async (c) => {
  const db = getDb(c.env.DB)
  const userId = c.get('userId')

  // قدم ۱: اول دنبال روم‌های starting با جای خالی بگرد
  let candidates = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(and(eq(rooms.origin, 'matchmaking'), eq(rooms.status, 'starting')))
    .orderBy(rooms.created_at)

  let targetRoomId = await findRoomWithSpace(c.env, candidates.map((r) => r.id))

  // قدم ۲: اگه هیچی نبود، دنبال waiting بگرد
  if (!targetRoomId) {
    candidates = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.origin, 'matchmaking'), eq(rooms.status, 'waiting')))
      .orderBy(rooms.created_at)

    targetRoomId = await findRoomWithSpace(c.env, candidates.map((r) => r.id))
  }

  // قدم ۳: اگه هنوز هیچی نبود، یه روم جدید بساز
  if (!targetRoomId) {
    targetRoomId = crypto.randomUUID()
    await db.insert(rooms).values({
      id: targetRoomId,
      name: 'بازی سریع',
      status: 'waiting',
      origin: 'matchmaking',
      created_at: Date.now(),
    })
  }

  return c.json({ roomId: targetRoomId })
})

// به هر روم کاندید، یه فراخوانی داخلی می‌زنیم که بپرسیم "جا داری؟"
async function findRoomWithSpace(env: Bindings, roomIds: string[]): Promise<string | null> {
  for (const roomId of roomIds) {
    const id = env.ROOM_DO.idFromName(roomId)
    const stub = env.ROOM_DO.get(id)
    const res = await stub.fetch('https://internal/room-info')
    if (res.ok) {
      const info = await res.json<{ playerCount: number; roomPhase: string }>()
      if (info.playerCount < MAX_PLAYERS_PER_ROOM && (info.roomPhase === 'waiting' || info.roomPhase === 'starting')) {
        return roomId
      }
    }
  }
  return null
}