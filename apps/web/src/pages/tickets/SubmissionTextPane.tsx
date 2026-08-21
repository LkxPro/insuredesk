export function SubmissionTextPane({ text }: { text: string }) {
  return (
    <div className="flex flex-col xl:min-h-0">
      <h3 className="m-0 shrink-0 border-b px-4 py-3 text-sm font-medium text-muted-foreground">
        工单原文
      </h3>
      <div className="p-4 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
        <pre className="m-0 whitespace-pre-wrap text-sm">{text}</pre>
      </div>
    </div>
  );
}
