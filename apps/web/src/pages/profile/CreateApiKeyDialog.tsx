import { zodResolver } from "@hookform/resolvers/zod";
import { type ApiKeyCreated, apiKeyCreateInputSchema } from "@insuredesk/shared";
import { addDays, addYears, format } from "date-fns";
import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { isCompleteLocalDate } from "@/lib/local-date-time";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";

const formSchema = z.object({
  name: apiKeyCreateInputSchema.shape.name,
  expiresAt: z
    .string()
    .refine(isCompleteLocalDate, "请选择过期时间")
    .refine((date) => new Date(`${date}T23:59:59`) > new Date(), "过期时间必须晚于现在")
    .refine((date) => date <= format(addYears(new Date(), 1), "yyyy-MM-dd"), "过期时间最长为 1 年"),
});
type FormValues = z.infer<typeof formSchema>;

function defaultExpiryDate(): string {
  return format(addDays(new Date(), 90), "yyyy-MM-dd");
}

export function CreateApiKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", expiresAt: defaultExpiryDate() },
  });

  useEffect(() => {
    if (open) {
      setCreated(null);
      form.reset({ name: "", expiresAt: defaultExpiryDate() });
    }
  }, [open, form]);

  const create = trpc.apiKey.create.useMutation({
    onSuccess: (result) => {
      setCreated(result);
      utils.apiKey.list.invalidate();
    },
  });

  const onSubmit = form.handleSubmit((values) =>
    create.mutate({
      name: values.name,
      expiresAt: new Date(`${values.expiresAt}T23:59:59`).toISOString(),
    }),
  );
  const busy = create.isPending;
  const errors = form.formState.errors;

  const copyCreatedKey = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动选择文本复制");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建 API key</DialogTitle>
          <DialogDescription>
            {created
              ? "明文仅此一次展示，关闭后无法再次查看，请立即复制保存。"
              : "key 以你的身份调用开放 API，权限与你本人一致。"}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="api-key-plaintext">API key</FieldLabel>
              <Input
                id="api-key-plaintext"
                readOnly
                value={created.key}
                className="font-mono text-xs"
                onFocus={(event) => event.target.select()}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={copyCreatedKey}>
                复制
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                完成
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
            {/* noValidate：date 输入的 min/max 原生校验会抢先拦截提交，范围报错统一走 zod */}
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="api-key-name">名称</FieldLabel>
              <Input id="api-key-name" {...form.register("name")} placeholder="如：BI 报表同步" />
              {errors.name && <FieldError>{errors.name.message}</FieldError>}
            </Field>

            <Field data-invalid={!!errors.expiresAt}>
              <FieldLabel htmlFor="api-key-expires-at">过期时间</FieldLabel>
              <Input
                id="api-key-expires-at"
                type="date"
                min={format(new Date(), "yyyy-MM-dd")}
                max={format(addYears(new Date(), 1), "yyyy-MM-dd")}
                {...form.register("expiresAt")}
              />
              {errors.expiresAt && <FieldError>{errors.expiresAt.message}</FieldError>}
            </Field>

            {create.error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>创建失败</AlertTitle>
                <AlertDescription>{create.error.message}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  取消
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner data-icon="inline-start" />}
                {busy ? "创建中…" : "创建"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
