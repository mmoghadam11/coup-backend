import type { GameState, OppMemory } from '../state'

const blank = (): OppMemory => ({ checked: 0, lies: 0, chal: 0, chalWrong: 0 })

function slot(g: GameState, id: number) {
  g.oppMemory ??= {}                                        // stateهای قدیمی این فیلد را ندارند
  if (Object.keys(g.oppMemory).length > 30) g.oppMemory = {} // سقف اندازه
  return (g.oppMemory[String(id)] ??= blank())
}

// فقط حقیقت‌های لو‌رفته ثبت می‌شود
export function noteProof(g: GameState, claimerId: number, challengerId: number, truthful: boolean) {
  const c = slot(g, claimerId); c.checked++; if (!truthful) c.lies++
  const h = slot(g, challengerId); h.chal++; if (truthful) h.chalWrong++
}

// احتمال دروغ‌گویی در ادعای چالش‌شده؛ مشاهده‌های کم، به پیش‌فرض نزدیک می‌مانند
export function estimateLieRate(g: GameState, id: number): number {
  const hist = g.players.find((p) => p.userId === id)?.hist
  const prior = hist && hist.games >= 5 ? Math.min(0.45, Math.max(0.12, 0.15 + 0.1 * hist.bluffPG)) : 0.22
  const m = g.oppMemory?.[String(id)]
  return ((m?.lies ?? 0) + prior * 3) / ((m?.checked ?? 0) + 3)
}

// >۱: میز زیاد اشتباه چالش می‌کند (بلوف بیشتر)  <۱: میز دقیق است (بلوف کمتر)
export function tablePressure(g: GameState, myId: number): number {
  let chal = 0, wrong = 0
  for (const [id, m] of Object.entries(g.oppMemory ?? {})) {
    if (Number(id) === myId) continue
    chal += m.chal; wrong += m.chalWrong
  }
  if (chal < 3) return 1
  const acc = 1 - wrong / chal
  return acc < 0.4 ? 1.25 : acc > 0.7 ? 0.7 : 1
}