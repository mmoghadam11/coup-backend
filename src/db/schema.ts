import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core'

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
  group_id: integer('group_id').references(() => telegramGroups.id),
  created_at: integer('created_at').notNull().default(0),
})

export const roomPlayers = sqliteTable('room_players', {
  room_id: text('room_id').notNull().references(() => rooms.id),
  user_id: integer('user_id').notNull().references(() => users.id),
})

export const playerStats = sqliteTable('player_stats', {
  user_id: integer('user_id').primaryKey().references(() => users.id),
  total_games: integer('total_games').notNull().default(0),
  total_wins: integer('total_wins').notNull().default(0),
  total_kills: integer('total_kills').notNull().default(0),
  total_coups: integer('total_coups').notNull().default(0),
  total_successful_bluffs: integer('total_successful_bluffs').notNull().default(0),
  total_caught_bluffs: integer('total_caught_bluffs').notNull().default(0),
  total_correct_challenges: integer('total_correct_challenges').notNull().default(0),
  total_wrong_challenges: integer('total_wrong_challenges').notNull().default(0),
  total_steals: integer('total_steals').notNull().default(0),
  last_played_at: integer('last_played_at'),
  last_reminder_sent_at: integer('last_reminder_sent_at'),
})

export const telegramGroups = sqliteTable('telegram_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegram_chat_id: integer('telegram_chat_id').notNull().unique(),
  group_name: text('group_name'),
  active_room_id: text('active_room_id'),
  last_played_at: integer('last_played_at'),
  last_reminder_sent_at: integer('last_reminder_sent_at'),
  created_at: integer('created_at').notNull().default(0),
})

export const groupPlayerStats = sqliteTable(
  'group_player_stats',
  {
    group_id: integer('group_id').notNull().references(() => telegramGroups.id),
    user_id: integer('user_id').notNull().references(() => users.id),
    games_played: integer('games_played').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    kills: integer('kills').notNull().default(0),
    coups: integer('coups').notNull().default(0),
    successful_bluffs: integer('successful_bluffs').notNull().default(0),
    caught_bluffs: integer('caught_bluffs').notNull().default(0),
    correct_challenges: integer('correct_challenges').notNull().default(0),
    wrong_challenges: integer('wrong_challenges').notNull().default(0),
    steals: integer('steals').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.group_id, table.user_id] }),
  })
)