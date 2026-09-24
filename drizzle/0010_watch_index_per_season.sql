-- 刷次改为「按季独立」后的历史数据修正。
--
-- 旧算法取整部作品的 max(watch_index)+1，多季剧二刷时逐季各记一条，
-- 于是同一轮二刷被拆成 2、3、4、5（怪奇物语 5 季显示成「5 刷」）。
-- 这里按 (work_id, progress_season) 分组重排：用 DENSE_RANK 而非 ROW_NUMBER，
-- 并列的 watch_index 会拿到同一个名次，豆瓣把两个条目并进同一部作品
-- （如「无声」2020 与 2021 两版）的并联记录因此仍留在第 1 刷，不会被误判为重刷。
--
-- progress_season 为 NULL 的一组按同一组处理（窗口分区把 NULL 视为相等），
-- 电影没有季，等价于按作品重排，正常二刷仍是 2。
UPDATE view_record
SET watch_index = ranked.new_index
FROM (
  SELECT id, DENSE_RANK() OVER (
    PARTITION BY work_id, progress_season ORDER BY watch_index
  ) AS new_index
  FROM view_record
) AS ranked
WHERE view_record.id = ranked.id
  AND view_record.watch_index <> ranked.new_index;
