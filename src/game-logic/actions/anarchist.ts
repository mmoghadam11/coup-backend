import { GameState } from '../state'
import { ANARCHIST_COST, ANARCHIST_BLOCK_ROLE } from '../roles'

export function startAnarchistAttack(game: GameState, actorId: number, targetId: number): { error?: string } {
  const actor = game.players.find((p) => p.userId === actorId)
  if (!actor) return { error: 'بازیکن پیدا نشد' }
  if (actor.coins < ANARCHIST_COST) return { error: `سکه کافی ندارید (نیاز به ${ANARCHIST_COST} سکه)` }

  const target = game.players.find((p) => p.userId === targetId)
  if (!target) return { error: 'هدف پیدا نشد' }

  actor.coins -= ANARCHIST_COST
  game.anarchistPending = {
    originalAttackerId: actorId,
    currentTargetId: targetId,
    chain: [targetId],
    status: 'awaiting_block_decision',
  }
  game.phase = 'anarchist_in_progress'
  game.log.push(`${actor.firstName} با پرداخت ${ANARCHIST_COST} سکه حمله‌ی آنارشیست رو فعال کرد`)
  return {}
}

export function respondToAnarchist(game: GameState, userId: number, response: 'allow' | 'block') {
  const ap = game.anarchistPending
  if (!ap || ap.status !== 'awaiting_block_decision') return
  if (ap.currentTargetId !== userId) return

  if (response === 'allow') {
    game.log.push('حمله‌ی آنارشیست بدون بلاک قبول شد')
    game.revealPending = { playerId: userId, reason: 'anarchist' }
    game.anarchistPending = null
    return
  }

  ap.status = 'awaiting_block_challenge'
  ap.blockChallengeResponses = {}
  game.log.push('یکی از بازیکنان با ادعای شاهدخت بلاک کرد')
}

export function respondToAnarchistBlock(game: GameState, userId: number, response: 'allow' | 'challenge') {
  const ap = game.anarchistPending
  if (!ap || ap.status !== 'awaiting_block_challenge') return
  if (userId === ap.currentTargetId) return

  ap.blockChallengeResponses![String(userId)] = response

  if (response === 'challenge') {
    game.provePending = {
      playerId: ap.currentTargetId,
      claimedRole: ANARCHIST_BLOCK_ROLE,
      context: 'anarchist_block',
      challengerId: userId,
    }
    game.phase = 'proving_claim'
    return
  }

  const eligible = game.players.filter((p) => p.userId !== ap.currentTargetId).map((p) => String(p.userId))
  const allResponded = eligible.every((id) => ap.blockChallengeResponses![id])

  if (allResponded) {
    game.log.push('بلاک با ادعای شاهدخت تایید شد؛ مدافع باید تصمیم بگیره')
    ap.status = 'awaiting_pass_target'
  }
}

// مدافع تصمیم می‌گیره: کارت رو pass بده (به یکی خارج از زنجیره) یا حمله رو کامل خنثی کنه
export function passAnarchistCard(game: GameState, userId: number, newTargetId: number): { error?: string } {
  const ap = game.anarchistPending
  if (!ap || ap.status !== 'awaiting_pass_target') return { error: 'الان نوبت pass دادن نیست' }
  if (ap.currentTargetId !== userId) return { error: 'شما نمی‌تونید pass بدید' }
  if (newTargetId === ap.originalAttackerId) return { error: 'نمی‌شه به مهاجم اول pass داد' }
  if (ap.chain.includes(newTargetId)) return { error: 'این بازیکن قبلاً این کارت رو داشته' }

  const newTarget = game.players.find((p) => p.userId === newTargetId)
  if (!newTarget) return { error: 'بازیکن هدف پیدا نشد' }

  ap.chain.push(newTargetId)
  ap.currentTargetId = newTargetId
  ap.status = 'awaiting_block_decision'
  game.log.push(`${newTarget.firstName} حالا هدف حمله‌ی آنارشیسته`)
  return {}
}

// این تابع جدید اضافه شد: مدافع می‌تونه به‌جای pass دادن، کلاً حمله رو خنثی کنه — هیچ‌کس کارت از دست نمی‌ده
export function neutralizeAnarchist(game: GameState, userId: number): { error?: string } {
  const ap = game.anarchistPending
  if (!ap || ap.status !== 'awaiting_pass_target') return { error: 'الان نمی‌شه خنثی کرد' }
  if (ap.currentTargetId !== userId) return { error: 'شما نمی‌تونید این کارو بکنید' }

  game.anarchistPending = null
  game.log.push('حمله‌ی آنارشیست خنثی شد؛ کسی کارت از دست نداد')
  return {}
}