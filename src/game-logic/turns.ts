import { GameState, isEliminated } from './state'

export function advanceTurn(game: GameState) {
  const total = game.turnOrder.length
  let next = game.currentTurnIndex

  for (let i = 0; i < total; i++) {
    next = (next + 1) % total
    const player = game.players.find((p) => p.userId === game.turnOrder[next])
    if (player && !isEliminated(player)) {
      game.currentTurnIndex = next
      game.phase = 'awaiting_action'
      return
    }
  }
  // اگه به اینجا رسیدیم یعنی همه حذف شدن؛ عملاً نباید اتفاق بیفته چون بازی زودتر باید game_over بشه
}