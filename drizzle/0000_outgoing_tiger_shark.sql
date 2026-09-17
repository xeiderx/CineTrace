CREATE TABLE `collection` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`cover_path` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_name_unique` ON `collection` (`name`);--> statement-breakpoint
CREATE INDEX `collection_sort_idx` ON `collection` (`sort_order`);--> statement-breakpoint
CREATE TABLE `collection_item` (
	`collection_id` integer NOT NULL,
	`work_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`note` text,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`collection_id`, `work_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_id`) REFERENCES `work`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_item_work_idx` ON `collection_item` (`work_id`);--> statement-breakpoint
CREATE TABLE `platform` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`color` text,
	`is_default` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_name_unique` ON `platform` (`name`);--> statement-breakpoint
CREATE INDEX `platform_default_idx` ON `platform` (`is_default`);--> statement-breakpoint
CREATE TABLE `raw_archive` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url_hash` text NOT NULL,
	`url` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`parser_version` text NOT NULL,
	`size_bytes` integer,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_archive_url_hash_uniq` ON `raw_archive` (`url_hash`,`parser_version`);--> statement-breakpoint
CREATE INDEX `raw_archive_kind_idx` ON `raw_archive` (`kind`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`user_agent` text,
	`ip` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_expires_idx` ON `session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_issue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text,
	`title` text,
	`reason` text NOT NULL,
	`detail` text,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_issue_reason_idx` ON `sync_issue` (`reason`,`resolved_at`);--> statement-breakpoint
CREATE TABLE `sync_run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	`cursor` text,
	`items_seen` integer DEFAULT 0 NOT NULL,
	`items_new` integer DEFAULT 0 NOT NULL,
	`items_updated` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`message` text
);
--> statement-breakpoint
CREATE INDEX `sync_run_kind_idx` ON `sync_run` (`kind`,`started_at`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name`);--> statement-breakpoint
CREATE INDEX `tag_name_idx` ON `tag` (`name`);--> statement-breakpoint
CREATE TABLE `task_lock` (
	`name` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`acquired_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text,
	`last_login_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);--> statement-breakpoint
CREATE TABLE `view_record` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_id` integer,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_key` text NOT NULL,
	`source_item_id` text,
	`status` text DEFAULT 'watched' NOT NULL,
	`watched_at` text,
	`started_at` text,
	`finished_at` text,
	`rating` integer,
	`comment` text,
	`platform_id` integer,
	`watch_index` integer DEFAULT 1 NOT NULL,
	`progress_season` integer,
	`progress_episode` integer,
	`episodes_watched` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `work`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`platform_id`) REFERENCES `platform`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `view_record_source_key_uniq` ON `view_record` (`source_key`);--> statement-breakpoint
CREATE INDEX `view_record_work_idx` ON `view_record` (`work_id`);--> statement-breakpoint
CREATE INDEX `view_record_watched_at_idx` ON `view_record` (`watched_at`);--> statement-breakpoint
CREATE INDEX `view_record_platform_idx` ON `view_record` (`platform_id`);--> statement-breakpoint
CREATE INDEX `view_record_status_idx` ON `view_record` (`status`);--> statement-breakpoint
CREATE TABLE `work` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_type` text NOT NULL,
	`tmdb_id` integer,
	`douban_id` text,
	`title` text NOT NULL,
	`original_title` text,
	`year` integer,
	`poster_path` text,
	`backdrop_path` text,
	`overview` text,
	`runtime` integer,
	`season_count` integer,
	`episode_count` integer,
	`release_date` text,
	`imdb_id` text,
	`genres` text DEFAULT '[]' NOT NULL,
	`countries` text DEFAULT '[]' NOT NULL,
	`languages` text DEFAULT '[]' NOT NULL,
	`directors` text DEFAULT '[]' NOT NULL,
	`cast` text DEFAULT '[]' NOT NULL,
	`match_status` text DEFAULT 'pending' NOT NULL,
	`match_strategy` text,
	`match_score` integer,
	`metadata_synced_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_tmdb_uniq` ON `work` (`media_type`,`tmdb_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `work_douban_uniq` ON `work` (`douban_id`);--> statement-breakpoint
CREATE INDEX `work_title_idx` ON `work` (`title`);--> statement-breakpoint
CREATE INDEX `work_year_idx` ON `work` (`year`);--> statement-breakpoint
CREATE INDEX `work_match_status_idx` ON `work` (`match_status`);--> statement-breakpoint
CREATE TABLE `work_tag` (
	`work_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`work_id`, `tag_id`),
	FOREIGN KEY (`work_id`) REFERENCES `work`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `work_tag_tag_idx` ON `work_tag` (`tag_id`);