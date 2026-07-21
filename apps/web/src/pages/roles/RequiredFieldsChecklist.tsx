import { TICKET_FIELDS, type TicketCreateFieldKey } from "@insuredesk/shared";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * 建单必填字段清单：勾选列表按表单分组排列。
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
          {["feedbackTime", "channelId"].map((field) => (
            <div key={field} className="flex items-start gap-2 text-sm">
              <Checkbox
                id={`required-field-${field}`}
                className="mt-0.5"
                checked={selected.has(field)}
                disabled={disabled}
                onCheckedChange={(checked) => toggle(field, checked === true)}
              />
              <label htmlFor={`required-field-${field}`} className="cursor-pointer">
                {TICKET_FIELDS[field as TicketCreateFieldKey].label}
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
            "policyNumbers",
            "userComplaintChannel",
            "complaintReceiveChannel",
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
                {TICKET_FIELDS[field as TicketCreateFieldKey].label}
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
            "contactTime",
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
                {TICKET_FIELDS[field as TicketCreateFieldKey].label}
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">分类与等级</legend>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {["categoryId", "complaintLevel", "priority"].map((field) => (
            <div key={field} className="flex items-start gap-2 text-sm">
              <Checkbox
                id={`required-field-${field}`}
                className="mt-0.5"
                checked={selected.has(field)}
                disabled={disabled}
                onCheckedChange={(checked) => toggle(field, checked === true)}
              />
              <label htmlFor={`required-field-${field}`} className="cursor-pointer">
                {TICKET_FIELDS[field as TicketCreateFieldKey].label}
              </label>
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
