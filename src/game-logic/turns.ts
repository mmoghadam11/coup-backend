import { GameState } from './state'
import { isEliminated } from './state'

export function advanceTurn(game: GameState) {
  let next = game.currentTurnIndex
  do {
    next = (next + 1) % game.turnOrder.length
    const player = game.players.find((p) => p.userId === game.turnOrder[next])
    if (player && !isEliminated(player)) break
  } while (next !== game.currentTurnIndex)

  game.currentTurnIndex = next
  game.phase = 'awaiting_action'
}