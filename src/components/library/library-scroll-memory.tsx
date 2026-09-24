"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * 上一次浏览器前进/后退的落点是不是档案库列表。popstate 触发时 URL 已经换好，
 * 这里直接读 location 判断；由挂载后的 effect 消费，还原真正落位（或放弃）后才清掉。
 *
 * 用「标记 + 消费」而不是时间差，是为了不依赖服务端取数快慢：慢一点的网络下
 * 页面晚半秒才上屏，按时间判断就会错过还原时机。而留到落位再清，是为了扛住
 * 开发模式下 effect 被重复执行一次（第一次的 rAF 会被 cleanup 取消掉）。
 */
let pendingRestore = false;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    pendingRestore = window.location.pathname === "/library";
  });
}

/** 还原位置最多重试的帧数：约 1.5 秒，够等取数与海报上屏，又不会一直空转 */
const MAX_RESTORE_FRAMES = 90;

/**
 * 记住档案库列表的滚动位置。
 *
 * 列表页是服务端组件，回退时靠重新取数渲染，文档高度在浏览器自行恢复之后才补齐，
 * 位置就被夹回顶部了，翻了几屏的人回来总得重新找位置。这里按 URL 把
 * window.scrollY 存进 sessionStorage，后退回来时再还原。
 *
 * 只在浏览器的前进/后退里还原：从侧边栏或标签点进档案库是「重新打开」，
 * 按惯例该落在顶部。
 */
export function LibraryScrollMemory() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // 筛选与页码都写在 URL 上，各自记各自的位置才不会被彼此覆盖
  const key = `cinetrace:scroll:${pathname}?${searchParams.toString()}`;

  useEffect(() => {
    const saved = Number(window.sessionStorage.getItem(key) ?? 0);
    let restoring = pendingRestore && saved > 0;
    // 没有可还原的位置就别把标记留着，免得下次从别处重新打开档案库也被拉走
    if (!restoring) pendingRestore = false;

    let restoreFrame = 0;
    if (restoring) {
      let tries = 0;
      const restore = () => {
        window.scrollTo(0, saved);
        if (Math.abs(window.scrollY - saved) < 2 || ++tries > MAX_RESTORE_FRAMES) {
          restoring = false;
          pendingRestore = false;
          return;
        }
        restoreFrame = requestAnimationFrame(restore);
      };
      restoreFrame = requestAnimationFrame(restore);
    }

    // 滚动事件一帧能来上百个，压到每帧最多写一次
    let saveFrame = 0;
    const onScroll = () => {
      if (saveFrame) return;
      saveFrame = requestAnimationFrame(() => {
        saveFrame = 0;
        // 还原期间不能回写：刚上屏时文档还不够高，scrollTo 会被夹到页面底部，
        // 这一下滚动若被记下来，记忆里的位置就变成那个残值了
        if (restoring) return;
        window.sessionStorage.setItem(key, String(window.scrollY));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(restoreFrame);
      // 取消未落盘的那一帧：离开列表时 Next 会把文档滚回顶部，
      // 让这次写入跑完只会把旧位置覆盖成 0
      cancelAnimationFrame(saveFrame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [key]);

  return null;
}
