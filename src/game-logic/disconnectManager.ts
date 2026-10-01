import { GameState } from './state'
import { DISCONNECT_TIMEOUT_SECONDS } from './matchmakingConfig'

export function registerDisconnect(game: GameState, userId: number) {
  if (game.roomPhase !== 'playing') return // فقط حین بازی مهمه
  game.disconnectDeadlines[String(userId)] = Date.now() + DISCONNECT_TIMEOUT_SECONDS * 1000
}

export function clearDisconnect(game: GameState, userId: number) {
  delete game.disconnectDeadlines[String(userId)]
}

export function getNextDisconnectDeadline(game: GameState): number | null {
  const values = Object.values(game.disconnectDeadlines)
  if (values.length === 0) return null
  return Math.min(...values)
}

// کسایی که deadline‌شون گذشته رو برمی‌گردونه (برای اینکه leave بشن)
export function getExpiredDisconnects(game: GameState): number[] {
  const now = Date.now()
  return Object.entries(game.disconnectDeadlines)
    .filter(([, deadline]) => deadline <= now)
    .map(([userId]) => Number(userId))
}