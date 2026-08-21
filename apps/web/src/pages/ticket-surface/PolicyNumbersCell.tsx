import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Unknown } from "./Unknown";

export function PolicyNumbersCell({
  policyNumbers,
  noPolicyNumber,
}: {
  policyNumbers: readonly string[];
  noPolicyNumber?: boolean;
}) {
  if (noPolicyNumber) {
    return <span className="text-muted-foreground">无</span>;
  }
  if (policyNumbers.length === 0) {
    return <Unknown />;
  }
  const [first, ...rest] = policyNumbers;
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {first}
      {rest.length > 0 && (
        <Popover>
          {/* stopPropagation: 展开保单号不应顺带打开行详情 */}
          <PopoverTrigger asChild onClick={(event) => event.stopPropagation()}>
            <Badge
              asChild
              variant="secondary"
              className="cursor-pointer tabular-nums"
              aria-label={`还有 ${rest.length} 个保单号`}
            >
              <button type="button">+{rest.length}</button>
            </Badge>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-auto max-w-72 p-2"
            onClick={(event) => event.stopPropagation()}
          >
            <ul className="flex flex-col gap-1 text-sm">
              {policyNumbers.map((policyNumber) => (
                <li key={policyNumber} className="break-all">
                  {policyNumber}
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}
