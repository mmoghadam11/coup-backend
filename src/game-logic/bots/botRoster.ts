import { GameState, InternalPlayer, emptyStats } from '../state'
import { BOT_NAMES, BOT_PROFILE_WEIGHTS, BOT_PROFILES, BotProfileId, THINK_MAX_MS, THINK_MAX_SHARE, THINK_MS, ThinkKind } from './botConfig'
import { BOT_LEAVE_AT_PLAYERS, BOT_WAIT_SECONDS } from '../matchmakingConfig'

export const botsOf = (g: GameState) => g.players.filter((p) => p.isBot)
export const humansOf = (g: GameState) => g.players.filter((p) => !p.isBot)

function removeBots(game: GameState) {
  for (const b of botsOf(game)) game.log.push(`${b.firstName} از روم خارج شد`) // همان متن خروج انسان
  game.players = game.players.filter((p) => !p.isBot)
  game.turnOrder = game.turnOrder.filter((id) => game.players.some((p) => p.userId === id))
}

// تصمیم می‌گیرد ربات باید برود یا برای آمدنش تایمر بگذارد. چندبار صدا زدنش بی‌ضرر است
export function reconcileBots(game: GameState) {
  if (game.origin !== 'matchmaking') { game.botJoinAt = null; return }
  const preStart = game.roomPhase === 'waiting' || game.roomPhase === 'starting'

  if (preStart && botsOf(game).length && (humansOf(game).length === 0 || game.players.length >= BOT_LEAVE_AT_PLAYERS)) {
    removeBots(game)
  }

  const humans = humansOf(game)
  const lone = game.roomPhase === 'waiting' && humans.length === 1 && humans[0].connected && botsOf(game).length === 0
  if (lone) { if (!game.botJoinAt) game.botJoinAt = Date.now() + (BOT_WAIT_SECONDS + Math.random() * 3) * 1000 }
  else game.botJoinAt = null
}

const pickProfile = (): BotProfileId => {
  let r = Math.random()
  for (const [id, w] of BOT_PROFILE_WEIGHTS) { r -= w; if (r <= 0) return id }
  return 'careful'
}

// id بزرگ و تصادفی؛ با id واقعی کاربران (عدد کوچک) برخورد نمی‌کند
function newBotId(game: GameState) {
  let id: number
  do { id = 900_000_000 + Math.floor(Math.random() * 90_000_000) } while (game.players.some((p) => p.userId === id))
  return id
}

export function maybeAddBot(game: GameState): boolean {
  if (game.origin !== 'matchmaking' || game.roomPhase !== 'waiting') return false
  if (humansOf(game).length !== 1 || botsOf(game).length > 0) return false

  const taken = new Set(game.players.map((p) => p.firstName))
  const names = BOT_NAMES.filter((n) => !taken.has(n))
  const name = names[Math.floor(Math.random() * names.length)] ?? 'Ali'
  const profile = pickProfile()

  const bot: InternalPlayer = {
    userId: newBotId(game), firstName: name, photoUrl: null, connected: true,
    coins: 0, roles: [], revealed: [], stats: emptyStats(), skins: {}, ready: true,
    isBot: true, botProfile: BOT_PROFILES[profile].id, botAt: null,
    botKey: null
  }
  game.players.push(bot)
  game.log.push(`${name} به روم پیوست`) // همان متن ورود انسان
  return true
}

export function thinkMs(b: InternalPlayer, kind: ThinkKind, remainingMs: number | null) {
  const [lo, hi] = THINK_MS[kind]
  let d = (lo + Math.random() * (hi - lo)) * BOT_PROFILES[b.botProfile ?? 'careful'].pace
  if (remainingMs !== null) d = Math.min(d, Math.max(300, remainingMs * THINK_MAX_SHARE)) // تا مهلت، همیشه وقت بماند
  return Math.min(d, THINK_MAX_MS)
}