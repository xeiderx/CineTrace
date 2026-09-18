import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { PlatformManager } from "@/components/settings/platform-manager";
import { SyncSettings } from "@/components/settings/sync-settings";
import { TagManager } from "@/components/settings/tag-manager";
import { Separator } from "@/components/ui/separator";
import {
  listPlatforms,
  listTags,
  platformUsage,
  tagUsage,
} from "@/lib/queries";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "设置" };

export default function SettingsPage() {
  const platforms = listPlatforms();
  const tags = listTags();

  return (
    <>
      <PageHeader
        title="设置"
        description="豆瓣同步、观影平台与标签的自定义管理。"
      />

      <div className="space-y-8">
        <SyncSettings initial={getSettings()} />

        <Separator />

        <PlatformManager platforms={platforms} usage={platformUsage()} />

        <Separator />

        <TagManager tags={tags} usage={tagUsage()} />
      </div>
    </>
  );
}
