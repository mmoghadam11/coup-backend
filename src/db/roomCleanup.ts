import { eq } from 'drizzle-orm'
import { getDb } from './index'
import { rooms, roomPlayers, users, telegramGroups } from './schema'

// پاک‌سازی سمت D1. کاربرها از روی users.active_room_id پیدا می‌شوند، نه room_players،
// چون روم matchmaking ردیف room_players ندارد
export async function markRoomFinishedAndClearPlayers(d1: D1Database, roomId: string) {
  const db = getDb(d1)
  await db.update(rooms).set({ status: 'closed' }).where(eq(rooms.id, roomId))
  await db.update(users).set({ active_room_id: null }).where(eq(users.active_room_id, roomId))
  // await db.update(telegramGroups).set({ active_room_id: null }).where(eq(telegramGroups.active_room_id, roomId))
  await db.delete(roomPlayers).where(eq(roomPlayers.room_id, roomId))
}

// بستن کامل: D1 و Durable Object با هم
export async function closeRoomEverywhere(env: { DB: D1Database; ROOM_DO: DurableObjectNamespace }, roomId: string) {
  await markRoomFinishedAndClearPlayers(env.DB, roomId)
  await env.ROOM_DO.get(env.ROOM_DO.idFromName(roomId)).fetch('https://internal/admin-close')
}