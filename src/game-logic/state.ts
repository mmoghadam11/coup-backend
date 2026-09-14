import { RoleName, GamePhase, PendingAction } from './types'

export interface InternalPlayer {
  userId: number
  firstName: string
  connected: boolean
  coins: number
  roles: RoleName[]
  revealed: boolean[]
}

export interface RevealPending {
  playerId: number
  reason: string
}

export interface SelectionPending {
  playerId: number
  mode: 'exchange' | 'contessa'
  pool?: RoleName[]      // فقط برای exchange: کارت‌های فعلی + ۲ کارت جدید
  keepCount?: number     // فقط برای exchange: چندتا باید نگه داره
}
export interface GameState {
  roomId: string | null
  roomName: string | null
  phase: GamePhase
  creatorId: number | null
  players: InternalPlayer[]
  turnOrder: number[]
  currentTurnIndex: number
  deck: RoleName[]
  log: string[]
  pendingAction: PendingAction | null
  revealPending: RevealPending | null
  selectionPending: SelectionPending | null
  winnerId: number | null
}

export function initialGameState(): GameState {
  return {
    roomId: null,
    roomName: null,
    phase: 'waiting_for_players',
    creatorId: null,
    players: [],
    turnOrder: [],
    currentTurnIndex: 0,
    deck: [],
    log: [],
    pendingAction: null,
    revealPending: null,
    selectionPending: null,
    winnerId: null,
  }
}

export function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function isEliminated(player: InternalPlayer): boolean {
  return player.roles.length > 0 && player.revealed.every((r) => r)
}