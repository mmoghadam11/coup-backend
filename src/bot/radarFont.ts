const PERSIAN_FONT_URL = 'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/ttf/Vazirmatn-Regular.ttf'

let cachedPersianFont: ArrayBuffer | null = null

async function loadFont(url: string): Promise<ArrayBuffer> {
  const cache = caches.default

  // ✅ کلید = خود URL
  const cached = await cache.match(url)
  if (cached) {
    console.log(`[radarFont] ${url} hit edge cache`)
    return cached.arrayBuffer()
  }

  console.log(`[radarFont] fetching ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Font fetch failed (${res.status}): ${url}`)
  const buf = await res.arrayBuffer()
  console.log(`[radarFont] downloaded, bytes:`, buf.byteLength)

  await cache.put(
    url, // ✅ کلید = URL
    new Response(buf.slice(0), {
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    })
  )
  return buf
}

export async function getPersianFont(): Promise<ArrayBuffer> {
  if (cachedPersianFont) return cachedPersianFont
  cachedPersianFont = await loadFont(PERSIAN_FONT_URL)
  return cachedPersianFont
}