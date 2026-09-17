import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "统计" };

export default function StatsPage() {
  return (
    <>
      <PageHeader
        title="统计"
        description="按年月、类型、平台、评分等维度回顾你的观影习惯。"
      />

      <EmptyState
        icon={BarChart3}
        title="暂无可统计的数据"
        description="产生观影记录后，这里会用图表呈现年度观影量、类型分布、平台占比与评分趋势。"
      />
    </>
  );
}
