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
import { HAND_RESULT_DISPLAY_SECONDS, MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_TO_START } from '../game-logic/matchmakingConfig'
import { foldHand, isQuietMoment, removePlayerFromRoom } from '../game-logic/actions/foldLeave'
import { continueFlow } from '../game-logic/actions/showcase'
import { parseSkins } from '../game-logic/skins'
import { finishDuelPick, submitDuelPick } from '../game-logic/duel'
import { handlePhaseTimeout, syncPhaseDeadline } from '../game-logic/phaseTimer'
import { rulesOf } from '../game-logic/roomRules'

type Env = { DB: D1Database }

export class RoomDO {
  state: DurableObjectState
  env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    try {
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
          if (room.status === 'closed' && game.players.length === 0) return new Response('room is closed', { status: 410 })

          game.creatorId = room.created_by
          game.roomName = room.name
          game.origin = room.origin as GameState['origin']
          game.visibility = room.visibility as GameState['visibility']
          game.roomPhase = room.status as GameState['roomPhase']
        }
      }

      game.roomId = roomId

      const existing = game.players.find((p) => p.userId === user.id)

      // اگر بازیکن جدید است، شرایط ورود را چک می‌کنیم
      if (!existing) {
        if (user.active_room_id !== roomId) return new Response('not a member of this room', { status: 403 })
        if (game.players.length >= MAX_PLAYERS_PER_ROOM) return new Response('room is full', { status: 409 })
        if (game.roomPhase === 'playing') return new Response('game in progress', { status: 409 })
      }

      if (existing) {
        // بازیکن در حال اتصال مجدد است
        existing.connected = true
        existing.photoUrl = user.photo_url ?? null
        existing.firstName = user.first_name ?? "بازیکن"
        if (!existing.stats) existing.stats = emptyStats()
        clearDisconnect(game, user.id)
        existing.skins = parseSkins(user.card_skins)
      } else {
        // اضافه کردن بازیکن جدید به بازی
        game.players.push({
          userId: user.id,
          firstName: user.first_name ?? 'بازیکن',
          photoUrl: user.photo_url ?? null,
          connected: true,
          coins: 0,
          roles: [],
          revealed: [],
          stats: emptyStats(),
          skins: parseSkins(user.card_skins),
          ready: game.roomPhase === 'starting'
        })
        game.log.push(`${user.first_name} به روم پیوست`)
      }

      try {
        evaluateMatchmakingTransition(game)
      } catch (err) {
        console.error('❌ Error in evaluateMatchmakingTransition:', err)
      }

      await this.syncRoomStatusToD1(game)
      await this.saveGame(game)
      await this.scheduleNextAlarm(game)

      // ساخت وب‌سوکت
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      this.state.acceptWebSocket(server, [String(user.id)])

      this.sendPrivateTo(server, game, user.id)

      // ارسال وضعیت بازی به پس‌زمینه سپرده می‌شود تا پاسخ 101 فوراً برگردد
      this.broadcast().catch((err) => console.error('❌ Background broadcast failed:', err))

      return new Response(null, { status: 101, webSocket: client })

    } catch (err: any) {
      // در صورتی که خطایی رخ دهد، لاگ می‌شود و کرش نمی‌کند
      console.error('❌❌❌ RoomDO.fetch crashed:', err?.message, err?.stack)
      return new Response(`Internal Server Error: ${err?.message}`, { status: 500 })
    }
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
    // let proofEvent: { playerId: string; playerName: string; role: string; success: boolean } | null = null
    // let revealResultEvent: { playerId: string; playerName: string; role: string; eliminated: boolean } | null = null
    const ALLOWED_DURING_SHOWCASE = ['chat', 'mm_leave', 'leave_room', 'close_room', 'force_reset']
    if (game.showcase && !ALLOWED_DURING_SHOWCASE.includes(data.type)) return
    let shouldWipeAfterBroadcast = false

    switch (data.type) {
      case 'chat': {
        const player = game.players.find((p) => p.userId === userId)
        game.log.push(`${player?.firstName ?? 'ناشناس'}: ${data.text}`)
        break
      }
      // case 'start_game':
      //   await this.startGame(game, userId)
      //   break
      case 'duel_pick': {
        const err = submitDuelPick(game, userId, data.role)
        if (err) ws.send(JSON.stringify({ type: 'error', message: err }))
        else if (Object.keys(game.duelPicks).length >= game.players.length) finishDuelPick(game)
        break
      }
      case 'action': {
        // const result = this.dispatchAction(game, userId, data.action, data.targetId)
        const result = this.dispatchAction(game, userId, data.action, data.targetId, data.cardIndex)
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
      case 'prove_card':
        provideProof(game, userId, data.roleIndex)
        break
      case 'reveal_card':
        revealCard(game, userId, data.roleIndex)
        break
      case 'exchange_select':
        confirmExchangeSelection(game, userId, data.keepIndexes)
        if (!game.selectionPending) advanceTurn(game)
        break
      case 'contessa_self_select':
      case 'contessa_other_select':
        confirmContessaSelection(game, userId, data.roleIndex)
        if (!game.selectionPending && !game.showcase) advanceTurn(game)
        break
      // case 'restart_game':
      //   await this.beginRestartVote(game, userId, data.reopenForJoining)
      //   break
      // case 'respond_to_restart_vote':
      //   await this.handleRestartVoteResponse(game, userId, data.choice)
      //   break
      case 'fold': {
        const result = foldHand(game, userId)
        if (result.error) ws.send(JSON.stringify({ type: 'error', message: result.error }))
        if (result.handEnded) await this.onHandEnded(game)
        break
      }
      // case 'leave_room':
      //   await this.leaveRoom(game, userId)
      //   break
      // case 'mm_leave': {
      //   if (game.origin !== 'matchmaking') break

      //   // وسط دست فعال؛ شامل game_over نمی‌شه
      //   const midHand = game.roomPhase === 'playing' && game.phase !== 'game_over'
      //   if (midHand) {
      //     const err = await this.leaveAtQuietMoment(game, userId)
      //     if (err) { ws.send(JSON.stringify({ type: 'error', message: err })); break }
      //   } else {
      //     // waiting / starting / پنجره‌ی نتیجه‌ی دست
      //     removePlayerFromRoom(game, userId)
      //     if (game.roomId) {
      //       const db = getDb(this.env.DB)
      //       await db.delete(roomPlayers).where(and(eq(roomPlayers.room_id, game.roomId), eq(roomPlayers.user_id, userId)))
      //       await db.update(users).set({ active_room_id: null }).where(eq(users.id, userId))
      //     }
      //   }

      //   evaluateMatchmakingTransition(game)
      //   await this.syncRoomStatusToD1(game)
      //   break
      // }
      // case 'leave_table': {
      //   const err = await this.leaveAtQuietMoment(game, userId)
      //   if (err) ws.send(JSON.stringify({ type: 'error', message: err }))
      //   break
      // }
      case 'set_ready': {
        const p = game.players.find((x) => x.userId === userId)
        const editable = game.phase === 'waiting_for_players' && (game.roomPhase === 'waiting' || game.roomPhase === 'starting')
        if (p && editable && rulesOf(game).startRule === 'ready_quorum') {
          p.ready = !!data.ready
          evaluateMatchmakingTransition(game)
          await this.syncRoomStatusToD1(game)
        }
        break
      }
      case 'mm_leave':
      case 'leave_table':
      case 'leave_room': {
        const midHand = game.roomPhase === 'playing' && game.phase !== 'game_over'
        if (midHand) {
          const err = await this.leaveAtQuietMoment(game, userId)
          if (err) { ws.send(JSON.stringify({ type: 'error', message: err })); break }
        } else {
          await this.dropPlayer(game, userId)
        }
        evaluateMatchmakingTransition(game)
        await this.syncRoomStatusToD1(game)
        if (await this.closeIfEmpty(game)) shouldWipeAfterBroadcast = true
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

    syncPhaseDeadline(game)
    await this.saveGame(game)
    await this.scheduleNextAlarm(game)   // ✅ این خط
    await this.broadcast()
    // این بخش جدید: یه پیام یک‌باره (نه بخشی از state دائمی) به همه بفرست
    // if (proofEvent) {
    //   const payload = JSON.stringify({ type: 'proof_result', result: proofEvent })
    //   for (const ws of this.state.getWebSockets()) {
    //     ws.send(payload)
    //   }
    // }
    // if (revealResultEvent) {
    //   const payload = JSON.stringify({ type: 'reveal_result', result: revealResultEvent })
    //   for (const ws of this.state.getWebSockets()) {
    //     ws.send(payload)
    //   }
    // }
    if (shouldWipeAfterBroadcast) {
      await this.wipeIfClosed()
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
    registerDisconnect(game, userId)
    evaluateMatchmakingTransition(game) // آفلاین‌ها در حد نصاب حساب نمی‌شوند
    await this.syncRoomStatusToD1(game)

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

  private dispatchAction(game: GameState, userId: number, action: string, targetId?: string, cardIndex?: number): { error?: string } | void {
    if (game.phase !== 'awaiting_action') return { error: 'الان نوبت اکشن نیست' }
    if (game.turnOrder[game.currentTurnIndex] !== userId) return { error: 'نوبت شما نیست' }

    if (game.showcase || game.revealPending) return { error: 'لطفاً صبر کنید' }
    if (game.phase !== 'awaiting_action') return { error: 'الان نوبت اکشن نیست' }
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
    return startChallengeableAction(game, userId, action as any, targetId, cardIndex)
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
    if (game.showcase?.kind === 'replacement' && game.showcase.playerId === userId) {
      payload.private.replacedIndex = game.showcase.replacedIndex
    }
    if (
      game.provePending?.playerId === userId &&
      game.provePending.context === 'action' &&
      game.pendingAction?.action === 'contessa_self'
    ) {
      payload.private.forcedProofIndex = game.pendingAction.claimedCardIndex
    }
    if (game.phase === 'duel_pick') payload.private.duelPick = game.duelPicks[String(userId)] ?? null
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

  // خروج کامل بین دو اکشن؛ کارت‌ها باز می‌شن و بازیکن از روم و D1 حذف می‌شه
  private async leaveAtQuietMoment(game: GameState, userId: number): Promise<string | null> {
    const beforeStart = game.phase === 'waiting_for_players'
    if (!beforeStart && !isQuietMoment(game)) return 'خروج فقط بین اکشن‌ها ممکنه'
    // if (game.origin !== 'matchmaking' && userId === game.creatorId) {
    //   return 'سازنده نمی‌تونه خارج بشه؛ باید روم رو ببنده'
    // }
    // const player = game.players.find((p) => p.userId === userId)
    // if (!player) return null
    if (!game.players.some((p) => p.userId === userId)) return null

    let handEnded = false
    if (!beforeStart) {
      // اول مثل فولد: کارت‌ها باز می‌شن و اگه نوبتش بود، نوبت جلو می‌ره
      const alive = game.players.some((p) => p.userId === userId && !isEliminated(p))
      if (alive) handEnded = foldHand(game, userId).handEnded
    }

    removePlayerFromRoom(game, userId) // از players و turnOrder حذف می‌کنه
    // if (game.currentTurnIndex >= game.turnOrder.length) game.currentTurnIndex = 0

    if (game.roomId) {
      const db = getDb(this.env.DB)
      await db.delete(roomPlayers).where(and(eq(roomPlayers.room_id, game.roomId), eq(roomPlayers.user_id, userId)))
      await db.update(users).set({ active_room_id: null }).where(eq(users.id, userId))
    }
    if (handEnded) await this.onHandEnded(game)
    return null
  }

  async alarm() {
    const game = await this.getGame()

    if (game.showcase && Date.now() >= game.showcase.endsAt) {
      const result = continueFlow(game)
      if (result.gameJustEnded) await this.onHandEnded(game)
    }

    if (game.deadlineAt && !game.showcase && Date.now() >= game.deadlineAt) {
      if (handlePhaseTimeout(game).gameJustEnded) await this.onHandEnded(game)
    }

    if (game.roomPhase === 'starting' && game.countdownEndsAt && Date.now() >= game.countdownEndsAt) {
      if (rulesOf(game).startRule === 'ready_quorum') await this.purgeNotReady(game)
      if (game.players.length >= MIN_PLAYERS_TO_START) startMatchmakingHand(game)
      else { game.roomPhase = 'waiting'; game.countdownEndsAt = null }
      await this.syncRoomStatusToD1(game)
    }

    if (game.handResultEndsAt && Date.now() >= game.handResultEndsAt) {
      finishMatchmakingHand(game)
      evaluateMatchmakingTransition(game)      // بدون شرط origin
      await this.syncRoomStatusToD1(game)
    }

    const expired = getExpiredDisconnects(game)
    for (const expiredUserId of expired) {
      const handEnded = await this.forceLeaveDueToDisconnect(game, expiredUserId)
      clearDisconnect(game, expiredUserId)
      if (handEnded) {
        await this.onHandEnded(game)
      }
    }
    if (expired.length > 0) {
      evaluateMatchmakingTransition(game)
      await this.syncRoomStatusToD1(game)
    }

    syncPhaseDeadline(game)
    // await this.saveGame(game)
    // await this.scheduleNextAlarm(game)
    // await this.broadcast()
    // جایگزین سه خط آخر (saveGame / scheduleNextAlarm / broadcast)
    const closed = await this.closeIfEmpty(game)
    await this.saveGame(game)
    if (closed) {
      await this.broadcast()
      await this.wipeIfClosed()
      return
    }
    await this.scheduleNextAlarm(game)
    await this.broadcast()
  }

  private async scheduleNextAlarm(game: GameState) {
    const candidates: number[] = []
    if (game.deadlineAt) candidates.push(game.deadlineAt)
    if (game.roomPhase === 'starting' && game.countdownEndsAt) candidates.push(game.countdownEndsAt)
    if (game.handResultEndsAt) candidates.push(game.handResultEndsAt)
    const nextDisconnect = getNextDisconnectDeadline(game)
    if (nextDisconnect) candidates.push(nextDisconnect)
    if (game.showcase) candidates.push(game.showcase.endsAt)

    if (candidates.length === 0) {
      await this.state.storage.deleteAlarm()
    } else {
      await this.state.storage.setAlarm(Math.min(...candidates))
    }
  }

  private async wipeIfClosed() {
    const g = await this.state.storage.get<GameState>('game')
    // اگر وضعیت از room_closed تغییر کرده باشد، یعنی کاربری دوباره روم را باز کرده؛ پس دست نزن
    if (g && g.phase !== 'room_closed') return

    await this.state.storage.deleteAlarm()     // deleteAll آلارم را پاک نمی‌کند، پس جداگانه پاکش می‌کنیم
    await this.state.storage.deleteAll()
  }

  private async syncRoomStatusToD1(game: GameState) {
    if (!game.roomId) return
    await getDb(this.env.DB).update(rooms).set({ status: game.roomPhase }).where(eq(rooms.id, game.roomId))
  }

  private async onHandEnded(game: GameState) {
    if (!game.roomId) return
    await recordGameResult(this.env.DB, game.roomId, this.buildGameResults(game))
    game.handResultEndsAt = Date.now() + HAND_RESULT_DISPLAY_SECONDS * 1000
    await this.syncRoomStatusToD1(game)
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
    if (game.pendingReplacement?.playerId === userId) game.pendingReplacement = null
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

  private async dropPlayer(game: GameState, userId: number) {
    removePlayerFromRoom(game, userId)
    if (game.roomId) {
      const db = getDb(this.env.DB)
      await db.delete(roomPlayers).where(and(eq(roomPlayers.room_id, game.roomId), eq(roomPlayers.user_id, userId)))
      await db.update(users).set({ active_room_id: null }).where(eq(users.id, userId))
    }
  }

  // ناآماده یا آفلاین بودن در لحظه‌ی شروع = خروج از میز
  private async purgeNotReady(game: GameState) {
    const out = game.players.filter((p) => !p.ready || !p.connected)
    for (const p of out) await this.dropPlayer(game, p.userId)
    if (out.length) game.log.push(`${out.length} بازیکن که آماده نبودند از میز خارج شدند`)
  }

  // وقتی همه رفتند، روم لابی و گروه بسته می‌شود؛ matchmaking دست‌نخورده می‌ماند
  private async closeIfEmpty(game: GameState): Promise<boolean> {
    if (!rulesOf(game).autoCloseWhenEmpty || game.players.length > 0 || game.phase === 'room_closed') return false
    if (game.roomId) await markRoomFinishedAndClearPlayers(this.env.DB, game.roomId)
    game.phase = 'room_closed'
    game.roomPhase = 'closed'
    game.log.push('همه‌ی بازیکنان خارج شدند؛ روم بسته شد')
    return true
  }
}