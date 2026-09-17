import type { Metadata } from "next";
import { ListVideo, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "片单" };

export default function CollectionsPage() {
  return (
    <>
      <PageHeader
        title="片单"
        description="完全本地自建的自定义片单，可自由添加作品、排序与备注。"
      >
        <Button size="sm">
          <Plus />
          新建片单
        </Button>
      </PageHeader>

      <EmptyState
        icon={ListVideo}
        title="还没有片单"
        description="片单与豆瓣无关，完全由你自己维护。可以按主题、心情、待看清单自由组合。"
      />
    </>
  );
}
