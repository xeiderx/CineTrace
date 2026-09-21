CREATE TABLE `view_episode` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_id` integer NOT NULL,
	`watch_index` integer DEFAULT 1 NOT NULL,
	`season_number` integer NOT NULL,
	`episode_number` integer NOT NULL,
	`watched_at` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `work`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `view_episode_seat_uniq` ON `view_episode` (`work_id`,`watch_index`,`season_number`,`episode_number`);--> statement-breakpoint
CREATE INDEX `view_episode_work_idx` ON `view_episode` (`work_id`,`watch_index`);--> statement-breakpoint
ALTER TABLE `view_record` ADD `manual_fields_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- 历史进度回填：把已有的「看到第几集」展开成逐集记录。
-- 不回填的话，迁移之后这些老记录的季进度会凭空归零——逐集表成了唯一真源，
-- 而它此时还是空的。
--
-- 只展开 progress_episode（同一季内的集号），不展开 episodes_watched：
-- 后者是跨季累计数，摊到单独一季会超出该季总集数，反而造出越界的假数据。
--
-- 日期按记录自身的日期兜底（标记日 → 看完日 → 开始日）；季号缺失时归到第 1 季，
-- 因为豆瓣的单季剧标题不带「第 X 季」，记录上根本没有季号可归。
INSERT OR IGNORE INTO `view_episode` (`work_id`, `watch_index`, `season_number`, `episode_number`, `watched_at`)
WITH RECURSIVE `seat`(`n`) AS (
	SELECT 1
	UNION ALL
	SELECT `n` + 1 FROM `seat` WHERE `n` < (SELECT coalesce(max(`progress_episode`), 0) FROM `view_record`)
)
SELECT
	r.`work_id`,
	r.`watch_index`,
	coalesce(r.`progress_season`, 1),
	`seat`.`n`,
	coalesce(r.`watched_at`, r.`finished_at`, r.`started_at`)
FROM `view_record` r
JOIN `seat` ON `seat`.`n` <= r.`progress_episode`
WHERE r.`work_id` IS NOT NULL
	AND r.`progress_episode` IS NOT NULL
	AND r.`progress_episode` > 0;