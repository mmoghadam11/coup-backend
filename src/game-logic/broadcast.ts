import { GameState } from './state'
import { isEliminated } from './state'

export function buildPublicPayload(game: GameState) {
  return {
    type: 'state',
    state: {
      phase: game.phase,
      creatorId: game.creatorId ? String(game.creatorId) : null,
      players: game.players.map((p) => ({
        id: String(p.userId),
        name: p.firstName,
        connected: p.connected,
        coins: p.coins,
        roleCount: p.roles.length - p.revealed.filter((r) => r).length,
        isAlive: !isEliminated(p),
      })),
      turnOrder: game.turnOrder.map(String),
      currentTurnIndex: game.currentTurnIndex,
      deckCount: game.deck.length,
      log: game.log.slice(-100),
      pendingAction: game.pendingAction,
      revealPending: game.revealPending
        ? { playerId: String(game.revealPending.playerId), reason: game.revealPending.reason }
        : null,
      winnerId: game.winnerId ? String(game.winnerId) : null,
    },
  }
}