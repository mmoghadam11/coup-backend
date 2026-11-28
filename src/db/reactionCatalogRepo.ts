import { eq } from 'drizzle-orm'
import { getDb } from './index'
import { reactions, userReactions } from './schema'
import { DEFAULT_EQUIPPED_IDS, MAX_EQUIPPED_REACTIONS, type ReactionDef } from '../game-logic/reactionRules'
import { REACTION_SEED_LIST } from '../game-logic/reactionSeedData'

type ReactionRow = typeof reactions.$inferSelect

function parseCommentsJson(commentsJson: string): string[] {
  try {
    const parsed = JSON.parse(commentsJson)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export const toReactionDef = (reactionRow: ReactionRow): ReactionDef => ({
  id: reactionRow.id,
  glyph: reactionRow.glyph,
  label: reactionRow.label,
  category: reactionRow.category,
  comments: parseCommentsJson(reactionRow.comments),
  price: reactionRow.price,
  mature: !!reactionRow.mature,
  active: !!reactionRow.active,
  sort: reactionRow.sort,
})

export async function listReactionDefs(d1: D1Database, onlyActive: boolean): Promise<ReactionDef[]> {
  const reactionRows = await getDb(d1).select().from(reactions)
  return reactionRows
    .map(toReactionDef)
    .filter((reactionDef) => !onlyActive || reactionDef.active)
    .sort((firstDef, secondDef) => firstDef.sort - secondDef.sort || firstDef.id.localeCompare(secondDef.id))
}

export async function listOwnedReactionIds(d1: D1Database, userId: number): Promise<Set<string>> {
  const ownershipRows = await getDb(d1)
    .select({ reactionId: userReactions.reaction_id })
    .from(userReactions)
    .where(eq(userReactions.user_id, userId))
  return new Set(ownershipRows.map((ownershipRow) => ownershipRow.reactionId))
}

// قابل استفاده برای این کاربر؟ (فعال، مجاز بودن «تند»، رایگان یا خریداری‌شده)
export const isReactionUsable = (reactionDef: ReactionDef, ownedIds: Set<string>, matureAllowed: boolean) =>
  reactionDef.active
  && (matureAllowed || !reactionDef.mature)
  && (reactionDef.price === 0 || ownedIds.has(reactionDef.id))

// فقط وقتی جدول خالی است. هر ردیف جدا ثبت می‌شود (D1 سقف پارامتر در هر دستور دارد)
export async function seedReactionsIfEmpty(d1: D1Database): Promise<number> {
  const db = getDb(d1)
  const existingRows = await db.select({ id: reactions.id }).from(reactions).limit(1)
  if (existingRows.length) return 0

  await db.batch(REACTION_SEED_LIST.map((seedItem) => db.insert(reactions).values({
    id: seedItem.id,
    glyph: seedItem.glyph,
    label: seedItem.label,
    category: seedItem.category,
    comments: JSON.stringify(seedItem.comments),
    price: 0,
    mature: seedItem.mature ? 1 : 0,
    active: 1,
    sort: seedItem.sort,
    created_at: Date.now(),
  })) as any)
  return REACTION_SEED_LIST.length
}

// واکنش‌های مجهزِ معتبر یک کاربر؛ savedSelectionJson = null یعنی هیچ‌وقت ذخیره نکرده (پیش‌فرض)
export async function equippedReactionIdsFor(
  d1: D1Database,
  userId: number,
  savedSelectionJson: string | null | undefined,
  matureAllowed: boolean,
): Promise<string[]> {
  let savedIds: unknown = DEFAULT_EQUIPPED_IDS
  if (savedSelectionJson != null) {
    try { savedIds = JSON.parse(savedSelectionJson) } catch { savedIds = DEFAULT_EQUIPPED_IDS }
  }
  if (!Array.isArray(savedIds)) return []

  const [activeDefs, ownedIds] = await Promise.all([listReactionDefs(d1, true), listOwnedReactionIds(d1, userId)])
  const defById = new Map(activeDefs.map((reactionDef) => [reactionDef.id, reactionDef]))

  const equippedIds: string[] = []
  for (const candidateId of savedIds) {
    const reactionDef = typeof candidateId === 'string' ? defById.get(candidateId) : undefined
    const canEquip = reactionDef && isReactionUsable(reactionDef, ownedIds, matureAllowed)
    if (reactionDef && canEquip && !equippedIds.includes(reactionDef.id)) equippedIds.push(reactionDef.id)
    if (equippedIds.length >= MAX_EQUIPPED_REACTIONS) break
  }
  return equippedIds
}