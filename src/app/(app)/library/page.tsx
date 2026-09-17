import type { Metadata } from "next";
import { Search, Library as LibraryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "档案库" };

export default function LibraryPage() {
  return (
    <>
      <PageHeader
        title="档案库"
        description="所有作品与观影流水的总入口，支持筛选、搜索与手动更正匹配。"
      >
        <Button variant="outline" size="sm">
          <Search />
          搜索
        </Button>
      </PageHeader>

      <EmptyState
        icon={LibraryIcon}
        title="档案库为空"
        description="这里会展示 work（作品）与 view_record（观影流水）的合并视图，可按类型、年份、标签、平台筛选。"
      />
    </>
  );
}
