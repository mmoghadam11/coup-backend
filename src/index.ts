import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRoutes } from './auth'
import { roomsRoutes } from './rooms'
import { adminRoutes } from './admin'
import { leaderboardRoutes } from './leaderboard'
import { matchmakingRoutes } from './matchmaking'

export { RoomDO } from './durable-objects/RoomDO'

type Bindings = {
  TELEGRAM_BOT_TOKEN: string
  DB: D1Database
  ROOM_DO: DurableObjectNamespace
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors({
  origin: ['https://telegram-coup-frontend.pages.dev', 'http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'PUT','PATCH' , 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.get('/', (c) => c.text('Hello Hono!'))

app.route('/auth', authRoutes)
// اتصال WebSocket به یه روم مشخص
app.get('/rooms/:id/ws', (c) => {
  const roomId = c.req.param('id')
  const id = c.env.ROOM_DO.idFromName(roomId) // یه id ثابت بر اساس roomId
  const stub = c.env.ROOM_DO.get(id)
  const url = new URL(c.req.url)
  url.searchParams.set('roomId', roomId)
  return stub.fetch(new Request(url.toString(), c.req.raw))
})
app.route('/matchmake', matchmakingRoutes)
app.route('/leaderboard', leaderboardRoutes)
app.route('/admin', adminRoutes)
app.route('/rooms', roomsRoutes)

export default app