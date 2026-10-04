import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { users, playerStats } from '../db/schema'
import { sendTelegramDocument, sendTelegramMessage, sendTelegramPhoto } from './telegramApi'
import { formatStatsMessage } from './statsFormatter'
import { buildRadarSvg } from './radarSvg'
import { svgToPng } from './radarPng'

type Bindings = { DB: D1Database; TELEGRAM_BOT_TOKEN: string; FRONTEND_URL: string }

export const botWebhookRoutes = new Hono<{ Bindings: Bindings }>()

botWebhookRoutes.post('/', async (c) => {
  const update = await c.req.json<any>()
  const message = update.message
  if (!message?.text || !message?.chat?.id) {
    return c.json({ ok: true }) // آپدیتی که برامون مهم نیست (مثلاً ویرایش پیام)
  }

  const chatId = message.chat.id
  const text: string = message.text.trim()
  const db = getDb(c.env.DB)

  if (text === '/start') {
    await sendTelegramMessage(
      c.env.TELEGRAM_BOT_TOKEN,
      chatId,
      `سلام! 👋 برای شروع بازی روی دکمه‌ی زیر بزن.`
    )
    return c.json({ ok: true })
  }

  // if (text === '/stats') {
  //   const [user] = await db.select().from(users).where(eq(users.telegram_id, chatId))
  //   if (!user) {
  //     await sendTelegramMessage(c.env.TELEGRAM_BOT_TOKEN, chatId, 'هنوز توی بازی ثبت‌نام نکردی. اول یه بار از دکمه‌ی بازی وارد شو.')
  //     return c.json({ ok: true })
  //   }

  //   const [stats] = await db.select().from(playerStats).where(eq(playerStats.user_id, user.id))
  //   const text = formatStatsMessage(user.first_name ?? 'بازیکن', stats ?? null)
  //   await sendTelegramMessage(c.env.TELEGRAM_BOT_TOKEN, chatId, text)
  //   return c.json({ ok: true })
  // }
  if (text === '/stats') {
  const [user] = await db.select().from(users).where(eq(users.telegram_id, chatId))
  if (!user) {
    await sendTelegramMessage(
      c.env.TELEGRAM_BOT_TOKEN,
      chatId,
      'هنوز توی بازی ثبت‌نام نکردی. اول یه بار از دکمه‌ی بازی وارد شو.'
    )
    return c.json({ ok: true })
  }

  const [stats] = await db.select().from(playerStats).where(eq(playerStats.user_id, user.id))
  const caption = formatStatsMessage(user.first_name ?? 'بازیکن', stats ?? null)

  if (stats && stats.total_games > 0) {
    const svg = buildRadarSvg(user.first_name ?? 'بازیکن', stats)
    const png = await svgToPng(svg, 600)
    await sendTelegramPhoto(c.env.TELEGRAM_BOT_TOKEN, chatId, png, caption)
  } else {
    await sendTelegramMessage(c.env.TELEGRAM_BOT_TOKEN, chatId, caption)
  }

  return c.json({ ok: true })
}

  return c.json({ ok: true })
})

// endpoint جدا که خود فایل SVG رو serve می‌کنه (باید عمومی باشه چون تلگرام از بیرون بهش دسترسی پیدا می‌کنه)
botWebhookRoutes.get('/radar/:userId', async (c) => {
  const userId = Number(c.req.param('userId'))
  const db = getDb(c.env.DB)

  const [row] = await db
    .select({
      total_games: playerStats.total_games,
      total_wins: playerStats.total_wins,
      total_kills: playerStats.total_kills,
      total_coups: playerStats.total_coups,
      total_successful_bluffs: playerStats.total_successful_bluffs,
      total_caught_bluffs: playerStats.total_caught_bluffs,
      total_correct_challenges: playerStats.total_correct_challenges,
      total_wrong_challenges: playerStats.total_wrong_challenges,
      first_name: users.first_name,
    })
    .from(playerStats)
    .innerJoin(users, eq(users.id, playerStats.user_id))
    .where(eq(playerStats.user_id, userId))

  if (!row) return c.text('not found', 404)

  const svg = buildRadarSvg(row.first_name ?? 'بازیکن', row)
  return c.body(svg, 200, { 'Content-Type': 'image/svg+xml' })
})