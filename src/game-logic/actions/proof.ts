import { GameState, isEliminated } from '../state'
// import { startShowcase } from './showcase'
import { startShowcase } from './showcaseCore'

import { PROOF_SHOWCASE_SECONDS } from '../matchmakingConfig'

export function provideProof(game: GameState, userId: number, roleIndex: number): { ok: boolean } {
  const prove = game.provePending
  if (!prove || prove.playerId !== userId) return { ok: false }

  const forcedIndex =
    prove.context === 'action' && game.pendingAction?.action === 'contessa_self'
      ? game.pendingAction.claimedCardIndex
      : undefined
  const idx = forcedIndex ?? roleIndex
  // const claimer = game.players.find((p) => p.userId === userId)
  // if (!claimer || claimer.revealed[roleIndex]) return { ok: false }
  // const shownRole = claimer.roles[roleIndex]
  const claimer = game.players.find((p) => p.userId === userId)
  if (!claimer || claimer.revealed[idx]) return { ok: false }
  const shownRole = claimer.roles[idx]

  const success = shownRole === prove.claimedRole
  const challenger = game.players.find((p) => p.userId === prove.challengerId)

  if (success) {
    // جایگزینی کارت عمداً عقب افتاده: اول چالش‌گر کارتش رو می‌سوزونه
    // game.pendingReplacement = { playerId: userId, roleIndex }
    game.pendingReplacement = { playerId: userId, roleIndex: idx }
    if (prove.context === 'action' && game.pendingAction?.action === 'contessa_self') {
      game.pendingAction.selfSwapDone = true // همین بُر خوردن، خودِ تعویضه
    }
    if (challenger) challenger.stats.wrongChallenges += 1
    game.revealPending = { playerId: prove.challengerId, reason: 'lost_challenge', actorId: userId }
    game.log.push(`${claimer.firstName} کارت رو نشون داد؛ ادعا درست بود`)

    if (prove.context === 'block') game.pendingAction = null
    if (prove.context === 'anarchist_block' && game.anarchistPending) {
      game.anarchistPending.status = 'awaiting_pass_target'
    }
  } else {
    const attackerId = game.anarchistPending?.originalAttackerId

    // claimer.revealed[roleIndex] = true
    claimer.revealed[idx] = true
    claimer.stats.caughtBluffs += 1
    if (challenger) challenger.stats.correctChallenges += 1
    game.log.push(`${claimer.firstName} کارت رو نشون داد؛ ادعا دروغ بود و اون کارت رو از دست داد`)
    if (isEliminated(claimer)) game.log.push(`${claimer.firstName} حذف شد`)

    if (prove.context === 'action') {
      game.pendingAction = null
    } else if (prove.context === 'block') {
      if (game.pendingAction) {
        game.pendingAction.blockedBy = undefined
        game.pendingAction.blockChallengeResponses = undefined
      }
    } else if (prove.context === 'anarchist_block') {
      game.anarchistPending = null
      // بلاک دروغ بود؛ حمله روی بلاک‌کننده موفق می‌شه (اگه هنوز زنده‌ست)
      if (!isEliminated(claimer)) {
        game.revealPending = { playerId: userId, reason: 'anarchist', actorId: attackerId }
      }
    }
  }

  game.provePending = null
  startShowcase(game, { kind: 'proof', playerId: userId, role: shownRole, success }, PROOF_SHOWCASE_SECONDS)
  return { ok: true }
}