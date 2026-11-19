export const MIN_PLAYERS_TO_START = 2
export const MAX_PLAYERS_PER_ROOM = 7
export const STARTING_COUNTDOWN_SECONDS = 10
export const DISCONNECT_TIMEOUT_SECONDS = 60
export const PRIVATE_COUNTDOWN_SECONDS = 15   // لابی و گروه
export const LOBBY_DISCONNECT_SECONDS = 120   // قطعی قبل از شروع (مثلاً رفتن به تلگرام برای کپی کد)
export const HAND_RESULT_DISPLAY_SECONDS = 8
export const JOIN_CODE_LENGTH = 6
export const JOIN_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // بدون حروف/عدد مشابه (O/0, I/1) برای خوانایی بهتر

// export const PROOF_SHOWCASE_SECONDS = 3.5
// export const REVEAL_SHOWCASE_SECONDS = 3.5
export const PROOF_SHOWCASE_SECONDS = 4.5
export const REVEAL_SHOWCASE_SECONDS = 4.5
export const REPLACEMENT_SHOWCASE_SECONDS = 4.5

export const DUEL_ENABLED = true
export const DUEL_PICK_SECONDS = 10
export const ACTION_SECONDS = 30      // پیشنهاد
export const RESPONSE_SECONDS = 15    // پیشنهاد
export const DEADLINE_GRACE_MS = 1000 // تأخیر شبکه؛ سرور یک ثانیه دیرتر عمل می‌کند

export function generateJoinCode(): string {
  let code = ''
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_CHARS[Math.floor(Math.random() * JOIN_CODE_CHARS.length)]
  }
  return code
}