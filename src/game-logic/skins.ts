export const DEFAULT_SKIN = 'minimal'
export const CARD_ROLES = ['duke', 'captain', 'ambassador', 'princess', 'assassin', 'contessa']

// با SKINS فرانت (cardSkins.ts) هم‌گام نگه دارید؛ هر پوشه‌ی تازه باید هر دو جا ثبت شود
export const SKINS: Record<string, { title: string; roles: string[]; price: number }> = {
  minimal: { title: 'کلاسیک', roles: CARD_ROLES, price: 0 },
  hero: { title: 'قهرمانان', roles: ['assassin'], price: 0 },
}

export interface RejectedSkin {
  role: string
  folder: string
  reason: 'unknown_skin' | 'role_not_in_skin' | 'not_owned'
}

export function normalizeSkins(input: unknown): { selection: Record<string, string>; rejected: RejectedSkin[] } {
  const selection: Record<string, string> = {}
  const rejected: RejectedSkin[] = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { selection, rejected }
  const raw = input as Record<string, unknown>

  for (const role of CARD_ROLES) {
    const folder = raw[role]
    if (folder === undefined || folder === null || folder === DEFAULT_SKIN) continue // پیش‌فرض ذخیره نمی‌شود
    // hasOwnProperty: جلوی ورودی‌هایی مثل "constructor" را می‌گیرد
    if (typeof folder !== 'string' || !Object.prototype.hasOwnProperty.call(SKINS, folder)) {
      rejected.push({ role, folder: String(folder), reason: 'unknown_skin' }); continue
    }
    const skin = SKINS[folder]
    if (!skin.roles.includes(role)) { rejected.push({ role, folder, reason: 'role_not_in_skin' }); continue }
    if (skin.price > 0) { rejected.push({ role, folder, reason: 'not_owned' }); continue } // بعداً: چک مالکیت
    selection[role] = folder
  }
  return { selection, rejected }
}

export const sanitizeSkins = (input: unknown) => normalizeSkins(input).selection

export function parseSkins(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {}
  try { return sanitizeSkins(JSON.parse(raw)) } catch { return {} }
}

export const skinCatalog = () => Object.entries(SKINS).map(([folder, s]) => ({ folder, ...s }))