import { GameState, isEliminated } from './state'
import { DEADLINE_GRACE_MS, STAGE_SECONDS } from './matchmakingConfig'

const here = (g: GameState) => g.players.filter((p) => !(p as { leftRoom?: boolean }).leftRoom)
const alive = (g: GameState) => here(g).filter((p) => !isEliminated(p))

// «الان منتظر چه چیزی هستیم»؛ null یعنی مهلتی لازم نیست. با عوض شدن این رشته، مهلت از نو شروع می‌شود
export function stageOf(g: GameState): string | null {
  if (g.showcase || g.roomPhase !== 'playing') return null
  // تعویض کارت بعد از سوختن کارت چالش‌گر انجام می‌شود؛ تا آن موقع pendingReplacement پر است ولی مرحله‌ی
  // «سوزاندن» فعال است. فقط وقتی کسی منتظر سوزاندن نیست، pendingReplacement یعنی «در حال گذار»
  if (g.pendingReplacement && !g.revealPending) return null
  if (g.revealPending) return `reveal:${g.revealPending.playerId}`
  if (g.selectionPending) return `select:${g.selectionPending.playerId}`
  if (g.provePending) return `prove:${g.provePending.playerId}:${g.provePending.challengerId}`
  const pa = g.pendingAction
  switch (g.phase) {
    case 'duel_pick': return 'duel'
    case 'awaiting_action': return pa ? null : `action:${g.currentTurnIndex}`
    case 'awaiting_response': return pa ? `resp:${pa.id}` : null
    case 'awaiting_block_response': return pa?.blockedBy ? `blk:${pa.id}:${pa.blockedBy.playerId}` : null
    case 'anarchist_in_progress': {
      const ap = g.anarchistPending
      return ap ? `an:${ap.status}:${ap.currentTargetId}:${ap.chain.length}` : null
    }
    default: return null
  }
}

// چه کسانی باید تصمیم بگیرند
export function waitedOn(g: GameState): number[] {
  if (!stageOf(g)) return []
  if (g.revealPending) return [g.revealPending.playerId]
  if (g.selectionPending) return [g.selectionPending.playerId]
  if (g.provePending) return [g.provePending.playerId]
  const pa = g.pendingAction
  switch (g.phase) {
    case 'duel_pick': return here(g).filter((p) => !g.duelPicks[String(p.userId)]).map((p) => p.userId)
    case 'awaiting_action': { const id = g.turnOrder[g.currentTurnIndex]; return id === undefined ? [] : [id] }
    case 'awaiting_response': return pa ? pa.awaitingResponseFrom.filter((id) => !pa.responses[id]).map(Number) : []
    case 'awaiting_block_response':
      return pa?.blockedBy
        ? alive(g).filter((p) => String(p.userId) !== pa.blockedBy!.playerId && !pa.blockChallengeResponses?.[String(p.userId)]).map((p) => p.userId)
        : []
    case 'anarchist_in_progress': {
      const ap = g.anarchistPending
      if (!ap) return []
      if (ap.status !== 'awaiting_block_challenge') return [ap.currentTargetId]
      return alive(g).filter((p) => p.userId !== ap.currentTargetId && !ap.blockChallengeResponses?.[String(p.userId)]).map((p) => p.userId)
    }
    default: return []
  }
}

const KEY: Record<string, keyof typeof STAGE_SECONDS> = {
  duel: 'duel', action: 'action', resp: 'response', blk: 'response',
  prove: 'prove', reveal: 'reveal', select: 'select', an: 'anarchist',
}
const secondsOf = (stage: string) => STAGE_SECONDS[KEY[stage.split(':')[0]] ?? 'response']

export function syncPhaseDeadline(g: GameState) {
  const stage = stageOf(g)
  // همه‌ی منتظرشده‌ها آفلاین‌اند: تایمر نوبت متوقف؛ فقط مهلت قطعی می‌گذرد. با برگشتن یکی، از اول شروع می‌شود
  const anyOnline = !!stage && waitedOn(g).some((id) => g.players.find((p) => p.userId === id)?.connected)
  if (!stage || !anyOnline) { g.deadlineKey = null; g.deadlineAt = null; return }
  if (stage === g.deadlineKey && g.deadlineAt) return      // همان انتظار قبلی؛ مهلت دست‌نخورده
  const ms = secondsOf(stage) * 1000
  g.deadlineKey = stage
  g.deadlineTotalMs = ms
  g.deadlineAt = Date.now() + ms + DEADLINE_GRACE_MS
}