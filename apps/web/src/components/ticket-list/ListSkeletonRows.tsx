import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

/** Layout-shaped placeholder rows while the list query is in flight. */
export function ListSkeletonRows({ columnCount }: { columnCount: number }) {
  const cells = Array.from({ length: columnCount }, (_, index) => index);
  return (
    <>
      {[0, 1, 2, 3, 4].map((row) => (
        <TableRow key={row}>
          {cells.map((cell) => (
            <TableCell key={cell}>
              <Skeleton className="h-4 w-full max-w-24" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
