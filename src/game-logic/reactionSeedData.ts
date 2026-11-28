import type { ReactionDef } from './reactionRules'

export type SeedReaction = Omit<ReactionDef, 'price' | 'active'>

// فقط برای ساخت اولین‌بار (وقتی جدول خالی است)
export const REACTION_SEED_LIST: SeedReaction[] = [
  { id: 'wow', glyph: '😮', label: 'تعجب', category: 'surprise', mature: false, sort: 1, comments: ['وای! همچین چیزی؟', 'نه بابا!', 'این دیگه از کجا آمد؟', 'باورم نمی‌شه…'] },
  { id: 'shock', glyph: '😱', label: 'شوکه', category: 'surprise', mature: false, sort: 2, comments: ['قلبم وایستاد!', 'اینو ندیده بودم!', 'وای وای وای!'] },
  { id: 'cry', glyph: '😢', label: 'گریه', category: 'sad', mature: false, sort: 3, comments: ['آخ کارتم…', 'دلم سوخت', 'این بی‌انصافیه', 'داغون شدم'] },
  { id: 'sob', glyph: '😭', label: 'ضجه', category: 'sad', mature: false, sort: 4, comments: ['تموم شد رفت!', 'بدبخت شدم', 'یکی منو نجات بده'] },
  { id: 'laugh', glyph: '😂', label: 'خنده', category: 'happy', mature: false, sort: 5, comments: ['ها ها! عالی بود', 'نتونستم نخندم', 'این یکی رو دوست داشتم'] },
  { id: 'clap', glyph: '👏', label: 'آفرین', category: 'happy', mature: false, sort: 6, comments: ['دمت گرم!', 'حرکت قشنگی بود', 'آفرین به این بلوف'] },
  { id: 'smirk', glyph: '😏', label: 'زیرکانه', category: 'tease', mature: false, sort: 7, comments: ['فکر کردی نمی‌فهمم؟', 'گفته بودم', 'خوب بود، ولی کافی نبود'] },
  { id: 'horns', glyph: '🐂', label: 'شاخ‌بازی', category: 'tease', mature: false, sort: 8, comments: ['نوش جان!', 'گفتم بلوفه!', 'بشین دستت رو بخون', 'بفرما، اینم از این'] },
  { id: 'devil', glyph: '😈', label: 'شیطنت', category: 'tease', mature: false, sort: 9, comments: ['حالا دیدی؟', 'من که گفتم حواست باشه', 'نوبت من هم می‌شه'] },
  { id: 'rage', glyph: '🤬', label: 'عصبانی', category: 'other', mature: true, sort: 10, comments: ['اه! لعنتی!', 'دیوونه‌م کردی!', 'برو بابا!'] },
]