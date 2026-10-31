import { GameState, shuffle, emptyStats } from './state'
import { RoleName } from './types'
import { buildFullDeck } from './roles'

export const DUEL_ROLES: RoleName[] = ['duke', 'captain', 'ambassador', 'princess', 'assassin'] // بدون بازرس

export function beginDuelPick(game: GameState) {
  for (const p of game.players) {
    p.roles = []; p.revealed = []; p.coins = 2; p.stats = emptyStats()
  }
  game.deck = []
  game.turnOrder = shuffle(game.players.map((p) => p.userId))
  game.currentTurnIndex = 0
  game.phase = 'duel_pick'
  game.duelPicks = {}
  game.winnerId = null
  game.pendingAction = null; game.revealPending = null; game.provePending = null
  game.anarchistPending = null; game.selectionPending = null
  game.showcase = null; game.pendingReplacement = null
  game.foldedThisHand = []
  game.log.push('دوئل! هر بازیکن کارت اولش را انتخاب می‌کند')
}

export function submitDuelPick(game: GameState, userId: number, role: string): string | null {
  if (game.phase !== 'duel_pick') return 'الان زمان انتخاب نیست'
  if (!game.players.some((p) => p.userId === userId)) return 'شما بازیکن این روم نیستید'
  if (game.duelPicks[String(userId)]) return 'انتخاب شما قبلاً ثبت شده'
  if (!DUEL_ROLES.includes(role as RoleName)) return 'کارت نامعتبر'
  game.duelPicks[String(userId)] = role as RoleName
  return null
}

// هر دو تأیید کردند، یا مهلت تمام شد (انتخاب‌نکرده‌ها تصادفی)
export function finishDuelPick(game: GameState) {
  const deck = buildFullDeck()
  for (const p of game.players) {
    const picked = game.duelPicks[String(p.userId)]
    const role = picked ?? DUEL_ROLES[Math.floor(Math.random() * DUEL_ROLES.length)]
    const i = deck.indexOf(role)
    if (i >= 0) deck.splice(i, 1)       // یک نسخه از دسته بیرون می‌آید
    p.roles = [role]
  }
  const shuffled = shuffle(deck)        // بازرس‌ها هم همین‌جا داخل دسته‌اند
  for (const p of game.players) {
    p.roles.push(shuffled.pop()!)
    p.revealed = [false, false]
  }
  game.deck = shuffled
  game.duelPicks = {}
  game.phase = 'awaiting_action'
  game.log.push('کارت‌ها پخش شد؛ بازی شروع شد')
}