import { eq } from 'drizzle-orm'
import { getDb } from './index'
import { appSettings } from './schema'

export const SETTING_REACTIONS_MATURE = 'reactions_mature'

// پیش‌فرض هر کلید؛ ردیفی در جدول نباشد از اینجا خوانده می‌شود
export const SETTING_DEFAULTS: Record<string, boolean> = {
  [SETTING_REACTIONS_MATURE]: true,
}

export async function getBooleanSetting(d1: D1Database, settingKey: string, fallbackValue: boolean): Promise<boolean> {
  const [settingRow] = await getDb(d1).select().from(appSettings).where(eq(appSettings.key, settingKey))
  if (!settingRow) return fallbackValue
  return settingRow.value === '1'
}

export async function setBooleanSetting(d1: D1Database, settingKey: string, newValue: boolean): Promise<void> {
  const storedValue = newValue ? '1' : '0'
  await getDb(d1)
    .insert(appSettings)
    .values({ key: settingKey, value: storedValue })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: storedValue } })
}

// همه‌ی تنظیمات شناخته‌شده به‌صورت یک آبجکت (برای پنل ادمین)
export async function getAllBooleanSettings(d1: D1Database): Promise<Record<string, boolean>> {
  const settingRows = await getDb(d1).select().from(appSettings)
  const storedValueByKey = new Map(settingRows.map((settingRow) => [settingRow.key, settingRow.value === '1']))
  const allSettings: Record<string, boolean> = {}
  for (const [settingKey, defaultValue] of Object.entries(SETTING_DEFAULTS)) {
    allSettings[settingKey] = storedValueByKey.get(settingKey) ?? defaultValue
  }
  return allSettings
}