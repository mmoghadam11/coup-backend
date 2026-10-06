import { Resvg } from '@cf-wasm/resvg/workerd'
import { getPersianFont } from './radarFont'

export async function svgToPng(svg: string, width = 600): Promise<Uint8Array> {
  const persianFont = await getPersianFont()
  console.log('[radarPng] persian bytes:', persianFont.byteLength)

  const resvg = await Resvg.async(svg, {
    fitTo: { mode: 'width', value: width },
    background: '#1a120b',
    font: {
      fontBuffers: [new Uint8Array(persianFont)],
      defaultFontFamily: 'Vazirmatn',
      loadSystemFonts: false,
    },
  })

  const png = resvg.render().asPng()
  console.log('[radarPng] png bytes:', png.length)
  return png
}