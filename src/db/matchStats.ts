import { eq, and, sql } from 'drizzle-orm'
import { getDb } from './index'
import { playerStats, groupPlayerStats, rooms, telegramGroups } from './schema'

interface GamePlayerResult {
  userId: number
  isWinner: boolean
  kills: number
  coups: number
  successfulBluffs: number
  caughtBluffs: number
  correctChallenges: number
  wrongChallenges: number
  successfulSteals: number
}

// این تابع، وقتی یه بازی game_over می‌شه، آمار هر بازیکن رو هم توی player_stats (تجمعی فردی)
// و هم (اگه روم مال یه گروه بود) توی group_player_stats ثبت می‌کنه
export async function recordGameResult(d1: D1Database, roomId: string, results: GamePlayerResult[]) {
  const db = getDb(d1)
  const now = Date.now()

  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId))
  const groupId = room?.group_id ?? null

  for (const result of results) {
    // ---- آمار فردی (player_stats) ----
    const [existing] = await db.select().from(playerStats).where(eq(playerStats.user_id, result.userId))

    if (existing) {
      await db
        .update(playerStats)
        .set({
          total_games: existing.total_games + 1,
          total_wins: existing.total_wins + (result.isWinner ? 1 : 0),
          total_kills: existing.total_kills + result.kills,
          total_coups: existing.total_coups + result.coups,
          total_successful_bluffs: existing.total_successful_bluffs + result.successfulBluffs,
          total_caught_bluffs: existing.total_caught_bluffs + result.caughtBluffs,
          total_correct_challenges: existing.total_correct_challenges + result.correctChallenges,
          total_wrong_challenges: existing.total_wrong_challenges + result.wrongChallenges,
          total_steals: existing.total_steals + result.successfulSteals,
          last_played_at: now,
        })
        .where(eq(playerStats.user_id, result.userId))
    } else {
      await db.insert(playerStats).values({
        user_id: result.userId,
        total_games: 1,
        total_wins: result.isWinner ? 1 : 0,
        total_kills: result.kills,
        total_coups: result.coups,
        total_successful_bluffs: result.successfulBluffs,
        total_caught_bluffs: result.caughtBluffs,
        total_correct_challenges: result.correctChallenges,
        total_wrong_challenges: result.wrongChallenges,
        total_steals: result.successfulSteals,
        last_played_at: now,
      })
    }

    // ---- آمار مشترک گروه (group_player_stats) — فقط اگه روم مال یه گروه بود ----
    if (groupId) {
      const [existingGroupStat] = await db
        .select()
        .from(groupPlayerStats)
        .where(and(eq(groupPlayerStats.group_id, groupId), eq(groupPlayerStats.user_id, result.userId)))

      if (existingGroupStat) {
        await db
          .update(groupPlayerStats)
          .set({
            games_played: existingGroupStat.games_played + 1,
            wins: existingGroupStat.wins + (result.isWinner ? 1 : 0),
            kills: existingGroupStat.kills + result.kills,
            coups: existingGroupStat.coups + result.coups,
            successful_bluffs: existingGroupStat.successful_bluffs + result.successfulBluffs,
            caught_bluffs: existingGroupStat.caught_bluffs + result.caughtBluffs,
            correct_challenges: existingGroupStat.correct_challenges + result.correctChallenges,
            wrong_challenges: existingGroupStat.wrong_challenges + result.wrongChallenges,
            steals: existingGroupStat.steals + result.successfulSteals,
          })
          .where(and(eq(groupPlayerStats.group_id, groupId), eq(groupPlayerStats.user_id, result.userId)))
      } else {
        await db.insert(groupPlayerStats).values({
          group_id: groupId,
          user_id: result.userId,
          games_played: 1,
          wins: result.isWinner ? 1 : 0,
          kills: result.kills,
          coups: result.coups,
          successful_bluffs: result.successfulBluffs,
          caught_bluffs: result.caughtBluffs,
          correct_challenges: result.correctChallenges,
          wrong_challenges: result.wrongChallenges,
          steals: result.successfulSteals,
        })
      }
    }
  }

  if (groupId) {
    await db.update(telegramGroups).set({ last_played_at: now }).where(eq(telegramGroups.id, groupId))
  }
}