import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { sessions, users, rooms, roomPlayers  } from '../db/schema'
import { GameState, initialGameState, isEliminated } from '../game-logic/state'
import { buildFullDeck } from '../game-logic/roles'
import { shuffle } from '../game-logic/state'
import { buildPublicPayload } from '../game-logic/broadcast'
import { advanceTurn } from '../game-logic/turns'
import { applyIncome, applyCoup } from '../game-logic/actions/basic'
import {
  startChallengeableAction,
  respondToAction,
  blockAction,
  respondToBlock,
} from '../game-logic/actions/challengeFlow'
import { revealCard } from '../game-logic/actions/reveal'
import { dealNewGame } from '../game-logic/lifecycle'

type Env = { DB: D1Database }

export class RoomDO {
  state: DurableObjectState
  env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 })
    }

    const url = new URL(request.url)
    const token = url.searchParams.get('token')
    const roomId = url.searchParams.get('roomId')
    if (!token || !roomId) return new Response('token and roomId required', { status: 401 })

    const db = getDb(this.env.DB)
    const [session] = await db.select().from(sessions).where(eq(sessions.token, token))
    if (!session) return new Response('invalid session', { status: 401 })

    const [user] = await db.select().from(users).where(eq(users.id, session.user_id))
    if (!user) return new Response('user not found', { status: 401 })

    const game = await this.getGame()
    if (game.creatorId === null) {
      const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId))
      if (room) game.creatorId = room.created_by
    }
    game.roomId = roomId

    const existing = game.players.find((p) => p.userId === user.id)
    if (existing) {
      existing.connected = true
    } else {
      game.players.push({
        userId: user.id,
        firstName: user.first_name ?? 'بازیکن',
        connected: true,
        coins: 0,
        roles: [],
        revealed: [],
      })
      game.log.push(`${user.first_name} به روم پیوست`)
    }
    await this.saveGame(game)

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.state.acceptWebSocket(server, [String(user.id)])

    this.sendPrivateTo(server, game, user.id)
    await this.broadcast()

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return
    const userId = Number(this.state.getTags(ws)[0])

    let data: any
    try {
      data = JSON.parse(message)
    } catch {
      return
    }

    const game = await this.getGame()

    switch (data.type) {
      case 'chat': {
        const player = game.players.find((p) => p.userId === userId)
        game.log.push(`${player?.firstName ?? 'ناشناس'}: ${data.text}`)
        break
      }
      case 'start_game':
        this.startGame(game, userId)
        break
      case 'action':
        this.dispatchAction(game, userId, data.action, data.targetId)
        break
      case 'respond':
        respondToAction(game, userId, data.response)
        break
      case 'block':
        blockAction(game, userId)
        break
      case 'respond_to_block':
        respondToBlock(game, userId, data.response)
        break
      case 'reveal_card':
        revealCard(game, userId, data.roleIndex)
        break
        case 'restart_game':
    this.restartGame(game, userId)
    break
      case 'leave_room':
        await this.leaveRoom(game, userId)
        break
      case 'close_room':
        await this.closeRoom(game, userId)
        break
      default:
        return
    }

    await this.saveGame(game)
    await this.broadcast()
  }

  async webSocketClose(ws: WebSocket) {
    const userId = Number(this.state.getTags(ws)[0])
    const game = await this.getGame()
    const player = game.players.find((p) => p.userId === userId)
    if (player) player.connected = false
    await this.saveGame(game)
    await this.broadcast()
  }

  // ---- منطق‌هایی که هنوز به‌قدری خاص RoomDO هستن که جدا نکردیم ----

  private startGame(game: GameState, requesterId: number) {
    if (game.phase !== 'waiting_for_players') return
    if (game.creatorId !== requesterId) return
    if (game.players.length < 2) return

    const deck = shuffle(buildFullDeck())
    for (const player of game.players) {
      player.roles = [deck.pop()!, deck.pop()!]
      player.revealed = [false, false]
      player.coins = 2
    }
    game.deck = deck
    game.turnOrder = shuffle(game.players.map((p) => p.userId))
    game.currentTurnIndex = 0
    game.phase = 'awaiting_action'
    game.log.push('بازی شروع شد')
  }

  private dispatchAction(game: GameState, userId: number, action: string, targetId?: string) {
    if (game.phase !== 'awaiting_action') return
    if (game.turnOrder[game.currentTurnIndex] !== userId) return

    if (action === 'income') {
      applyIncome(game, userId)
      advanceTurn(game)
      return
    }
    if (action === 'coup') {
      if (!targetId) return
      applyCoup(game, userId, Number(targetId))
      return
    }
    // بقیه (foreign_aid, tax, assassinate, steal, و بعداً exchange/contessa)
    startChallengeableAction(game, userId, action as any, targetId)
  }

  // ---- storage/broadcast helpers ----

  private async getGame(): Promise<GameState> {
    return (await this.state.storage.get<GameState>('game')) ?? initialGameState()
  }

  private async saveGame(game: GameState) {
    await this.state.storage.put('game', game)
  }

  private sendPrivateTo(ws: WebSocket, game: GameState, userId: number) {
    const player = game.players.find((p) => p.userId === userId)
    if (player) {
      ws.send(JSON.stringify({ type: 'private', private: { yourRoles: player.roles, yourRevealed: player.revealed } }))
    }
  }

  private async broadcast() {
    const game = await this.getGame()
    const publicPayload = JSON.stringify(buildPublicPayload(game))
    for (const ws of this.state.getWebSockets()) {
      ws.send(publicPayload)
      const userId = Number(this.state.getTags(ws)[0])
      this.sendPrivateTo(ws, game, userId)
    }
  }

  private restartGame(game: GameState, requesterId: number) {
  if (game.phase !== 'game_over') return
  if (game.creatorId !== requesterId) return
  dealNewGame(game)
  game.log.push('بازی مجدد شروع شد')
}

private async leaveRoom(game: GameState, userId: number) {
  if (game.phase !== 'game_over') return // فقط بعد از پایان بازی می‌شه خارج شد
  if (!game.roomId) return

  const db = getDb(this.env.DB)
  await db
    .delete(roomPlayers)
    .where(and(eq(roomPlayers.room_id, game.roomId), eq(roomPlayers.user_id, userId)))
  await db.update(users).set({ active_room_id: null }).where(eq(users.id, userId))

  const player = game.players.find((p) => p.userId === userId)
  game.players = game.players.filter((p) => p.userId !== userId)
  game.turnOrder = game.turnOrder.filter((id) => id !== userId)
  game.log.push(`${player?.firstName ?? 'یک بازیکن'} از روم خارج شد`)
}

private async closeRoom(game: GameState, requesterId: number) {
  if (game.creatorId !== requesterId) return
  if (!game.roomId) return

  const db = getDb(this.env.DB)
  await db.update(rooms).set({ status: 'finished' }).where(eq(rooms.id, game.roomId))

  for (const player of game.players) {
    await db.update(users).set({ active_room_id: null }).where(eq(users.id, player.userId))
  }
  await db.delete(roomPlayers).where(eq(roomPlayers.room_id, game.roomId))

  game.phase = 'room_closed'
  game.log.push('روم توسط سازنده بسته شد')
}
}