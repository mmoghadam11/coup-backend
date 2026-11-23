import { GameState, InternalPlayer, isEliminated } from '../state'
import { RoleName } from '../types'
import { buildFullDeck } from '../roles'
import { BOT_PROFILES, BotProfile, ThinkKind } from './botConfig'
import { estimateLieRate, tablePressure } from './botMemory'

export type BotMove = { type: string;[k: string]: any }

const DECK = buildFullDeck()
const TOTAL = DECK.length
const COPIES: Record<string, number> = {}
for (const r of DECK) COPIES[r] = (COPIES[r] ?? 0) + 1

const VALUE: Record<string, number> = { assassin: 3, duke: 3, captain: 2, ambassador: 2, princess: 2, contessa: 1 }
const BLOCKS: Record<string, RoleName[]> = { foreign_aid: ['duke'], assassinate: ['princess'], steal: ['captain', 'ambassador'] }

const rnd = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const hiddenIdx = (p: InternalPlayer) => p.roles.map((_, i) => i).filter((i) => !p.revealed[i])
const richest = (l: InternalPlayer[]) => l.reduce((a, b) => (b.coins > a.coins ? b : a))

// احتمال اینکه claimer واقعاً کارت role را دارد. فقط از اطلاعات مجاز استفاده می‌کند:
// کارت‌های رو‌شده، کارت‌های خودِ ربات و تعداد کارت پنهان حریف
function rawPHas(game: GameState, me: InternalPlayer, claimer: InternalPlayer, role: string): number {
    let known = 0, revealedAll = 0
    for (const pl of game.players) {
        pl.roles.forEach((r, i) => { if (pl.revealed[i]) { revealedAll++; if (r === role) known++ } })
    }
    const mine = hiddenIdx(me)
    const own = mine.filter((i) => me.roles[i] === role).length
    const remaining = (COPIES[role] ?? 0) - known - own
    if (remaining <= 0) return 0
    const unknown = TOTAL - revealedAll - mine.length // شامل کارت‌های دسته
    let none = 1
    for (let i = 0; i < hiddenIdx(claimer).length; i++) none *= 1 - Math.min(1, remaining / Math.max(1, unknown - i))
    return 1 - none
}
function pHas(game: GameState, me: InternalPlayer, claimer: InternalPlayer, role: string, prof: BotProfile): number {
    const raw = rawPHas(game, me, claimer, role)
    if (raw === 0) return 0   // کارت کاملاً حساب‌شده: حافظه نباید آن را زنده کند
    // دروغگوی شناخته‌شده: احتمال کمتر (چالش بیشتر)؛ راستگو: احتمال بیشتر
    const adj = Math.max(-0.15, Math.min(0.3, (estimateLieRate(game, claimer.userId) - 0.25) * 0.9)) * prof.memory
    return Math.min(1, Math.max(0, raw - adj))
}

// آستانه‌ی چالش: با یک کارت بی‌دلیل ریسک نمی‌کند، مگر ترور به خودش باشد
function threshold(prof: BotProfile, hiddenN: number, lethal: boolean, bonus = 0) {
    let t = prof.challengeAt + bonus
    if (prof.smart) { if (lethal && hiddenN === 1) t = 0.65; else if (hiddenN === 1) t *= 0.6 }
    return t + (Math.random() - 0.5) * 0.1
}

function loseIndex(me: InternalPlayer, prof: BotProfile, safe: boolean) {
    const h = hiddenIdx(me)
    if (safe || (!prof.smart && Math.random() < 0.3)) return rnd(h)
    return [...h].sort((a, b) => (VALUE[me.roles[a]] ?? 0) - (VALUE[me.roles[b]] ?? 0))[0]
}

function chooseAction(game: GameState, me: InternalPlayer, prof: BotProfile, safe: boolean): BotMove {
    if (safe && me.coins < 10) return { type: 'action', action: 'income' }
    const hidden = hiddenIdx(me)
    const cards = hidden.map((i) => me.roles[i])
    const has = (r: string) => cards.includes(r as RoleName)
    const others = game.players.filter((p) => p.userId !== me.userId && !isEliminated(p))
    const coins = me.coins

    // هدف کشتن: حرفه‌ای اول تک‌کارته‌ها را می‌زند
    const killTarget = () => {
        const weak = prof.smart ? others.filter((o) => hiddenIdx(o).length === 1) : []
        if (weak.length) return richest(weak)
        return prof.id === 'careful' ? rnd(others) : richest(others)
    }
    const coup = (): BotMove => ({ type: 'action', action: 'coup', targetId: String(killTarget().userId) })

    if (coins >= 10) return coup() // قانون ۱۰ سکه
    if (coins >= 7 && (prof.smart || prof.id === 'careful' || Math.random() < 0.7)) return coup()

    // با یک کارت بلوف خطرناک است
    //   const bluffF = prof.bluff * (hidden.length === 1 ? (prof.smart ? 0.3 : 0.6) : 1)
    const bluffF = prof.bluff
        * (hidden.length === 1 ? (prof.smart ? 0.3 : 0.6) : 1)
        * (1 + (tablePressure(game, me.userId) - 1) * prof.memory)
    const w = (owned: boolean, base: number) => (owned ? base * 2 : base * bluffF)
    const opts: { w: number; move: BotMove }[] = [
        { w: 1, move: { type: 'action', action: 'income' } },
        { w: 2, move: { type: 'action', action: 'foreign_aid' } },
        { w: w(has('duke'), 3), move: { type: 'action', action: 'tax' } },
        { w: w(has('ambassador'), 1.2), move: { type: 'action', action: 'exchange' } },
    ]
    const robbable = others.filter((o) => o.coins > 0)
    if (robbable.length) {
        const t = prof.smart ? richest(robbable) : rnd(robbable)
        opts.push({ w: w(has('captain') || has('ambassador'), 2.5), move: { type: 'action', action: 'steal', targetId: String(t.userId) } })
    }
    if (coins >= 3) opts.push({ w: w(has('assassin'), 3.5), move: { type: 'action', action: 'assassinate', targetId: String(killTarget().userId) } })
    if (coins >= 5) opts.push({ w: prof.smart ? 1.2 : 0.6, move: { type: 'action', action: 'anarchist_attack', targetId: String(killTarget().userId) } })
    const ci = hidden.find((i) => me.roles[i] === 'contessa')
    opts.push({ w: w(ci !== undefined, 0.8), move: { type: 'action', action: 'contessa_self', cardIndex: ci ?? rnd(hidden) } })
    opts.push({ w: w(has('contessa'), 0.6), move: { type: 'action', action: 'contessa_other', targetId: String(rnd(others).userId) } })

    let r = Math.random() * opts.reduce((s, o) => s + o.w, 0)
    for (const o of opts) { r -= o.w; if (r <= 0) return o.move }
    return opts[0].move
}

function respondToClaim(game: GameState, me: InternalPlayer, prof: BotProfile): BotMove {
    const pa = game.pendingAction!
    const actor = game.players.find((p) => String(p.userId) === pa.actorId)
    const allow: BotMove = { type: 'respond', response: 'allow' }
    if (!actor) return allow
    const hiddenN = hiddenIdx(me).length
    const targetsMe = pa.targetId === String(me.userId)

    if (pa.claimedRole) {
        const ph = pHas(game, me, actor, pa.claimedRole, prof)
        const lethal = pa.action === 'assassinate' && targetsMe
        if (ph < threshold(prof, hiddenN, lethal)) return { type: 'respond', response: 'challenge' }
        if (prof.randomChallenge && hiddenN === 2 && ph < 0.7 && Math.random() < prof.randomChallenge) return { type: 'respond', response: 'challenge' }
    }

    const roles = BLOCKS[pa.action]
    if (roles && (pa.action === 'foreign_aid' || targetsMe)) {
        const owned = roles.find((r) => hiddenIdx(me).some((i) => me.roles[i] === r))
        if (owned && Math.random() < 0.9) return { type: 'block', claimedRole: owned }
        if (!owned) {
            const base = pa.action === 'assassinate' ? (hiddenN === 1 ? 0.55 : 0.25) : pa.action === 'steal' ? 0.2 : 0.15
            if (Math.random() < Math.min(0.8, base * prof.bluff * 1.6)) return { type: 'block', claimedRole: roles[0] }
        }
    }
    return allow
}

function respondToBlockClaim(game: GameState, me: InternalPlayer, prof: BotProfile): BotMove {
    const pa = game.pendingAction!
    const blocker = game.players.find((p) => String(p.userId) === pa.blockedBy!.playerId)
    if (!blocker) return { type: 'respond_to_block', response: 'allow' }
    const iAmActor = pa.actorId === String(me.userId)
    const ph = pHas(game, me, blocker, pa.blockedBy!.claimedRole, prof)
    const thr = threshold(prof, hiddenIdx(me).length, false, iAmActor ? 0.1 : 0)
    return { type: 'respond_to_block', response: ph < thr ? 'challenge' : 'allow' }
}

function anarchistMove(game: GameState, me: InternalPlayer, prof: BotProfile, safe: boolean): BotMove | null {
    const ap = game.anarchistPending
    if (!ap) return null
    const id = String(me.userId)
    const hiddenN = hiddenIdx(me).length

    if (ap.status === 'awaiting_block_decision' && ap.currentTargetId === me.userId) {
        if (safe) return { type: 'anarchist_respond', response: 'allow' }
        const owned = hiddenIdx(me).some((i) => me.roles[i] === 'princess')
        const bluffP = Math.min(0.8, prof.bluff * (hiddenN === 1 ? 1.2 : 0.4))
        return { type: 'anarchist_respond', response: (owned && Math.random() < 0.9) || (!owned && Math.random() < bluffP) ? 'block' : 'allow' }
    }
    if (ap.status === 'awaiting_block_challenge' && ap.currentTargetId !== me.userId && !ap.blockChallengeResponses?.[id]) {
        const target = game.players.find((p) => p.userId === ap.currentTargetId)
        if (safe || !target) return { type: 'anarchist_block_respond', response: 'allow' }
        const ph = pHas(game, me, target, 'princess', prof)
        return { type: 'anarchist_block_respond', response: ph < threshold(prof, hiddenN, false) ? 'challenge' : 'allow' }
    }
    if (ap.status === 'awaiting_pass_target' && ap.currentTargetId === me.userId) return { type: 'anarchist_neutralize' }
    return null
}

/** حرکتی که ربات الان باید بزند، یا null اگر کاری ندارد. safe=true: حرکت امن برای وقتی که حرکت اصلی خطا داد */
export function planBotMove(game: GameState, botId: number, opts: { safe?: boolean; anyPlayer?: boolean } = {}): BotMove | null {
    if (game.showcase || game.roomPhase !== 'playing') return null
    if (game.pendingReplacement && !game.revealPending) return null
    const me = game.players.find((p) => p.userId === botId)
    // anyPlayer: timeout برای انسانِ AFK هم از همین حرکت امن استفاده می‌کند
    if (!me || isEliminated(me) || (!me.isBot && !opts.anyPlayer)) return null
    const prof = BOT_PROFILES[me.botProfile ?? 'careful']
    const safe = !!opts.safe
    const id = String(botId)

    if (game.revealPending) {
        return game.revealPending.playerId === botId ? { type: 'reveal_card', roleIndex: loseIndex(me, prof, safe) } : null
    }

    const sp = game.selectionPending
    if (sp) {
        if (sp.playerId !== botId) return null
        if (sp.mode === 'contessa') return { type: 'contessa_other_select', roleIndex: loseIndex(me, prof, safe) }
        const pool = sp.pool ?? []
        const keep = sp.keepCount ?? 2
        const idx = pool.map((_, i) => i)
        if (!safe) idx.sort((a, b) => (VALUE[pool[b]] ?? 0) - (VALUE[pool[a]] ?? 0) || Math.random() - 0.5)
        return { type: 'exchange_select', keepIndexes: idx.slice(0, keep) }
    }

    const pp = game.provePending
    if (pp) {
        if (pp.playerId !== botId) return null
        const h = hiddenIdx(me)
        const real = safe ? undefined : h.find((i) => me.roles[i] === pp.claimedRole)
        return { type: 'prove_card', roleIndex: real ?? rnd(h) } // اگر کارت ادعاشده را ندارد، سرور هر چه باشد می‌سوزاند
    }

    switch (game.phase) {
        case 'duel_pick':
            return game.duelPicks[id] ? null : { type: 'duel_pick', role: rnd(prof.duel) }
        case 'awaiting_action':
            if (game.pendingAction || game.turnOrder[game.currentTurnIndex] !== botId) return null
            return chooseAction(game, me, prof, safe)
        case 'awaiting_response': {
            const pa = game.pendingAction
            if (!pa || !pa.awaitingResponseFrom.includes(id) || pa.responses[id]) return null
            return safe ? { type: 'respond', response: 'allow' } : respondToClaim(game, me, prof)
        }
        case 'awaiting_block_response': {
            const pa = game.pendingAction
            if (!pa?.blockedBy || pa.blockedBy.playerId === id || pa.blockChallengeResponses?.[id]) return null
            return safe ? { type: 'respond_to_block', response: 'allow' } : respondToBlockClaim(game, me, prof)
        }
        case 'anarchist_in_progress':
            return anarchistMove(game, me, prof, safe)
        default:
            return null
    }
}

export function thinkKindOf(m: BotMove): ThinkKind {
    switch (m.type) {
        case 'reveal_card': case 'prove_card': case 'contessa_other_select':
        case 'contessa_self_select': case 'anarchist_neutralize': return 'forced'
        case 'exchange_select': return 'quick'
        case 'respond': case 'respond_to_block': case 'anarchist_respond': case 'anarchist_block_respond':
            return m.response === 'allow' ? 'quick' : 'decision'
        case 'action': return m.action === 'income' || m.action === 'foreign_aid' ? 'quick' : 'decision'
        default: return 'decision'
    }
}