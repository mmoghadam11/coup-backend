import { GameState, isEliminated } from './state'
import { advanceTurn } from './turns'
import { applyIncome } from './actions/basic'
import { respondToAction, respondToBlock } from './actions/challengeFlow'
import { finishDuelPick } from './duel'
import { ACTION_SECONDS, RESPONSE_SECONDS, DUEL_PICK_SECONDS, DEADLINE_GRACE_MS } from './matchmakingConfig'

const TIMED = ['duel_pick', 'awaiting_action', 'awaiting_response', 'awaiting_block_response']

// کلیدی که می‌گوید «منتظر چه چیزی هستیم»؛ null یعنی مهلتی لازم نیست
function waitKey(g: GameState): string | null {
  if (!TIMED.includes(g.phase)) return null
  if (g.showcase || g.revealPending || g.selectionPending || g.provePending || g.pendingReplacement) return null
  if (g.phase === 'awaiting_action' && g.pendingAction) return null
  return [g.phase, g.currentTurnIndex, g.pendingAction?.id ?? '', g.pendingAction?.blockedBy?.playerId ?? ''].join('|')
}

const secondsFor = (phase: string) =>
  phase === 'duel_pick' ? DUEL_PICK_SECONDS : phase === 'awaiting_action' ? ACTION_SECONDS : RESPONSE_SECONDS

export function syncPhaseDeadline(g: GameState) {
  const key = waitKey(g)
  if (key === null) { g.deadlineKey = null; g.deadlineAt = null; return }
  if (key === g.deadlineKey && g.deadlineAt) return     // همان انتظار قبلی؛ مهلت دست‌نخورده
  const ms = secondsFor(g.phase) * 1000
  g.deadlineKey = key
  g.deadlineTotalMs = ms
  g.deadlineAt = Date.now() + ms + DEADLINE_GRACE_MS
}

export function handlePhaseTimeout(g: GameState): { gameJustEnded: boolean } {
  g.deadlineAt = null; g.deadlineKey = null

  if (g.phase === 'duel_pick') { finishDuelPick(g); return { gameJustEnded: false } }

  if (g.phase === 'awaiting_action') {
    const id = g.turnOrder[g.currentTurnIndex]
    const p = g.players.find((x) => x.userId === id)
    if (p) {
      g.log.push(`مهلت ${p.firstName} تمام شد؛ درآمد گرفته شد`)
      applyIncome(g, id)
      advanceTurn(g)
    }
    return { gameJustEnded: false }
  }

  const pa = g.pendingAction
  if (!pa) return { gameJustEnded: false }
  const paId = pa.id

  if (g.phase === 'awaiting_response') {
    for (const pid of [...pa.awaitingResponseFrom]) {
      if (g.phase !== 'awaiting_response' || g.pendingAction?.id !== paId) break
      if (!pa.responses[pid]) respondToAction(g, Number(pid), 'allow')
    }
  } else if (g.phase === 'awaiting_block_response' && pa.blockedBy) {
    const blocker = pa.blockedBy.playerId
    const eligible = g.players.filter((p) => String(p.userId) !== blocker && !isEliminated(p))
    for (const p of eligible) {
      if (g.phase !== 'awaiting_block_response' || g.pendingAction?.id !== paId) break
      if (!pa.blockChallengeResponses?.[String(p.userId)]) respondToBlock(g, p.userId, 'allow')
    }
  }
  return { gameJustEnded: false }
}