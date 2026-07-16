import { PERMISSION_GROUPS, PERMISSION_LABELS, type Permission } from "@insuredesk/shared";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * The 权限点清单 as grouped checkboxes — the single configuration surface
 * for 角色权限. Groups follow the PRD's five sections; each entry shows the
 * Chinese label plus the raw permission point so the checklist maps 1:1 onto
 * the PRD table. Renders read-only for the 管理员 system role and for viewers
 * without role.edit_permission.
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
      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.label} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{group.label}</legend>
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
