"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 返回上一级。详情页会被档案库、追剧页、概览和演员墙等多个入口带进来，
 * 写死某个列表页会在换入口时把人送错地方，所以优先走浏览器历史。
 * 直接打开（新标签页、书签）时没有上一级可退，兜底回档案库。
 */
export function BackButton({ fallbackHref = "/library" }: { fallbackHref?: string }) {
  const router = useRouter();

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push(fallbackHref);
  }

  return (
    <Button variant="ghost" size="sm" onClick={goBack}>
      <ArrowLeft />
      返回
    </Button>
  );
}
