import type { Metadata } from "next";
import { Settings as SettingsIcon } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "设置" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="设置"
        description="观影平台、标签、同步策略与账号安全。"
      />

      <EmptyState
        icon={SettingsIcon}
        title="设置项待接入"
        description="后续在此管理自定义观影平台与标签、调整同步时间段与限速、修改登录密码。"
      />
    </>
  );
}
