import type { RoleName } from '../types'

export type BotProfileId = 'careful' | 'bluffer' | 'pro'

export type ThinkKind = 'forced' | 'quick' | 'decision'

// زمان فکر: کار اجباری سریع، پاسخ «قبول» متوسط، تصمیم واقعی کمی بیشتر
export const THINK_MS: Record<ThinkKind, [number, number]> = {
  forced: [2100, 7100], quick: [3700, 4500], decision: [4500, 7800],
}
export const THINK_MAX_SHARE = 0.65   // هیچ‌وقت بیش از 55٪ مهلت باقی‌مانده
export const THINK_MAX_MS = 9500

export interface BotProfile {
  id: BotProfileId; bluff: number; challengeAt: number; randomChallenge: number
  smart: boolean; pace: number; memory: number; duel: RoleName[]
}

export const BOT_PROFILES: Record<BotProfileId, BotProfile> = {
  careful: { id: 'careful', bluff: 0.12, challengeAt: 0.2, randomChallenge: 0, smart: false, pace: 1.25, memory: 0.5, duel: ['princess', 'duke', 'ambassador'] },
  bluffer: { id: 'bluffer', bluff: 0.7, challengeAt: 0.3, randomChallenge: 0.15, smart: false, pace: 0.85, memory: 0.3, duel: ['assassin', 'captain'] },
  pro: { id: 'pro', bluff: 0.35, challengeAt: 0.32, randomChallenge: 0, smart: true, pace: 1, memory: 1, duel: ['duke', 'assassin'] },
}

export const BOT_PROFILE_WEIGHTS: [BotProfileId, number][] = [['careful', 0.35], ['bluffer', 0.35], ['pro', 0.3]]

export const BOT_NAMES = [
  'آرین', 'نگار', 'پوریا', 'سارا', 'کیان', 'مهسا', 'امیر', 'الهام', 'بابک', 'ندا',
  'رضا', 'شیدا', 'سینا', 'مینا', 'کاوه', 'کیوان', 'نیما', 'یلدا', 'حامد', 'لیلا',
  'Sina', 'Kian', 'Nika', 'Ario', 'Mahan', 'Sepi', 'Parsa', 'Dara','mehran','pari'
]