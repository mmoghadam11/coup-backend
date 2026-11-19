import { eq } from 'drizzle-orm'
import type { getDb } from './index'
import { rooms, users } from './schema'

type Db = ReturnType<typeof getDb>

/** روم فعالِ معتبر کاربر؛ اگر روم بسته یا حذف شده باشد، پاکش می‌کند و null برمی‌گرداند */
export async function currentRoomOf(db: Db, user: { id: number; active_room_id: string | null }) {
  if (!user.active_room_id) return null
  const [room] = await db.select({ status: rooms.status }).from(rooms).where(eq(rooms.id, user.active_room_id))
  if (room && room.status !== 'closed') return user.active_room_id
  await db.update(users).set({ active_room_id: null }).where(eq(users.id, user.id))
  return null
}