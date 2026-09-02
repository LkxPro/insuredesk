import { zodResolver } from "@hookform/resolvers/zod";
import { type ApiKeyCreated, apiKeyCreateInputSchema } from "@insuredesk/shared";
import { addDays } from "date-fns";
import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 天" },
  { value: "90", label: "90 天" },
  { value: "180", label: "180 天" },
  { value: "365", label: "365 天" },
  { value: "never", label: "永不过期" },
] as const;

const formSchema = z.object({
  name: apiKeyCreateInputSchema.shape.name,
  expiry: z.enum(["30", "90", "180", "365", "never"]),
});
type FormValues = z.infer<typeof formSchema>;

const DEFAULT_VALUES: FormValues = { name: "", expiry: "90" };

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
    defaultValues: DEFAULT_VALUES,
  });

  const create = trpc.apiKey.create.useMutation({
    onSuccess: (result) => {
      setCreated(result);
      utils.apiKey.list.invalidate();
    },
  });
  const resetCreate = create.reset;

  useEffect(() => {
    if (open) {
      setCreated(null);
      resetCreate();
      form.reset(DEFAULT_VALUES);
    }
  }, [open, form, resetCreate]);

  const onSubmit = form.handleSubmit((values) =>
    create.mutate({
      name: values.name,
      expiresAt:
        values.expiry === "never" ? null : addDays(new Date(), Number(values.expiry)).toISOString(),
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
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="api-key-name">名称</FieldLabel>
              <Input id="api-key-name" {...form.register("name")} placeholder="如：BI 报表同步" />
              {errors.name && <FieldError>{errors.name.message}</FieldError>}
            </Field>

            <Field data-invalid={!!errors.expiry}>
              <FieldLabel htmlFor="api-key-expiry">有效期</FieldLabel>
              <Controller
                control={form.control}
                name="expiry"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="api-key-expiry" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.expiry && <FieldError>{errors.expiry.message}</FieldError>}
              {form.watch("expiry") === "never" && (
                <p className="text-sm text-destructive">
                  永不过期的 key 泄露后长期有效，建议定期轮换。
                </p>
              )}
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
