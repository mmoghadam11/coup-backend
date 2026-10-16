import { GameState, Showcase, shuffle } from '../state'
import { REPLACEMENT_SHOWCASE_SECONDS } from '../matchmakingConfig'

export function startShowcase(game: GameState, data: Omit<Showcase, 'endsAt'>, seconds: number) {
  game.showcase = { ...data, endsAt: Date.now() + seconds * 1000 }
}

// کارت رو داخل دسته می‌ذاره، بُر می‌زنه و کارت رویی رو جایگزین می‌کنه
// (ممکنه همون کارت قبلی دوباره بیاد)
export function replaceCardFromDeck(
  game: GameState,
  playerId: number,
  roleIndex: number,
  options: { shuffleDeck: boolean } = { shuffleDeck: true }
): boolean {
  const player = game.players.find((p) => p.userId === playerId)
  if (!player || player.revealed[roleIndex]) return false

  if (options.shuffleDeck) {
    game.deck.push(player.roles[roleIndex])
    game.deck = shuffle(game.deck)
  } else {
    game.deck.unshift(player.roles[roleIndex]) // زیر دسته
  }
  player.roles[roleIndex] = game.deck.pop()! // کارت رویی
  game.log.push(`${player.firstName} کارت جدید گرفت`)

  startShowcase(game, { kind: 'replacement', playerId, replacedIndex: roleIndex , shuffle: options.shuffleDeck, }, REPLACEMENT_SHOWCASE_SECONDS)
  return true
}