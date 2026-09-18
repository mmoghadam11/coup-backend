import { RoleName, GamePhase, PendingAction } from './types'

export interface PlayerStats {
  successfulBluffs: number
  caughtBluffs: number
  correctChallenges: number
  wrongChallenges: number
  successfulSteals: number
  kills: number   // فقط ترور موفق (قاتل)
  coups: number   // فقط کودتای موفق
}

export function emptyStats(): PlayerStats {
  return {
    successfulBluffs: 0,
    caughtBluffs: 0,
    correctChallenges: 0,
    wrongChallenges: 0,
    successfulSteals: 0,
    kills: 0,
    coups: 0,
  }
}

export interface InternalPlayer {
  userId: number
  firstName: string
  connected: boolean
  coins: number
  roles: RoleName[]
  revealed: boolean[]
  stats: PlayerStats
}

export interface RevealPending {
  playerId: number
  reason: string
}

export interface ProvePending {
  playerId: number
  claimedRole: RoleName
  context: 'action' | 'block'
  challengerId: number
}

export interface SelectionPending {
  playerId: number
  mode: 'exchange' | 'contessa'
  pool?: RoleName[]
  keepCount?: number
}

export interface RestartVoteState {
  reopenForJoining: boolean
  responses: Record<string, 'stay' | 'leave'>
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
  provePending: ProvePending | null
  selectionPending: SelectionPending | null
  restartVote: RestartVoteState | null
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
    provePending: null,
    selectionPending: null,
    restartVote: null,
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