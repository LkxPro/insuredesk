export function SectionHeader({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}
