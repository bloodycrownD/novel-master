import type { ToolCallView } from "./message-blocks";
import { toolCallSummary, vfsToolFilePath } from "./message-blocks";

type ToolCallCardProps = {
  tool: ToolCallView;
  /** 为 true 时展示完整 JSON 入参而非摘要。 */
  showFullParams?: boolean;
  /** ToolCallGroupCard 内的行内卡片。 */
  groupItem?: boolean;
  /** 工具含 VFS 文件路径时可点击打开 Preview。 */
  onOpenFile?: (path: string) => void;
};

function statusLabel(status: ToolCallView["status"]): string {
  switch (status) {
    case "success":
      return "成功";
    case "error":
      return "失败";
    case "pending":
      return "执行中";
    case "interrupted":
      return "已中断";
    default:
      return "";
  }
}

export function ToolCallCard({
  tool,
  showFullParams,
  groupItem = false,
  onOpenFile,
}: ToolCallCardProps) {
  const filePath = vfsToolFilePath(tool);
  const canOpen = filePath != null && onOpenFile != null;
  const summary = toolCallSummary(tool);
  const detail = showFullParams
    ? JSON.stringify(tool.input, null, 2)
    : summary;

  const content = (
    <>
      <div className="tool-call-card__header">
        <span className="tool-call-card__name">{tool.name}</span>
        <span className={`tool-call-card__status tool-call-card__status--${tool.status}`}>
          {statusLabel(tool.status)}
        </span>
      </div>
      {detail ? <p className="tool-call-card__summary">{detail}</p> : null}
      {canOpen ? (
        <p className="tool-call-card__open-hint">点击查看 · 聊天工作区</p>
      ) : null}
    </>
  );

  const className = [
    "tool-call-card",
    `tool-call-card--${tool.status}`,
    groupItem ? "tool-call-card--group-item" : "",
    canOpen ? "tool-call-card--clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (canOpen) {
    return (
      <button
        type="button"
        className={className}
        data-tool-use-id={tool.toolUseId}
        aria-label={`打开文件 ${filePath}`}
        onClick={() => onOpenFile(filePath)}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={className} data-tool-use-id={tool.toolUseId}>
      {content}
    </div>
  );
}
