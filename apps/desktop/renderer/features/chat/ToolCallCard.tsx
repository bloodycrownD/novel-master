import type { ToolCallView } from "./message-blocks";
import {
  skillToolRef,
  toolCallSummary,
  vfsToolFilePath,
} from "./message-blocks";
import { dispatchOpenSettingsView } from "@/features/skills/skill-ui";
import {
  dispatchOpenToolResultView,
  toolResultViewFor,
} from "./ToolResultViewer";

type ToolCallCardProps = {
  tool: ToolCallView;
  /** 为 true 时展示完整 JSON 入参而非摘要。 */
  showFullParams?: boolean;
  /** ToolCallGroupCard 内的行内卡片。 */
  groupItem?: boolean;
  /** 工具含 VFS 文件路径时可点击打开 Preview。 */
  onOpenFile?: (path: string) => void;
  /** task 工具携带子会话 id 时可点击跳转只读子会话面板。 */
  onOpenSubagentSession?: (sessionId: string) => void;
  /** 当前会话项目 id；skill 卡片跳设置详情需要（project 域补全三元组）。 */
  projectId?: string;
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
  onOpenSubagentSession,
  projectId,
}: ToolCallCardProps) {
  const filePath = vfsToolFilePath(tool);
  const subagentSessionId = tool.subagentSessionId;
  const skillRef = skillToolRef(tool, projectId);
  const canOpenFile = filePath != null && onOpenFile != null;
  const canOpenSubagent =
    subagentSessionId != null && onOpenSubagentSession != null;
  const canOpenSkill = skillRef != null;
  // 结果阅读（search/curl/grep/glob）：正文在手即读，不依赖落盘文件——
  // 摆在跳转门控最后一级（这四个工具名不会命中文件/子会话/技能解析）。
  const resultView = toolResultViewFor(tool);
  const canOpen =
    canOpenFile || canOpenSubagent || canOpenSkill || resultView != null;
  const summary = toolCallSummary(tool);
  const detail = showFullParams
    ? JSON.stringify(tool.input, null, 2)
    : summary;

  const openHint = canOpenSubagent
    ? "点击查看 · 子智能体会话"
    : canOpenSkill
      ? "点击查看 · 技能"
      : resultView != null
        ? "点击查看 · 结果"
        : "点击查看 · 聊天工作区";

  const handleClick = () => {
    // 文件路径优先（同一张卡理论上不会同时具备多种入口，仍以文件优先兜底）
    if (canOpenFile && filePath != null) {
      onOpenFile!(filePath);
      return;
    }
    if (canOpenSubagent && subagentSessionId != null) {
      onOpenSubagentSession!(subagentSessionId);
      return;
    }
    if (canOpenSkill && skillRef != null) {
      // 跳设置技能详情页（App 监听事件开设置页 + 导航栈 push skillDetail）
      dispatchOpenSettingsView({ view: "skillDetail", skillRef });
      return;
    }
    if (resultView != null) {
      dispatchOpenToolResultView(resultView);
    }
  };

  const ariaLabel = canOpenFile
    ? `打开文件 ${filePath}`
    : canOpenSubagent
      ? `查看子智能体会话 ${subagentSessionId}`
      : canOpenSkill
        ? `查看技能 ${skillRef?.name}`
        : resultView != null
          ? `查看工具结果 ${tool.name}`
          : "";

  const content = (
    <>
      <div className="tool-call-card__header">
        <span className="tool-call-card__name">{tool.name}</span>
        <span className={`tool-call-card__status tool-call-card__status--${tool.status}`}>
          {statusLabel(tool.status)}
        </span>
      </div>
      {detail ? <p className="tool-call-card__summary">{detail}</p> : null}
      {canOpen ? <p className="tool-call-card__open-hint">{openHint}</p> : null}
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
        aria-label={ariaLabel}
        onClick={handleClick}
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
