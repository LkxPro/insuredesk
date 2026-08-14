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
import { toast } from "@/lib/toast";
import { trpc } from "@/lib/trpc";
import type { SlaPolicyRow } from "./SlaPage";

/**
 * 编辑 SLA 策略 (sla.edit): one level's firstResponseMinutes, overdueHours
 * (可空 = 不设超时), and the typed reminder-rule list with 增删改. The form
 * mirrors slaPolicyUpdateInputSchema — positive integers everywhere and
 * advanceMinutes strictly below its own checkpoint — so nothing the 保存
 * button accepts can be rejected by the API.
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

/** The form's one numeric shape: a strictly positive integer, else null. */
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

/** Mirrors slaPolicyEditableRuleSchema, field by field. */
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
      // Validation ran first; a null here is a bug, and `?? 0` would ship it
      // to the server's schema instead of hiding it.
      checkpointHours: parsePositiveInt(draft.checkpointHours) as number,
      requiredCount: parsePositiveInt(draft.requiredCount) as number,
      advanceMinutes: parsePositiveInt(draft.advanceMinutes) as number,
    };
  }
  return { type: draft.type, intervalHours: parsePositiveInt(draft.intervalHours) as number };
}

export function SlaPolicyEditDialog({
  policy,
  onOpenChange,
}: {
  policy: SlaPolicyRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [firstResponseMinutes, setFirstResponseMinutes] = useState("");
  const [noOverdue, setNoOverdue] = useState(false);
  const [overdueHours, setOverdueHours] = useState("");
  const [rules, setRules] = useState<RuleDraft[]>([]);

  useEffect(() => {
    if (policy) {
      setFirstResponseMinutes(String(policy.firstResponseMinutes));
      setNoOverdue(policy.overdueHours === null);
      setOverdueHours(policy.overdueHours === null ? "" : String(policy.overdueHours));
      setRules(policy.reminderRules.map(draftFrom));
    }
  }, [policy]);

  const update = trpc.sla.update.useMutation({
    onSuccess: (result) => {
      toast.success(`已更新「${result.complaintLevel}」SLA 策略，即时生效`);
      utils.sla.list.invalidate();
      onOpenChange(false);
    },
  });

  const firstResponseError =
    parsePositiveInt(firstResponseMinutes) === null ? "需为正整数（分钟）" : undefined;
  const overdueError =
    !noOverdue && parsePositiveInt(overdueHours) === null ? "需为正整数（小时）" : undefined;
  const ruleErrors = rules.map(validateRule);
  const invalid =
    firstResponseError !== undefined ||
    overdueError !== undefined ||
    ruleErrors.some((errors) => Object.keys(errors).length > 0);
  const busy = update.isPending;

  function patchRule(key: number, patch: Partial<RuleDraft>) {
    setRules((current) => current.map((rule) => (rule.key === key ? { ...rule, ...patch } : rule)));
  }

  function save() {
    if (!policy || invalid) {
      return;
    }
    update.mutate({
      complaintLevel: policy.complaintLevel,
      firstResponseMinutes: parsePositiveInt(firstResponseMinutes) as number,
      overdueHours: noOverdue ? null : (parsePositiveInt(overdueHours) as number),
      reminderRules: rules.map(toReminderRule),
    });
  }

  return (
    <Dialog open={policy !== null} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[min(720px,90svh)] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>编辑 SLA 策略{policy ? `：${policy.complaintLevel}` : ""}</DialogTitle>
          <DialogDescription>
            保存即时生效：此后新建单按新超时计算处理时限，待办告警按新规则判定；存量工单的处理时限不变。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto pr-1">
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
                无提醒规则——该等级工单仅保留待首响与超时告警。
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
          <Button type="button" disabled={busy || invalid} onClick={save}>
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
