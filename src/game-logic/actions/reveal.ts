import { GameState, isEliminated } from '../state'
import { advanceTurn } from '../turns'
import { RoleName } from '../types'
import { resolvePendingActionEffect } from './challengeFlow'

export interface RevealCardResult {
  gameJustEnded: boolean
  revealedRole?: RoleName
  playerName?: string
  eliminated?: boolean
}

export function revealCard(game: GameState, userId: number, roleIndex: number): RevealCardResult {
  if (!game.revealPending || game.revealPending.playerId !== userId) {
    return { gameJustEnded: false }
  }

  const player = game.players.find((p) => p.userId === userId)
  if (!player || player.revealed[roleIndex]) {
    return { gameJustEnded: false }
  }

  const revealedRole = player.roles[roleIndex]
  player.revealed[roleIndex] = true
  game.log.push(`${player.firstName} یکی از کارت‌هاش رو کشت`)
  game.revealPending = null

  const eliminated = isEliminated(player)
  if (eliminated) {
    game.log.push(`${player.firstName} حذف شد`)
  }

  const alivePlayers = game.players.filter((p) => !isEliminated(p))
  if (alivePlayers.length === 1) {
    game.phase = 'game_over'
    game.winnerId = alivePlayers[0].userId
    game.log.push(`${alivePlayers[0].firstName} برنده‌ی بازی شد!`)
    return { gameJustEnded: true, revealedRole, playerName: player.firstName, eliminated }
  }

  if (game.pendingAction) {
    resolvePendingActionEffect(game)
    return { gameJustEnded: false, revealedRole, playerName: player.firstName, eliminated }
  }

  if (game.selectionPending) {
    return { gameJustEnded: false, revealedRole, playerName: player.firstName, eliminated }
  }

  if (game.anarchistPending) {
    game.phase = 'anarchist_in_progress'
    return { gameJustEnded: false, revealedRole, playerName: player.firstName, eliminated }
  }

  advanceTurn(game)
  return { gameJustEnded: false, revealedRole, playerName: player.firstName, eliminated }
}