import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { BackupManager } from "@/components/settings/backup-manager";
import { IconLibraryManager } from "@/components/settings/icon-library-manager";
import { PlatformManager } from "@/components/settings/platform-manager";
import { SourceChannelManager } from "@/components/settings/source-channel-manager";
import { SyncSettings } from "@/components/settings/sync-settings";
import { TagManager } from "@/components/settings/tag-manager";
import { Separator } from "@/components/ui/separator";
import { countPendingMetadata } from "@/lib/backup";
import {
  listIconLibraries,
  listPlatforms,
  listSourceChannels,
  listTags,
  platformUsage,
  sourceChannelUsage,
  tagUsage,
} from "@/lib/queries";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "设置" };

export default function SettingsPage() {
  const platforms = listPlatforms();
  const tags = listTags();
  const sourceChannels = listSourceChannels();
  const iconLibraries = listIconLibraries();
  // 平台与渠道的表单都要挑图，这里统一取一次传下去
  const libraryOptions = iconLibraries.map(({ id, name }) => ({ id, name }));

  return (
    <>
      <PageHeader
        title="设置"
        description="豆瓣同步、观影平台、来源渠道、图标库与标签的自定义管理。"
      />

      <div className="space-y-8">
        <SyncSettings initial={getSettings()} />

        <Separator />

        <PlatformManager
          platforms={platforms}
          usage={platformUsage()}
          libraries={libraryOptions}
        />

        <Separator />

        <SourceChannelManager
          channels={sourceChannels}
          usage={sourceChannelUsage()}
          libraries={libraryOptions}
        />

        <Separator />

        <IconLibraryManager libraries={iconLibraries} />

        <Separator />

        <TagManager tags={tags} usage={tagUsage()} />

        <Separator />

        <BackupManager pendingMetadata={countPendingMetadata()} />
      </div>
    </>
  );
}
