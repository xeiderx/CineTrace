"use client";

import { useActionState, useState, useTransition } from "react";
import { Download, RefreshCw, Upload } from "lucide-react";
import {
  backfillMetadataAction,
  importBackupAction,
  type BackupFormState,
} from "@/app/actions/backup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  /** 待补 TMDB 元数据的作品数，服务端渲染时算好 */
  pendingMetadata: number;
};

/**
 * 备份与恢复。
 * 导出走 /api/backup/export（浏览器直接下载），导入与元数据补全走 server action。
 */
export function BackupManager({ pendingMetadata }: Props) {
  const [importState, importAction, importing] = useActionState<BackupFormState, FormData>(
    importBackupAction,
    undefined,
  );

  // 补全结果只在本组件内消费，不必进 useActionState
  const [backfilling, startBackfill] = useTransition();
  const [backfillState, setBackfillState] = useState<BackupFormState>(undefined);

  // 选文件后把文件名显示出来，避免用户以为没选上
  const [fileName, setFileName] = useState("");

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-medium">备份与恢复</h2>
        <p className="text-xs text-muted-foreground">
          导出观影记录、作品匹配关系、平台、标签、片单与设置。
          海报、简介等 TMDB 元数据不在备份里——它们可以随时重新拉取。
        </p>
      </div>

      <div className="space-y-5 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        {/* 导出 */}
        <div className="space-y-2">
          <Label>导出备份</Label>
          <p className="text-xs text-muted-foreground">
            下载一个 JSON 文件。含 TMDB API Key 与账号密码哈希，请妥善保管。
          </p>
          <Button asChild variant="outline" size="sm">
            <a href="/api/backup/export" download>
              <Download />
              下载备份文件
            </a>
          </Button>
        </div>

        {/* 导入 */}
        <form
          action={importAction}
          className="space-y-2 border-t border-border/60 pt-5"
        >
          <Label htmlFor="file">导入备份</Label>
          <p className="text-xs text-muted-foreground">
            按唯一键合并：已存在的作品与记录会被更新，不会删除现有数据。可重复导入。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="file"
              name="file"
              type="file"
              accept="application/json,.json"
              className="h-8 max-w-96"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={importing || !fileName}
            >
              <Upload />
              {importing ? "导入中…" : "开始导入"}
            </Button>
          </div>

          {fileName ? (
            <p className="text-xs text-muted-foreground">已选择：{fileName}</p>
          ) : null}

          {importState?.error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {importState.error}
            </p>
          ) : null}

          {importState?.ok ? (
            <p className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
              {importState.message ?? "导入完成。"}
            </p>
          ) : null}
        </form>

        {/* 元数据补全 */}
        <div className="flex items-start justify-between gap-4 border-t border-border/60 pt-5">
          <div className="space-y-1">
            <Label>补全 TMDB 元数据</Label>
            <p className="text-xs text-muted-foreground">
              为导入后尚未同步过详情的作品拉取海报、简介、时长与分季结构。
              当前待补 <span className="font-medium text-foreground">{pendingMetadata}</span> 部。
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={backfilling || pendingMetadata === 0}
            onClick={() => {
              startBackfill(async () => {
                setBackfillState(await backfillMetadataAction());
              });
            }}
          >
            <RefreshCw className={backfilling ? "animate-spin" : undefined} />
            {backfilling ? "补全中…" : "开始补全"}
          </Button>
        </div>

        {backfillState?.error ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {backfillState.error}
          </p>
        ) : null}

        {backfillState?.ok ? (
          <p className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
            {backfillState.message ?? "补全完成。"}
          </p>
        ) : null}
      </div>
    </div>
  );
}
