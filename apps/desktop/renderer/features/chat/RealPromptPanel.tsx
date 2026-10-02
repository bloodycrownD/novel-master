/**
 * 真实提示词查看面板（desktop，prompt-rounds）。
 *
 * 数据是「轮」数组（core `buildPromptPreviewTurnsFromLayout`）：模板段各占一轮、
 * 真用户输入开新轮、其余消息段归入当前 assistant 轮。
 *
 * - template / user 轮：按段渲染原 `.prompt-segment` 折叠卡片（user 轮可多段顺序展示）；
 * - assistant 轮：渲染摘要卡（role 标「assistant 轮」+ core 侧钉死的 summary +
 *   chevron），点击开**详情 Modal**（详情数据即 `turn.body`，只读 CodeEditor）。
 *
 * payload 口径：assistant 轮的 `items` 不走 IPC（见 shared/ipc-types 注释），
 * 所以这里对 assistant 轮不做段展开。
 */
import { useCallback, useEffect, useState } from "react";
import type {
  PromptPreviewSegmentDto,
  PromptPreviewTurnDto,
} from "@shared/ipc-types";
import { PROMPT_REGION_LABELS } from "@shared/logic/config-forms-agent";
import { ipcPromptRealPreview } from "@/ipc/client";
import { Button } from "@/components/ui/Button";
import { CodeEditor } from "@/components/ui/CodeEditor";

interface RealPromptPanelProps {
  projectId: string;
  sessionId: string;
  visible: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  system: PROMPT_REGION_LABELS.system,
  user: "用户",
  assistant: "助手",
  tool: "工具结果",
  tool_call: "工具调用",
  thinking: "思考",
};

/** assistant 轮的 role 标签（不是消息角色，是「轮」这一层）。 */
const ASSISTANT_TURN_LABEL = "assistant 轮";

function segmentTitleLabel(title: string): string {
  if (title === "system") {
    return PROMPT_REGION_LABELS.system;
  }
  if (title === "skills") {
    return PROMPT_REGION_LABELS.skills;
  }
  return title;
}

function previewLine(body: string): string {
  const line = body.replace(/\r\n/g, "\n").split("\n")[0]?.trim() ?? "";
  if (line.length === 0) {
    return "空内容";
  }
  if (line.length <= 72) {
    return line;
  }
  return `${line.slice(0, 69)}…`;
}

function collapsedHint(body: string): string {
  const charCount = body.length;
  const hint = charCount === 0 ? "空内容" : previewLine(body);
  const countSuffix = charCount > 0 ? ` · ${charCount} 字` : "";
  return `${hint}${countSuffix}`;
}

export function RealPromptPanel({
  projectId,
  sessionId,
  visible,
}: RealPromptPanelProps) {
  const [turns, setTurns] = useState<PromptPreviewTurnDto[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // 详情 Modal 打开中的 assistant 轮（null = 未打开）。
  const [detailTurn, setDetailTurn] = useState<PromptPreviewTurnDto | null>(
    null,
  );

  const load = useCallback(async () => {
    const result = await ipcPromptRealPreview({ projectId, sessionId });
    if (result.ok) {
      setTurns(result.data);
    }
  }, [projectId, sessionId]);

  useEffect(() => {
    if (visible) {
      void load();
    }
  }, [visible, load]);

  const closeDetail = useCallback(() => setDetailTurn(null), []);

  // Esc 关闭详情 Modal。CodeEditor 内部已消费的 Esc（defaultPrevented）不拦截。
  useEffect(() => {
    if (detailTurn == null) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        setDetailTurn(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [detailTurn]);

  if (!visible) {
    return null;
  }

  const renderSegmentCard = (segment: PromptPreviewSegmentDto) => {
    const open = expanded[segment.id] ?? false;
    const roleLabel = ROLE_LABELS[segment.role] ?? segment.role;
    return (
      <div
        key={segment.id}
        className={`prompt-segment${open ? " is-expanded" : ""}`}
        data-segment-id={segment.id}
      >
        <button
          type="button"
          className="prompt-segment__header"
          aria-expanded={open}
          onClick={() =>
            setExpanded((prev) => ({ ...prev, [segment.id]: !open }))
          }
        >
          <span className="prompt-segment__text">
            <span className="prompt-segment__role">{roleLabel}</span>
            <span className="prompt-segment__title">
              {segmentTitleLabel(segment.title)}
            </span>
            <span className="prompt-segment__preview">
              {collapsedHint(segment.body)}
            </span>
          </span>
          <span className="prompt-segment__chevron" aria-hidden="true">
            {open ? "▼" : "▶"}
          </span>
        </button>
        <pre className="prompt-segment__body">{segment.body || "（空）"}</pre>
      </div>
    );
  };

  return (
    <div className="real-prompt-list" id="real-prompt-list">
      {turns.map((turn) => {
        if (turn.kind === "assistant") {
          return (
            <div
              key={turn.id}
              className="prompt-segment prompt-turn-card"
              data-turn-id={turn.id}
            >
              <button
                type="button"
                className="prompt-segment__header"
                aria-label={`查看 ${ASSISTANT_TURN_LABEL} 详情`}
                onClick={() => setDetailTurn(turn)}
              >
                <span className="prompt-segment__text">
                  <span className="prompt-segment__role">
                    {ASSISTANT_TURN_LABEL}
                  </span>
                  <span className="prompt-segment__preview">
                    {turn.summary}
                  </span>
                </span>
                <span className="prompt-segment__chevron" aria-hidden="true">
                  ▶
                </span>
              </button>
            </div>
          );
        }
        // template / user 轮按段顺序展示；单段轮（template 恒为单段）不加轮壳，
        // 视觉与原 segment 卡片完全一致。
        const items = turn.items ?? [];
        if (items.length <= 1) {
          return items.map(renderSegmentCard);
        }
        return (
          <div
            key={turn.id}
            className={`prompt-turn prompt-turn--${turn.kind}`}
            data-turn-id={turn.id}
          >
            {items.map(renderSegmentCard)}
          </div>
        );
      })}
      <p className="real-prompt-hint">
        在会话工作区调整纳入规则可改变预览内容。默认折叠以减轻长文本渲染压力。
      </p>
      {detailTurn != null ? (
        <div className="text-prompt-overlay" onClick={closeDetail}>
          <div
            className="prompt-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${ASSISTANT_TURN_LABEL}详情`}
            onClick={(e) => e.stopPropagation()}
          >
            <CodeEditor
              readOnly
              value={detailTurn.body ?? ""}
              languagePath="prompt.txt"
              aria-label={`${ASSISTANT_TURN_LABEL}详情`}
            />
            <div className="prompt-editor-modal__footer">
              <Button variant="secondary" onClick={closeDetail}>
                关闭
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
