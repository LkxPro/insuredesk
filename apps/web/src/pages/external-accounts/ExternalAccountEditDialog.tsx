import { zodResolver } from "@hookform/resolvers/zod";
import {
  displayNameSchema,
  externalAccountPrefillSchema,
  optionalEmailSchema,
  TICKET_FIELDS,
  usernameSchema,
} from "@insuredesk/shared";
import { AlertCircle } from "lucide-react";
import { useEffect } from "react";
import { Controller, type UseFormReturn, useForm } from "react-hook-form";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import type { ExternalAccountRow } from "./ExternalAccountManagePage";

const accountFormSchema = z.object({
  username: usernameSchema,
  password: z.string(),
  name: displayNameSchema,
  email: optionalEmailSchema,
  prefill: externalAccountPrefillSchema,
});

export type ExternalAccountFormValues = z.input<typeof accountFormSchema>;

function buildAccountFormSchema(mode: "create" | "update") {
  return accountFormSchema.superRefine((values, ctx) => {
    const password = values.password;
    if (!password) {
      if (mode === "create") {
        ctx.addIssue({ code: "custom", message: "密码至少 6 位", path: ["password"] });
      }
      return;
    }
    if (password.length < 6) {
      ctx.addIssue({ code: "custom", message: "密码至少 6 位", path: ["password"] });
    }
    if (password.length > 72) {
      ctx.addIssue({ code: "custom", message: "密码最长 72 字符", path: ["password"] });
    }
  });
}

const EMPTY_PREFILL: NonNullable<ExternalAccountFormValues["prefill"]> = {
  channelId: "",
  project: "",
  brokerageEntity: "",
  paymentChannel: "",
  userFeedbackChannelId: "",
  feedbackReceiveChannelId: "",
};

const PREFILL_TEXT_KEYS = ["project", "brokerageEntity", "paymentChannel"] as const;

const PREFILL_CATALOG_KEYS = [
  { key: "channelId", unsetLabel: "不预填渠道" },
  { key: "userFeedbackChannelId", unsetLabel: "不预填用户反馈渠道" },
  { key: "feedbackReceiveChannelId", unsetLabel: "不预填反馈信息接收渠道" },
] as const;

type PrefillCatalogKey = (typeof PREFILL_CATALOG_KEYS)[number]["key"];

function PrefillCatalogSelect({
  form,
  idPrefix,
  name,
  unsetLabel,
  options,
  isLoading,
}: {
  form: UseFormReturn<ExternalAccountFormValues>;
  idPrefix: string;
  name: PrefillCatalogKey;
  unsetLabel: string;
  options: ReadonlyArray<{ id: string; name: string }>;
  isLoading: boolean;
}) {
  const currentId = form.watch(`prefill.${name}`) ?? "";
  const currentMissing = currentId !== "" && !options.some((option) => option.id === currentId);
  const errors = form.formState.errors;

  return (
    <Field data-invalid={!!errors.prefill?.[name]}>
      <FieldLabel htmlFor={`${idPrefix}-prefill-${name}`}>{TICKET_FIELDS[name].label}</FieldLabel>
      <Controller
        control={form.control}
        name={`prefill.${name}`}
        render={({ field }) => (
          <Select
            value={field.value ?? ""}
            onValueChange={(value) => field.onChange(value === "" ? null : value)}
          >
            <SelectTrigger
              id={`${idPrefix}-prefill-${name}`}
              className="w-full"
              disabled={isLoading}
            >
              <SelectValue placeholder={unsetLabel} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{unsetLabel}</SelectItem>
              {currentMissing && <SelectItem value={currentId}>当前引用（已停用）</SelectItem>}
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      {errors.prefill?.[name] && <FieldError>{errors.prefill[name].message}</FieldError>}
    </Field>
  );
}

/**
 * 目录下拉只列启用项; 当前引用的停用项随表单初值补进选项（保持原值可存,
 * 不能新选其他停用项）。
 */
function PrefillFields({
  form,
  idPrefix,
}: {
  form: UseFormReturn<ExternalAccountFormValues>;
  idPrefix: string;
}) {
  const channelsQuery = trpc.channel.options.useQuery();
  const userFeedbackChannelsQuery = trpc.userFeedbackChannel.options.useQuery();
  const feedbackReceiveChannelsQuery = trpc.feedbackReceiveChannel.options.useQuery();
  const catalogQueries = {
    channelId: channelsQuery,
    userFeedbackChannelId: userFeedbackChannelsQuery,
    feedbackReceiveChannelId: feedbackReceiveChannelsQuery,
  } as const;

  const errors = form.formState.errors;

  return (
    <>
      <Separator />
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">提交预填（全部可选）</h3>
        <p className="text-xs text-muted-foreground">
          该账号提交工单时自动带入以下字段；留空 = 客服后补。
        </p>
      </div>

      {PREFILL_CATALOG_KEYS.map(({ key, unsetLabel }) => (
        <PrefillCatalogSelect
          key={key}
          form={form}
          idPrefix={idPrefix}
          name={key}
          unsetLabel={unsetLabel}
          options={catalogQueries[key].data ?? []}
          isLoading={catalogQueries[key].isLoading}
        />
      ))}

      <div className="grid gap-4 sm:grid-cols-2">
        {PREFILL_TEXT_KEYS.map((key) => (
          <Field key={key} data-invalid={!!errors.prefill?.[key]}>
            <FieldLabel htmlFor={`${idPrefix}-prefill-${key}`}>
              {TICKET_FIELDS[key].label}
            </FieldLabel>
            <Input id={`${idPrefix}-prefill-${key}`} {...form.register(`prefill.${key}`)} />
            {errors.prefill?.[key] && <FieldError>{errors.prefill[key].message}</FieldError>}
          </Field>
        ))}
      </div>
    </>
  );
}

export function ExternalAccountEditDialog({
  account,
  open,
  onOpenChange,
}: {
  account?: ExternalAccountRow | null;
  open?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isCreate = !account;
  const isOpen = account ? !!account : !!open;

  if (isCreate) {
    return <CreateDialog open={isOpen} onOpenChange={onOpenChange} />;
  }

  return <UpdateDialog account={account} onOpenChange={onOpenChange} />;
}

function CreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();

  const form = useForm<ExternalAccountFormValues>({
    resolver: zodResolver(buildAccountFormSchema("create")),
    defaultValues: {
      username: "",
      password: "",
      name: "",
      email: "",
      prefill: EMPTY_PREFILL,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        username: "",
        password: "",
        name: "",
        email: "",
        prefill: EMPTY_PREFILL,
      });
    }
  }, [open, form]);

  const create = trpc.externalAccount.create.useMutation({
    onSuccess: (result) => {
      toast.success(`已创建账号 ${result.name}`);
      utils.externalAccount.invalidate();
      onOpenChange(false);
    },
  });

  const onSubmit = form.handleSubmit((values) => create.mutate(values));
  const busy = create.isPending;
  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建外部账号</DialogTitle>
          <DialogDescription>创建可登录的外部账号，仅能看到自己提交的工单。</DialogDescription>
        </DialogHeader>

        <form className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pe-1" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="account-name">姓名</FieldLabel>
              <Input id="account-name" {...form.register("name")} placeholder="如：张三" />
              {errors.name && <FieldError>{errors.name.message}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.username}>
              <FieldLabel htmlFor="account-username">用户名</FieldLabel>
              <Input id="account-username" {...form.register("username")} placeholder="登录账号" />
              {errors.username && <FieldError>{errors.username.message}</FieldError>}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="account-password">初始密码</FieldLabel>
              <Input id="account-password" type="password" {...form.register("password")} />
              {errors.password && <FieldError>{errors.password.message}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="account-email">邮箱（可选）</FieldLabel>
              <Input id="account-email" {...form.register("email")} />
              {errors.email && <FieldError>{errors.email.message}</FieldError>}
            </Field>
          </div>

          <PrefillFields form={form} idPrefix="account-create" />

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
  account,
  onOpenChange,
}: {
  account: ExternalAccountRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();

  const form = useForm<ExternalAccountFormValues>({
    resolver: zodResolver(buildAccountFormSchema("update")),
    defaultValues: {
      username: "",
      password: "",
      name: "",
      email: "",
      prefill: EMPTY_PREFILL,
    },
  });

  useEffect(() => {
    if (account) {
      form.reset({
        username: account.username,
        password: "",
        name: account.name,
        email: account.email ?? "",
        prefill: {
          channelId: account.prefill.channelId ?? "",
          project: account.prefill.project ?? "",
          brokerageEntity: account.prefill.brokerageEntity ?? "",
          paymentChannel: account.prefill.paymentChannel ?? "",
          userFeedbackChannelId: account.prefill.userFeedbackChannelId ?? "",
          feedbackReceiveChannelId: account.prefill.feedbackReceiveChannelId ?? "",
        },
      });
    }
  }, [account, form]);

  const update = trpc.externalAccount.update.useMutation({
    onSuccess: (result) => {
      toast.success(`已更新账号 ${result.name}`);
      utils.externalAccount.invalidate();
      onOpenChange(false);
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (account) {
      update.mutate({ ...values, id: account.id });
    }
  });
  const busy = update.isPending;
  const errors = form.formState.errors;

  return (
    <Dialog open={!!account} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑外部账号</DialogTitle>
          <DialogDescription>修改用户名后该账号下次登录需用新用户名。</DialogDescription>
        </DialogHeader>

        <form className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pe-1" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="account-edit-name">姓名</FieldLabel>
              <Input id="account-edit-name" {...form.register("name")} />
              {errors.name && <FieldError>{errors.name.message}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.username}>
              <FieldLabel htmlFor="account-edit-username">用户名</FieldLabel>
              <Input
                id="account-edit-username"
                {...form.register("username")}
                placeholder="登录账号"
              />
              {errors.username && <FieldError>{errors.username.message}</FieldError>}
            </Field>
          </div>

          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="account-edit-email">邮箱（可选）</FieldLabel>
            <Input id="account-edit-email" {...form.register("email")} />
            {errors.email && <FieldError>{errors.email.message}</FieldError>}
          </Field>

          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="account-edit-password">重置密码</FieldLabel>
            <Input
              id="account-edit-password"
              type="password"
              {...form.register("password")}
              placeholder="留空则不修改"
            />
            <FieldDescription>填写后该账号在线会话即刻失效，需用新密码登录。</FieldDescription>
            {errors.password && <FieldError>{errors.password.message}</FieldError>}
          </Field>

          <PrefillFields form={form} idPrefix="account-edit" />

          {update.error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>保存失败</AlertTitle>
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
              {busy ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
