"use client";

import { useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * 危险操作确认按钮。服务端 action 通过 hidden 字段接收主键，
 * 确认后才真正提交，避免误删。
 */
export function ConfirmDeleteButton({
  action,
  id,
  title,
  description,
  label = "删除",
  iconOnly = true,
}: {
  action: (formData: FormData) => Promise<void>;
  id: number;
  title: string;
  description: string;
  label?: string;
  iconOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(() => void action(formData));
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {iconOnly ? (
          <Button variant="ghost" size="icon-sm" aria-label={label}>
            <Trash2 />
          </Button>
        ) : (
          <Button variant="destructive" size="sm">
            <Trash2 />
            {label}
          </Button>
        )}
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(event) => {
              // 交给 React 处理，避免 Radix 关闭后丢失 form 提交
              event.preventDefault();
              const formData = new FormData();
              formData.set("id", String(id));
              submit(formData);
            }}
          >
            {pending ? <Loader2 className="animate-spin" /> : null}
            确认删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
