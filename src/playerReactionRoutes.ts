import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { users } from './db/schema'
import { requireAuth } from './authMiddleware'
import { getBooleanSetting, SETTING_REACTIONS_MATURE } from './db/appSettings'
import { CATEGORY_LABELS, MAX_EQUIPPED_REACTIONS, PREMIUM_CURRENCY } from './game-logic/reactionRules'
import { equippedReactionIdsFor, isReactionUsable, listOwnedReactionIds, listReactionDefs } from './db/reactionCatalogRepo'

type Bindings = { DB: D1Database }
type Variables = { userId: number }

export const playerReactionRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()
playerReactionRoutes.use('*', requireAuth)

playerReactionRoutes.get('/', async (context) => {
  const userId = context.get('userId')
  const matureAllowed = await getBooleanSetting(context.env.DB, SETTING_REACTIONS_MATURE, true)
  const [activeDefs, ownedIds, [userRow]] = await Promise.all([
    listReactionDefs(context.env.DB, true),
    listOwnedReactionIds(context.env.DB, userId),
    getDb(context.env.DB).select({ savedSelection: users.reaction_pack }).from(users).where(eq(users.id, userId)),
  ])

  return context.json({
    selection: await equippedReactionIdsFor(context.env.DB, userId, userRow?.savedSelection, matureAllowed),
    // «تند» وقتی بسته است اصلاً فهرست نمی‌شود؛ پولی‌ها با owned و قیمت دیده می‌شوند
    catalog: activeDefs
      .filter((reactionDef) => matureAllowed || !reactionDef.mature)
      .map((reactionDef) => ({ ...reactionDef, owned: reactionDef.price === 0 || ownedIds.has(reactionDef.id) })),
    categories: CATEGORY_LABELS,
    currency: PREMIUM_CURRENCY,
    max: MAX_EQUIPPED_REACTIONS,
  })
})

playerReactionRoutes.on(['PUT', 'POST'], '/', async (context) => {
  const userId = context.get('userId')
  const requestBody: any = await context.req.json().catch(() => ({}))
  const matureAllowed = await getBooleanSetting(context.env.DB, SETTING_REACTIONS_MATURE, true)
  const [activeDefs, ownedIds] = await Promise.all([
    listReactionDefs(context.env.DB, true),
    listOwnedReactionIds(context.env.DB, userId),
  ])
  const defById = new Map(activeDefs.map((reactionDef) => [reactionDef.id, reactionDef]))

  const acceptedIds: string[] = []
  const requestedIds: unknown[] = Array.isArray(requestBody?.selection) ? requestBody.selection : []
  for (const requestedId of requestedIds) {
    const reactionDef = typeof requestedId === 'string' ? defById.get(requestedId) : undefined
    const canEquip = reactionDef && isReactionUsable(reactionDef, ownedIds, matureAllowed)
    if (reactionDef && canEquip && !acceptedIds.includes(reactionDef.id)) acceptedIds.push(reactionDef.id)
    if (acceptedIds.length >= MAX_EQUIPPED_REACTIONS) break
  }

  await getDb(context.env.DB).update(users).set({ reaction_pack: JSON.stringify(acceptedIds) }).where(eq(users.id, userId))
  return context.json({ selection: acceptedIds })
})