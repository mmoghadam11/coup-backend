import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { sessions, users } from '../db/schema'
import { RoleName, GamePhase } from '../game-logic/types'
import { buildFullDeck } from '../game-logic/roles'
import { rooms } from '../db/schema'

type Env = { DB: D1Database }

interface InternalPlayer {
  userId: number
  firstName: string
  connected: boolean
  coins: number
  roles: RoleName[]
  revealed: boolean[]
}

interface GameState {
  phase: GamePhase
  creatorId: number | null
  players: InternalPlayer[]
  turnOrder: number[]
  currentTurnIndex: number
  deck: RoleName[]
  log: string[]
}

function initialGameState(): GameState {
  return {
    phase: 'waiting_for_players',
    creatorId: null,
    players: [],
    turnOrder: [],
    currentTurnIndex: 0,
    deck: [],
    log: [],
  }
}

// الگوریتم استاندارد Fisher-Yates برای شافل کردن یه آرایه
function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

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
    if (!token || !roomId) {
      return new Response('token and roomId required', { status: 401 })
    }

    const db = getDb(this.env.DB)
    const [session] = await db.select().from(sessions).where(eq(sessions.token, token))
    if (!session) return new Response('invalid session', { status: 401 })

    const [user] = await db.select().from(users).where(eq(users.id, session.user_id))
    if (!user) return new Response('user not found', { status: 401 })

      // اگه هنوز creatorId رو نمی‌دونیم، همین الان از D1 بخون
  const game = await this.getGame()
  if (game.creatorId === null) {
    const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId))
    if (room) {
      game.creatorId = room.created_by
      await this.saveGame(game)
    }
  }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.state.acceptWebSocket(server, [String(user.id)])

    await this.addOrReconnectPlayer(user.id, user.first_name ?? 'بازیکن')

    await this.sendStateTo(server)
    await this.broadcastPublicState()

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return

    const tags = this.state.getTags(ws)
    const userId = Number(tags[0])

    let data: any
    try {
      data = JSON.parse(message)
    } catch {
      return
    }

    if (data.type === 'chat') {
      const game = await this.getGame()
      const player = game.players.find((p) => p.userId === userId)
      const name = player?.firstName ?? 'ناشناس'
      game.log.push(`${name}: ${data.text}`)
      await this.saveGame(game)
      await this.broadcastPublicState()
      return
    }

    if (data.type === 'start_game') {
      await this.startGame(userId)
      return
    }

    // بقیه‌ی انواع پیام (action, respond, block, ...) رو قدم بعد اضافه می‌کنیم
  }

  async webSocketClose(ws: WebSocket) {
    const tags = this.state.getTags(ws)
    const userId = Number(tags[0])

    const game = await this.getGame()
    const player = game.players.find((p) => p.userId === userId)
    if (player) player.connected = false
    await this.saveGame(game)
    await this.broadcastPublicState()
  }

  // ---- منطق شروع بازی ----

  private async startGame(requesterId: number) {
    const game = await this.getGame()

    if (game.phase !== 'waiting_for_players') {
      return // بازی از قبل شروع شده، دوباره نمی‌شه شروعش کرد
    }
    if (game.creatorId !== requesterId) return
    if (game.players.length < 2) {
      return // بعداً پیام خطای مناسب برای کلاینت هم اضافه می‌کنیم
    }

    const deck = shuffle(buildFullDeck())

    // به هر بازیکن ۲ تا کارت از بالای دسته بده
    for (const player of game.players) {
      player.roles = [deck.pop()!, deck.pop()!]
      player.revealed = [false, false]
      player.coins = 2 // سکه‌ی شروع استاندارد Coup
    }

    game.deck = deck
    game.turnOrder = shuffle(game.players.map((p) => p.userId))
    game.currentTurnIndex = 0
    game.phase = 'awaiting_action'
    game.log.push('بازی شروع شد')

    await this.saveGame(game)
    await this.broadcastPublicState()
    await this.broadcastPrivateStates()
  }

  // ---- مدیریت اتصال/قطع بازیکن‌ها ----

  private async addOrReconnectPlayer(userId: number, firstName: string) {
    const game = await this.getGame()
    const existing = game.players.find((p) => p.userId === userId)

    if (existing) {
      existing.connected = true // فقط وضعیت آنلاین رو آپدیت کن، کارت‌ها/سکه‌ها دست‌نخورده می‌مونن
    } else {
      game.players.push({
        userId,
        firstName,
        connected: true,
        coins: 0,
        roles: [],
        revealed: [],
      })
      game.log.push(`${firstName} به روم پیوست`)
    }

    await this.saveGame(game)
  }

  // ---- خواندن/نوشتن state از storage ----

  private async getGame(): Promise<GameState> {
    return (await this.state.storage.get<GameState>('game')) ?? initialGameState()
  }

  private async saveGame(game: GameState) {
    await this.state.storage.put('game', game)
  }

  // ---- broadcast ----

  private buildPublicPayload(game: GameState) {
    return {
      type: 'state',
      state: {
        phase: game.phase,
        creatorId: game.creatorId ? String(game.creatorId) : null,
        players: game.players.map((p) => ({
          id: String(p.userId),
          name: p.firstName,
          connected: p.connected,
          coins: p.coins,
          roleCount: p.roles.length,
        })),
        turnOrder: game.turnOrder.map(String),
        currentTurnIndex: game.currentTurnIndex,
        deckCount: game.deck.length,
        log: game.log.slice(-100),
      },
    }
  }

  private async sendStateTo(ws: WebSocket) {
    const game = await this.getGame()
    ws.send(JSON.stringify(this.buildPublicPayload(game)))

    const tags = this.state.getTags(ws)
    const userId = Number(tags[0])
    const player = game.players.find((p) => p.userId === userId)
    if (player) {
      ws.send(JSON.stringify({ type: 'private', private: { yourRoles: player.roles, yourRevealed: player.revealed } }))
    }
  }

  private async broadcastPublicState() {
    const game = await this.getGame()
    const payload = JSON.stringify(this.buildPublicPayload(game))
    for (const ws of this.state.getWebSockets()) {
      ws.send(payload)
    }
  }

  private async broadcastPrivateStates() {
    const game = await this.getGame()
    for (const ws of this.state.getWebSockets()) {
      const tags = this.state.getTags(ws)
      const userId = Number(tags[0])
      const player = game.players.find((p) => p.userId === userId)
      if (player) {
        ws.send(JSON.stringify({ type: 'private', private: { yourRoles: player.roles, yourRevealed: player.revealed } }))
      }
    }
  }
}