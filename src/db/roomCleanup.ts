    import { eq } from 'drizzle-orm'
import { getDb } from './index'
import { rooms, roomPlayers, users } from './schema'

// این تابع فقط سمت D1 کار می‌کنه: وضعیت روم finished می‌شه،
// active_room_id همه‌ی بازیکن‌هاش پاک می‌شه، و عضویت‌هاشون حذف می‌شه
export async function markRoomFinishedAndClearPlayers(d1: D1Database, roomId: string) {
  const db = getDb(d1)

  await db.update(rooms).set({ status: 'finished' }).where(eq(rooms.id, roomId))

  const playersInRoom = await db
    .select({ user_id: roomPlayers.user_id })
    .from(roomPlayers)
    .where(eq(roomPlayers.room_id, roomId))

  for (const p of playersInRoom) {
    await db.update(users).set({ active_room_id: null }).where(eq(users.id, p.user_id))
  }

  await db.delete(roomPlayers).where(eq(roomPlayers.room_id, roomId))
}