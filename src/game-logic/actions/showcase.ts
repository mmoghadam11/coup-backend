import { GameState, Showcase, isEliminated, shuffle } from '../state'
import { advanceTurn } from '../turns'
import { resolvePendingActionEffect } from './challengeFlow'
import { REPLACEMENT_SHOWCASE_SECONDS } from '../matchmakingConfig'

export function startShowcase(game: GameState, data: Omit<Showcase, 'endsAt'>, seconds: number) {
  game.showcase = { ...data, endsAt: Date.now() + seconds * 1000 }
}

// وقتی زمان یه showcase تموم شد (از alarm صدا زده می‌شه) مرحله‌ی بعد رو تعیین می‌کنه
export function continueFlow(game: GameState): { gameJustEnded: boolean } {
  game.showcase = null

  // ۱. هنوز کسی باید یه کارت بسوزونه (مثلاً چالش‌گری که چالش رو باخته)
  if (game.revealPending) return { gameJustEnded: false }

  // ۲. پایان بازی — فقط اینجا و بعد از تموم شدن نمایش کارت‌ها ست می‌شه
  const alive = game.players.filter((p) => !isEliminated(p))
  if (alive.length <= 1) {
    game.pendingReplacement = null
    game.phase = 'game_over'
    game.winnerId = alive[0]?.userId ?? null
    if (alive[0]) game.log.push(`${alive[0].firstName} برنده‌ی بازی شد!`)
    return { gameJustEnded: true }
  }

  // ۳. جایگزینی کارتِ کسی که ادعاش درست بود (بعد از سوختن کارت چالش‌گر)
  if (game.pendingReplacement) {
    const { playerId, roleIndex } = game.pendingReplacement
    game.pendingReplacement = null
    const player = game.players.find((p) => p.userId === playerId)
    if (player && !player.revealed[roleIndex]) {
      game.deck.push(player.roles[roleIndex])
      game.deck = shuffle(game.deck)
      player.roles[roleIndex] = game.deck.pop()!
      game.log.push(`${player.firstName} کارت جدید گرفت`)
      startShowcase(game, { kind: 'replacement', playerId, replacedIndex: roleIndex }, REPLACEMENT_SHOWCASE_SECONDS)
      return { gameJustEnded: false }
    }
  }

  // ۴. بقیه‌ی جریان، دقیقاً مثل قبل
  if (game.pendingAction) {
    resolvePendingActionEffect(game)
    return { gameJustEnded: false }
  }
  if (game.selectionPending) return { gameJustEnded: false }
  if (game.anarchistPending) {
    game.phase = 'anarchist_in_progress'
    return { gameJustEnded: false }
  }

  advanceTurn(game)
  return { gameJustEnded: false }
}