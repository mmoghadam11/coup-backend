import { GameState, isEliminated } from '../state'
import { advanceTurn } from '../turns'
import { resolvePendingActionEffect } from './challengeFlow'

export function revealCard(game: GameState, userId: number, roleIndex: number): { gameJustEnded: boolean } {
  if (!game.revealPending || game.revealPending.playerId !== userId) {
    return { gameJustEnded: false }
  }

  const player = game.players.find((p) => p.userId === userId)
  if (!player || player.revealed[roleIndex]) {
    return { gameJustEnded: false }
  }

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
    return { gameJustEnded: true }
  }

  if (game.pendingAction) {
    resolvePendingActionEffect(game)
    return { gameJustEnded: false }
  }

  if (game.selectionPending) {
    return { gameJustEnded: false }
  }

  if (game.anarchistPending) {
    game.phase = 'anarchist_in_progress'
    return { gameJustEnded: false }
  }

  advanceTurn(game)
  return { gameJustEnded: false }
}