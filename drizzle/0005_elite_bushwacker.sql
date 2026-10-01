ALTER TABLE `rooms` ADD `origin` text DEFAULT 'lobby' NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `visibility` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `join_code` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `cost_required` integer DEFAULT 0 NOT NULL;