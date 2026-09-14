import { GameState, shuffle } from '../state'

// ambassador: actor کارت‌های فعلیش + ۲ کارت جدید رو می‌بینه، باید همون تعداد قبلی رو نگه داره
export function startExchangeSelection(game: GameState, actorId: number) {
  const actor = game.players.find((p) => p.userId === actorId)
  if (!actor) return

  const drawn = [game.deck.pop()!, game.deck.pop()!]
  const activeRoles = actor.roles.filter((_, i) => !actor.revealed[i])
  const pool = [...activeRoles, ...drawn]

  game.selectionPending = { playerId: actorId, mode: 'exchange', pool, keepCount: activeRoles.length }
  game.phase = 'exchange_in_progress'
  game.log.push(`${actor.firstName} در حال تعویض کارت (سفیر) است`)
}

export function confirmExchangeSelection(game: GameState, userId: number, keepIndexes: number[]) {
  const sel = game.selectionPending
  if (!sel || sel.mode !== 'exchange' || sel.playerId !== userId || !sel.pool) return
  if (keepIndexes.length !== sel.keepCount) return

  const actor = game.players.find((p) => p.userId === userId)
  if (!actor) return

  const kept = keepIndexes.map((i) => sel.pool![i])
  const returned = sel.pool.filter((_, i) => !keepIndexes.includes(i))

  game.deck.push(...returned)
  game.deck = shuffle(game.deck)

  let k = 0
  actor.roles = actor.roles.map((r, i) => (actor.revealed[i] ? r : kept[k++]))

  game.selectionPending = null
  game.phase = 'awaiting_action'
  game.log.push(`${actor.firstName} تعویض کارت رو انجام داد`)
}

// contessa (چه self چه other): همون یه نفر (playerId) باید یکی از کارت‌های خودش رو انتخاب کنه که با روی دسته عوض بشه
export function startContessaSelection(game: GameState, playerId: number) {
  const player = game.players.find((p) => p.userId === playerId)
  if (!player) return

  game.selectionPending = { playerId, mode: 'contessa' }
  game.phase = 'contessa_in_progress'
  game.log.push(`${player.firstName} باید یکی از کارت‌هاش رو برای تعویض انتخاب کنه`)
}

export function confirmContessaSelection(game: GameState, userId: number, roleIndex: number) {
  const sel = game.selectionPending
  if (!sel || sel.mode !== 'contessa' || sel.playerId !== userId) return

  const player = game.players.find((p) => p.userId === userId)
  if (!player || player.revealed[roleIndex]) return

  const oldRole = player.roles[roleIndex]
  game.deck.push(oldRole)
  game.deck = shuffle(game.deck)
  player.roles[roleIndex] = game.deck.pop()!

  game.selectionPending = null
  game.phase = 'awaiting_action'
  game.log.push(`${player.firstName} یکی از کارت‌هاش رو تعویض کرد`)
}