CREATE TABLE `reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`glyph` text NOT NULL,
	`label` text NOT NULL,
	`category` text DEFAULT 'tease' NOT NULL,
	`comments` text DEFAULT '[]' NOT NULL,
	`price` integer DEFAULT 0 NOT NULL,
	`mature` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_reactions` (
	`user_id` integer NOT NULL,
	`reaction_id` text NOT NULL,
	`acquired_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `reaction_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reaction_id`) REFERENCES `reactions`(`id`) ON UPDATE no action ON DELETE no action
);
