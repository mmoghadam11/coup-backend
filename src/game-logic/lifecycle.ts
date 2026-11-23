import { GameState, shuffle, emptyStats } from './state'
import { buildFullDeck } from './roles'
import { DUEL_ENABLED, MIN_PLAYERS_TO_START, STARTING_COUNTDOWN_SECONDS } from './matchmakingConfig'
import { beginDuelPick } from './duel';
import { readyQuorum, rulesOf } from './roomRules';
import { reconcileBots } from './bots/botRoster';

export function dealNewGame(game: GameState) {
  if (DUEL_ENABLED && game.players.length === 2) { beginDuelPick(game); return }
  const deck = shuffle(buildFullDeck())
  for (const player of game.players) {
    player.roles = [deck.pop()!, deck.pop()!]
    player.revealed = [false, false]
    player.coins = 2
    player.stats = emptyStats()
  }
  game.deck = deck
  game.turnOrder = shuffle(game.players.map((p) => p.userId))
  game.currentTurnIndex = 0
  game.phase = 'awaiting_action'
  game.winnerId = null
  game.foldedThisHand = []
  game.pendingAction = null
  game.revealPending = null
  game.provePending = null
  game.anarchistPending = null
  game.showcase = null
  game.pendingReplacement = null
}

export function resetToWaiting(game: GameState) {
  for (const player of game.players) {
    player.roles = []
    player.revealed = []
    player.coins = 0
    player.stats = emptyStats()
  }
  game.deck = []
  game.turnOrder = []
  game.currentTurnIndex = 0
  game.phase = 'waiting_for_players'
  game.winnerId = null
  game.pendingAction = null
  game.revealPending = null
  game.provePending = null
  game.anarchistPending = null
  game.showcase = null
  game.pendingReplacement = null
  game.duelPicks = {}
}

export function forceResetGame(game: GameState) {
  dealNewGame(game)
  game.log.push('⚠️ بازی توسط سازنده ریست شد')
}

// تصمیم می‌گیرد شمارش شروع شود یا لغو شود
export function evaluateMatchmakingTransition(game: GameState): { needsAlarmUpdate: boolean } {
  reconcileBots(game) // رفتن ربات در لحظه‌ی لازم
  if (game.roomPhase === 'closed' || game.phase === 'room_closed') return { needsAlarmUpdate: false }

  const rules = rulesOf(game)
  const present = game.players.filter((p) => p.connected)
  const ready = present.filter((p) => p.ready)
  const headcount = rules.startRule === 'headcount'

  const canStart = headcount ? present.length >= MIN_PLAYERS_TO_START : ready.length >= readyQuorum(present.length)
  // بعد از شروع شمارش، ورود یک نفر جدید نباید آن را بپراند؛ فقط افتادن زیر حداقل لغوش می‌کند
  const keepStarting = headcount ? present.length >= MIN_PLAYERS_TO_START : ready.length >= MIN_PLAYERS_TO_START

  if (game.roomPhase === 'waiting' && canStart) {
    game.roomPhase = 'starting'
    game.countdownEndsAt = Date.now() + rules.countdownSeconds * 1000
    game.log.push(`شمارش معکوس شروع شد (${rules.countdownSeconds} ثانیه)`)
    return { needsAlarmUpdate: true }
  }
  if (game.roomPhase === 'starting' && !keepStarting) {
    game.roomPhase = 'waiting'
    game.countdownEndsAt = null
    game.log.push('تعداد آماده‌ها کافی نیست؛ شمارش معکوس لغو شد')
    return { needsAlarmUpdate: true }
  }
  return { needsAlarmUpdate: false }
}

// وقتی countdown تموم شد (alarm فایر شد) و واقعاً باید بازی شروع بشه
export function startMatchmakingHand(game: GameState) {
  game.roomPhase = 'playing'
  game.countdownEndsAt = null
  game.foldedThisHand = []
  dealNewGame(game)
  game.log.push('بازی شروع شد')
}

// وقتی یه دست matchmaking تموم شد، برگرد به waiting (نه closed) تا دست بعدی بتونه شروع بشه
export function finishMatchmakingHand(game: GameState) {
  game.roomPhase = 'waiting'
  game.handResultEndsAt = null
  resetToWaiting(game)
  for (const p of game.players) p.ready = p.connected // کسی که مانده، برای دست بعد آماده است
  game.log.push('این دست تموم شد؛ منتظر بازیکنان برای دست بعدی')
}