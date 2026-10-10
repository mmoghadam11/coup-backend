import { RoleName, GamePhase, PendingAction } from './types'

export type RoomOrigin = 'matchmaking' | 'lobby' | 'group'
export type RoomVisibility = 'public' | 'private'

export type RoomPhase =
  | 'waiting'
  | 'starting'
  | 'playing'
  | 'closed'

export type AlarmPurpose = 'countdown' | 'disconnect'

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
  photoUrl: string | null
  connected: boolean
  coins: number
  roles: RoleName[]
  revealed: boolean[]
  stats: PlayerStats
}

export interface RevealPending {
  playerId: number
  reason: string
  actorId?: number // این خط اضافه شد — کی باعث این reveal شده (برای نمایش پیام)
}

export interface ProvePending {
  playerId: number
  claimedRole: RoleName
  context: 'action' | 'block' | 'anarchist_block'
  challengerId: number
}

export interface SelectionPending {
  playerId: number
  mode: 'exchange' | 'contessa'
  pool?: RoleName[]
  keepCount?: number
}

export interface AnarchistPending {
  originalAttackerId: number
  currentTargetId: number
  chain: number[] // همه‌ی کسایی که تا الان این کارت رو داشتن، برای exclude کردن از pass بعدی
  status: 'awaiting_block_decision' | 'awaiting_block_challenge' | 'awaiting_pass_target'
  blockChallengeResponses?: Record<string, 'allow' | 'challenge'>
}

export interface RestartVoteState {
  reopenForJoining: boolean
  responses: Record<string, 'stay' | 'leave'>
}

export interface GameState {
  roomId: string | null
  roomName: string | null
  origin: RoomOrigin               // این خط اضافه شد
  visibility: RoomVisibility | null // این خط اضافه شد (فقط lobby پر می‌شه)
  roomPhase: RoomPhase

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
  anarchistPending: AnarchistPending | null
  restartVote: RestartVoteState | null
  winnerId: number | null

  disconnectDeadlines: Record<string, number>
  foldedThisHand: number[]   // این خط اضافه شد — بازیکنانی که این دست fold کردن (برای matchmaking/هر روم چندباره)
  // pendingAlarm: { purpose: AlarmPurpose; targetUserId?: number } | null
  countdownEndsAt: number | null   // این خط اضافه شد — timestamp پایان شمارش معکوس، برای نمایش به فرانت هم لازمه
  handResultEndsAt: number | null
}

export function initialGameState(origin: RoomOrigin = 'lobby'): GameState {
  return {
    roomId: null,
    roomName: null,
    origin,
    visibility: null,
    roomPhase: origin === 'matchmaking' ? 'waiting' : 'playing',
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
    anarchistPending: null,
    restartVote: null,
    winnerId: null,
    disconnectDeadlines: {},
    foldedThisHand: [],
    // pendingAlarm: null,
    countdownEndsAt: null,
    handResultEndsAt: null,
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