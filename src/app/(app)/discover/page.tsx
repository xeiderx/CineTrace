import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "发现" };

export default function DiscoverPage() {
  return (
    <>
      <PageHeader
        title="发现"
        description="基于 TMDB 的当前热门与高分推荐，可直接加入片单。"
      />

      <EmptyState
        icon={Compass}
        title="发现页待接入"
        description="接入 TMDB 接口后，这里会展示热门电影、剧集与个性化推荐。"
      />
    </>
  );
}
