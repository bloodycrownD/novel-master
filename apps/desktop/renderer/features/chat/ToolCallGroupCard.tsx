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

  const hasPending = tools.some((tool) => tool.status === "pending");

  return (
    <details
      className={`chat-message__tool-group${dimmed ? " chat-message__tool-group--dimmed" : ""}`}
      {...(hasPending ? { open: true } : {})}
    >
      <summary>
        工具调用 ({tools.length}){hasPending ? " · 执行中" : ""}
      </summary>
      <div className="chat-message__tool-group-items">
        {tools.map((tool) => (
          <ToolCallCard key={tool.toolUseId} tool={tool} groupItem />
        ))}
      </div>
    </details>
  );
}
