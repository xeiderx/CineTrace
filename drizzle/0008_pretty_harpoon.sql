CREATE TABLE `source_channel` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	`icon_data` text,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `source_channel`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_channel_parent_name_uniq` ON `source_channel` (`parent_id`,`name`);--> statement-breakpoint
CREATE INDEX `source_channel_parent_idx` ON `source_channel` (`parent_id`);--> statement-breakpoint
ALTER TABLE `view_record` ADD `source_channel_id` integer REFERENCES source_channel(id);--> statement-breakpoint
CREATE INDEX `view_record_source_channel_idx` ON `view_record` (`source_channel_id`);