"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import {
  getPersonProfileAction,
  type PersonDetailResult,
} from "@/app/actions/library";
import { Button } from "@/components/ui/button";
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

/** ISO 时间戳转「2026-09-19」，只到日 */
function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

/**
 * 演员头像墙。点头像才去拉生平——简介只在 `/person/{id}` 接口里，
 * 一部作品十来个主演，提前抓一遍纯属浪费配额。
 * 拉过的结果同时留在组件内，同一次浏览里反复点开不再请求。
 */
export function CastWall({ cast }: { cast: CastPortrait[] }) {
  const [active, setActive] = useState<CastPortrait | null>(null);
  const [details, setDetails] = useState<Record<number, PersonDetailResult>>({});
  const [loading, setLoading] = useState(false);

  /**
   * 取资料。`force` 来自弹窗里的「重新获取」按钮，
   * 用于绕过半年的缓存有效期强制重拉。
   */
  async function load(item: CastPortrait, force = false) {
    setLoading(true);
    const result = await getPersonProfileAction(item.id, force);
    setLoading(false);
    setDetails((prev) => ({ ...prev, [item.id]: result }));
  }

  function open(item: CastPortrait) {
    setActive(item);
    // 已拉过的直接复用，同一次浏览里反复点开不再请求
    if (!details[item.id]) void load(item);
  }

  const detail = active ? details[active.id] : undefined;
  const profile = detail?.profile ?? null;

  return (
    <>
      {/* 窄屏单行横向滑动：主演动辄十来个，铺成网格会把详情页拉得很长；
          宽屏空间够，回到网格一次看全 */}
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-x-2 sm:gap-y-4 sm:overflow-visible sm:px-0 md:grid-cols-6 lg:grid-cols-8">
        {cast.map((item) => (
          <li key={item.id} className="w-20 shrink-0 sm:w-auto">
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
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
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
                ) : detail?.error ? (
                  <p className="text-sm text-muted-foreground">{detail.error}</p>
                ) : profile ? (
                  <>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {profile.birthday ? <span>{profile.birthday} 出生</span> : null}
                      {profile.placeOfBirth ? <span>{profile.placeOfBirth}</span> : null}
                    </div>
                    {profile.biography ? (
                      <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                        {profile.biography}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        TMDB 上没有这位演员的生平介绍。
                      </p>
                    )}
                  </>
                ) : null}

                {detail?.works.length ? (
                  <div className="space-y-2 border-t border-border/60 pt-3">
                    <p className="text-xs text-muted-foreground">
                      参演你库里的 {detail.works.length} 部作品
                    </p>
                    <ul className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                      {detail.works.map((w) => (
                        <li key={w.id} className="w-20 shrink-0">
                          <Link
                            href={`/library/${w.id}`}
                            onClick={() => setActive(null)}
                            className="group block space-y-1"
                          >
                            <div className="aspect-[2/3] w-full overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10">
                              {w.posterUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={w.posterUrl}
                                  alt={w.title}
                                  loading="lazy"
                                  className="h-full w-full object-cover transition-transform group-hover:scale-[1.04]"
                                />
                              ) : (
                                <span className="flex h-full w-full items-center justify-center text-lg font-semibold text-muted-foreground/50">
                                  {w.title.slice(0, 1)}
                                </span>
                              )}
                            </div>
                            <p className="line-clamp-2 text-[11px] leading-tight group-hover:text-primary">
                              {w.title}
                            </p>
                            {w.year ? (
                              <p className="text-[10px] text-muted-foreground">{w.year}</p>
                            ) : null}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {detail && !loading ? (
                  <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                    <p className="text-[11px] text-muted-foreground">
                      {profile
                        ? formatUpdatedAt(profile.updatedAt)
                          ? `资料更新于 ${formatUpdatedAt(profile.updatedAt)}`
                          : "资料来自本地缓存"
                        : "未能获取到资料"}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => active && void load(active, true)}
                    >
                      <RefreshCw />
                      重新获取
                    </Button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
