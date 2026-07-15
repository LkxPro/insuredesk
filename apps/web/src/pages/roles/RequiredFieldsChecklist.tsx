import { Checkbox } from "@/components/ui/checkbox";
import type { TicketCreateFieldKey } from "@insuredesk/shared";

const FIELD_LABELS: Record<TicketCreateFieldKey, string> = {
  feedbackTime: "反馈时间",
  channel: "业务渠道",
  project: "项目名称",
  brokerageEntity: "经纪主体",
  paymentChannel: "支付渠道",
  internalOrderNumber: "内部工单号",
  policyNumber: "保单号",
  userComplaintChannel: "用户投诉渠道",
  customerName: "客户姓名",
  phone: "手机号",
  contactPhone: "联系电话",
  customerRequest: "客户诉求",
  nuclearBodyStatus: "保司侧是否核身",
  hasContacted: "是否已联系",
  contactId: "联系人ID",
  category: "分类",
  complaintLevel: "投诉等级",
  priority: "优先级",
};

/**
 * 建单必填字段清单：17 个字段的勾选列表，按表单分组排列。
 * 必填集保存在 Role 上，建单时从会话载荷读取并动态生成校验。
 */
export function RequiredFieldsChecklist({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly string[];
  onChange?: (next: TicketCreateFieldKey[]) => void;
  disabled?: boolean;
}) {
  const selected = new Set(value);

  function toggle(field: string, checked: boolean) {
    if (!onChange) {
      return;
    }
    const next = new Set(selected);
    if (checked) {
      next.add(field);
    } else {
      next.delete(field);
    }
    onChange([...next] as TicketCreateFieldKey[]);
  }

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">来源与渠道</legend>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {["feedbackTime", "channel"].map((field) => (
            <div key={field} className="flex items-start gap-2 text-sm">
              <Checkbox
                id={`required-field-${field}`}
                className="mt-0.5"
                checked={selected.has(field)}
                disabled={disabled}
                onCheckedChange={(checked) => toggle(field, checked === true)}
              />
              <label htmlFor={`required-field-${field}`} className="cursor-pointer">
                {FIELD_LABELS[field as TicketCreateFieldKey]}
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">业务信息</legend>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {[
            "project",
            "brokerageEntity",
            "paymentChannel",
            "internalOrderNumber",
            "policyNumber",
            "userComplaintChannel",
          ].map((field) => (
            <div key={field} className="flex items-start gap-2 text-sm">
              <Checkbox
                id={`required-field-${field}`}
                className="mt-0.5"
                checked={selected.has(field)}
                disabled={disabled}
                onCheckedChange={(checked) => toggle(field, checked === true)}
              />
              <label htmlFor={`required-field-${field}`} className="cursor-pointer">
                {FIELD_LABELS[field as TicketCreateFieldKey]}
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">客户信息</legend>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {[
            "customerName",
            "phone",
            "contactPhone",
            "nuclearBodyStatus",
            "customerRequest",
            "hasContacted",
            "contactId",
          ].map((field) => (
            <div key={field} className="flex items-start gap-2 text-sm">
              <Checkbox
                id={`required-field-${field}`}
                className="mt-0.5"
                checked={selected.has(field)}
                disabled={disabled}
                onCheckedChange={(checked) => toggle(field, checked === true)}
              />
              <label htmlFor={`required-field-${field}`} className="cursor-pointer">
                {FIELD_LABELS[field as TicketCreateFieldKey]}
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">分类与等级</legend>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {["category", "complaintLevel", "priority"].map((field) => (
            <div key={field} className="flex items-start gap-2 text-sm">
              <Checkbox
                id={`required-field-${field}`}
                className="mt-0.5"
                checked={selected.has(field)}
                disabled={disabled}
                onCheckedChange={(checked) => toggle(field, checked === true)}
              />
              <label htmlFor={`required-field-${field}`} className="cursor-pointer">
                {FIELD_LABELS[field as TicketCreateFieldKey]}
              </label>
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
