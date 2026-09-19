"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, RefreshCw, Upload } from "lucide-react";
import {
  backfillMetadataAction,
  getBackfillProgressAction,
  importBackupAction,
  type BackupFormState,
  type BackfillState,
} from "@/app/actions/backup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  /** 待补 TMDB 元数据的作品数，服务端渲染时算好 */
  pendingMetadata: number;
};

/** 轮询间隔。补全进度只用于展示，没必要问得太勤。 */
const POLL_MS = 1500;

/**
 * 备份与恢复。
 * 导出走 /api/backup/export（浏览器直接下载），导入走 server action。
 * 元数据补全在服务端用 after() 后台执行，这里只负责发起与轮询进度——
 * 所以补全期间可以随意切换页面，进度不会因为离开页面而中断。
 */
export function BackupManager({ pendingMetadata }: Props) {
  const router = useRouter();
  const [importState, importAction, importing] = useActionState<BackupFormState, FormData>(
    importBackupAction,
    undefined,
  );

  const [backfillState, setBackfillState] = useState<BackfillState | null>(null);
  const [starting, setStarting] = useState(false);
  const [fileName, setFileName] = useState("");

  // 组件卸载后不再 setState，也不继续轮询（补全本身在服务端照跑）
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const running = backfillState?.running ?? false;

  /**
   * 点一次就补到完。
   * 服务端立即返回并转后台执行，这里轮询到 running 变 false 为止。
   * 中途切走页面只会丢掉轮询，服务端的补全不受影响。
   */
  const startBackfill = async () => {
    setStarting(true);
    try {
      setBackfillState(await backfillMetadataAction());
    } finally {
      if (aliveRef.current) setStarting(false);
    }

    while (aliveRef.current) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (!aliveRef.current) return;

      const state = await getBackfillProgressAction();
      if (!aliveRef.current) return;
      setBackfillState(state);
      if (!state.running) {
        // 补完让服务端组件重新渲染，待补数量与海报才会更新
        router.refresh();
        return;
      }
    }
  };

  // 进入页面时若后台还在补，直接接上进度显示
  useEffect(() => {
    void (async () => {
      const state = await getBackfillProgressAction();
      if (aliveRef.current && state.running) setBackfillState(state);
    })();
  }, []);

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
              当前待补 <span className="font-medium text-foreground">{pendingMetadata}</span> 部，
              点一次会自动补到完，期间可以随意切换页面。
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={starting || running || (pendingMetadata === 0 && !running)}
            onClick={() => void startBackfill()}
          >
            <RefreshCw className={starting || running ? "animate-spin" : undefined} />
            {starting
              ? "启动中…"
              : running
                ? `补全中 ${backfillState?.done ?? 0}/${backfillState?.total ?? 0}…`
                : "开始补全"}
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

        {backfillState && !backfillState.error && backfillState.message ? (
          <p className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
            {backfillState.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
