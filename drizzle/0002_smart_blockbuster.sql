PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`telegram_id` integer NOT NULL,
	`username` text,
	`first_name` text NOT NULL,
	`last_name` text,
	`photo_url` text,
	`active_room_id` text,
	`role` text DEFAULT 'player' NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "telegram_id", "username", "first_name", "last_name", "photo_url", "active_room_id", "role", "created_at") SELECT "id", "telegram_id", "username", "first_name", "last_name", "photo_url", "active_room_id", "role", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_telegram_id_unique` ON `users` (`telegram_id`);