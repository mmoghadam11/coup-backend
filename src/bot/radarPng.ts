import { Resvg } from '@cf-wasm/resvg/workerd'

export async function svgToPng(svg: string, width = 600): Promise<Uint8Array> {
  const resvg = await Resvg.async(svg, {
    fitTo: { mode: 'width', value: width },
    background: '#1a120b',
  })
  return resvg.render().asPng()
}