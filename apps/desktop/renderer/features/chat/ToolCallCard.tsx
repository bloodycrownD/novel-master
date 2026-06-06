import type { ToolCallView } from "./message-blocks";
import { toolCallSummary } from "./message-blocks";

type ToolCallCardProps = {
  tool: ToolCallView;
};

function statusLabel(status: ToolCallView["status"]): string {
  switch (status) {
    case "success":
      return "成功";
    case "error":
      return "失败";
    default:
      return "进行中";
  }
}

export function ToolCallCard({ tool }: ToolCallCardProps) {
  const summary = toolCallSummary(tool);

  return (
    <div
      className={`tool-call-card tool-call-card--${tool.status}`}
      data-tool-use-id={tool.toolUseId}
    >
      <div className="tool-call-card__header">
        <span className="tool-call-card__name">{tool.name}</span>
        <span className={`tool-call-card__status tool-call-card__status--${tool.status}`}>
          {statusLabel(tool.status)}
        </span>
      </div>
      {summary ? <p className="tool-call-card__summary">{summary}</p> : null}
    </div>
  );
}
