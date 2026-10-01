import { GameState, isEliminated } from '../state'
import { advanceTurn } from '../turns'

export function foldHand(game: GameState, userId: number): { handEnded: boolean } {
  if (game.roomPhase !== 'playing') return { handEnded: false }
  if (game.phase === 'game_over') return { handEnded: false }

  const player = game.players.find((p) => p.userId === userId)
  if (!player || isEliminated(player)) return { handEnded: false }

  // فولد یعنی همین الان همه‌ی کارت‌هاش show بشن — دقیقاً مثل باختن، ولی خودش توی روم می‌مونه
  player.revealed = player.roles.map(() => true)
  game.foldedThisHand.push(userId)
  game.log.push(`${player.firstName} فولد کرد`)

  const alivePlayers = game.players.filter((p) => !isEliminated(p))
  if (alivePlayers.length <= 1) {
    game.phase = 'game_over'
    game.winnerId = alivePlayers[0]?.userId ?? null
    game.log.push(alivePlayers[0] ? `${alivePlayers[0].firstName} برنده‌ی این دست شد!` : 'دست بدون برنده تموم شد')
    return { handEnded: true }
  }

  if (game.turnOrder[game.currentTurnIndex] === userId) {
    advanceTurn(game)
  }
  return { handEnded: false }
}

// حذف کامل بازیکن از روم (نه فقط فولد) — برای waiting/starting یا leave واقعی وسط بازی
export function removePlayerFromRoom(game: GameState, userId: number) {
  const player = game.players.find((p) => p.userId === userId)
  if (!player) return

  // اگه وسط یه دست فعاله و هنوز نباخته، اول کارت‌هاش رو show کن (مثل فولد)
  if (game.roomPhase === 'playing' && !isEliminated(player)) {
    player.revealed = player.roles.map(() => true)
  }

  game.players = game.players.filter((p) => p.userId !== userId)
  game.turnOrder = game.turnOrder.filter((id) => id !== userId)
  delete game.disconnectDeadlines[String(userId)]
  game.log.push(`${player.firstName} از روم خارج شد`)
}