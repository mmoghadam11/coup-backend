// export async function sendTelegramMessage(botToken: string, chatId: number, text: string) {
//   const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
//   })
//   if (!res.ok) {
//     const body = await res.text()
//     console.error('Telegram sendMessage failed:', res.status, body)
//   }
//   return res
// }

// export async function sendTelegramDocument(botToken: string, chatId: number, documentUrl: string, caption?: string) {
//   const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ chat_id: chatId, document: documentUrl, caption, parse_mode: 'HTML' }),
//   })
//   if (!res.ok) {
//     console.error('Telegram sendDocument failed:', res.status, await res.text())
//   }
//   return res
// }

export async function sendTelegramPhoto(
  botToken: string,
  chatId: number,
  photoBuffer: Uint8Array,
  caption?: string
) {
  const form = new FormData()
  form.append('chat_id', String(chatId))

  // Blob از Uint8Array
  const blob = new Blob([new Uint8Array(photoBuffer)] as any, { type: 'image/png' })
  form.append('photo', blob, 'radar.png')

  if (caption) {
    form.append('caption', caption)
    form.append('parse_mode', 'HTML')
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    console.error('sendPhoto failed:', res.status, await res.text())
  }
  return res
}
const API = 'https://api.telegram.org'

export async function tgCall<T = any>(token: string, method: string, body: object = {}) {
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string }
    if (!json.ok) console.error(`Telegram ${method} failed:`, res.status, json.description)
    return json
  } catch (e) {
    console.error(`Telegram ${method} network error`, e)
    return { ok: false, result: undefined as T | undefined, description: String(e) }
  }
}

export const sendTelegramMessage = (token: string, chatId: number, text: string, extra: object = {}) =>
  tgCall(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra })

export const sendTelegramDocument = (token: string, chatId: number, documentUrl: string, caption?: string) =>
  tgCall(token, 'sendDocument', { chat_id: chatId, document: documentUrl, caption, parse_mode: 'HTML' })

// نام ربات از خود تلگرام؛ در حافظه‌ی همین isolate کش می‌شود
let cachedUsername: string | null = null
export async function getBotUsername(token: string): Promise<string> {
  if (!cachedUsername) cachedUsername = (await tgCall<{ username: string }>(token, 'getMe')).result?.username ?? null
  return cachedUsername ?? ''
}

async function memberOf(token: string, chatId: number, userId: number) {
  const r = await tgCall<any>(token, 'getChatMember', { chat_id: chatId, user_id: userId })
  return r.ok ? r.result : null
}

// عضویت واقعی در گروه؛ لینک ورود را هر کسی می‌تواند برای دیگری بفرستد
export async function isChatMember(token: string, chatId: number, userId: number) {
  const m = await memberOf(token, chatId, userId)
  return !!m && (['creator', 'administrator', 'member'].includes(m.status) || (m.status === 'restricted' && m.is_member === true))
}

export async function isChatAdmin(token: string, chatId: number, userId: number) {
  const m = await memberOf(token, chatId, userId)
  return !!m && ['creator', 'administrator'].includes(m.status)
}

export async function sendTelegramDocumentFile(token: string, chatId: number, filename: string, content: string, mime: string, caption?: string) {
  const form = new FormData()
  form.append('chat_id', String(chatId))
  if (caption) { form.append('caption', caption); form.append('parse_mode', 'HTML') }
  form.append('document', new Blob([content], { type: mime }), filename)
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form })
  const j: any = await res.json().catch(() => ({}))
  if (!j.ok) console.error('sendDocument upload failed:', res.status, j.description)
  return j
}