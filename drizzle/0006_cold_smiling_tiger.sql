CREATE TABLE `view_record_tag` (
	`view_record_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`view_record_id`, `tag_id`),
	FOREIGN KEY (`view_record_id`) REFERENCES `view_record`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `view_record_tag_tag_idx` ON `view_record_tag` (`tag_id`);
--> statement-breakpoint
-- 存量数据迁移：标签的挂载层级由「作品」下沉到「观影流水」。
-- 旧 work_tag 上的每个标签，挂到该作品最新的一条观影流水上：
-- 排序与 src/lib/queries.ts 的 latestRecord() 保持一致 —— watchedAt 为空的排最后，
-- 其余按日期倒序，日期相同则 id 大者（后录入者）优先。
-- 作品若一条流水都没有（例如仅「想看」），没有任何一次观看行为可承载标签，
-- 这些标签会随 0007 删除 work_tag 一并消失。
INSERT OR IGNORE INTO `view_record_tag` (`view_record_id`, `tag_id`)
SELECT r.id, wt.tag_id
FROM `work_tag` wt
JOIN `view_record` r ON r.id = (
  SELECT vr.id
  FROM `view_record` vr
  WHERE vr.work_id = wt.work_id
  ORDER BY (vr.watched_at IS NULL), vr.watched_at DESC, vr.id DESC
  LIMIT 1
);