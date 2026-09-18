import { GameState } from "../state"

export function initiateRestartVote(game: GameState, reopenForJoining: boolean) {
  game.phase = 'restart_vote'
  game.restartVote = { reopenForJoining, responses: {} }
  game.log.push('سازنده در حال شروع مجدد بازیه؛ بقیه باید مشخص کنن می‌مونن یا می‌رن')
}

export function respondToRestartVote(game: GameState, userId: number, choice: 'stay' | 'leave') {
  if (!game.restartVote || game.phase !== 'restart_vote') return
  if (userId === game.creatorId) return // سازنده همیشه می‌مونه، لازم نیست رای بده
  game.restartVote.responses[String(userId)] = choice
}

export function isRestartVoteComplete(game: GameState): boolean {
  if (!game.restartVote) return false
  const others = game.players.filter((p) => p.userId !== game.creatorId)
  return others.every((p) => !!game.restartVote!.responses[String(p.userId)])
}

export function getLeavingPlayerIds(game: GameState): number[] {
  if (!game.restartVote) return []
  return Object.entries(game.restartVote.responses)
    .filter(([, choice]) => choice === 'leave')
    .map(([id]) => Number(id))
}