import type { ReminderRule, ReminderRuleType } from "@insuredesk/shared";
import { AlertCircle, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import type { SlaPolicyRow } from "./SlaPage";

/**
 * 校验口径镜像服务端 slaPolicyCreateInputSchema /
 * slaPolicyEditInputSchema；名称全表唯一（含停用行）由服务端执法，CONFLICT
 * 回执落回名称字段。
 */

interface RuleDraft {
  /** Stable identity across edits/removals — index shifts on delete. */
  key: number;
  type: ReminderRuleType;
  checkpointHours: string;
  requiredCount: string;
  advanceMinutes: string;
  intervalHours: string;
}

let draftKeySeq = 0;

function draftFrom(rule: ReminderRule): RuleDraft {
  draftKeySeq += 1;
  if (rule.type === "follow_up_checkpoint") {
    return {
      key: draftKeySeq,
      type: rule.type,
      checkpointHours: String(rule.checkpointHours),
      requiredCount: String(rule.requiredCount),
      advanceMinutes: String(rule.advanceMinutes),
      intervalHours: "",
    };
  }
  return {
    key: draftKeySeq,
    type: rule.type,
    checkpointHours: "",
    requiredCount: "",
    advanceMinutes: "",
    intervalHours: String(rule.intervalHours),
  };
}

function emptyDraft(type: ReminderRuleType): RuleDraft {
  draftKeySeq += 1;
  return {
    key: draftKeySeq,
    type,
    checkpointHours: "",
    requiredCount: "",
    advanceMinutes: "",
    intervalHours: "",
  };
}

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return parsed > 0 ? parsed : null;
}

interface RuleErrors {
  checkpointHours?: string;
  requiredCount?: string;
  advanceMinutes?: string;
  intervalHours?: string;
}

function validateRule(draft: RuleDraft): RuleErrors {
  if (draft.type === "rolling_follow_up") {
    return parsePositiveInt(draft.intervalHours) === null
      ? { intervalHours: "需为正整数（小时）" }
      : {};
  }
  const errors: RuleErrors = {};
  const checkpointHours = parsePositiveInt(draft.checkpointHours);
  if (checkpointHours === null) {
    errors.checkpointHours = "需为正整数（小时）";
  }
  if (parsePositiveInt(draft.requiredCount) === null) {
    errors.requiredCount = "需为正整数（次）";
  }
  const advanceMinutes = parsePositiveInt(draft.advanceMinutes);
  if (advanceMinutes === null) {
    errors.advanceMinutes = "需为正整数（分钟）";
  } else if (checkpointHours !== null && advanceMinutes >= checkpointHours * 60) {
    errors.advanceMinutes = "提前提醒必须小于检查点时长";
  }
  return errors;
}

function toReminderRule(draft: RuleDraft): ReminderRule {
  if (draft.type === "follow_up_checkpoint") {
    return {
      type: draft.type,
      checkpointHours: parsePositiveInt(draft.checkpointHours) as number,
      requiredCount: parsePositiveInt(draft.requiredCount) as number,
      advanceMinutes: parsePositiveInt(draft.advanceMinutes) as number,
    };
  }
  return { type: draft.type, intervalHours: parsePositiveInt(draft.intervalHours) as number };
}

export function SlaPolicyDialog({
  open,
  policy,
  onOpenChange,
}: {
  open: boolean;
  policy: SlaPolicyRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [firstResponseMinutes, setFirstResponseMinutes] = useState("");
  const [noOverdue, setNoOverdue] = useState(false);
  const [overdueHours, setOverdueHours] = useState("");
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [nameConflict, setNameConflict] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(policy?.name ?? "");
    setDescription(policy?.description ?? "");
    setFirstResponseMinutes(policy ? String(policy.firstResponseMinutes) : "");
    setNoOverdue(policy ? policy.overdueHours === null : false);
    setOverdueHours(policy?.overdueHours == null ? "" : String(policy.overdueHours));
    setRules(policy ? policy.reminderRules.map(draftFrom) : []);
    setNameConflict(null);
  }, [open, policy]);

  const onSaved = (saved: { name: string }) => {
    toast.success(policy ? `已更新时效策略「${saved.name}」` : `已创建时效策略「${saved.name}」`);
    utils.sla.list.invalidate();
    onOpenChange(false);
  };
  const create = trpc.sla.create.useMutation({
    onSuccess: onSaved,
    onError: (error) => {
      if (error.data?.code === "CONFLICT") {
        setNameConflict(error.message);
        create.reset();
      }
    },
  });
  const update = trpc.sla.update.useMutation({
    onSuccess: onSaved,
    onError: (error) => {
      if (error.data?.code === "CONFLICT") {
        setNameConflict(error.message);
        update.reset();
      }
    },
  });

  const nameError =
    name.trim() === ""
      ? "策略名称不能为空"
      : name.trim().length > 100
        ? "策略名称不能超过 100 字"
        : (nameConflict ?? undefined);
  const descriptionError = description.trim().length > 500 ? "策略描述不能超过 500 字" : undefined;
  const firstResponseError =
    parsePositiveInt(firstResponseMinutes) === null ? "需为正整数（分钟）" : undefined;
  const overdueError =
    !noOverdue && parsePositiveInt(overdueHours) === null ? "需为正整数（小时）" : undefined;
  const ruleErrors = rules.map(validateRule);
  const invalid =
    nameError !== undefined ||
    descriptionError !== undefined ||
    firstResponseError !== undefined ||
    overdueError !== undefined ||
    ruleErrors.some((errors) => Object.keys(errors).length > 0);
  const busy = create.isPending || update.isPending;
  const saveError = create.error ?? update.error;

  function patchRule(key: number, patch: Partial<RuleDraft>) {
    setRules((current) => current.map((rule) => (rule.key === key ? { ...rule, ...patch } : rule)));
  }

  function save() {
    if (invalid) {
      return;
    }
    const payload = {
      name: name.trim(),
      description: description.trim() === "" ? null : description.trim(),
      firstResponseMinutes: parsePositiveInt(firstResponseMinutes) as number,
      overdueHours: noOverdue ? null : (parsePositiveInt(overdueHours) as number),
      reminderRules: rules.map(toReminderRule),
    };
    if (policy) {
      update.mutate({ id: policy.id, ...payload });
    } else {
      create.mutate(payload);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[min(720px,90svh)] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{policy ? `编辑时效策略：${policy.name}` : "新增时效策略"}</DialogTitle>
          <DialogDescription>
            保存即时生效：此后新建单按新超时计算处理时限，待办告警按新规则判定；存量工单的处理时限不变。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto pr-1">
          <Field data-invalid={nameError !== undefined}>
            <FieldLabel htmlFor="sla-policy-name">策略名称</FieldLabel>
            <Input
              id="sla-policy-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameConflict(null);
              }}
            />
            {nameError && <FieldError>{nameError}</FieldError>}
          </Field>

          <Field data-invalid={descriptionError !== undefined}>
            <FieldLabel htmlFor="sla-policy-description">策略说明</FieldLabel>
            <Textarea
              id="sla-policy-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="展示在策略卡片上的口径说明，可留空"
            />
            {descriptionError && <FieldError>{descriptionError}</FieldError>}
          </Field>

          <Field data-invalid={firstResponseError !== undefined}>
            <FieldLabel htmlFor="sla-first-response">首响违约线（分钟）</FieldLabel>
            <Input
              id="sla-first-response"
              inputMode="numeric"
              value={firstResponseMinutes}
              onChange={(event) => setFirstResponseMinutes(event.target.value)}
              className="max-w-40"
            />
            {firstResponseError && <FieldError>{firstResponseError}</FieldError>}
          </Field>

          <Field data-invalid={overdueError !== undefined}>
            <FieldLabel htmlFor="sla-overdue-hours">超时时长（小时）</FieldLabel>
            <div className="flex items-center gap-4">
              <Input
                id="sla-overdue-hours"
                inputMode="numeric"
                value={overdueHours}
                disabled={noOverdue}
                onChange={(event) => setOverdueHours(event.target.value)}
                className="max-w-40"
              />
              <div className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="sla-no-overdue"
                  checked={noOverdue}
                  onCheckedChange={(checked) => setNoOverdue(checked === true)}
                />
                <label htmlFor="sla-no-overdue" className="cursor-pointer">
                  不设超时
                </label>
              </div>
            </div>
            {overdueError && <FieldError>{overdueError}</FieldError>}
          </Field>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">提醒规则</span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRules((current) => [...current, emptyDraft("follow_up_checkpoint")])
                  }
                >
                  <Plus data-icon="inline-start" />
                  添加检查点
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRules((current) => [...current, emptyDraft("rolling_follow_up")])
                  }
                >
                  <Plus data-icon="inline-start" />
                  添加滚动提醒
                </Button>
              </div>
            </div>

            {rules.length === 0 && (
              <p className="text-sm text-muted-foreground">
                无提醒规则——该策略工单仅保留待首响与超时告警。
              </p>
            )}

            {rules.map((rule, index) => {
              const errors = ruleErrors[index] ?? {};
              return (
                <div key={rule.key} className="flex flex-col gap-3 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary">
                      {rule.type === "follow_up_checkpoint" ? "跟进检查点" : "滚动提醒"}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() =>
                        setRules((current) => current.filter((item) => item.key !== rule.key))
                      }
                    >
                      删除
                    </Button>
                  </div>
                  {rule.type === "follow_up_checkpoint" ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field data-invalid={errors.checkpointHours !== undefined}>
                        <FieldLabel htmlFor={`rule-${rule.key}-checkpoint`}>
                          检查点（小时）
                        </FieldLabel>
                        <Input
                          id={`rule-${rule.key}-checkpoint`}
                          inputMode="numeric"
                          value={rule.checkpointHours}
                          onChange={(event) =>
                            patchRule(rule.key, { checkpointHours: event.target.value })
                          }
                        />
                        {errors.checkpointHours && (
                          <FieldError>{errors.checkpointHours}</FieldError>
                        )}
                      </Field>
                      <Field data-invalid={errors.requiredCount !== undefined}>
                        <FieldLabel htmlFor={`rule-${rule.key}-required`}>
                          要求累计跟进（次）
                        </FieldLabel>
                        <Input
                          id={`rule-${rule.key}-required`}
                          inputMode="numeric"
                          value={rule.requiredCount}
                          onChange={(event) =>
                            patchRule(rule.key, { requiredCount: event.target.value })
                          }
                        />
                        {errors.requiredCount && <FieldError>{errors.requiredCount}</FieldError>}
                      </Field>
                      <Field data-invalid={errors.advanceMinutes !== undefined}>
                        <FieldLabel htmlFor={`rule-${rule.key}-advance`}>
                          提前提醒（分钟）
                        </FieldLabel>
                        <Input
                          id={`rule-${rule.key}-advance`}
                          inputMode="numeric"
                          value={rule.advanceMinutes}
                          onChange={(event) =>
                            patchRule(rule.key, { advanceMinutes: event.target.value })
                          }
                        />
                        {errors.advanceMinutes && <FieldError>{errors.advanceMinutes}</FieldError>}
                      </Field>
                    </div>
                  ) : (
                    <Field data-invalid={errors.intervalHours !== undefined} className="max-w-56">
                      <FieldLabel htmlFor={`rule-${rule.key}-interval`}>
                        跟进间隔（小时）
                      </FieldLabel>
                      <Input
                        id={`rule-${rule.key}-interval`}
                        inputMode="numeric"
                        value={rule.intervalHours}
                        onChange={(event) =>
                          patchRule(rule.key, { intervalHours: event.target.value })
                        }
                      />
                      {errors.intervalHours && <FieldError>{errors.intervalHours}</FieldError>}
                    </Field>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {saveError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>保存失败</AlertTitle>
            <AlertDescription>{saveError.message}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={busy}>
              取消
            </Button>
          </DialogClose>
          <Button type="button" disabled={busy || invalid} onClick={save}>
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
