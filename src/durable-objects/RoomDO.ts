import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { sessions, users, rooms, roomPlayers } from '../db/schema'
import { GameState, initialGameState, emptyStats, isEliminated } from '../game-logic/state'
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
import { provideProof } from '../game-logic/actions/proof'
import { dealNewGame, evaluateMatchmakingTransition, finishMatchmakingHand, forceResetGame, resetToWaiting, startMatchmakingHand } from '../game-logic/lifecycle'
import { confirmContessaSelection, confirmExchangeSelection } from '../game-logic/actions/selection'
import {
  initiateRestartVote,
  respondToRestartVote,
  isRestartVoteComplete,
  getLeavingPlayerIds,
} from '../game-logic/actions/restartVote'
import { markRoomFinishedAndClearPlayers } from '../db/roomCleanup'
import { neutralizeAnarchist, passAnarchistCard, respondToAnarchist, respondToAnarchistBlock, startAnarchistAttack } from '../game-logic/actions/anarchist'
import { recordGameResult } from '../db/matchStats'
import { clearDisconnect, getExpiredDisconnects, getNextDisconnectDeadline, registerDisconnect } from '../game-logic/disconnectManager'
import { HAND_RESULT_DISPLAY_SECONDS, MAX_PLAYERS_PER_ROOM } from '../game-logic/matchmakingConfig'
import { foldHand, removePlayerFromRoom } from '../game-logic/actions/foldLeave'

type Env = { DB: D1Database }

export class RoomDO {
  state: DurableObjectState
  env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/admin-close') {
      return this.handleAdminClose()
    }

    if (url.pathname === '/room-info') {
      const game = await this.getGame()
      return new Response(
        JSON.stringify({ playerCount: game.players.length, roomPhase: game.roomPhase }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 })
    }

    const token = url.searchParams.get('token')
    const roomId = url.searchParams.get('roomId')
    if (!token || !roomId) return new Response('token and roomId required', { status: 401 })

    const db = getDb(this.env.DB)
    const [session] = await db.select().from(sessions).where(eq(sessions.token, token))
    if (!session) return new Response('invalid session', { status: 401 })

    const [user] = await db.select().from(users).where(eq(users.id, session.user_id))
    if (!user) return new Response('user not found', { status: 401 })

    const game = await this.getGame()
    if (game.roomName === null) {
      const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId))
      if (room) {
        if (room.status === 'closed' && game.players.length === 0) {
          return new Response('room is closed', { status: 410 })
        }
        game.creatorId = room.created_by
        game.roomName = room.name
        game.origin = room.origin as any
        game.visibility = room.visibility as any
        // game.roomPhase = room.status as any   // ✅ این خط اضافه شد
        if (room.origin === 'matchmaking') {
          game.roomPhase = room.status as any // حالا enum یکیه، این امن‌تره
        }
      }
    }
    game.roomId = roomId

    const existing = game.players.find((p) => p.userId === user.id)
    if (!existing && game.players.length >= MAX_PLAYERS_PER_ROOM) {
      return new Response('room is full', { status: 409 })
    }
    if (existing) {
      existing.connected = true
      existing.photoUrl = user.photo_url ?? null
      existing.firstName = user.first_name ?? "بازیکن"
      if (!existing.stats) existing.stats = emptyStats()
      clearDisconnect(game, user.id)
    } else {
      game.players.push({
        userId: user.id,
        firstName: user.first_name ?? 'بازیکن',
        photoUrl: user.photo_url ?? null,
        connected: true,
        coins: 0,
        roles: [],
        revealed: [],
        stats: emptyStats(),
      })
      game.log.push(`${user.first_name} به روم پیوست`)
    }
    const transition = evaluateMatchmakingTransition(game)
    await this.syncRoomStatusToD1(game)
    await this.saveGame(game)
    await this.scheduleNextAlarm(game)

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
    let proofEvent: { playerId: string; playerName: string; role: string; success: boolean } | null = null
    let shouldWipeAfterBroadcast = false

    switch (data.type) {
      case 'chat': {
        const player = game.players.find((p) => p.userId === userId)
        game.log.push(`${player?.firstName ?? 'ناشناس'}: ${data.text}`)
        break
      }
      case 'start_game':
        await this.startGame(game, userId)
        break
      case 'action': {
        const result = this.dispatchAction(game, userId, data.action, data.targetId)
        if (result?.error) {
          ws.send(JSON.stringify({ type: 'error', message: result.error }))
        }
        break
      }
      case 'respond':
        respondToAction(game, userId, data.response)
        break
      case 'block':
        blockAction(game, userId, data.claimedRole)
        break
      case 'respond_to_block':
        respondToBlock(game, userId, data.response)
        break
      case 'anarchist_respond':
        respondToAnarchist(game, userId, data.response)
        break
      case 'anarchist_block_respond':
        respondToAnarchistBlock(game, userId, data.response)
        break
      case 'anarchist_pass': {
        const result = passAnarchistCard(game, userId, Number(data.targetId))
        if (result.error) {
          ws.send(JSON.stringify({ type: 'error', message: result.error }))
        }
        break
      }
      case 'anarchist_neutralize': { // این case جدید اضافه شد
        const result = neutralizeAnarchist(game, userId)
        if (result.error) {
          ws.send(JSON.stringify({ type: 'error', message: result.error }))
        } else {
          advanceTurn(game) // چون حمله کامل تموم شد، نوبت باید بره جلو
        }
        break
      }
      case 'prove_card': {
        const claimer = game.players.find((p) => p.userId === userId)
        const result = provideProof(game, userId, data.roleIndex)
        if (result.gameJustEnded && game.roomId) {
          // const db = getDb(this.env.DB)
          // await db.update(rooms).set({ status: 'finished' }).where(eq(rooms.id, game.roomId))
          // await recordGameResult(this.env.DB, game.roomId, this.buildGameResults(game))
          await this.onHandEnded(game)
        }
        if (result.shownRole && claimer) {
          proofEvent = {
            playerId: String(userId),
            playerName: claimer.firstName,
            role: result.shownRole,
            success: !!result.success,
          }
        }
        break
      }
      case 'reveal_card': {
        const result = revealCard(game, userId, data.roleIndex)
        if (result.gameJustEnded && game.roomId) {
          // const db = getDb(this.env.DB)
          // await db.update(rooms).set({ status: 'finished' }).where(eq(rooms.id, game.roomId))
          // await recordGameResult(this.env.DB, game.roomId, this.buildGameResults(game))
          await this.onHandEnded(game)
        }
        break
      }
      case 'exchange_select':
        confirmExchangeSelection(game, userId, data.keepIndexes)
        if (!game.selectionPending) advanceTurn(game)
        break
      case 'contessa_self_select':
      case 'contessa_other_select':
        confirmContessaSelection(game, userId, data.roleIndex)
        if (!game.selectionPending) advanceTurn(game)
        break
      case 'restart_game':
        await this.beginRestartVote(game, userId, data.reopenForJoining)
        break
      case 'respond_to_restart_vote':
        await this.handleRestartVoteResponse(game, userId, data.choice)
        break
      case 'leave_room':
        await this.leaveRoom(game, userId)
        break
      case 'fold': {
        const result = foldHand(game, userId)
        if (result.handEnded) {
          await this.onHandEnded(game)
        }
        break
      }
      case 'mm_leave': {
        if (game.origin === 'matchmaking') {
          const wasPlaying = game.roomPhase === 'playing'
          const player = game.players.find((p) => p.userId === userId)
          const stillAlive = player && !player.revealed.every((r) => r)

          removePlayerFromRoom(game, userId)

          if (game.roomId) {
            const db = getDb(this.env.DB)
            await db.delete(roomPlayers).where(and(eq(roomPlayers.room_id, game.roomId), eq(roomPlayers.user_id, userId)))
            await db.update(users).set({ active_room_id: null }).where(eq(users.id, userId))
          }

          if (wasPlaying && stillAlive) {
            const alivePlayers = game.players.filter((p) => !p.revealed.every((r) => r))
            if (alivePlayers.length <= 1 && game.phase !== 'game_over') {
              game.phase = 'game_over'
              game.winnerId = alivePlayers[0]?.userId ?? null
              await this.onHandEnded(game)
            }
          }

          const transition = evaluateMatchmakingTransition(game)
          await this.syncRoomStatusToD1(game)
          if (transition.needsAlarmUpdate) {
            // alarm پایین‌تر، بعد از switch، دوباره schedule می‌شه
          }
        }
        break
      }
      case 'force_reset':
        this.forceReset(game, userId)
        break
      case 'close_room':
        await this.closeRoom(game, userId)
        if (game.phase === 'room_closed') {
          shouldWipeAfterBroadcast = true // این خط اضافه شد
        }
        break
      default:
        return
    }

    await this.saveGame(game)
    await this.scheduleNextAlarm(game)   // ✅ این خط
    await this.broadcast()
    // این بخش جدید: یه پیام یک‌باره (نه بخشی از state دائمی) به همه بفرست
    if (proofEvent) {
      const payload = JSON.stringify({ type: 'proof_result', result: proofEvent })
      for (const ws of this.state.getWebSockets()) {
        ws.send(payload)
      }
    }
    if (shouldWipeAfterBroadcast) {
      await this.state.storage.deleteAll()
    }
  }

  async webSocketClose(ws: WebSocket) {
    const userId = Number(this.state.getTags(ws)[0])
    // اگه کانکشن دیگه‌ای (مثلاً از یه reconnect سریع) برای همین کاربر هنوز زنده‌ست، آفلاینش نکن
    const otherLiveSockets = this.state.getWebSockets(String(userId)).filter((s) => s !== ws)
    if (otherLiveSockets.length > 0) return

    const game = await this.getGame()
    const player = game.players.find((p) => p.userId === userId)
    if (!player) return

    // این بخش جدید اضافه شد: حین waiting/starting، دیسکانکت = حذف فوری (بدون مهلت)
    if (game.origin === 'matchmaking' && (game.roomPhase === 'waiting' || game.roomPhase === 'starting')) {
      if (game.roomId) {
        const db = getDb(this.env.DB)
        await db.delete(roomPlayers).where(and(eq(roomPlayers.room_id, game.roomId), eq(roomPlayers.user_id, userId)))
        await db.update(users).set({ active_room_id: null }).where(eq(users.id, userId))
      }
      removePlayerFromRoom(game, userId)
      evaluateMatchmakingTransition(game) // ممکنه starting→waiting برگرده اگه تعداد کم شد
      await this.syncRoomStatusToD1(game)
      await this.saveGame(game)
      await this.scheduleNextAlarm(game)
      await this.broadcast()
      return
    }
    player.connected = false
    registerDisconnect(game, userId) // این خط اضافه شد

    await this.saveGame(game)
    await this.scheduleNextAlarm(game)
    await this.broadcast()
  }

  private async startGame(game: GameState, requesterId: number) {
    if (game.phase !== 'waiting_for_players') return
    if (game.creatorId !== requesterId) return
    if (game.players.length < 2) return

    dealNewGame(game)
    game.log.push('بازی شروع شد')
    if (game.roomId) {
      const db = getDb(this.env.DB)
      await db.update(rooms).set({ status: 'playing' }).where(eq(rooms.id, game.roomId))
    }
  }

  private dispatchAction(game: GameState, userId: number, action: string, targetId?: string): { error?: string } | void {
    if (game.phase !== 'awaiting_action') return { error: 'الان نوبت اکشن نیست' }
    if (game.turnOrder[game.currentTurnIndex] !== userId) return { error: 'نوبت شما نیست' }

    if (action === 'income') {
      applyIncome(game, userId)
      advanceTurn(game)
      return
    }
    if (action === 'coup') {
      if (!targetId) return { error: 'هدف مشخص نشده' }
      return applyCoup(game, userId, Number(targetId))
    }
    if (action === 'anarchist_attack') {
      if (!targetId) return { error: 'هدف مشخص نشده' }
      return startAnarchistAttack(game, userId, Number(targetId))
    }
    return startChallengeableAction(game, userId, action as any, targetId)
  }

  private async beginRestartVote(game: GameState, requesterId: number, reopenForJoining: boolean) {
    if (game.phase !== 'game_over') return
    if (game.creatorId !== requesterId) return

    initiateRestartVote(game, reopenForJoining)

    if (isRestartVoteComplete(game)) {
      await this.finalizeRestartVote(game)
    }
  }

  private async handleRestartVoteResponse(game: GameState, userId: number, choice: 'stay' | 'leave') {
    respondToRestartVote(game, userId, choice)
    if (isRestartVoteComplete(game)) {
      await this.finalizeRestartVote(game)
    }
  }

  private async finalizeRestartVote(game: GameState) {
    if (!game.restartVote) return
    const reopenForJoining = game.restartVote.reopenForJoining
    const leavingIds = getLeavingPlayerIds(game)

    const db = getDb(this.env.DB)

    for (const id of leavingIds) {
      if (game.roomId) {
        await db.delete(roomPlayers).where(and(eq(roomPlayers.room_id, game.roomId), eq(roomPlayers.user_id, id)))
      }
      await db.update(users).set({ active_room_id: null }).where(eq(users.id, id))
      const p = game.players.find((pl) => pl.userId === id)
      game.log.push(`${p?.firstName ?? 'یک بازیکن'} از روم خارج شد`)
    }

    game.players = game.players.filter((p) => !leavingIds.includes(p.userId))
    game.turnOrder = game.turnOrder.filter((id) => !leavingIds.includes(id))
    game.restartVote = null

    if (game.players.length < 2) {
      resetToWaiting(game)
      game.log.push('تعداد بازیکنان کافی نیست؛ روم منتظر بازیکن جدید موند')
      if (game.roomId) await db.update(rooms).set({ status: 'waiting' }).where(eq(rooms.id, game.roomId))
      return
    }

    if (reopenForJoining) {
      resetToWaiting(game)
      game.log.push('روم دوباره برای ورود بازیکن جدید باز شد')
      if (game.roomId) await db.update(rooms).set({ status: 'waiting' }).where(eq(rooms.id, game.roomId))
    } else {
      dealNewGame(game)
      game.log.push('بازی مجدد با بازیکنان باقی‌مانده شروع شد')
      if (game.roomId) await db.update(rooms).set({ status: 'playing' }).where(eq(rooms.id, game.roomId))
    }
  }

  private async getGame(): Promise<GameState> {
    return (await this.state.storage.get<GameState>('game')) ?? initialGameState('lobby')
  }

  private async saveGame(game: GameState) {
    await this.state.storage.put('game', game)
  }

  private sendPrivateTo(ws: WebSocket, game: GameState, userId: number) {
    const player = game.players.find((p) => p.userId === userId)
    if (!player) return
    const payload: any = {
      type: 'private',
      private: { yourRoles: player.roles, yourRevealed: player.revealed },
    }
    if (game.selectionPending?.mode === 'exchange' && game.selectionPending.playerId === userId) {
      payload.private.exchangePool = game.selectionPending.pool
      payload.private.exchangeKeepCount = game.selectionPending.keepCount
    }
    ws.send(JSON.stringify(payload))
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
  private async handleAdminClose(): Promise<Response> {
    const game = await this.getGame()

    if (game.phase !== 'room_closed') {
      game.phase = 'room_closed'
      game.roomPhase = 'closed'
      game.log.push('روم توسط ادمین بسته شد')
      await this.saveGame(game)
      await this.state.storage.deleteAlarm()

      const payload = JSON.stringify(buildPublicPayload(game))
      for (const ws of this.state.getWebSockets()) {
        ws.send(payload)
      }
    }

    await this.state.storage.deleteAll()
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
  }

  private async leaveRoom(game: GameState, userId: number) {
    if (game.phase !== 'game_over') return
    if (userId === game.creatorId) return // این خط اضافه شد — سازنده باید ببنده، نه خارج بشه
    if (!game.roomId) return

    const db = getDb(this.env.DB)
    await db.delete(roomPlayers).where(and(eq(roomPlayers.room_id, game.roomId), eq(roomPlayers.user_id, userId)))
    await db.update(users).set({ active_room_id: null }).where(eq(users.id, userId))

    const player = game.players.find((p) => p.userId === userId)
    game.players = game.players.filter((p) => p.userId !== userId)
    game.turnOrder = game.turnOrder.filter((id) => id !== userId)
    game.log.push(`${player?.firstName ?? 'یک بازیکن'} از روم خارج شد`)
  }

  async alarm() {
    const game = await this.getGame()

    if (game.roomPhase === 'starting' && game.countdownEndsAt && Date.now() >= game.countdownEndsAt) {
      startMatchmakingHand(game)
      await this.syncRoomStatusToD1(game)
    }

    if (game.handResultEndsAt && Date.now() >= game.handResultEndsAt) {
      finishMatchmakingHand(game)
      await this.syncRoomStatusToD1(game)
      // این بخش جدید اضافه شد: بعد از برگشتن به waiting، فوراً چک کن شاید همین الان کافیه برای starting
      if (game.origin === 'matchmaking') {
        evaluateMatchmakingTransition(game)
        await this.syncRoomStatusToD1(game)
      }
    }

    const expired = getExpiredDisconnects(game)
    for (const expiredUserId of expired) {
      const handEnded = await this.forceLeaveDueToDisconnect(game, expiredUserId)
      clearDisconnect(game, expiredUserId)
      if (handEnded) {
        await this.onHandEnded(game)
      }
    }
    if (expired.length > 0 && game.origin === 'matchmaking') {
      evaluateMatchmakingTransition(game)
      await this.syncRoomStatusToD1(game)
    }

    await this.saveGame(game)
    await this.scheduleNextAlarm(game)
    await this.broadcast()
  }

  private async scheduleNextAlarm(game: GameState) {
    const candidates: number[] = []
    if (game.roomPhase === 'starting' && game.countdownEndsAt) candidates.push(game.countdownEndsAt)
    if (game.handResultEndsAt) candidates.push(game.handResultEndsAt)
    const nextDisconnect = getNextDisconnectDeadline(game)
    if (nextDisconnect) candidates.push(nextDisconnect)

    if (candidates.length === 0) {
      await this.state.storage.deleteAlarm()
    } else {
      await this.state.storage.setAlarm(Math.min(...candidates))
    }
  }

  private async syncRoomStatusToD1(game: GameState) {
    if (!game.roomId || game.origin !== 'matchmaking') return
    const db = getDb(this.env.DB)
    await db.update(rooms).set({ status: game.roomPhase }).where(eq(rooms.id, game.roomId))
  }

  private async onHandEnded(game: GameState) {
    if (!game.roomId) return

    await recordGameResult(this.env.DB, game.roomId, this.buildGameResults(game))

    if (game.origin === 'matchmaking') {
      game.handResultEndsAt = Date.now() + HAND_RESULT_DISPLAY_SECONDS * 1000
      await this.syncRoomStatusToD1(game) // الان هنوز roomPhase='playing'، status رو همونجوری نگه می‌داریم تا alarm برگردوندش به waiting
    }
    // else {
    //   if (game.roomId) {
    //     const db = getDb(this.env.DB)
    //     await db.update(rooms).set({ status: 'finished' }).where(eq(rooms.id, game.roomId))
    //   }
    // }
  }



  // این تابع کامل بازنویسی شد — حالا واقعاً پایان دست رو هم مدیریت می‌کنه
  private async forceLeaveDueToDisconnect(game: GameState, userId: number): Promise<boolean> {
    const player = game.players.find((p) => p.userId === userId)
    if (!player) return false

    const wasPlaying = game.roomPhase === 'playing' && game.phase !== 'waiting_for_players' && game.phase !== 'game_over'

    player.revealed = player.roles.map(() => true)
    game.log.push(`${player.firstName} به‌خاطر قطعی طولانی از بازی خارج شد`)

    if (game.roomId) {
      const db = getDb(this.env.DB)
      await db.delete(roomPlayers).where(and(eq(roomPlayers.room_id, game.roomId), eq(roomPlayers.user_id, userId)))
      await db.update(users).set({ active_room_id: null }).where(eq(users.id, userId))
    }

    game.players = game.players.filter((p) => p.userId !== userId)
    game.turnOrder = game.turnOrder.filter((id) => id !== userId)

    // اگه این بازیکن وسط یه pendingAction/reveal/selection/anarchist بود، اون‌ها رو پاک کن که گیر نکنیم
    if (game.revealPending?.playerId === userId) game.revealPending = null
    if (game.provePending?.playerId === userId || game.provePending?.challengerId === userId) game.provePending = null
    if (game.selectionPending?.playerId === userId) game.selectionPending = null
    if (game.anarchistPending && (game.anarchistPending.originalAttackerId === userId || game.anarchistPending.currentTargetId === userId)) {
      game.anarchistPending = null
    }
    if (game.pendingAction && (game.pendingAction.actorId === String(userId) || game.pendingAction.targetId === String(userId))) {
      game.pendingAction = null
    }

    if (!wasPlaying) return false

    const alivePlayers = game.players.filter((p) => !isEliminated(p))
    if (alivePlayers.length <= 1) {
      game.phase = 'game_over'
      game.winnerId = alivePlayers[0]?.userId ?? null
      return true
    }

    if (game.turnOrder.length > 0 && game.currentTurnIndex >= game.turnOrder.length) {
      game.currentTurnIndex = 0
    }
    return false
  }

  private async closeRoom(game: GameState, requesterId: number) {
    if (game.creatorId !== requesterId) return
    if (!game.roomId) return

    await markRoomFinishedAndClearPlayers(this.env.DB, game.roomId) // این خط جایگزین کدهای قبلی شد

    game.phase = 'room_closed'
    game.log.push('روم توسط سازنده بسته شد')
  }

  private forceReset(game: GameState, requesterId: number) {
    if (game.creatorId !== requesterId) return
    if (game.phase === 'room_closed') return
    if (game.players.length < 2) return

    forceResetGame(game)
  }

  private buildGameResults(game: GameState) {
    return game.players.map((p) => ({
      userId: p.userId,
      isWinner: p.userId === game.winnerId,
      kills: p.stats.kills,
      coups: p.stats.coups,
      successfulBluffs: p.stats.successfulBluffs,
      caughtBluffs: p.stats.caughtBluffs,
      correctChallenges: p.stats.correctChallenges,
      wrongChallenges: p.stats.wrongChallenges,
      successfulSteals: p.stats.successfulSteals,
    }))
  }
}