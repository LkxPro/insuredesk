import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";

type RoleOption = { id: string; external: boolean };

/** Whether the picked role needs an 所属外部机构, per the role picker's payload. */
export function isExternalRoleOption(
  roleOptions: RoleOption[] | undefined,
  roleId: string,
): boolean {
  return (roleOptions ?? []).some((role) => role.id === roleId && role.external);
}

/**
 * 所属外部机构 picker, shared by the three 用户管理 dialogs. Rendered only while
 * the account's role holds an external permission point — the API refuses an
 * org on an internal role, so offering the field there would be a dead end.
 *
 * Disabled orgs stay selectable when the account is already bound to one
 * (dropping the selection would be the only way to save an unrelated edit),
 * but are never offered as a fresh pick.
 */
export function ExternalOrgField({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const orgOptions = trpc.user.externalOrgOptions.useQuery();
  const options = (orgOptions.data ?? []).filter((org) => org.active || org.id === value);

  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>所属外部机构</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full" disabled={orgOptions.isLoading}>
          <SelectValue placeholder="请选择外部机构" />
        </SelectTrigger>
        <SelectContent>
          {options.map((org) => (
            <SelectItem key={org.id} value={org.id}>
              {org.name}
              {!org.active && "（已停用）"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>外部角色账号只能看到本机构提交的工单。</FieldDescription>
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}
