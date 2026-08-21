import {
  MANAGEMENT_PERMISSION_GROUPS,
  PERMISSION_LABELS,
  type Permission,
} from "@insuredesk/shared";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Restrictive groups carry 勾选=禁止 semantics — the inverse of every other
 * checkbox — so they must stay visually marked.
 */
export function PermissionChecklist({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly Permission[];
  onChange?: (next: Permission[]) => void;
  disabled?: boolean;
}) {
  const selected = new Set(value);

  function toggle(permission: Permission, checked: boolean) {
    if (!onChange) {
      return;
    }
    const next = new Set(selected);
    if (checked) {
      next.add(permission);
    } else {
      next.delete(permission);
    }
    onChange([...next]);
  }

  return (
    <div className="flex flex-col gap-5">
      {MANAGEMENT_PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.label} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">
            {group.label}
            {group.restrictive && (
              <span className="ml-2 text-xs font-normal text-destructive">
                勾选 = 禁止该操作，与其他权限相反
              </span>
            )}
          </legend>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {group.permissions.map((permission) => (
              <div key={permission} className="flex items-start gap-2 text-sm">
                <Checkbox
                  id={`permission-${permission}`}
                  className="mt-0.5"
                  checked={selected.has(permission)}
                  disabled={disabled}
                  onCheckedChange={(checked) => toggle(permission, checked === true)}
                />
                <label
                  htmlFor={`permission-${permission}`}
                  className="flex cursor-pointer flex-col"
                >
                  {PERMISSION_LABELS[permission]}
                  <span className="font-mono text-xs text-muted-foreground">{permission}</span>
                </label>
              </div>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
