import { Hono } from 'hono'
import { eq, desc } from 'drizzle-orm'
import { getDb } from '../db'
import { users, playerStats, telegramGroups, groupPlayerStats } from '../db/schema'
import { closeRoomEverywhere } from '../db/roomCleanup'
import { getBotUsername, isChatAdmin, sendTelegramDocument, sendTelegramDocumentFile, sendTelegramMessage, sendTelegramPhoto } from './telegramApi'
import { formatStatsMessage } from './statsFormatter'
import { buildRadarSvg } from './radarSvg'
import { svgToPng } from './radarPng'

type Env = {
  DB: D1Database; ROOM_DO: DurableObjectNamespace
  TELEGRAM_BOT_TOKEN: string; FRONTEND_URL: string
  MINI_APP_SHORT_NAME?: string; WEBHOOK_SECRET?: string
}
type Db = ReturnType<typeof getDb>

export const botWebhookRoutes = new Hono<{ Bindings: Env }>()

const isGroup = (t?: string) => t === 'group' || t === 'supergroup'
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))

// در گروه فقط دکمه‌ی url مجاز است (web_app مجاز نیست)
async function gameLink(env: Env, groupId: number) {
  const bot = await getBotUsername(env.TELEGRAM_BOT_TOKEN)
  const base = env.MINI_APP_SHORT_NAME ? `https://t.me/${bot}/${env.MINI_APP_SHORT_NAME}` : `https://t.me/${bot}`
  return `${base}?startapp=g${groupId}`
}

async function sendGroupPlay(env: Env, chatId: number, groupId: number) {
  return sendTelegramMessage(
    env.TELEGRAM_BOT_TOKEN, chatId,
    '🎮 <b>کودتا</b>\nبرای بازی با اعضای این گروه روی دکمه بزنید. میز گروه خودکار ساخته می‌شود و کدی لازم نیست.',
    { reply_markup: { inline_keyboard: [[{ text: '🎲 ورود به بازی گروه', url: await gameLink(env, groupId) }]] } }
  )
}

async function upsertGroup(db: Db, chat: any, addedBy?: number) {
  const find = async () => (await db.select().from(telegramGroups).where(eq(telegramGroups.telegram_chat_id, chat.id)))[0]
  const existing = await find()
  if (existing) {
    if (chat.title && chat.title !== existing.group_name) {
      await db.update(telegramGroups).set({ group_name: chat.title }).where(eq(telegramGroups.id, existing.id))
    }
    return existing
  }
  try {
    await db.insert(telegramGroups).values({
      telegram_chat_id: chat.id, group_name: chat.title ?? null,
      added_by_telegram_id: addedBy ?? null, created_at: Date.now(),
    })
  } catch { /* دو update هم‌زمان؛ ردیف را دوباره می‌خوانیم */ }
  return (await find())!
}

async function handleGroupCommand(env: Env, db: Db, msg: any, cmd: string) {
  const token = env.TELEGRAM_BOT_TOKEN
  const chatId: number = msg.chat.id
  const say = (text: string) => sendTelegramMessage(token, chatId, text)
  const group = await upsertGroup(db, msg.chat)

  if (cmd === 'start' || cmd === 'play') return void (await sendGroupPlay(env, chatId, group.id))

  if (cmd === 'stats' || cmd === 'top') {
    const rows = await db
      .select({ name: users.first_name, wins: groupPlayerStats.wins, games: groupPlayerStats.games_played })
      .from(groupPlayerStats)
      .innerJoin(users, eq(users.id, groupPlayerStats.user_id))
      .where(eq(groupPlayerStats.group_id, group.id))
      .orderBy(desc(groupPlayerStats.wins))
      .limit(5)
    return void (await say(
      rows.length
        ? '🏆 <b>برترین‌های گروه</b>\n' + rows.map((r, i) => `${i + 1}. ${esc(r.name ?? 'بازیکن')} — ${r.wins} برد از ${r.games} بازی`).join('\n')
        : 'هنوز بازی‌ای توی این گروه ثبت نشده. با /play شروع کنید!'
    ))
  }

  if (cmd === 'close') {
    if (!(await isChatAdmin(token, chatId, msg.from.id))) return void (await say('فقط ادمین‌های گروه می‌توانند میز را ببندند.'))
    if (!group.active_room_id) return void (await say('الان میز بازی وجود ندارد.'))
    await closeRoomEverywhere(env, group.active_room_id)
    await say('میز بسته شد. با /play می‌توانید میز جدید بسازید.')
  }
}

async function handlePrivateCommand(env: Env, db: Db, origin: string, msg: any, cmd: string) {
  const token = env.TELEGRAM_BOT_TOKEN
  const chatId: number = msg.chat.id

    if (cmd === 'start' || cmd === 'play') {
    // ✅ تعریف کیبورد پایین
    const replyKeyboard = {
      keyboard: [
        // [{ text: '🎮 ورود به بازی', web_app: { url: env.FRONTEND_URL } }],
        [{ text: '📊 نمودار قدرت من' }]
      ],
      resize_keyboard: true, // اندازه کیبورد متناسب با دکمه‌ها باشد
      // is_persistent: true    // کیبورد بعد از ارسال پیام، باز بماند
    };

    return void (await sendTelegramMessage(
      token, 
      chatId, 
      'سلام! 👋 برای شروع بازی و مشاهده آمار، از دکمه‌های زیر استفاده کن.', 
      { reply_markup: replyKeyboard }
    ));
  }

  if (cmd === 'stats') {
    const [user] = await db.select().from(users).where(eq(users.telegram_id, chatId))

    if (!user) {
      return void (await sendTelegramMessage(
        token,
        chatId,
        'هنوز توی بازی ثبت‌نام نکردی. اول یه بار از دکمه‌ی بازی وارد شو.'
      ))
    }

    const [stats] = await db.select().from(playerStats).where(eq(playerStats.user_id, user.id))
    const caption = formatStatsMessage(user.first_name ?? 'بازیکن', stats ?? null)

    if (stats && stats.total_games > 0) {
      const svg = buildRadarSvg(user.first_name ?? 'بازیکن', stats)
      const png = await svgToPng(svg, 600)
      await sendTelegramPhoto(token, chatId, png, caption)
    } else {
      await sendTelegramMessage(token, chatId, caption)
    }

    return
  }
}

async function handleUpdate(env: Env, origin: string, update: any) {
  const db = getDb(env.DB)

  // ربات به گروه اضافه شد
  const mcm = update.my_chat_member
  if (mcm && isGroup(mcm.chat?.type) && ['member', 'administrator'].includes(mcm.new_chat_member?.status)) {
    const group = await upsertGroup(db, mcm.chat, mcm.from?.id)
    return void (await sendGroupPlay(env, mcm.chat.id, group.id))
  }

  const msg = update.message
  if (!msg?.text || !msg.chat?.id || !msg.from?.id) return

  // /cmd  /cmd@Bot  /cmd payload
    let cmd = ''
  
  // ۱. بررسی اینکه آیا پیام یک کامند تلگرامی است (مثل /start یا /stats)
  const m = msg.text.trim().match(/^\/(\w+)(?:@(\w+))?(?:\s|$)/)
  
  if (m) {
    if (m[2] && m[2].toLowerCase() !== (await getBotUsername(env.TELEGRAM_BOT_TOKEN)).toLowerCase()) return // فرمانِ ربات دیگر
    cmd = m[1].toLowerCase()
  } 
  // ۲. بررسی اینکه آیا کاربر روی دکمه‌های کیبورد پایین کلیک کرده است
  else if (msg.text.trim() === '📊 نمودار قدرت من') {
    cmd = 'stats' // به عنوان دستور stats شناخته شود
  } 
  else {
    return // اگر پیام نه کامند بود و نه از دکمه‌های ما، نادیده بگیر
  }

  // هدایت به تابع مربوطه
  if (isGroup(msg.chat.type)) await handleGroupCommand(env, db, msg, cmd)
  else if (msg.chat.type === 'private') await handlePrivateCommand(env, db, origin, msg, cmd)
}

botWebhookRoutes.post('/', async (c) => {
  const secret = c.env.WEBHOOK_SECRET
  if (secret && c.req.header('X-Telegram-Bot-Api-Secret-Token') !== secret) return c.json({ ok: false }, 401)

  const update = await c.req.json().catch(() => null)
  if (update) {
    // فوراً ۲۰۰ می‌دهیم و کار را پشت‌صحنه انجام می‌دهیم؛ خطا هم باعث تکرار update توسط تلگرام نمی‌شود
    const origin = new URL(c.req.url).origin
    c.executionCtx.waitUntil(handleUpdate(c.env, origin, update).catch((e) => console.error('bot update failed', e)))
  }
  return c.json({ ok: true })
})

// ...مسیر GET /radar/:userId همان قبلی

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

  // const svg = buildRadarSvg(row.first_name ?? 'بازیکن', row)
  const svg = buildRadarSvg(row.first_name ?? 'بازیکن', row)
  return c.body(svg, 200, { 'Content-Type': 'image/svg+xml' })
})