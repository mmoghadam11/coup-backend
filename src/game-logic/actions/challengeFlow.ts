import { GameState, isEliminated, shuffle } from '../state'
import { ActionType, RoleName } from '../types'
import { ACTION_TO_ROLE, BLOCKING_ROLES, actionCost } from '../roles'
import { advanceTurn } from '../turns'
import { startContessaSelection, startExchangeSelection } from './selection'

export function startChallengeableAction(
  game: GameState,
  actorId: number,
  action: ActionType,
  targetId?: string
): { error?: string } {
  const actor = game.players.find((p) => p.userId === actorId)
  if (!actor) return { error: 'بازیکن پیدا نشد' }

  const cost = actionCost(action)
  if (cost > 0 && actor.coins < cost) {
    return { error: `سکه کافی ندارید (نیاز به ${cost} سکه)` }
  }

  const claimedRole = ACTION_TO_ROLE[action]
  const others = game.players.filter((p) => p.userId !== actorId && !isEliminated(p))

  game.pendingAction = {
    id: crypto.randomUUID(),
    actorId: String(actorId),
    action,
    targetId,
    claimedRole,
    awaitingResponseFrom: others.map((p) => String(p.userId)),
    responses: {},
    createdAt: Date.now(),
  }
  game.phase = 'awaiting_response'
  game.log.push(`${actor.firstName} اکشن ${action} رو اعلام کرد`)

  if (cost > 0) actor.coins -= cost
  return {}
}

export function respondToAction(game: GameState, userId: number, response: 'allow' | 'challenge') {
  const pending = game.pendingAction
  if (!pending || game.phase !== 'awaiting_response') return
  if (!pending.awaitingResponseFrom.includes(String(userId))) return
  if (response === 'challenge' && !pending.claimedRole) return

  pending.responses[String(userId)] = response

  if (response === 'challenge') {
    initiateChallenge(game, pending.actorId, pending.claimedRole!, 'action', String(userId))
    return
  }

  const allResponded = pending.awaitingResponseFrom.every((id) => pending.responses[id])
  if (allResponded) {
    if (pending.claimedRole) {
      const actor = game.players.find((p) => p.userId === Number(pending.actorId))
      const actuallyHasRole = actor?.roles.some((r, i) => r === pending.claimedRole && !actor.revealed[i])
      if (actor && !actuallyHasRole) {
        actor.stats.successfulBluffs += 1
      }
    }
    resolvePendingActionEffect(game)
  }
}

// اکنون claimedRole رو از خودِ کلاینت می‌گیریم (چون برای steal ممکنه فرمانده یا سفیر ادعا بشه)
export function blockAction(game: GameState, userId: number, claimedRole: RoleName) {
  const pending = game.pendingAction
  if (!pending || game.phase !== 'awaiting_response') return

  const blockableRoles = BLOCKING_ROLES[pending.action]
  if (!blockableRoles || !blockableRoles.includes(claimedRole)) return

  if ((pending.action === 'assassinate' || pending.action === 'steal') && pending.targetId !== String(userId)) {
    return
  }

  pending.blockedBy = { playerId: String(userId), claimedRole }
  pending.blockChallengeResponses = {}
  game.phase = 'awaiting_block_response'
  game.log.push('یکی از بازیکنان اکشن رو بلاک کرد')
}

export function respondToBlock(game: GameState, userId: number, response: 'allow' | 'challenge') {
  const pending = game.pendingAction
  if (!pending?.blockedBy || game.phase !== 'awaiting_block_response') return
  if (userId === Number(pending.blockedBy.playerId)) return

  pending.blockChallengeResponses![String(userId)] = response

  if (response === 'challenge') {
    initiateChallenge(game, pending.blockedBy.playerId, pending.blockedBy.claimedRole, 'block', String(userId))
    return
  }

  const eligible = game.players
    .filter((p) => p.userId !== Number(pending.blockedBy!.playerId) && !isEliminated(p))
    .map((p) => String(p.userId))
  const allResponded = eligible.every((id) => pending.blockChallengeResponses![id])

  if (allResponded) {
    const blocker = game.players.find((p) => p.userId === Number(pending.blockedBy!.playerId))
    const actuallyHasRole = blocker?.roles.some(
      (r, i) => r === pending.blockedBy!.claimedRole && !blocker.revealed[i]
    )
    if (blocker && !actuallyHasRole) {
      blocker.stats.successfulBluffs += 1
    }

    game.log.push('بلاک تایید شد، اکشن خنثی شد')
    game.pendingAction = null
    advanceTurn(game)
  }
}

// به‌جای چک خودکار، فقط منتظر می‌مونیم ادعاکننده خودش یه کارت برای اثبات انتخاب کنه
function initiateChallenge(
  game: GameState,
  claimerId: string,
  claimedRole: RoleName,
  context: 'action' | 'block',
  challengerId: string
) {
  game.provePending = {
    playerId: Number(claimerId),
    claimedRole,
    context,
    challengerId: Number(challengerId),
  }
  game.phase = 'proving_claim'
  game.log.push('چالش زده شد؛ منتظر اثبات هستیم')
}
//برای مدل اتوماتیک
function resolveChallenge(
  game: GameState,
  claimerId: string,
  claimedRole: RoleName,
  context: 'action' | 'block',
  challengerId: string
) {
  const claimer = game.players.find((p) => p.userId === Number(claimerId))
  const challenger = game.players.find((p) => p.userId === Number(challengerId))
  if (!claimer) return

  const idx = claimer.roles.findIndex((r, i) => r === claimedRole && !claimer.revealed[i])
  const hasRole = idx !== -1

  if (hasRole) {
    // ادعا درست بود: claimer کارتشو با یه کارت جدید از دسته عوض می‌کنه
    game.deck.push(claimer.roles[idx])
    game.deck = shuffle(game.deck)
    claimer.roles[idx] = game.deck.pop()!
    game.log.push('ادعا درست بود؛ کارت جدید گرفت')

    if (challenger) challenger.stats.wrongChallenges += 1   // این خط اضافه شد

    game.revealPending = { playerId: Number(challengerId), reason: 'lost_challenge' }

    if (context === 'block') game.pendingAction = null
  } else {
    game.log.push('ادعا دروغ بود!')
    claimer.stats.caughtBluffs += 1                          // این خط اضافه شد
    if (challenger) challenger.stats.correctChallenges += 1  // این خط اضافه شد

    game.revealPending = { playerId: Number(claimerId), reason: 'lost_challenge' }

    if (context === 'action') {
      game.pendingAction = null
    } else {
      if (game.pendingAction) {
        game.pendingAction.blockedBy = undefined
        game.pendingAction.blockChallengeResponses = undefined
      }
    }
  }
}
export function resolvePendingActionEffect(game: GameState) {
  const pending = game.pendingAction
  if (!pending) return

  const actor = game.players.find((p) => p.userId === Number(pending.actorId))
  if (!actor) {
    game.pendingAction = null
    return
  }
  const target = pending.targetId ? game.players.find((p) => p.userId === Number(pending.targetId)) : undefined

  switch (pending.action) {
    case 'foreign_aid':
      actor.coins += 2
      game.log.push(`${actor.firstName} کمک خارجی گرفت`)
      break
    case 'tax':
      actor.coins += 3
      game.log.push(`${actor.firstName} مالیات گرفت`)
      break
    case 'steal':
      if (target) {
        const amount = Math.min(2, target.coins)
        target.coins -= amount
        actor.coins += amount
        actor.stats.successfulSteals += 1
        game.log.push(`${actor.firstName} از هدف دزدی کرد`)
      }
      break
    case 'assassinate':
      if (target) {
        actor.stats.kills += 1   // فقط قاتل
        game.revealPending = { playerId: target.userId, reason: 'assassinated', actorId: actor.userId }
      }
      break
    case 'exchange':
      startExchangeSelection(game, actor.userId)
      break
    case 'contessa_self':
      startContessaSelection(game, actor.userId)
      break
    case 'contessa_other':
      if (target) startContessaSelection(game, target.userId)
      break
  }

  game.pendingAction = null
  if (!game.revealPending && !game.selectionPending) {
    advanceTurn(game)
  }
}