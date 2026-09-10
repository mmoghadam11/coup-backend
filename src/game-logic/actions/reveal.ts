import { GameState, isEliminated } from '../state'
import { advanceTurn } from '../turns'
import { resolvePendingActionEffect } from './challengeFlow'

export function revealCard(game: GameState, userId: number, roleIndex: number) {
  if (!game.revealPending || game.revealPending.playerId !== userId) return

  const player = game.players.find((p) => p.userId === userId)
  if (!player || player.revealed[roleIndex]) return

  player.revealed[roleIndex] = true
  game.log.push(`${player.firstName} یکی از کارت‌هاش رو کور کرد`)
  game.revealPending = null

  if (isEliminated(player)) {
    game.log.push(`${player.firstName} حذف شد`)
  }

  const alivePlayers = game.players.filter((p) => !isEliminated(p))
  if (alivePlayers.length === 1) {
    game.phase = 'game_over'
    game.winnerId = alivePlayers[0].userId
    game.log.push(`${alivePlayers[0].firstName} برنده‌ی بازی شد!`)
    return
  }

  if (game.pendingAction) {
    resolvePendingActionEffect(game)
    if (game.revealPending) return // اگه اثر اکشن خودش یه reveal جدید لازم داره (مثلاً assassinate)
  }

  advanceTurn(game)
}