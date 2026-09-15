import { GameState, shuffle , emptyStats} from './state'
import { buildFullDeck } from './roles'

export function dealNewGame(game: GameState) {
  const deck = shuffle(buildFullDeck())
  for (const player of game.players) {
    player.roles = [deck.pop()!, deck.pop()!]
    player.revealed = [false, false]
    player.coins = 2
    player.stats = emptyStats()
  }
  game.deck = deck
  game.turnOrder = shuffle(game.players.map((p) => p.userId))
  game.currentTurnIndex = 0
  game.phase = 'awaiting_action'
  game.winnerId = null
  game.pendingAction = null
  game.revealPending = null
}
// روم رو به حالت "منتظر شروع" برمی‌گردونه (بازیکن‌ها می‌مونن، ولی کارت/سکه صفر می‌شه)
export function resetToWaiting(game: GameState) {
  for (const player of game.players) {
    player.roles = []
    player.revealed = []
    player.coins = 0
    player.stats = emptyStats()
  }
  game.deck = []
  game.turnOrder = []
  game.currentTurnIndex = 0
  game.phase = 'waiting_for_players'
  game.winnerId = null
  game.pendingAction = null
  game.revealPending = null
}
export function forceResetGame(game: GameState) {
  dealNewGame(game)
  game.log.push('⚠️ بازی توسط سازنده ریست شد')
}