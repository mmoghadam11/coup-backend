import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { sessions, users } from '../db/schema'

type Env = {
  DB: D1Database
}

interface StoredPlayer {
  userId: number
  firstName: string
  connected: boolean
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
    if (!token) return new Response('token required', { status: 401 })

    // شناسایی کاربر واقعی از روی token (دقیقاً مثل authMiddleware، ولی اینجا دستی)
    const db = getDb(this.env.DB)
    const [session] = await db.select().from(sessions).where(eq(sessions.token, token))
    if (!session) return new Response('invalid session', { status: 401 })

    const [user] = await db.select().from(users).where(eq(users.id, session.user_id))
    if (!user) return new Response('user not found', { status: 401 })

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // tag = userId، تا بعد از Hibernation هم بشه فهمید این WebSocket مال کیه
    this.state.acceptWebSocket(server, [String(user.id)])

    await this.addPlayer(user.id, user.first_name)
    //  بلافاصله وضعیت فعلی رو فقط به همین کانکشن جدید بفرست
    await this.sendCurrentState(server)
    await this.broadcastPlayers()

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
      await this.appendLog(`${userId}: ${data.text}`)
      await this.broadcastLog()
    }
  }

  async webSocketClose(ws: WebSocket) {
    const tags = this.state.getTags(ws)
    const userId = Number(tags[0])

    await this.setPlayerConnected(userId, false)
    await this.broadcastPlayers()
  }

  // ---- کمکی‌ها برای کار با storage ----

  private async getPlayers(): Promise<StoredPlayer[]> {
    return (await this.state.storage.get<StoredPlayer[]>('players')) ?? []
  }

  private async addPlayer(userId: number, firstName: string) {
    const players = await this.getPlayers()
    const existing = players.find((p) => p.userId === userId)
    if (existing) {
      existing.connected = true
    } else {
      players.push({ userId, firstName, connected: true })
    }
    await this.state.storage.put('players', players)
  }

  private async setPlayerConnected(userId: number, connected: boolean) {
    const players = await this.getPlayers()
    const player = players.find((p) => p.userId === userId)
    if (player) player.connected = connected
    await this.state.storage.put('players', players)
  }
  private async sendCurrentState(ws: WebSocket) {
  const players = await this.getPlayers()
  const log = (await this.state.storage.get<string[]>('log')) ?? []

  ws.send(JSON.stringify({ type: 'players', players }))
  ws.send(JSON.stringify({ type: 'log', log }))
}

  private async appendLog(line: string) {
    const log = (await this.state.storage.get<string[]>('log')) ?? []
    log.push(line)
    await this.state.storage.put('log', log.slice(-100)) // فقط ۱۰۰ خط آخر رو نگه دار
  }

  // ---- broadcast به همه‌ی کانکشن‌های فعال این روم ----

  private async broadcastPlayers() {
    const players = await this.getPlayers()
    const payload = JSON.stringify({ type: 'players', players })
    for (const ws of this.state.getWebSockets()) {
      ws.send(payload)
    }
  }

  private async broadcastLog() {
    const log = (await this.state.storage.get<string[]>('log')) ?? []
    const payload = JSON.stringify({ type: 'log', log })
    for (const ws of this.state.getWebSockets()) {
      ws.send(payload)
    }
  }
}