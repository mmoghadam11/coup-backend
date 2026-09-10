import { GameState, shuffle } from './state'
import { buildFullDeck } from './roles'

export function dealNewGame(game: GameState) {
  const deck = shuffle(buildFullDeck())
  for (const player of game.players) {
    player.roles = [deck.pop()!, deck.pop()!]
    player.revealed = [false, false]
    player.coins = 2
  }
  game.deck = deck
  game.turnOrder = shuffle(game.players.map((p) => p.userId))
  game.currentTurnIndex = 0
  game.phase = 'awaiting_action'
  game.winnerId = null
  game.pendingAction = null
  game.revealPending = null
}