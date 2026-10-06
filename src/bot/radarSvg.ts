interface PlayerStatsRow {
  total_games: number
  total_wins: number
  total_kills: number
  total_coups: number
  total_successful_bluffs: number
  total_caught_bluffs: number
  total_correct_challenges: number
  total_wrong_challenges: number
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.min(100, Math.round((numerator / denominator) * 100))
}

export function buildRadarSvg(firstName: string, stats: PlayerStatsRow): string {
  const winRate = pct(stats.total_wins, stats.total_games)
  const bluffSuccessRate = pct(
    stats.total_successful_bluffs,
    stats.total_successful_bluffs + stats.total_caught_bluffs
  )
  const challengeSuccessRate = pct(
    stats.total_correct_challenges,
    stats.total_correct_challenges + stats.total_wrong_challenges
  )
  const aggressionRate = pct(stats.total_kills + stats.total_coups, stats.total_games * 2)

  const axes = [
    { label: 'برد', value: winRate },
    { label: 'بلوف', value: bluffSuccessRate },
    { label: 'چالش', value: challengeSuccessRate },
    { label: 'تهاجم', value: aggressionRate },
  ]

  const size = 400
  const center = size / 2
  const maxRadius = 130
  const angleStep = (2 * Math.PI) / axes.length

  function pointAt(index: number, radiusPercent: number) {
    const angle = -Math.PI / 2 + index * angleStep
    const r = (radiusPercent / 100) * maxRadius
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    }
  }

  const dataPoints = axes.map((axis, i) => pointAt(i, axis.value))
  const dataPolygon = dataPoints.map((p) => `${p.x},${p.y}`).join(' ')

  const axisLines = axes
    .map((_, i) => {
      const outer = pointAt(i, 100)
      return `<line x1="${center}" y1="${center}" x2="${outer.x}" y2="${outer.y}" stroke="rgba(255,255,255,.2)" stroke-width="1" />`
    })
    .join('')

  // ✅ فقط دو خط متن: label بالا، درصد پایین
  const labels = axes
    .map((axis, i) => {
      const base = pointAt(i, 120)

      return `
        <text x="${base.x}" y="${base.y}" fill="#fff" font-size="15" font-family="Vazirmatn" text-anchor="middle" font-weight="bold">${axis.label}</text>
        <text x="${base.x}" y="${base.y + 18}" fill="#e0a52f" font-size="13" font-family="Vazirmatn" text-anchor="middle" font-weight="bold">${axis.value}%</text>
      `
    })
    .join('')

  const grids = [25, 50, 75, 100]
    .map((percent) => {
      const points = axes.map((_, i) => pointAt(i, percent))
      const poly = points.map((p) => `${p.x},${p.y}`).join(' ')
      return `<polygon points="${poly}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="1" />`
    })
    .join('')

  return `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#1a120b" />
  <text x="${center}" y="30" fill="#e0a52f" font-size="20" font-family="Vazirmatn" font-weight="bold" text-anchor="middle">پنجره‌ی قدرت ${firstName}</text>
  <g transform="translate(0, 20)">
    ${grids}
    ${axisLines}
    <polygon points="${dataPolygon}" fill="rgba(224,165,47,0.45)" stroke="#e0a52f" stroke-width="2" />
    ${labels}
  </g>
</svg>`.trim()
}