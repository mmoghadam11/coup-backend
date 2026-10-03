import { GameState, shuffle, emptyStats } from './state'
import { buildFullDeck } from './roles'
import { MIN_PLAYERS_TO_START, STARTING_COUNTDOWN_SECONDS } from './matchmakingConfig'

export function dealNewGame(game: GameState) {
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
  game.pendingAction = null
  game.revealPending = null
  game.provePending = null
  game.anarchistPending = null
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
}

export function forceResetGame(game: GameState) {
  dealNewGame(game)
  game.log.push('⚠️ بازی توسط سازنده ریست شد')
}

// فقط برای روم‌های matchmaking: بعد از اضافه/کم شدن بازیکن، چک کن باید وارد starting بشیم یا ازش خارج بشیم
export function evaluateMatchmakingTransition(game: GameState): { needsAlarmUpdate: boolean } {
  if (game.origin !== 'matchmaking') return { needsAlarmUpdate: false }

  const playerCount = game.players.filter((p) => p.connected || game.roomPhase === 'playing').length

  if (game.roomPhase === 'waiting') {
    if (playerCount >= MIN_PLAYERS_TO_START) {
      game.roomPhase = 'starting'
      game.countdownEndsAt = Date.now() + STARTING_COUNTDOWN_SECONDS * 1000
      game.log.push(`شمارش معکوس شروع شد (${STARTING_COUNTDOWN_SECONDS} ثانیه)`)
      return { needsAlarmUpdate: true }
    }
    return { needsAlarmUpdate: false }
  }

  if (game.roomPhase === 'starting') {
    if (playerCount < MIN_PLAYERS_TO_START) {
      game.roomPhase = 'waiting'
      game.countdownEndsAt = null
      game.log.push('تعداد بازیکنان کافی نیست؛ شمارش معکوس لغو شد')
      return { needsAlarmUpdate: true }
    }
    // اگه پر هنوز starting هست و countdown از قبل درحال اجراست، کاری نکن (alarm خودش سروقتش فایر می‌شه)
    return { needsAlarmUpdate: false }
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
  game.handResultEndsAt = null   // ✅ این خط
  resetToWaiting(game)
  game.log.push('این دست تموم شد؛ منتظر بازیکنان برای دست بعدی')
}