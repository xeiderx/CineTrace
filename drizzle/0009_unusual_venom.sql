CREATE TABLE `icon_library` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `icon_library_name_unique` ON `icon_library` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `icon_library_url_unique` ON `icon_library` (`url`);--> statement-breakpoint
CREATE INDEX `icon_library_sort_idx` ON `icon_library` (`sort_order`);