"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  getPersonProfileAction,
  type PersonProfile,
} from "@/app/actions/library";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 展示用的一条主演。头像地址在服务端拼好——TMDB 图床的拼接规则
 * 依赖 `posterUrl`，而那个模块连着数据库，不能进客户端包。
 */
export type CastPortrait = {
  id: number;
  name: string;
  character: string | null;
  profileUrl: string | null;
};

type Detail = PersonProfile | { error: string };

/**
 * 演员头像墙。点头像才去拉生平——简介只在 `/person/{id}` 接口里，
 * 一部作品十来个主演，提前抓一遍纯属浪费配额。
 * 拉过的结果同时留在组件内，同一次浏览里反复点开不再请求。
 */
export function CastWall({ cast }: { cast: CastPortrait[] }) {
  const [active, setActive] = useState<CastPortrait | null>(null);
  const [details, setDetails] = useState<Record<number, Detail>>({});
  const [loading, setLoading] = useState(false);

  async function open(item: CastPortrait) {
    setActive(item);
    // 已拉过的（含失败结果）直接复用，失败也只在第一次重试
    if (details[item.id]) return;

    setLoading(true);
    const result = await getPersonProfileAction(item.id);
    setLoading(false);
    if (!result) return;
    setDetails((prev) => ({ ...prev, [item.id]: result }));
  }

  const detail = active ? details[active.id] : undefined;
  const failed = detail && "error" in detail ? detail.error : null;

  return (
    <>
      <ul className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {cast.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => open(item)}
              className="group flex w-full flex-col items-center gap-2 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <div className="size-20 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-foreground/10 transition-transform group-hover:scale-[1.04] sm:size-24">
                {item.profileUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.profileUrl}
                    alt={item.name}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-2xl font-semibold text-muted-foreground/50">
                    {item.name.slice(0, 1)}
                  </span>
                )}
              </div>
              <p className="line-clamp-2 text-center text-xs leading-snug">
                {item.name}
              </p>
              {item.character ? (
                <p className="-mt-1.5 line-clamp-1 text-center text-[11px] text-muted-foreground">
                  {item.character}
                </p>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      <Dialog
        open={active !== null}
        onOpenChange={(next) => {
          if (!next) setActive(null);
        }}
      >
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-md">
          {active ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-4">
                  <div className="size-20 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-foreground/10">
                    {active.profileUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={active.profileUrl}
                        alt={active.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-2xl font-semibold text-muted-foreground/50">
                        {active.name.slice(0, 1)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <DialogTitle>{active.name}</DialogTitle>
                    <DialogDescription>
                      {active.character ? `饰 ${active.character}` : "演员"}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-3">
                {loading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    正在获取简介…
                  </p>
                ) : failed ? (
                  <p className="text-sm text-muted-foreground">{failed}</p>
                ) : detail && "name" in detail ? (
                  <>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {detail.birthday ? (
                        <span>{detail.birthday} 出生</span>
                      ) : null}
                      {detail.placeOfBirth ? (
                        <span>{detail.placeOfBirth}</span>
                      ) : null}
                    </div>
                    {detail.biography ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                        {detail.biography}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        TMDB 上没有这位演员的生平介绍。
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
