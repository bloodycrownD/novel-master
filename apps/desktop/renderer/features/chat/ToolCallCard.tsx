import type { ToolCallView } from "./message-blocks";
import { toolCallSummary } from "./message-blocks";

type ToolCallCardProps = {
  tool: ToolCallView;
  /** When true, show full JSON input instead of summary. */
  showFullParams?: boolean;
  /** Inline row inside ToolCallGroupCard. */
  groupItem?: boolean;
};

function statusLabel(status: ToolCallView["status"]): string {
  switch (status) {
    case "success":
      return "成功";
    case "error":
      return "失败";
    case "pending":
      return "执行中…";
    default:
      return "进行中";
  }
}

export function ToolCallCard({
  tool,
  showFullParams,
  groupItem = false,
}: ToolCallCardProps) {
  const summary = toolCallSummary(tool);
  const detail = showFullParams
    ? JSON.stringify(tool.input, null, 2)
    : summary;

  return (
    <div
      className={`tool-call-card tool-call-card--${tool.status}${groupItem ? " tool-call-card--group-item" : ""}`}
      data-tool-use-id={tool.toolUseId}
    >
      <div className="tool-call-card__header">
        <span className="tool-call-card__name">{tool.name}</span>
        <span className={`tool-call-card__status tool-call-card__status--${tool.status}`}>
          {tool.status === "pending" ? (
            <span className="tool-call-card__spinner" aria-hidden="true" />
          ) : null}
          {statusLabel(tool.status)}
        </span>
      </div>
      {detail ? <p className="tool-call-card__summary">{detail}</p> : null}
    </div>
  );
}
