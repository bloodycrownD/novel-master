import type { ToolCallView } from "./message-blocks";
import { ToolCallCard } from "./ToolCallCard";

type ToolCallGroupCardProps = {
  tools: readonly ToolCallView[];
  dimmed?: boolean;
};

export function ToolCallGroupCard({
  tools,
  dimmed = false,
}: ToolCallGroupCardProps) {
  if (tools.length === 0) {
    return null;
  }

  return (
    <details
      className={`chat-message__tool-group${dimmed ? " chat-message__tool-group--dimmed" : ""}`}
    >
      <summary>工具调用 ({tools.length})</summary>
      <div className="chat-message__tool-group-items">
        {tools.map((tool) => (
          <ToolCallCard key={tool.toolUseId} tool={tool} groupItem />
        ))}
      </div>
    </details>
  );
}
