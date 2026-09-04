import { Hono } from 'hono'
import { requireAuth } from './authMiddleware'

type Bindings = { DB: D1Database }
type Variables = { userId: number }

export const roomsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

roomsRoutes.use('*', requireAuth) // همه‌ی route های زیر این فایل، نیاز به لاگین دارن

// لیست روم‌های باز
roomsRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.name, r.status, r.created_at, COUNT(rp.user_id) as player_count
     FROM rooms r LEFT JOIN room_players rp ON rp.room_id = r.id
     WHERE r.status != 'finished'
     GROUP BY r.id ORDER BY r.created_at DESC LIMIT 50`
  ).all()
  return c.json({ rooms: results })
})

// ساخت روم جدید
roomsRoutes.post('/', async (c) => {
  const userId = c.get('userId')
  const { name } = await c.req.json<{ name: string }>()

  const roomId = crypto.randomUUID()
  await c.env.DB.prepare(
    "INSERT INTO rooms (id, name, status, created_by) VALUES (?, ?, 'waiting', ?)"
  )
    .bind(roomId, name || 'بازی جدید', userId)
    .run()

  // سازنده‌ی روم خودکار عضو روم هم می‌شه
  await c.env.DB.prepare('INSERT INTO room_players (room_id, user_id) VALUES (?, ?)')
    .bind(roomId, userId)
    .run()

  return c.json({ roomId })
})

// join به یه روم موجود
roomsRoutes.post('/:id/join', async (c) => {
  const userId = c.get('userId')
  const roomId = c.req.param('id')

  const room = await c.env.DB.prepare('SELECT id FROM rooms WHERE id = ?').bind(roomId).first()
  if (!room) return c.json({ error: 'room not found' }, 404)

  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO room_players (room_id, user_id) VALUES (?, ?)'
  )
    .bind(roomId, userId)
    .run()

  return c.json({ ok: true, roomId })
})