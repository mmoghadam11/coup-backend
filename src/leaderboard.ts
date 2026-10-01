import { Hono } from 'hono'
import { eq, desc, sql } from 'drizzle-orm'
import { getDb } from './db'
import { playerStats, users } from './db/schema'
import { requireAuth } from './authMiddleware'

type Bindings = { DB: D1Database }
type Variables = { userId: number }

export const leaderboardRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

leaderboardRoutes.use('*', requireAuth)

leaderboardRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB)
  const currentUserId = c.get('userId')

  // ۵ نفر برتر بر اساس تعداد برد
  const top = await db
    .select({
      user_id: playerStats.user_id,
      first_name: users.first_name,
      photo_url: users.photo_url,
      total_games: playerStats.total_games,
      total_wins: playerStats.total_wins,
      total_kills: playerStats.total_kills,
      total_coups: playerStats.total_coups,
      total_successful_bluffs: playerStats.total_successful_bluffs,
      total_caught_bluffs: playerStats.total_caught_bluffs,
      total_correct_challenges: playerStats.total_correct_challenges,
      total_wrong_challenges: playerStats.total_wrong_challenges,
      total_steals: playerStats.total_steals,
    })
    .from(playerStats)
    .innerJoin(users, eq(users.id, playerStats.user_id))
    .orderBy(desc(playerStats.total_wins))
    .limit(5)

  // آمار خودِ کاربر فعلی (حتی اگه توی ۵ تای برتر نباشه)
  const [me] = await db
    .select({
      user_id: playerStats.user_id,
      first_name: users.first_name,
      photo_url: users.photo_url,
      total_games: playerStats.total_games,
      total_wins: playerStats.total_wins,
      total_kills: playerStats.total_kills,
      total_coups: playerStats.total_coups,
      total_successful_bluffs: playerStats.total_successful_bluffs,
      total_caught_bluffs: playerStats.total_caught_bluffs,
      total_correct_challenges: playerStats.total_correct_challenges,
      total_wrong_challenges: playerStats.total_wrong_challenges,
      total_steals: playerStats.total_steals,
    })
    .from(playerStats)
    .innerJoin(users, eq(users.id, playerStats.user_id))
    .where(eq(playerStats.user_id, currentUserId))

  // رتبه‌ی خودِ کاربر (چندمینه بر اساس total_wins)
  let myRank: number | null = null
  if (me) {
    const [{ rank }] = await db
      .select({ rank: sql<number>`COUNT(*) + 1` })
      .from(playerStats)
      .where(sql`${playerStats.total_wins} > ${me.total_wins}`)
    myRank = rank
  }

  return c.json({ top, me: me ?? null, myRank })
})