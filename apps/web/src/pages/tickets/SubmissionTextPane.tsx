/**
 * 编辑态工单原文对照面板：右栏自动从时间线切换为原文（大段可滚动），客服一边
 * 看右栏原文一边补全左栏表单。只在外部件（source=external_channel）且
 * submissionText 非空时渲染。
 */
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
