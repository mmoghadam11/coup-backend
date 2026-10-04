export async function sendTelegramMessage(botToken: string, chatId: number, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error('Telegram sendMessage failed:', res.status, body)
  }
  return res
}

export async function sendTelegramDocument(botToken: string, chatId: number, documentUrl: string, caption?: string) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, document: documentUrl, caption, parse_mode: 'HTML' }),
  })
  if (!res.ok) {
    console.error('Telegram sendDocument failed:', res.status, await res.text())
  }
  return res
}

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