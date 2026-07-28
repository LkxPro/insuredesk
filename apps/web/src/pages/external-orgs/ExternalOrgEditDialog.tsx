import { zodResolver } from "@hookform/resolvers/zod";
import {
  EXTERNAL_VISIBLE_FIELD_OPTIONS,
  type ExternalOrgCreateInput,
  type ExternalOrgUpdateInput,
  externalOrgCreateInputSchema,
  externalOrgUpdateInputSchema,
} from "@insuredesk/shared";
import { AlertCircle } from "lucide-react";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { trpc } from "@/lib/trpc";
import type { ExternalOrgRow } from "./ExternalOrgManagePage";

/** 编辑弹窗与机构详情页共用一份取词，两处显示保持一致。 */
export const FIELD_LABELS: Record<string, string> = {
  workOrderNumber: "工单号",
  feedbackTime: "反馈时间",
  status: "状态",
  completionStatusId: "完结状态",
  processingResult: "处理结果",
  source: "工单来源",
  categoryId: "客诉类别",
  complaintLevel: "投诉等级",
  priority: "优先级",
  description: "客户诉求",
  brokerageEntity: "经纪主体",
  paymentChannel: "支付渠道",
  project: "项目",
  userComplaintChannel: "用户投诉渠道",
  submissionText: "提交原文",
};

export function ExternalOrgEditDialog({
  org,
  open,
  onOpenChange,
}: {
  org?: ExternalOrgRow | null;
  open?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isCreate = !org;
  const isOpen = org ? !!org : !!open;

  if (isCreate) {
    return <CreateDialog open={isOpen} onOpenChange={onOpenChange} />;
  }

  return <UpdateDialog org={org} onOpenChange={onOpenChange} />;
}

function CreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();

  const form = useForm<ExternalOrgCreateInput>({
    resolver: zodResolver(externalOrgCreateInputSchema),
    defaultValues: { name: "", channelId: undefined, visibleTicketFields: [] },
  });

  useEffect(() => {
    if (open) {
      form.reset({ name: "", channelId: undefined, visibleTicketFields: [] });
    }
  }, [open, form]);

  const channelsQuery = trpc.channel.list.useQuery(undefined, { enabled: open });

  const create = trpc.externalOrg.create.useMutation({
    onSuccess: () => {
      toast.success("已创建机构");
      utils.externalOrg.invalidate();
      onOpenChange(false);
    },
  });

  const onSubmit = form.handleSubmit((values) => create.mutate(values));
  const busy = create.isPending;
  const errors = form.formState.errors;

  const selectedFields = form.watch("visibleTicketFields");
  const selectedCount = selectedFields?.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建机构</DialogTitle>
          <DialogDescription>创建外部机构并配置可见字段白名单。</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="org-name">机构名称</FieldLabel>
            <Input id="org-name" {...form.register("name")} placeholder="如：XX保险经纪公司" />
            {errors.name && <FieldError>{errors.name.message}</FieldError>}
          </Field>

          <Field data-invalid={!!errors.channelId}>
            <FieldLabel htmlFor="org-channel">关联渠道（可选）</FieldLabel>
            <Controller
              control={form.control}
              name="channelId"
              render={({ field }) => (
                <Select
                  value={field.value ?? ""}
                  onValueChange={(val) => field.onChange(val === "" ? undefined : val)}
                >
                  <SelectTrigger
                    id="org-channel"
                    className="w-full"
                    disabled={channelsQuery.isLoading}
                  >
                    <SelectValue placeholder="不关联渠道" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">不关联渠道</SelectItem>
                    {(channelsQuery.data ?? [])
                      .filter((ch) => ch.active)
                      .map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>
                          {channel.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.channelId && <FieldError>{errors.channelId.message}</FieldError>}
          </Field>

          <Field data-invalid={!!errors.visibleTicketFields}>
            <FieldLabel>可见字段（{selectedCount} 个已选）</FieldLabel>
            <div className="max-h-48 overflow-y-auto rounded-md border p-3">
              <Controller
                control={form.control}
                name="visibleTicketFields"
                render={({ field }) => {
                  const value = field.value ?? [];
                  return (
                    <div className="grid gap-2">
                      {EXTERNAL_VISIBLE_FIELD_OPTIONS.map((fieldKey) => (
                        <label
                          key={fieldKey}
                          htmlFor={`org-create-field-${fieldKey}`}
                          className="flex items-center gap-2 text-sm hover:cursor-pointer"
                        >
                          <Checkbox
                            id={`org-create-field-${fieldKey}`}
                            checked={value.includes(fieldKey)}
                            onCheckedChange={(checked) => {
                              const newValue = checked
                                ? [...value, fieldKey]
                                : value.filter((f) => f !== fieldKey);
                              field.onChange(newValue);
                            }}
                          />
                          <span>{FIELD_LABELS[fieldKey] ?? fieldKey}</span>
                        </label>
                      ))}
                    </div>
                  );
                }}
              />
            </div>
            {errors.visibleTicketFields && (
              <FieldError>{errors.visibleTicketFields.message}</FieldError>
            )}
            <p className="text-xs text-muted-foreground">
              留空使用系统默认（工单号、反馈时间、状态、完结状态、处理结果）
            </p>
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
      </DialogContent>
    </Dialog>
  );
}

function UpdateDialog({
  org,
  onOpenChange,
}: {
  org: ExternalOrgRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();

  const form = useForm<ExternalOrgUpdateInput>({
    resolver: zodResolver(externalOrgUpdateInputSchema),
    defaultValues: { id: "", name: "", channelId: undefined, visibleTicketFields: [] },
  });

  useEffect(() => {
    if (org) {
      form.reset({
        id: org.id,
        name: org.name,
        channelId: org.channelId ?? undefined,
        // null = 系统默认；表单里以空勾选表达，保存空数组时服务端归一回 null
        visibleTicketFields: org.visibleTicketFields ?? [],
      });
    }
  }, [org, form]);

  const channelsQuery = trpc.channel.list.useQuery(undefined, { enabled: !!org });

  const update = trpc.externalOrg.update.useMutation({
    onSuccess: () => {
      toast.success("已更新机构");
      utils.externalOrg.invalidate();
      onOpenChange(false);
    },
  });

  const onSubmit = form.handleSubmit((values) => update.mutate(values));
  const busy = update.isPending;
  const errors = form.formState.errors;

  const selectedFields = form.watch("visibleTicketFields");
  const selectedCount = selectedFields?.length ?? 0;

  return (
    <Dialog open={!!org} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑机构</DialogTitle>
          <DialogDescription>修改机构名称、渠道和可见字段。</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="org-name">机构名称</FieldLabel>
            <Input id="org-name" {...form.register("name")} placeholder="如：XX保险经纪公司" />
            {errors.name && <FieldError>{errors.name.message}</FieldError>}
          </Field>

          <Field data-invalid={!!errors.channelId}>
            <FieldLabel htmlFor="org-channel">关联渠道（可选）</FieldLabel>
            <Controller
              control={form.control}
              name="channelId"
              render={({ field }) => (
                <Select
                  value={field.value ?? ""}
                  onValueChange={(val) => field.onChange(val === "" ? null : val)}
                >
                  <SelectTrigger
                    id="org-channel"
                    className="w-full"
                    disabled={channelsQuery.isLoading}
                  >
                    <SelectValue placeholder="不关联渠道" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">不关联渠道</SelectItem>
                    {(channelsQuery.data ?? [])
                      .filter((ch) => ch.active)
                      .map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>
                          {channel.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.channelId && <FieldError>{errors.channelId.message}</FieldError>}
          </Field>

          <Field data-invalid={!!errors.visibleTicketFields}>
            <FieldLabel>可见字段（{selectedCount} 个已选）</FieldLabel>
            <div className="max-h-48 overflow-y-auto rounded-md border p-3">
              <Controller
                control={form.control}
                name="visibleTicketFields"
                render={({ field }) => {
                  const value = field.value ?? [];
                  return (
                    <div className="grid gap-2">
                      {EXTERNAL_VISIBLE_FIELD_OPTIONS.map((fieldKey) => (
                        <label
                          key={fieldKey}
                          htmlFor={`org-edit-field-${fieldKey}`}
                          className="flex items-center gap-2 text-sm hover:cursor-pointer"
                        >
                          <Checkbox
                            id={`org-edit-field-${fieldKey}`}
                            checked={value.includes(fieldKey)}
                            onCheckedChange={(checked) => {
                              const newValue = checked
                                ? [...value, fieldKey]
                                : value.filter((f) => f !== fieldKey);
                              field.onChange(newValue);
                            }}
                          />
                          <span>{FIELD_LABELS[fieldKey] ?? fieldKey}</span>
                        </label>
                      ))}
                    </div>
                  );
                }}
              />
            </div>
            {errors.visibleTicketFields && (
              <FieldError>{errors.visibleTicketFields.message}</FieldError>
            )}
            <p className="text-xs text-muted-foreground">
              留空使用系统默认（工单号、反馈时间、状态、完结状态、处理结果）
            </p>
          </Field>

          {update.error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>更新失败</AlertTitle>
              <AlertDescription>{update.error.message}</AlertDescription>
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
              {busy ? "更新中…" : "更新"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
