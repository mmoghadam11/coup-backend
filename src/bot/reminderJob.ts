import { lt, or, isNull, eq , and, isNotNull} from 'drizzle-orm'
import { getDb } from '../db'
import { playerStats, users } from '../db/schema'
import { sendTelegramMessage } from './telegramApi'
import { formatReminderMessage } from './statsFormatter'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export async function runWeeklyReminderJob(d1: D1Database, botToken: string) {
  const db = getDb(d1)
  const now = Date.now()
  const sevenDaysAgo = now - SEVEN_DAYS_MS

  const candidates = await db
    .select({
      user_id: playerStats.user_id,
      total_games: playerStats.total_games,
      total_wins: playerStats.total_wins,
      total_kills: playerStats.total_kills,
      total_coups: playerStats.total_coups,
      total_successful_bluffs: playerStats.total_successful_bluffs,
      total_caught_bluffs: playerStats.total_caught_bluffs,
      total_correct_challenges: playerStats.total_correct_challenges,
      total_wrong_challenges: playerStats.total_wrong_challenges,
      total_steals: playerStats.total_steals,
      first_name: users.first_name,
      telegram_id: users.telegram_id,
    })
    .from(playerStats)
    .innerJoin(users, eq(users.id, playerStats.user_id))
    .where(
      and(
        isNotNull(playerStats.last_played_at),
        lt(playerStats.last_played_at, sevenDaysAgo),
        or(isNull(playerStats.last_reminder_sent_at), lt(playerStats.last_reminder_sent_at, sevenDaysAgo))
      )
    )

  for (const candidate of candidates) {
    const text = formatReminderMessage(candidate.first_name ?? 'بازیکن', candidate)
    await sendTelegramMessage(botToken, candidate.telegram_id, text)
    await db.update(playerStats).set({ last_reminder_sent_at: now }).where(eq(playerStats.user_id, candidate.user_id))
  }

  return candidates.length
}

export async function sendTestReminder(d1: D1Database, botToken: string, userId: number): Promise<boolean> {
  const db = getDb(d1)
  const [row] = await db
    .select({
      user_id: playerStats.user_id,
      total_games: playerStats.total_games,
      total_wins: playerStats.total_wins,
      total_kills: playerStats.total_kills,
      total_coups: playerStats.total_coups,
      total_successful_bluffs: playerStats.total_successful_bluffs,
      total_caught_bluffs: playerStats.total_caught_bluffs,
      total_correct_challenges: playerStats.total_correct_challenges,
      total_wrong_challenges: playerStats.total_wrong_challenges,
      total_steals: playerStats.total_steals,
      first_name: users.first_name,
      telegram_id: users.telegram_id,
    })
    .from(playerStats)
    .innerJoin(users, eq(users.id, playerStats.user_id))
    .where(eq(playerStats.user_id, userId))

  if (!row) return false

  const text = formatReminderMessage(row.first_name ?? 'بازیکن', row)
  await sendTelegramMessage(botToken, row.telegram_id, text)
  return true
}