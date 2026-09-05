import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRoutes } from './auth'

type Bindings = {
  TELEGRAM_BOT_TOKEN: string
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors({
  origin: ['https://telegram-coup-frontend.pages.dev', 'http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

app.get('/', (c) => c.text('Hello Hono!'))

app.route('/auth', authRoutes)

export default app