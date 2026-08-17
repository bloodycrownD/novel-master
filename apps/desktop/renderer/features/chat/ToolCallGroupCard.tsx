import type { ToolCallView } from "./message-blocks";
import { ToolCallCard } from "./ToolCallCard";

type ToolCallGroupCardProps = {
  tools: readonly ToolCallView[];
  dimmed?: boolean;
  /** 当前会话项目 id；透传给 skill_opt 卡片解析 project 域三元组。 */
  projectId?: string;
  onOpenFile?: (path: string) => void;
  onOpenSubagentSession?: (sessionId: string) => void;
};

export function ToolCallGroupCard({
  tools,
  dimmed = false,
  projectId,
  onOpenFile,
  onOpenSubagentSession,
}: ToolCallGroupCardProps) {
  if (tools.length === 0) {
    return null;
  }

  return (
    <details className={`chat-message__tool-group${dimmed ? " chat-message__tool-group--dimmed" : ""}`}>
      <summary>工具调用 ({tools.length})</summary>
      <div className="chat-message__tool-group-items">
        {tools.map((tool) => (
          <ToolCallCard
            key={tool.toolUseId}
            tool={tool}
            groupItem
            projectId={projectId}
            onOpenFile={onOpenFile}
            onOpenSubagentSession={onOpenSubagentSession}
          />
        ))}
      </div>
    </details>
  );
}
