import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { sessions, users, rooms, roomPlayers, playerStats } from '../db/schema'
import { GameState, initialGameState, emptyStats, isEliminated } from '../game-logic/state'
import { buildPublicPayload } from '../game-logic/broadcast'
import { advanceTurn } from '../game-logic/turns'
import { applyIncome, applyCoup } from '../game-logic/actions/basic'
import {
  startChallengeableAction, respondToAction, blockAction, respondToBlock, resolvePendingActionEffect,
} from '../game-logic/actions/challengeFlow'
import { revealCard } from '../game-logic/actions/reveal'
import { provideProof } from '../game-logic/actions/proof'
import { evaluateMatchmakingTransition, finishMatchmakingHand, startMatchmakingHand } from '../game-logic/lifecycle'
import { confirmContessaSelection, confirmExchangeSelection } from '../game-logic/actions/selection'
import { markRoomFinishedAndClearPlayers } from '../db/roomCleanup'
import {
  neutralizeAnarchist, passAnarchistCard, respondToAnarchist, respondToAnarchistBlock, startAnarchistAttack,
} from '../game-logic/actions/anarchist'
import { recordGameResult } from '../db/matchStats'
import { clearDisconnect, getExpiredDisconnects, getNextDisconnectDeadline, registerDisconnect } from '../game-logic/disconnectManager'
import {
  BOT_DEBUG, BOT_USE_HISTORY, HAND_RESULT_DISPLAY_SECONDS, MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_TO_START, RECORD_STATS_WITH_BOTS,
} from '../game-logic/matchmakingConfig'
import { foldHand, isQuietMoment, removePlayerFromRoom } from '../game-logic/actions/foldLeave'
import { continueFlow } from '../game-logic/actions/showcase'
import { parseSkins } from '../game-logic/skins'
import { finishDuelPick, submitDuelPick } from '../game-logic/duel'
import { stageOf, syncPhaseDeadline, waitedOn } from '../game-logic/phaseTimer'
import { rulesOf } from '../game-logic/roomRules'
import { planBotMove, thinkKindOf } from '../game-logic/bots/botBrain'
import { botsOf, humansOf, maybeAddBot, thinkMs } from '../game-logic/bots/botRoster'
import { pickRandomComment, ReactionDef } from '../game-logic/reactionRules'
import { equippedReactionIdsFor, listReactionDefs } from '../db/reactionCatalogRepo'
import { getBooleanSetting, SETTING_REACTIONS_MATURE } from '../db/appSettings'

type Env = { DB: D1Database }

const ALLOWED_DURING_SHOWCASE = ['mm_leave', 'leave_table', 'leave_room']
// محدودیت ارسال واکنش: حداقل فاصله بین دو واکنش و سقف تعداد در یک بازه
const REACTION_MIN_GAP_MS = 2500
const REACTION_WINDOW_MS = 30_000
const REACTION_MAX_PER_WINDOW = 6
// فهرست واکنش‌ها و سوییچ «تند» از D1 خوانده می‌شود؛ این‌قدر در حافظه می‌ماند تا هر واکنش D1 نخواند
const REACTION_CACHE_TTL_MS = 60_000

export class RoomDO {
  state: DurableObjectState
  env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  // ───────────── صف سریال ─────────────
  // handlerها حین await به D1 وسط هم نمی‌پرند؛ همه‌ی رویدادها یکی‌یکی اجرا می‌شوند.
  // خطای یکی، بقیه را متوقف نمی‌کند
  private chain: Promise<unknown> = Promise.resolve()
  // ───────────── واکنش‌ها: کش و محدودیت نرخ (فقط در حافظه) ─────────────
  private reactionDefsCache: { defs: Map<string, ReactionDef>; loadedAt: number } | null = null
  private matureCache: { allowed: boolean; loadedAt: number } | null = null
  private reactionSendTimes = new Map<number, number[]>()

  private async getReactionDefs(): Promise<Map<string, ReactionDef>> {
    const now = Date.now()
    if (!this.reactionDefsCache || now - this.reactionDefsCache.loadedAt > REACTION_CACHE_TTL_MS) {
      const activeDefs = await listReactionDefs(this.env.DB, true)
      this.reactionDefsCache = { defs: new Map(activeDefs.map((reactionDef) => [reactionDef.id, reactionDef])), loadedAt: now }
    }
    return this.reactionDefsCache.defs
  }

  private async isMatureAllowed(): Promise<boolean> {
    const now = Date.now()
    if (!this.matureCache || now - this.matureCache.loadedAt > REACTION_CACHE_TTL_MS) {
      this.matureCache = { allowed: await getBooleanSetting(this.env.DB, SETTING_REACTIONS_MATURE, true), loadedAt: now }
    }
    return this.matureCache.allowed
  }

  // واکنش گذرا است: ذخیره نمی‌شود، alarm نمی‌خواهد و فقط برای همه پخش می‌شود
  private async handleReaction(ws: WebSocket, game: GameState, userId: number, emojiId: string) {
    const player = game.players.find((playerItem) => playerItem.userId === userId)
    if (!player || player.leftRoom || !player.reactions?.includes(emojiId)) return

    const now = Date.now()
    const recentTimes = (this.reactionSendTimes.get(userId) ?? []).filter((sentAt) => now - sentAt < REACTION_WINDOW_MS)
    const lastSentAt = recentTimes[recentTimes.length - 1] ?? 0
    if (now - lastSentAt < REACTION_MIN_GAP_MS || recentTimes.length >= REACTION_MAX_PER_WINDOW) return
    this.reactionSendTimes.set(userId, [...recentTimes, now])

    // دوباره با فهرست زنده می‌سنجیم؛ ادمین ممکن است بعد از اتصال غیرفعال یا «تند» را بسته باشد
    const reactionDef = (await this.getReactionDefs()).get(emojiId)
    if (!reactionDef || (reactionDef.mature && !(await this.isMatureAllowed()))) return

    const payload = JSON.stringify({
      type: 'reaction',
      playerId: userId,
      name: player.firstName,
      emojiId: reactionDef.id,
      glyph: reactionDef.glyph,
      text: pickRandomComment(reactionDef),
      mature: reactionDef.mature,
    })
    for (const socketItem of this.state.getWebSockets()) socketItem.send(payload)
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn)
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  fetch(request: Request) { return this.serial(() => this.handleFetch(request)) }
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) { return this.serial(() => this.handleMessage(ws, message)) }
  webSocketClose(ws: WebSocket) { return this.serial(() => this.handleClose(ws)) }
  alarm() { return this.serial(() => this.handleAlarm()) }

  // ───────────── اتصال ─────────────
  private async handleFetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)

      if (url.pathname === '/admin-close') return this.handleAdminClose()

      if (url.pathname === '/room-info') {
        const game = await this.getGame()
        return new Response(JSON.stringify({ playerCount: game.players.length, roomPhase: game.roomPhase }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 })

      const token = url.searchParams.get('token')
      const roomId = url.searchParams.get('roomId')
      if (!token || !roomId) return new Response('token and roomId required', { status: 401 })

      const db = getDb(this.env.DB)
      const [session] = await db.select().from(sessions).where(eq(sessions.token, token))
      if (!session) return new Response('invalid session', { status: 401 })
      const [user] = await db.select().from(users).where(eq(users.id, session.user_id))
      if (!user) return new Response('user not found', { status: 401 })

      let game = await this.getGame()

      // D1 می‌گوید میز دوباره باز شده ولی state بسته‌شده مانده: دور ریخته می‌شود
      if (game.phase === 'room_closed' || game.roomPhase === 'closed') {
        const [r] = await db.select({ status: rooms.status }).from(rooms).where(eq(rooms.id, roomId))
        if (r && r.status !== 'closed') {
          await this.state.storage.deleteAlarm()
          await this.state.storage.deleteAll()
          game = await this.getGame()
        }
      }

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
      if (existing?.leftRoom) return new Response('removed from this game', { status: 403 })
      if (!existing) {
        // فقط کسی که از مسیر رسمی (لابی، گروه، matchmaking) عضو شده
        if (user.active_room_id !== roomId) return new Response('not a member of this room', { status: 403 })
        if (game.players.length >= MAX_PLAYERS_PER_ROOM) return new Response('room is full', { status: 409 })
        if (game.roomPhase === 'playing') return new Response('game in progress', { status: 409 })
      }

      if (existing) {
        existing.connected = true
        existing.photoUrl = user.photo_url ?? null
        existing.firstName = user.first_name ?? 'بازیکن'
        if (!existing.stats) existing.stats = emptyStats()
        existing.skins = parseSkins(user.card_skins)
        existing.reactions = await equippedReactionIdsFor(this.env.DB, user.id, user.reaction_pack, await this.isMatureAllowed())
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
          skins: parseSkins(user.card_skins),
          ready: game.roomPhase === 'starting', // کسی که وسط شمارش می‌رسد، آماده است
          reactions: await equippedReactionIdsFor(this.env.DB, user.id, user.reaction_pack, await this.isMatureAllowed()),
        })
        game.log.push(`${user.first_name} به روم پیوست`)
        if (botsOf(game).length) await this.loadHistory(game)
      }

      evaluateMatchmakingTransition(game)
      await this.syncRoomStatusToD1(game)
      await this.saveGame(game)
      await this.scheduleNextAlarm(game)

      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      this.state.acceptWebSocket(server, [String(user.id)])
      this.sendPrivateTo(server, game, user.id)
      await this.broadcast()

      return new Response(null, { status: 101, webSocket: client })
    } catch (err: any) {
      console.error('RoomDO.fetch crashed:', err?.message, err?.stack)
      return new Response(`Internal Server Error: ${err?.message}`, { status: 500 })
    }
  }

  // ───────────── پیام‌ها ─────────────
  private async handleMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return
    const userId = Number(this.state.getTags(ws)[0])

    let data: any
    try { data = JSON.parse(message) } catch { return }

    const game = await this.getGame()
    if (data.type === 'reaction') { await this.handleReaction(ws, game, userId, String(data.emojiId)); return }
    if (game.showcase && !ALLOWED_DURING_SHOWCASE.includes(data.type)) return
    let wipe = false

    switch (data.type) {
      case 'duel_pick': case 'action': case 'respond': case 'block': case 'respond_to_block':
      case 'anarchist_respond': case 'anarchist_block_respond': case 'anarchist_pass': case 'anarchist_neutralize':
      case 'prove_card': case 'reveal_card': case 'exchange_select':
      case 'contessa_self_select': case 'contessa_other_select': {
        const err = this.applyGameCommand(game, userId, data)
        if (err) ws.send(JSON.stringify({ type: 'error', message: err }))
        break
      }
      case 'fold': {
        const result = foldHand(game, userId)
        if (result.error) ws.send(JSON.stringify({ type: 'error', message: result.error }))
        if (result.handEnded) await this.onHandEnded(game)
        break
      }
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
        if (await this.closeIfEmpty(game)) wipe = true
        break
      }
      default:
        return
    }

    await this.saveGame(game)
    await this.scheduleNextAlarm(game)
    await this.broadcast()
    if (wipe) await this.wipeIfClosed()
  }

  // اجرای یک دستور بازی؛ انسان و ربات هر دو از همین می‌گذرند. خطا را برمی‌گرداند یا null
  private applyGameCommand(game: GameState, userId: number, data: any): string | null {
    switch (data.type) {
      case 'duel_pick': {
        const err = submitDuelPick(game, userId, data.role)
        if (err) return err
        if (Object.keys(game.duelPicks).length >= game.players.length) finishDuelPick(game)
        return null
      }
      case 'action':
        return this.dispatchAction(game, userId, data.action, data.targetId, data.cardIndex)?.error ?? null
      case 'respond': respondToAction(game, userId, data.response); return null
      case 'block': blockAction(game, userId, data.claimedRole); return null
      case 'respond_to_block': respondToBlock(game, userId, data.response); return null
      case 'anarchist_respond': respondToAnarchist(game, userId, data.response); return null
      case 'anarchist_block_respond': respondToAnarchistBlock(game, userId, data.response); return null
      case 'anarchist_pass': return passAnarchistCard(game, userId, Number(data.targetId)).error ?? null
      case 'anarchist_neutralize': {
        const r = neutralizeAnarchist(game, userId)
        if (r.error) return r.error
        advanceTurn(game)
        return null
      }
      case 'prove_card': provideProof(game, userId, data.roleIndex); return null
      case 'reveal_card': revealCard(game, userId, data.roleIndex); return null
      case 'exchange_select':
        confirmExchangeSelection(game, userId, data.keepIndexes)
        if (!game.selectionPending) advanceTurn(game)
        return null
      case 'contessa_self_select':
      case 'contessa_other_select':
        confirmContessaSelection(game, userId, data.roleIndex)
        if (!game.selectionPending && !game.showcase) advanceTurn(game)
        return null
    }
    return null
  }

  private dispatchAction(game: GameState, userId: number, action: string, targetId?: string, cardIndex?: number): { error?: string } | void {
    if (game.showcase || game.revealPending) return { error: 'لطفاً صبر کنید' }
    if (game.phase !== 'awaiting_action') return { error: 'الان نوبت اکشن نیست' }
    if (game.turnOrder[game.currentTurnIndex] !== userId) return { error: 'نوبت شما نیست' }

    if (action === 'income') { applyIncome(game, userId); advanceTurn(game); return }
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

  // ───────────── قطع اتصال ─────────────
  private async handleClose(ws: WebSocket) {
    const userId = Number(this.state.getTags(ws)[0])
    // اگر کانکشن دیگری (مثلاً reconnect سریع) برای همین کاربر زنده است، آفلاینش نکن
    if (this.state.getWebSockets(String(userId)).some((s) => s !== ws)) return

    const game = await this.getGame()
    const player = game.players.find((p) => p.userId === userId)
    if (!player) return

    // matchmaking قبل از شروع: قطع شدن = حذف فوری
    if (game.origin === 'matchmaking' && (game.roomPhase === 'waiting' || game.roomPhase === 'starting')) {
      await this.dropPlayer(game, userId)
    } else {
      player.connected = false
      registerDisconnect(game, userId)
    }
    evaluateMatchmakingTransition(game) // آفلاین‌ها در حد نصاب حساب نمی‌شوند
    await this.syncRoomStatusToD1(game)
    await this.saveGame(game)
    await this.scheduleNextAlarm(game)
    await this.broadcast()
  }

  // ───────────── alarm ─────────────
  private async handleAlarm() {
    const game = await this.getGame()
    const now = () => Date.now()

    if (game.showcase && now() >= game.showcase.endsAt) {
      if (continueFlow(game).gameJustEnded) await this.onHandEnded(game)
    }

    if (game.botJoinAt && now() >= game.botJoinAt) {
      game.botJoinAt = null
      await this.loadHistory(game)
      if (maybeAddBot(game)) {
        evaluateMatchmakingTransition(game) // با ربات تعداد کافی است و شمارش شروع می‌شود
        await this.syncRoomStatusToD1(game)
      }
    }

    if (game.roomPhase === 'starting' && game.countdownEndsAt && now() >= game.countdownEndsAt) {
      if (rulesOf(game).startRule === 'ready_quorum') await this.purgeNotReady(game)
      if (game.players.length >= MIN_PLAYERS_TO_START) startMatchmakingHand(game)
      else { game.roomPhase = 'waiting'; game.countdownEndsAt = null }
      await this.syncRoomStatusToD1(game)
    }

    if (game.handResultEndsAt && now() >= game.handResultEndsAt) {
      finishMatchmakingHand(game)
      evaluateMatchmakingTransition(game)
      await this.syncRoomStatusToD1(game)
    }

    for (const id of getExpiredDisconnects(game)) {
      if (await this.forceLeaveDueToDisconnect(game, id)) await this.onHandEnded(game)
      clearDisconnect(game, id)
    }
    evaluateMatchmakingTransition(game)
    await this.syncRoomStatusToD1(game)

    // ربات‌ها اول؛ بعد مهلت مرحله. اگر ربات مرحله را عوض کرد، sync مهلت را از نو می‌گذارد
    this.runBots(game)
    syncPhaseDeadline(game)
    if (game.deadlineAt && !game.showcase && now() >= game.deadlineAt) this.autopilot(game)

    const closed = await this.closeIfEmpty(game)
    await this.saveGame(game)
    await this.broadcast()
    if (closed) { await this.wipeIfClosed(); return }
    await this.scheduleNextAlarm(game)
  }

  private async scheduleNextAlarm(game: GameState) {
    const c: number[] = []
    if (game.deadlineAt) c.push(game.deadlineAt)
    if (game.roomPhase === 'starting' && game.countdownEndsAt) c.push(game.countdownEndsAt)
    if (game.handResultEndsAt) c.push(game.handResultEndsAt)
    const nd = getNextDisconnectDeadline(game)
    if (nd) c.push(nd)
    if (game.showcase) c.push(game.showcase.endsAt)
    if (game.botJoinAt) c.push(game.botJoinAt)
    for (const b of botsOf(game)) if (b.botAt) c.push(b.botAt)

    if (c.length === 0) await this.state.storage.deleteAlarm()
    else await this.state.storage.setAlarm(Math.min(...c))
  }

  // ───────────── ربات‌ها و مهلت‌ها ─────────────
  // ربات‌هایی که زمان فکرشان تمام شده. تصمیم لحظه‌ی اجرا دوباره گرفته می‌شود، چون وضعیت ممکن است عوض شده باشد
  private runBots(game: GameState) {
    const now = Date.now()
    for (const b of botsOf(game)) {
      if (!b.botAt || b.botAt > now) continue
      b.botAt = null
      const key = stageOf(game)
      const move = key ? planBotMove(game, b.userId) : null
      if (!move) continue

      const err = this.applyGameCommand(game, b.userId, move)
      if (BOT_DEBUG) console.log('[bot]', b.firstName, JSON.stringify(move), err ?? 'ok')

      // حرکتی که خطا داد یا بی‌صدا اثری نداشت: حرکت امن، و اگر باز هم گیر کرد ۱۵ ثانیه صبر (تا alarm در حلقه نیفتد)
      const stuck = !!err || (stageOf(game) === key && !!planBotMove(game, b.userId))
      if (!stuck) { b.botErrors = 0; continue }
      b.botErrors = (b.botErrors ?? 0) + 1
      const safe = planBotMove(game, b.userId, { safe: true })
      if (safe) this.applyGameCommand(game, b.userId, safe)
      if (stageOf(game) === key && planBotMove(game, b.userId)) b.botAt = now + 15000
    }
  }

  // مهلت تمام شد: برای همه‌ی منتظرشده‌ها (انسان AFK) «حرکت امن» اجرا می‌شود
  private autopilot(game: GameState) {
    game.deadlineAt = null
    game.deadlineKey = null
    const stage = stageOf(game)
    if (!stage) return
    for (const id of waitedOn(game)) {
      if (stageOf(game) !== stage) break // مرحله عوض شد؛ بقیه دیگر منتظر نیستند
      const move = planBotMove(game, id, { safe: true, anyPlayer: true })
      if (move) this.applyGameCommand(game, id, move)
    }
    // اگر مرحله عوض نشد، syncPhaseDeadline در saveGame یک مهلت کامل تازه می‌گذارد (بدون حلقه‌ی داغ)
  }

  // فقط برای ربات: تاریخچه‌ی بلوف انسان‌ها (یک خواندن D1، یک‌بار برای هر بازیکن)
  private async loadHistory(game: GameState) {
    if (!BOT_USE_HISTORY) return
    const need = humansOf(game).filter((p) => !p.hist).map((p) => p.userId)
    if (!need.length) return
    const rows = await getDb(this.env.DB)
      .select({
        id: playerStats.user_id, games: playerStats.total_games,
        ok: playerStats.total_successful_bluffs, caught: playerStats.total_caught_bluffs,
      })
      .from(playerStats)
      .where(inArray(playerStats.user_id, need))
    for (const p of humansOf(game)) {
      if (!need.includes(p.userId)) continue
      const r = rows.find((x) => x.id === p.userId)
      p.hist = r && r.games > 0 ? { games: r.games, bluffPG: (r.ok + r.caught) / r.games } : { games: 0, bluffPG: 0 }
    }
  }

  // ───────────── خروج و حذف ─────────────
  private async dropPlayer(game: GameState, userId: number) {
    removePlayerFromRoom(game, userId)
    if (game.roomId) {
      const db = getDb(this.env.DB)
      await db.delete(roomPlayers).where(and(eq(roomPlayers.room_id, game.roomId), eq(roomPlayers.user_id, userId)))
      await db.update(users).set({ active_room_id: null }).where(eq(users.id, userId))
    }
  }

  // خروج کامل بین دو اکشن؛ کارت‌ها باز می‌شوند و بازیکن از روم و D1 حذف می‌شود
  private async leaveAtQuietMoment(game: GameState, userId: number): Promise<string | null> {
    const beforeStart = game.phase === 'waiting_for_players'
    if (!beforeStart && !isQuietMoment(game)) return 'خروج فقط بین اکشن‌ها ممکنه'
    if (!game.players.some((p) => p.userId === userId)) return null

    let handEnded = false
    if (!beforeStart) {
      const alive = game.players.some((p) => p.userId === userId && !isEliminated(p))
      if (alive) handEnded = foldHand(game, userId).handEnded // اول مثل فولد
    }
    await this.dropPlayer(game, userId)
    if (handEnded) await this.onHandEnded(game)
    return null
  }

  // ناآماده یا آفلاین بودن در لحظه‌ی شروع = خروج از میز
  private async purgeNotReady(game: GameState) {
    const out = game.players.filter((p) => !p.isBot && (!p.ready || !p.connected))
    for (const p of out) await this.dropPlayer(game, p.userId)
    if (out.length) game.log.push(`${out.length} بازیکن که آماده نبودند از میز خارج شدند`)
  }

  // قطعی طولانی: وسط دست، بازیکن «مرده» با کارت‌های باز روی میز می‌ماند و آخر دست حذف می‌شود
  private async forceLeaveDueToDisconnect(game: GameState, userId: number): Promise<boolean> {
    const player = game.players.find((p) => p.userId === userId)
    if (!player || player.leftRoom) return false

    if (game.roomId) {
      const db = getDb(this.env.DB)
      await db.delete(roomPlayers).where(and(eq(roomPlayers.room_id, game.roomId), eq(roomPlayers.user_id, userId)))
      await db.update(users).set({ active_room_id: null }).where(eq(users.id, userId))
    }

    const inHand =
      game.roomPhase === 'playing' && !['waiting_for_players', 'game_over'].includes(game.phase) && player.roles.length > 0
    if (!inHand) { removePlayerFromRoom(game, userId); return false }

    game.log.push(`${player.firstName} به‌خاطر قطعی طولانی از بازی خارج شد`)
    player.revealed = player.roles.map(() => true)
    player.leftRoom = true
    player.connected = false

    const idx = game.turnOrder.indexOf(userId)
    game.turnOrder = game.turnOrder.filter((id) => id !== userId)
    if (idx !== -1 && idx < game.currentTurnIndex) game.currentTurnIndex -= 1
    if (game.currentTurnIndex >= game.turnOrder.length) game.currentTurnIndex = 0

    if (game.pendingReplacement?.playerId === userId) game.pendingReplacement = null
    if (game.revealPending?.playerId === userId) game.revealPending = null
    if (game.provePending?.playerId === userId || game.provePending?.challengerId === userId) game.provePending = null
    if (game.selectionPending?.playerId === userId) game.selectionPending = null
    const ap = game.anarchistPending
    if (ap && (ap.originalAttackerId === userId || ap.currentTargetId === userId)) game.anarchistPending = null

    const id = String(userId)
    const pa = game.pendingAction
    if (pa) {
      if (pa.actorId === id || pa.targetId === id || pa.blockedBy?.playerId === id) {
        game.pendingAction = null
      } else {
        pa.awaitingResponseFrom = pa.awaitingResponseFrom.filter((x) => x !== id)
        delete pa.responses[id]
        if (pa.blockChallengeResponses) delete pa.blockChallengeResponses[id]
      }
    }

    const alive = game.players.filter((p) => !isEliminated(p))
    if (alive.length <= 1) {
      game.phase = 'game_over'
      game.winnerId = alive[0]?.userId ?? null
      return true
    }

    const cur = game.pendingAction
    if (cur && game.phase === 'awaiting_response' && cur.awaitingResponseFrom.every((x) => cur.responses[x])) {
      resolvePendingActionEffect(game)
    } else if (cur?.blockedBy && game.phase === 'awaiting_block_response') {
      const eligible = game.players
        .filter((p) => String(p.userId) !== cur.blockedBy!.playerId && !isEliminated(p))
        .map((p) => String(p.userId))
      if (eligible.every((x) => cur.blockChallengeResponses?.[x])) {
        game.log.push('بلاک تایید شد، اکشن خنثی شد')
        game.pendingAction = null
        advanceTurn(game)
      }
    }

    const busy =
      game.pendingAction || game.provePending || game.revealPending || game.selectionPending ||
      game.anarchistPending || game.showcase || game.pendingReplacement
    if (!busy && game.phase !== 'game_over') game.phase = 'awaiting_action'
    return false
  }

  // وقتی همه رفتند، روم لابی و گروه بسته می‌شود؛ matchmaking دست‌نخورده می‌ماند
  private async closeIfEmpty(game: GameState): Promise<boolean> {
    const real = game.players.filter((p) => !p.leftRoom)
    if (!rulesOf(game).autoCloseWhenEmpty || real.length > 0 || game.phase === 'room_closed') return false
    if (game.roomId) await markRoomFinishedAndClearPlayers(this.env.DB, game.roomId)
    game.phase = 'room_closed'
    game.roomPhase = 'closed'
    game.log.push('همه‌ی بازیکنان خارج شدند؛ روم بسته شد')
    return true
  }

  // ───────────── پایان دست و D1 ─────────────
  private async onHandEnded(game: GameState) {
    if (!game.roomId) return
    game.handResultEndsAt = Date.now() + HAND_RESULT_DISPLAY_SECONDS * 1000
    const withBots = game.players.some((p) => p.isBot)
    if (RECORD_STATS_WITH_BOTS || !withBots) {
      await recordGameResult(this.env.DB, game.roomId, this.buildGameResults(game))
    }
    await this.syncRoomStatusToD1(game)
  }

  private buildGameResults(game: GameState) {
    return game.players
      .filter((p) => !p.isBot) // ربات توی users نیست؛ ثبتش کلید خارجی را می‌شکند
      .map((p) => ({
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

  private async syncRoomStatusToD1(game: GameState) {
    if (!game.roomId) return
    await getDb(this.env.DB).update(rooms).set({ status: game.roomPhase }).where(eq(rooms.id, game.roomId))
  }

  // ───────────── state و ارسال ─────────────
  private async getGame(): Promise<GameState> {
    const g = (await this.state.storage.get<GameState>('game')) ?? initialGameState('lobby')
    g.oppMemory ??= {}     // stateهای قدیمی این فیلدها را ندارند
    g.botJoinAt ??= null
    return g
  }

  // زمان‌بندی مهلت و ربات‌ها از اینجا انجام می‌شود، چون بعد از هر تغییر state صدا زده می‌شود
  private async saveGame(game: GameState) {
    syncPhaseDeadline(game)
    const now = Date.now()
    const key = stageOf(game)
    for (const b of botsOf(game)) {
      const move = key ? planBotMove(game, b.userId) : null
      if (!move) { b.botAt = null; b.botKey = null; continue }
      if (b.botKey !== key || !b.botAt) {
        b.botKey = key
        const remaining = game.deadlineAt ? game.deadlineAt - now : null
        b.botAt = now + thinkMs(b, thinkKindOf(move), remaining) // تأخیر وابسته به مرحله و سقف‌دار با مهلت
      }
    }
    await this.state.storage.put('game', game)
  }

  // پاک کردن فقط وقتی state ذخیره‌شده هنوز بسته است (اگر میز دوباره باز شده، دست نزن)
  private async wipeIfClosed() {
    const g = await this.state.storage.get<GameState>('game')
    if (g && g.phase !== 'room_closed') return
    await this.state.storage.deleteAlarm() // deleteAll آلارم را پاک نمی‌کند
    await this.state.storage.deleteAll()
  }

  private sendPrivateTo(ws: WebSocket, game: GameState, userId: number) {
    const player = game.players.find((p) => p.userId === userId)
    if (!player) return
    const payload: any = { type: 'private', private: { yourRoles: player.roles, yourRevealed: player.revealed } }
    if (game.selectionPending?.mode === 'exchange' && game.selectionPending.playerId === userId) {
      payload.private.exchangePool = game.selectionPending.pool
      payload.private.exchangeKeepCount = game.selectionPending.keepCount
    }
    if (game.showcase?.kind === 'replacement' && game.showcase.playerId === userId) {
      payload.private.replacedIndex = game.showcase.replacedIndex
    }
    if (game.provePending?.playerId === userId && game.provePending.context === 'action' && game.pendingAction?.action === 'contessa_self') {
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
      this.sendPrivateTo(ws, game, Number(this.state.getTags(ws)[0]))
    }
  }

  private async handleAdminClose(): Promise<Response> {
    const game = await this.getGame()
    if (game.phase !== 'room_closed') {
      game.phase = 'room_closed'
      game.roomPhase = 'closed'
      game.log.push('روم توسط ادمین بسته شد')
      await this.state.storage.put('game', game) // مستقیم؛ saveGame مهلت و ربات را هم می‌سنجد و اینجا لازم نیست
      await this.state.storage.deleteAlarm()
      const payload = JSON.stringify(buildPublicPayload(game))
      for (const ws of this.state.getWebSockets()) ws.send(payload)
    }
    await this.state.storage.deleteAll() // بستن ادمین بی‌قید و شرط پاک می‌کند
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
  }
}