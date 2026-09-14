import { GameState, shuffle } from '../state'
import { ActionType, RoleName } from '../types'
import { ACTION_TO_ROLE, BLOCKING_ROLES, actionCost } from '../roles'
import { advanceTurn } from '../turns'

export function startChallengeableAction(
  game: GameState,
  actorId: number,
  action: ActionType,
  targetId?: string
) {
  const actor = game.players.find((p) => p.userId === actorId)
  if (!actor) return

  const cost = actionCost(action)
  if (cost > 0 && actor.coins < cost) return

  const claimedRole = ACTION_TO_ROLE[action]
  const others = game.players.filter((p) => p.userId !== actorId)

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
}

export function respondToAction(game: GameState, userId: number, response: 'allow' | 'challenge') {
  const pending = game.pendingAction
  if (!pending || game.phase !== 'awaiting_response') return
  if (!pending.awaitingResponseFrom.includes(String(userId))) return
  if (response === 'challenge' && !pending.claimedRole) return
  

  pending.responses[String(userId)] = response

  if (response === 'challenge') {
    resolveChallenge(game, pending.actorId, pending.claimedRole!, 'action', String(userId))
    return
  }

  const allResponded = pending.awaitingResponseFrom.every((id) => pending.responses[id])
  if (allResponded) {
    resolvePendingActionEffect(game)
  }
}

export function blockAction(game: GameState, userId: number) {
  const pending = game.pendingAction
  if (!pending || game.phase !== 'awaiting_response') return

  const blockableRoles = BLOCKING_ROLES[pending.action]
  if (!blockableRoles) return

  if ((pending.action === 'assassinate' || pending.action === 'steal') && pending.targetId !== String(userId)) {
    return
  }

  pending.blockedBy = { playerId: String(userId), claimedRole: blockableRoles[0] }
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
    resolveChallenge(game, pending.blockedBy.playerId, pending.blockedBy.claimedRole, 'block', String(userId))
    return
  }

  const eligible = game.players
    .filter((p) => p.userId !== Number(pending.blockedBy!.playerId))
    .map((p) => String(p.userId))
  const allResponded = eligible.every((id) => pending.blockChallengeResponses![id])

  if (allResponded) {
    game.log.push('بلاک تایید شد، اکشن خنثی شد')
    game.pendingAction = null
  }
}

// context = 'action' یعنی داریم به خودِ ادعای اکشن challenge می‌زنیم
// context = 'block' یعنی داریم به ادعای بلاک‌کننده challenge می‌زنیم
function resolveChallenge(
  game: GameState,
  claimerId: string,
  claimedRole: RoleName,
  context: 'action' | 'block',
  challengerId: string
) {
  const claimer = game.players.find((p) => p.userId === Number(claimerId))
  if (!claimer) return

  const idx = claimer.roles.findIndex((r, i) => r === claimedRole && !claimer.revealed[i])
  const hasRole = idx !== -1

  if (hasRole) {
    // ادعا درست بود: claimer کارتشو با یه کارت جدید از دسته عوض می‌کنه
    game.deck.push(claimer.roles[idx])
    game.deck = shuffle(game.deck)
    claimer.roles[idx] = game.deck.pop()!
    game.log.push('ادعا درست بود؛ کارت جدید گرفت')

    // چالش‌کننده باخته، باید یه کارت رو از دست بده
    game.revealPending = { playerId: Number(challengerId), reason: 'lost_challenge' }

    // اگه روی یه بلاک چالش زده بودن و بلاک درست از آب دراومد، خودِ اکشن اصلی کنسل می‌شه
    if (context === 'block') game.pendingAction = null
    // اگه context === 'action' بود، pendingAction دست‌نخورده می‌مونه تا بعد از reveal، اثرش اجرا بشه
  } else {
    // ادعا دروغ بود: claimer باید یه کارت رو از دست بده
    game.log.push('ادعا دروغ بود!')
    game.revealPending = { playerId: Number(claimerId), reason: 'lost_challenge' }

    if (context === 'action') {
      // خودِ اکشن دروغ بود، کلاً کنسل می‌شه
      game.pendingAction = null
    } else {
      // بلاک دروغ بود؛ بلاک باطل می‌شه ولی اکشن اصلی باید بعد از reveal اجرا بشه
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
        game.log.push(`${actor.firstName} از هدف دزدی کرد`)
      }
      break
    case 'assassinate':
      if (target) game.revealPending = { playerId: target.userId, reason: 'assassinated' }
      break
  }

  game.pendingAction = null
  if (!game.revealPending) {
    advanceTurn(game)
  }
}