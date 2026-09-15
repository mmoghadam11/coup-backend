import { GameState } from '../state'
import { actionCost } from '../roles'

export function applyIncome(game: GameState, actorId: number) {
  const actor = game.players.find((p) => p.userId === actorId)
  if (!actor) return
  actor.coins += 1
  game.log.push(`${actor.firstName} درآمد گرفت`)
}

export function applyCoup(game: GameState, actorId: number, targetId: number) {
  const actor = game.players.find((p) => p.userId === actorId)
  if (!actor) return
  if (actor.coins < actionCost('coup')) return

  actor.coins -= actionCost('coup')
  actor.stats.kills += 1
  game.log.push(`${actor.firstName} کودتا کرد`)
  game.revealPending = { playerId: targetId, reason: 'coup' }
}