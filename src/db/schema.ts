import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegram_id: integer('telegram_id').notNull().unique(),
  username: text('username'),
  first_name: text('first_name').notNull(),
  last_name: text('last_name'),
  photo_url: text('photo_url'),
  active_room_id: text('active_room_id'),
  role: text('role').notNull().default('player'), // 'player' | 'admin'
  created_at: integer('created_at').notNull().default(0),
})

export const sessions = sqliteTable('sessions', {
  token: text('token').primaryKey(),
  user_id: integer('user_id').notNull().references(() => users.id),
  created_at: integer('created_at').notNull().default(0),
})

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('waiting'),
  created_by: integer('created_by').references(() => users.id),
  created_at: integer('created_at').notNull().default(0),
})

export const roomPlayers = sqliteTable('room_players', {
  room_id: text('room_id').notNull().references(() => rooms.id),
  user_id: integer('user_id').notNull().references(() => users.id),
})