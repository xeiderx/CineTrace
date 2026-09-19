CREATE TABLE `person` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tmdb_person_id` integer NOT NULL,
	`name` text NOT NULL,
	`biography` text,
	`birthday` text,
	`place_of_birth` text,
	`fetched_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_tmdb_person_id_unique` ON `person` (`tmdb_person_id`);