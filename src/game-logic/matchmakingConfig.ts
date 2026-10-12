export const MIN_PLAYERS_TO_START = 2
export const MAX_PLAYERS_PER_ROOM = 7
export const STARTING_COUNTDOWN_SECONDS = 10
export const DISCONNECT_TIMEOUT_SECONDS = 60
export const HAND_RESULT_DISPLAY_SECONDS = 8
export const JOIN_CODE_LENGTH = 6
export const JOIN_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // بدون حروف/عدد مشابه (O/0, I/1) برای خوانایی بهتر

export const PROOF_SHOWCASE_SECONDS = 3.5
export const REVEAL_SHOWCASE_SECONDS = 3.5
export const REPLACEMENT_SHOWCASE_SECONDS = 4.5

export function generateJoinCode(): string {
  let code = ''
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_CHARS[Math.floor(Math.random() * JOIN_CODE_CHARS.length)]
  }
  return code
}