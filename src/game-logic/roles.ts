import { ActionType, RoleName } from './types'

export const ROLE_LABELS_FA: Record<RoleName, string> = {
  duke: 'بزرگ‌زاده',
  captain: 'فرمانده',
  ambassador: 'سفیر',
  princess: 'شاهدخت',
  assassin: 'قاتل',
  contessa: 'بازرس',
}

// تعداد نسخه‌ی هر نقش داخل دسته — همه ۲ تا، به‌جز بازرس که ۵ تاست (جمعاً ۱۵ کارت)
export const ROLE_COPIES: Record<RoleName, number> = {
  duke: 2,
  captain: 2,
  ambassador: 2,
  princess: 2,
  assassin: 2,
  contessa: 5,
}

export function buildFullDeck(): RoleName[] {
  const deck: RoleName[] = []
  for (const role of Object.keys(ROLE_COPIES) as RoleName[]) {
    for (let i = 0; i < ROLE_COPIES[role]; i++) deck.push(role)
  }
  return deck
}

// کدوم اکشن، ادعای کدوم نقشه (برای تشخیص اینکه اکشن قابل challenge هست و روی چه نقشی)
export const ACTION_TO_ROLE: Partial<Record<ActionType, RoleName>> = {
  tax: 'duke',
  assassinate: 'assassin',
  steal: 'captain',
  exchange: 'ambassador',
  contessa_self: 'contessa',
  contessa_other: 'contessa',
}

// کدوم نقش(ها) می‌تونن کدوم اکشن رو بلاک کنن
export const BLOCKING_ROLES: Partial<Record<ActionType, RoleName[]>> = {
  foreign_aid: ['duke'],
  assassinate: ['princess'],
  steal: ['captain', 'ambassador'],
}

// اکشن‌هایی که هیچ ادعایی ندارن و اصلاً قابل challenge نیستن
export const UNCHALLENGEABLE_ACTIONS: ActionType[] = ['income', 'coup', 'anarchist_attack']

export function isActionChallengeable(action: ActionType): boolean {
  return action in ACTION_TO_ROLE
}

export function actionCost(action: ActionType): number {
  if (action === 'coup') return 7
  if (action === 'assassinate') return 3
  if (action === 'anarchist_attack') return 5
  return 0
}

// نقشی که آنارشیست رو بلاک می‌کنه — همیشه شاهدخت
export const ANARCHIST_BLOCK_ROLE: RoleName = 'princess'
export const ANARCHIST_COST = 5