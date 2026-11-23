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
export const DEADLINE_GRACE_MS = 300 // تأخیر شبکه؛ سرور یک ثانیه دیرتر عمل می‌کند
export const STAGE_SECONDS = { duel: 10, action: 30, response: 15, prove: 15, reveal: 15, select: 20, anarchist: 15 }
export const BOT_USE_HISTORY = true
export const BOT_DEBUG = false          // true: هر حرکت ربات در wrangler tail چاپ می‌شود

/**
 * 
 * @returns the bot config
 */
export const BOT_WAIT_SECONDS = 10        // انتظار تنها بازیکن قبل از آمدن ربات
export const BOT_LEAVE_AT_PLAYERS = 5     // با رسیدن کل بازیکنان به این عدد (قبل از شروع)، ربات می‌رود
export const RECORD_STATS_WITH_BOTS = true // false: دست‌هایی که ربات دارند در لیدربورد ثبت نشوند

export function generateJoinCode(): string {
  let code = ''
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_CHARS[Math.floor(Math.random() * JOIN_CODE_CHARS.length)]
  }
  return code
}