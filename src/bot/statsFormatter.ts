interface PlayerStatsRow {
  total_games: number
  total_wins: number
  total_kills: number
  total_coups: number
  total_successful_bluffs: number
  total_caught_bluffs: number
  total_correct_challenges: number
  total_wrong_challenges: number
  total_steals: number
}

export function formatStatsMessage(firstName: string, stats: PlayerStatsRow | null): string {
  if (!stats || stats.total_games === 0) {
    return `سلام ${firstName}! 👋\nهنوز هیچ بازی‌ای نکردی. برو یه دست بزن! 🎮`
  }

  const winRate = stats.total_games > 0 ? Math.round((stats.total_wins / stats.total_games) * 100) : 0

  return [
    `📊 <b>آمار ${firstName}</b>`,
    ``,
    `🎮 بازی‌ها: ${stats.total_games}`,
    `🏆 بردها: ${stats.total_wins} (${winRate}٪)`,
    `⚔️ کشتار: ${stats.total_kills} - 💥 کودتا: ${stats.total_coups}`,
    ``,
    `🎭 بلوف موفق: ${stats.total_successful_bluffs} - 😬 بلوف لورفته: ${stats.total_caught_bluffs}`,
    ``,
    `🕵️ چالش درست: ${stats.total_correct_challenges} - ❌ چالش غلط: ${stats.total_wrong_challenges}`,
    ``,
    `💰 دزدی موفق: ${stats.total_steals}`,
  ].join('\n')
}

export function formatReminderMessage(firstName: string, stats: PlayerStatsRow | null): string {
  const statsBlock = formatStatsMessage(firstName, stats)
  return `دلتنگتیم ${firstName}! 😢 مدتیه بازی نکردی...\n\n${statsBlock}\n\nبرگرد و رقابت کن! 🔥`
}