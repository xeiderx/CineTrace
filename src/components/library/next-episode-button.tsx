"use client";

import { useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { setSeasonProgressAction } from "@/app/actions/library";
import { Button } from "@/components/ui/button";

/**
 * 档案库卡片上的「标记下一集」快捷按钮。
 *
 * 只给正在追的剧用：点一下就把当前季的进度推到下一集，不必进详情页开面板。
 * 写入仍走 setSeasonProgressAction，与详情页面板共用同一套规则，
 * 免得两处对「看到第几集」的解释出现偏差。
 */
export function NextEpisodeButton({
  workId,
  seasonNumber,
  episodeNumber,
  completesSeason,
  nextSeasonName,
  label,
}: {
  workId: number;
  seasonNumber: number;
  /** 要标记的那一集，即当前进度 +1 */
  episodeNumber: number;
  /** 这一集正好是当季最后一集，标完这一季就看完 */
  completesSeason: boolean;
  /** 本季看完后接上的下一季名；没有后继季时为 null */
  nextSeasonName: string | null;
  /** 作品名，用于读屏文案 */
  label: string;
}) {
  const [pending, startTransition] = useTransition();

  function markNext(): void {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("workId", String(workId));
      formData.set("seasonNumber", String(seasonNumber));
      formData.set("lastEpisode", String(episodeNumber));
      // 不带日期，由 action 默认成今天——卡片上没有挑日期的位置
      const state = await setSeasonProgressAction(undefined, formData);
      if (state?.error) {
        toast.error(state.error);
        return;
      }
      if (!state?.message) return;

      if (completesSeason && nextSeasonName) {
        toast.success(state.message, {
          description: `下一季是${nextSeasonName}`,
        });
        return;
      }
      toast.success(state.message);
    });
  }

  return (
    <Button
      type="button"
      size="xs"
      variant="secondary"
      disabled={pending}
      onClick={markNext}
      className="shadow-sm"
      title={`标记到第 ${episodeNumber} 集`}
      aria-label={`把《${label}》标记到第 ${seasonNumber} 季第 ${episodeNumber} 集`}
    >
      {pending ? <Loader2 className="animate-spin" /> : <Plus />}
      第 {episodeNumber} 集
    </Button>
  );
}
