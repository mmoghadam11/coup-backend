import { GameState } from '../state'
import { actionCost } from '../roles'

export function applyIncome(game: GameState, actorId: number) {
  const actor = game.players.find((p) => p.userId === actorId)
  if (!actor) return
  actor.coins += 1
  game.log.push(`${actor.firstName} درآمد گرفت`)
}

export function applyCoup(game: GameState, actorId: number, targetId: number): { error?: string } {
  const actor = game.players.find((p) => p.userId === actorId)
  if (!actor) return { error: 'بازیکن پیدا نشد' }
  if (actor.coins < actionCost('coup')) {
    return { error: `سکه کافی ندارید (نیاز به ${actionCost('coup')} سکه)` }
  }

  actor.coins -= actionCost('coup')
  actor.stats.coups += 1   // فقط کودتا، جدا از kills
  game.log.push(`${actor.firstName} کودتا کرد`)
  game.revealPending = { playerId: targetId, reason: 'coup', actorId }
  return {}
}