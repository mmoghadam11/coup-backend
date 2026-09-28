CREATE TABLE `group_player_stats` (
	`group_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`games_played` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`kills` integer DEFAULT 0 NOT NULL,
	`coups` integer DEFAULT 0 NOT NULL,
	`successful_bluffs` integer DEFAULT 0 NOT NULL,
	`caught_bluffs` integer DEFAULT 0 NOT NULL,
	`correct_challenges` integer DEFAULT 0 NOT NULL,
	`wrong_challenges` integer DEFAULT 0 NOT NULL,
	`steals` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `telegram_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `player_stats` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`total_games` integer DEFAULT 0 NOT NULL,
	`total_wins` integer DEFAULT 0 NOT NULL,
	`total_kills` integer DEFAULT 0 NOT NULL,
	`total_coups` integer DEFAULT 0 NOT NULL,
	`total_successful_bluffs` integer DEFAULT 0 NOT NULL,
	`total_caught_bluffs` integer DEFAULT 0 NOT NULL,
	`total_correct_challenges` integer DEFAULT 0 NOT NULL,
	`total_wrong_challenges` integer DEFAULT 0 NOT NULL,
	`total_steals` integer DEFAULT 0 NOT NULL,
	`last_played_at` integer,
	`last_reminder_sent_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `telegram_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`telegram_chat_id` integer NOT NULL,
	`group_name` text,
	`active_room_id` text,
	`last_played_at` integer,
	`last_reminder_sent_at` integer,
	`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_groups_telegram_chat_id_unique` ON `telegram_groups` (`telegram_chat_id`);