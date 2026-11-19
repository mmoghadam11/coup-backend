import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { rooms, roomPlayers, telegramGroups, users } from './db/schema'
import { requireAuth } from './authMiddleware'
import { tryJoin } from './rooms'
import { currentRoomOf } from './db/activeRoom'
import { isChatMember } from './bot/telegramApi'

type Bindings = { DB: D1Database; TELEGRAM_BOT_TOKEN: string }
type Variables = { userId: number }

export const groupsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()
groupsRoutes.use('*', requireAuth)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// رزرو اتمیک: فقط یک نفر می‌تواند میز گروه را بسازد
const claimGroupRoom = async (d1: D1Database, groupId: number, roomId: string) =>
    (await d1.prepare('UPDATE telegram_groups SET active_room_id = ? WHERE id = ? AND active_room_id IS NULL').bind(roomId, groupId).run()).meta.changes === 1

const releaseGroupRoom = (d1: D1Database, groupId: number, roomId: string) =>
    d1.prepare('UPDATE telegram_groups SET active_room_id = NULL WHERE id = ? AND active_room_id = ?').bind(groupId, roomId).run()

// ورود به میز گروه؛ اگر میزی نیست، اولین ورودی آن را می‌سازد (بدون امتیاز ویژه)
groupsRoutes.post('/:id/enter', async (c) => {
    const db = getDb(c.env.DB)
    const userId = c.get('userId')
    const groupId = Number(c.req.param('id'))
    if (!Number.isInteger(groupId)) return c.json({ error: 'گروه نامعتبر است' }, 400)

    const [[group], [user]] = await Promise.all([
        db.select().from(telegramGroups).where(eq(telegramGroups.id, groupId)),
        db.select().from(users).where(eq(users.id, userId)),
    ])
    if (!group || !user) return c.json({ error: 'گروه پیدا نشد' }, 404)

    if (!(await isChatMember(c.env.TELEGRAM_BOT_TOKEN, group.telegram_chat_id, user.telegram_id))) {
        return c.json({ error: 'فقط اعضای این گروه می‌توانند وارد شوند' }, 403)
    }
    const myRoom = await currentRoomOf(db, user)

    for (let attempt = 0; attempt < 4; attempt++) {
        const [g] = await db.select({ active: telegramGroups.active_room_id }).from(telegramGroups).where(eq(telegramGroups.id, groupId))
        const activeId = g?.active ?? null

        if (activeId) {
            let [room] = await db.select().from(rooms).where(eq(rooms.id, activeId))

            if (room?.status === 'closed') {
                // فقط اگر هنوز closed است باز می‌کند؛ اگر نفر دیگری زودتر باز کرده باشد، اینجا چیزی تغییر نمی‌کند
                await c.env.DB
                    .prepare(`UPDATE rooms SET status = 'waiting', name = ? WHERE id = ? AND status = 'closed'`)
                    .bind(group.group_name || 'گروه', activeId).run()
                    ;[room] = await db.select().from(rooms).where(eq(rooms.id, activeId)) // دوباره بخوان
            }

            if (room) {
                const r = await tryJoin(db, userId, room)
                return c.json(r.body, r.status as any)
            }
            if (attempt < 3) { await sleep(300); continue }
            await releaseGroupRoom(c.env.DB, groupId, activeId)
        }

        if (myRoom) return c.json({ error: 'شما همین الان توی یه روم دیگه‌اید' }, 409)

        const roomId = crypto.randomUUID()
        if (!(await claimGroupRoom(c.env.DB, groupId, roomId))) continue // دیگری زودتر بود

        try {
            await db.batch([
                db.insert(rooms).values({
                    id: roomId, name: group.group_name || 'گروه', status: 'waiting', origin: 'group',
                    visibility: 'private', join_code: null, cost_required: 0, group_id: groupId,
                    created_by: userId, created_at: Date.now(),
                }),
                db.insert(roomPlayers).values({ room_id: roomId, user_id: userId }),
                db.update(users).set({ active_room_id: roomId }).where(eq(users.id, userId)),
            ])
            return c.json({ ok: true, roomId })
        } catch (e) {
            await releaseGroupRoom(c.env.DB, groupId, roomId)
            throw e
        }
    }
    return c.json({ error: 'چند لحظه بعد دوباره امتحان کنید' }, 409)
})