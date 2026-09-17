import type { Metadata } from "next";
import { Clock, Film, Layers, Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";

export const metadata: Metadata = { title: "概览" };

const STATS = [
  { key: "total", label: "作品总数", icon: Layers, hint: "已入库的影视作品" },
  { key: "watched", label: "观影记录", icon: Film, hint: "含二刷三刷流水" },
  { key: "hours", label: "累计时长", icon: Clock, hint: "按 TMDB 片长估算" },
  { key: "rating", label: "平均评分", icon: Star, hint: "仅统计已打分" },
] as const;

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        title="概览"
        description="你的观影轨迹一览。数据将在同步任务跑通后填充。"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.key} className="gap-0">
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {stat.label}
                  </span>
                  <Icon className="size-4 text-primary/70" />
                </div>
                <div className="text-3xl font-semibold tracking-tight">--</div>
                <p className="text-xs text-muted-foreground">{stat.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-6">
        <EmptyState
          icon={Film}
          title="还没有观影记录"
          description="骨架阶段暂无数据。后续接入豆瓣抓取与 TMDB 匹配后，最近观看会显示在这里。"
        />
      </div>
    </>
  );
}
