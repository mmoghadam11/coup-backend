import type { RoomOrigin } from './state'
import { MIN_PLAYERS_TO_START, STARTING_COUNTDOWN_SECONDS, PRIVATE_COUNTDOWN_SECONDS } from './matchmakingConfig'

export interface RoomRules {
  countdownSeconds: number
  startRule: 'headcount' | 'ready_quorum'
  autoCloseWhenEmpty: boolean
}

const PRIVATE: RoomRules = { countdownSeconds: PRIVATE_COUNTDOWN_SECONDS, startRule: 'ready_quorum', autoCloseWhenEmpty: true }

export const ROOM_RULES: Record<RoomOrigin, RoomRules> = {
  matchmaking: { countdownSeconds: STARTING_COUNTDOWN_SECONDS, startRule: 'headcount', autoCloseWhenEmpty: false },
  lobby: PRIVATE,
  group: PRIVATE,
}

export const rulesOf = (g: { origin: RoomOrigin }): RoomRules => ROOM_RULES[g.origin] ?? PRIVATE

// حد نصاب آماده‌ها: حداقل MIN و بیش از نصف حاضرها (فرمول مشابه سمت فرانت هم هست)
export const readyQuorum = (present: number) => Math.max(MIN_PLAYERS_TO_START, Math.floor(present / 2) + 1)