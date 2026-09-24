import { GameState, isEliminated, shuffle } from '../state'
import { RoleName } from '../types'
import { advanceTurn } from '../turns'
import { resolvePendingActionEffect } from './challengeFlow'

export interface ProofResult {
  gameJustEnded: boolean
  shownRole?: RoleName
  success?: boolean
}

export function provideProof(game: GameState, userId: number, roleIndex: number): ProofResult {
  const prove = game.provePending
  if (!prove || prove.playerId !== userId) return { gameJustEnded: false }

  const claimer = game.players.find((p) => p.userId === userId)
  if (!claimer || claimer.revealed[roleIndex]) return { gameJustEnded: false }

  const shownRole = claimer.roles[roleIndex]
  const success = shownRole === prove.claimedRole
  const challenger = game.players.find((p) => p.userId === prove.challengerId)

  if (success) {
    game.deck.push(claimer.roles[roleIndex])
    game.deck = shuffle(game.deck)
    claimer.roles[roleIndex] = game.deck.pop()!
    game.log.push(`${claimer.firstName} کارت رو نشون داد؛ ادعا درست بود`)

    if (challenger) challenger.stats.wrongChallenges += 1
    game.revealPending = { playerId: prove.challengerId, reason: 'lost_challenge' }

    if (prove.context === 'block') game.pendingAction = null
    // context === 'anarchist_block' یعنی anarchistPending.status باید بعد از این reveal بره awaiting_pass_target
    if (prove.context === 'anarchist_block' && game.anarchistPending) {
      game.anarchistPending.status = 'awaiting_pass_target'
    }

    game.provePending = null
    return { gameJustEnded: false, shownRole, success: true }
  }

  claimer.revealed[roleIndex] = true
  claimer.stats.caughtBluffs += 1
  if (challenger) challenger.stats.correctChallenges += 1
  game.log.push(`${claimer.firstName} کارت رو نشون داد؛ ادعا دروغ بود و اون کارت رو از دست داد`)

  if (isEliminated(claimer)) {
    game.log.push(`${claimer.firstName} حذف شد`)
  }

  if (prove.context === 'action') {
    game.pendingAction = null
  } else if (prove.context === 'block') {
    if (game.pendingAction) {
      game.pendingAction.blockedBy = undefined
      game.pendingAction.blockChallengeResponses = undefined
    }
  } else if (prove.context === 'anarchist_block') {
    // بلاک دروغ بود؛ حمله موفق می‌شه روی همون بلاک‌کننده (اگه هنوز زنده مونده باشه)
    game.anarchistPending = null
  }
  game.provePending = null

  const alivePlayers = game.players.filter((p) => !isEliminated(p))
  if (alivePlayers.length === 1) {
    game.phase = 'game_over'
    game.winnerId = alivePlayers[0].userId
    game.log.push(`${alivePlayers[0].firstName} برنده‌ی بازی شد!`)
    return { gameJustEnded: true, shownRole, success: false }
  }

  if (prove.context === 'anarchist_block' && !isEliminated(claimer)) {
    // حمله‌ی آنارشیست موفق شد، یه کارت دیگه هم باید از همون بلاک‌کننده کور بشه
    game.revealPending = { playerId: prove.playerId, reason: 'anarchist' }
    return { gameJustEnded: false, shownRole, success: false }
  }

  if (game.pendingAction) {
    resolvePendingActionEffect(game)
    return { gameJustEnded: false, shownRole, success: false }
  }

  if (game.revealPending || game.selectionPending) {
    return { gameJustEnded: false, shownRole, success: false }
  }

  if (game.anarchistPending) {
    game.phase = 'anarchist_in_progress'
    return { gameJustEnded: false, shownRole, success: false }
  }

  advanceTurn(game)
  return { gameJustEnded: false, shownRole, success: false }
}