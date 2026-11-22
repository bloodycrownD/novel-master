import { ToolSummary } from "@shared/logic/chat";
import { coreT } from "@shared/logic/core-i18n";
import type { ToolCallView } from "./message-blocks";
import { skillToolRef, vfsToolFilePath } from "./message-blocks";
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
            return coreT({key: "ui.transcript.tool_status.success"});
        case "error":
            return coreT({key: "ui.transcript.tool_status.error"});
        case "pending":
            return coreT({key: "ui.transcript.tool_status.pending"});
        case "interrupted":
            return coreT({key: "ui.transcript.tool_status.interrupted"});
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
    const canOpenSubagent = subagentSessionId != null && onOpenSubagentSession != null;
    const canOpenSkill = skillRef != null;
    // 结果阅读兜底：正文在手即读（任何工具通用），摆在跳转门控最后一级——
    // 文件/子会话/技能的专属跳转优先，其余（fs/agent/search/…）点了至少
    // 有反应，进阅读页看工具返回全文。
    const resultView = toolResultViewFor(tool);
    const canOpen = canOpenFile || canOpenSubagent || canOpenSkill || resultView != null;
    // 工具卡摘要（原 toolCallSummary 内联）：失败取首行截断；否则 core 输入摘要；再退 resultContent 截断。
    const summary = (() => {
        if (tool.status === "error" && tool.summary) {
            // 失败摘要只取首行（搜索链聚合错误等多行诊断全文见工具详情），
            // 超长按与成功摘要同档截断，卡片不被整段报错撑开。
            const firstLine = tool.summary.split("\n")[0]?.trim() ?? "";
            return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
        }
        const fromInput = ToolSummary.summarizeInput(tool.name, tool.input);
        if (fromInput) {
            return fromInput;
        }
        if (tool.resultContent) {
            const t = tool.resultContent.trim();
            return t.length > 120 ? `${t.slice(0, 117)}…` : t;
        }
        return "";
    })();
    const detail = showFullParams ? JSON.stringify(tool.input, null, 2) : summary;

    const openHint = canOpenSubagent ? coreT({key: "ui.transcript.open_hint", params: {kind: coreT({key: "ui.transcript.open_kind.subagent"})}}) : canOpenSkill ? coreT({key: "ui.transcript.open_hint", params: {kind: coreT({key: "ui.transcript.open_kind.skill"})}}) : resultView != null ? coreT({key: "ui.transcript.open_hint", params: {kind: coreT({key: "ui.transcript.open_kind.result"})}}) : coreT({key: "ui.transcript.open_hint", params: {kind: coreT({key: "ui.transcript.open_kind.workspace"})}});

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

    const ariaLabel = canOpenFile ? coreT({key: "ui.chat.open_file_aria", params: {path: filePath}}) : canOpenSubagent ? coreT({key: "ui.chat.view_subagent_aria", params: {id: subagentSessionId}}) : canOpenSkill ? coreT({key: "ui.chat.view_skill_aria", params: {name: skillRef?.name}}) : resultView != null ? coreT({key: "ui.chat.view_result_aria", params: {name: tool.name}}) : "";

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
