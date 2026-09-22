"use client";

import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Images, ImageUp, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/** 设置页里的图标库，够弹窗选库用 */
export type IconLibraryOption = { id: number; name: string };

/** 图标库 JSON 里的一条图标 */
type LibraryIcon = { name: string; url: string };

/** GET /api/icon-libraries/[id] 的返回体 */
type LibraryContent = { name: string; description: string; icons: LibraryIcon[] };

/** 原始文件上限。图片会在浏览器里先压缩，超过这个大小说明选错了文件 */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** 压缩后图标的长边像素。列表里按 32px 显示，128px 已经够清晰 */
const ICON_MAX_EDGE = 128;
/** 网格缩略图宽度，必须落在 /api/icon-libraries/[id]/icon 的 ALLOWED_WIDTHS 里 */
const THUMB_WIDTH = 96;
/** 选中后取回的宽度，比入库的 128px 略大，交给下面的压缩统一收口 */
const PICK_WIDTH = 192;

/**
 * 把选中的图片压成 data URL。
 *
 * 存库而非落盘：public/ 在 Docker 镜像是只读层，容器重建就被覆盖；
 * 压到 128px 长边后典型体积 10-30KB，随 JSON 备份一起导出也不至于爆掉。
 */
async function compressToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, ICON_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持 Canvas 2D");
    context.drawImage(bitmap, 0, 0, width, height);

    // 用 PNG 保留透明背景，站点图标多为透明底
    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}

/** 走服务端代理取缩略图，浏览器不用能直连 GitHub */
function thumbUrl(libraryId: number, url: string, width: number): string {
  return `/api/icon-libraries/${libraryId}/icon?url=${encodeURIComponent(url)}&w=${width}`;
}

/**
 * 从图标库里挑一张图。
 *
 * 分两步：先选库、再在网格里选图标。库清单动辄几百条，所以网格上带搜索框，
 * 并按需懒加载缩略图（服务端已经缩过，单张几 KB）。
 * 选中的图会被压回 128px 的 data URL，与用户自己上传的走同一条入库路径。
 */
function LibraryPickerDialog({
  open,
  onOpenChange,
  libraries,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraries: IconLibraryOption[];
  onPick: (dataUrl: string) => void;
}) {
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [content, setContent] = useState<LibraryContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [picking, setPicking] = useState<string | null>(null);

  const icons = useMemo(() => {
    const list = content?.icons ?? [];
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) return list;
    return list.filter((icon) => icon.name.toLowerCase().includes(trimmed));
  }, [content, keyword]);

  /** 关闭时清干净，下次打开回到选库那一步 */
  function handleOpenChange(next: boolean) {
    if (!next) {
      setLibraryId(null);
      setContent(null);
      setError(null);
      setKeyword("");
      setPicking(null);
    }
    onOpenChange(next);
  }

  async function openLibrary(library: IconLibraryOption) {
    setLibraryId(library.id);
    setContent(null);
    setError(null);
    setKeyword("");
    setLoading(true);
    try {
      const response = await fetch(`/api/icon-libraries/${library.id}`);
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          (payload as { error?: string } | null)?.error ?? "图标库读取失败",
        );
      }
      setContent(payload as LibraryContent);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "图标库读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function pick(icon: LibraryIcon) {
    if (libraryId == null) return;
    setError(null);
    setPicking(icon.url);
    try {
      const response = await fetch(thumbUrl(libraryId, icon.url, PICK_WIDTH));
      if (!response.ok) throw new Error("取图失败");
      const blob = await response.blob();
      onPick(await compressToDataUrl(new File([blob], "icon.png", { type: "image/png" })));
      handleOpenChange(false);
    } catch {
      setError("这个图标取不回来，换一个再试");
    } finally {
      setPicking(null);
    }
  }

  const current = libraries.find((library) => library.id === libraryId) ?? null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{current ? current.name : "选择图标库"}</DialogTitle>
          <DialogDescription>
            {current
              ? content
                ? `共 ${content.icons.length} 个图标，点击即选用。`
                : "正在读取图标清单…"
              : "图标由远端图标库提供，这里选的图会压缩后存入数据库。"}
          </DialogDescription>
        </DialogHeader>

        {current ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLibraryId(null);
                  setContent(null);
                  setError(null);
                  setKeyword("");
                }}
              >
                <ArrowLeft />
                换个图标库
              </Button>

              <div className="relative ml-auto w-full max-w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索图标名"
                  className="h-8 pl-8"
                />
              </div>
            </div>

            {loading ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                读取中…
              </div>
            ) : icons.length === 0 ? (
              <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                {content?.icons.length ? "没有匹配的图标" : "这个图标库里没有可用图标"}
              </p>
            ) : (
              <ScrollArea className="h-64 rounded-lg ring-1 ring-foreground/10">
                <ul className="grid grid-cols-5 gap-1.5 p-2 sm:grid-cols-7 md:grid-cols-9">
                  {icons.map((icon) => (
                    <li key={icon.url}>
                      <button
                        type="button"
                        title={icon.name}
                        disabled={picking != null}
                        onClick={() => void pick(icon)}
                        className={cn(
                          "flex aspect-square w-full items-center justify-center rounded-lg bg-muted/60",
                          "ring-1 ring-foreground/5 transition-colors hover:bg-accent disabled:opacity-50",
                        )}
                      >
                        {picking === icon.url ? (
                          <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumbUrl(current.id, icon.url, THUMB_WIDTH)}
                            alt=""
                            loading="lazy"
                            className="size-8 object-contain"
                          />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </div>
        ) : libraries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            还没有图标库，先在设置里添加一个。
          </p>
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {libraries.map((library) => (
              <li key={library.id}>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => void openLibrary(library)}
                >
                  {library.name}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 图标选择：上传本地图片、从图标库挑、或者（平台用）填一个内置图标名。
 *
 * 值统一塞进 hidden 字段跟着普通表单提交：图片是 data URL，平台的内置图标是
 * lucide 名，两种写法下游都能认。`renderValue` 负责把非图片的值画出来。
 */
export function IconField({
  name,
  initial,
  label = "图标",
  hint,
  libraries,
  renderValue,
  namedIcons,
}: {
  /** hidden 字段名：来源渠道是 iconData，观影平台是 icon */
  name: string;
  initial: string | null;
  label?: string;
  hint?: string;
  libraries: IconLibraryOption[];
  /** 画非 data URL 的值（内置图标名），不传就只当图片处理 */
  renderValue?: (value: string) => ReactNode;
  /** 可一键选中的内置图标名 */
  namedIcons?: string[];
}) {
  const [value, setValue] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const isImage = value.startsWith("data:");

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("只支持 PNG / JPEG / WebP 图片");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("图片不超过 5MB");
      return;
    }

    setBusy(true);
    try {
      setValue(await compressToDataUrl(file));
    } catch {
      setError("图片处理失败，换一张再试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>

      <div className="flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 [&_svg]:size-5">
          {value && isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="size-full object-contain" />
          ) : value && renderValue ? (
            renderValue(value)
          ) : (
            <ImageUp className="size-5 text-muted-foreground" />
          )}
        </span>

        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "处理中…" : value ? "更换图片" : "选择图片"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            <Images />
            从图标库选择
          </Button>
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setValue("");
                setError(null);
              }}
            >
              <X />
              移除
            </Button>
          ) : null}
        </div>
      </div>

      {namedIcons?.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">内置图标</span>
          {namedIcons.map((item) => (
            <Button
              key={item}
              type="button"
              variant={value === item ? "secondary" : "ghost"}
              size="icon-sm"
              title={item}
              onClick={() => {
                setValue(item);
                setError(null);
              }}
            >
              {renderValue?.(item)}
            </Button>
          ))}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {hint ?? `可选 PNG / JPEG / WebP，会自动压缩到 ${ICON_MAX_EDGE}px 后存入数据库。`}
      </p>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <input
        ref={fileRef}
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // 立刻清空，否则连着选同一个文件不会再触发 change
          event.target.value = "";
          void handleFile(file);
        }}
      />
      <input type="hidden" name={name} value={value} />

      <LibraryPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        libraries={libraries}
        onPick={(dataUrl) => {
          setValue(dataUrl);
          setError(null);
        }}
      />
    </div>
  );
}
