import { GameState, isEliminated } from '../state'
// import { startShowcase } from './showcase'
import { startShowcase } from './showcaseCore'
import { REVEAL_SHOWCASE_SECONDS } from '../matchmakingConfig'

export function revealCard(game: GameState, userId: number, roleIndex: number): { ok: boolean } {
  if (!game.revealPending || game.revealPending.playerId !== userId) return { ok: false }

  const player = game.players.find((p) => p.userId === userId)
  if (!player || player.revealed[roleIndex]) return { ok: false }

  const role = player.roles[roleIndex]
  player.revealed[roleIndex] = true
  game.log.push(`${player.firstName} یکی از کارت‌هاش رو کشت`)
  game.revealPending = null

  const eliminated = isEliminated(player)
  if (eliminated) game.log.push(`${player.firstName} حذف شد`)

  // دیگه اینجا game_over نمی‌شه؛ اول نمایش کارت، بعد continueFlow
  startShowcase(game, { kind: 'reveal', playerId: userId, role, eliminated }, REVEAL_SHOWCASE_SECONDS)
  return { ok: true }
}