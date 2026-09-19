import { NextResponse } from "next/server";
import { exportBackup } from "@/lib/backup";
import { getOptionalUser } from "@/lib/session";

/**
 * 导出备份。
 * proxy 的 matcher 排除了 /api，因此这里必须自己鉴权。
 */
export async function GET(): Promise<Response> {
  const authUser = await getOptionalUser();
  if (!authUser) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const backup = exportBackup();
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `cinetrace-backup-${stamp}.json`;

  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
