/**
 * 真实提示词查看面板（desktop，prompt-rounds）。
 *
 * 数据是「轮」数组（core `buildPromptPreviewTurnsFromLayout`）：模板段各占一轮、
 * 真用户输入开新轮、其余消息段归入当前 assistant 轮。
 *
 * - template / user 轮：按 `cards` 渲染原 `.prompt-segment` 折叠卡片；
 * - assistant 轮：渲染摘要卡（role 标「assistant 轮」+ core 侧钉死的 summaryText +
 *   chevron），点击开**详情 Modal**（只读 CodeEditor，正文由 `cards` 逐卡拼出）。
 *
 * payload 口径：`cards` 是唯一正文载体，`body` / `items` 已从 DTO 退役
 * （见 shared/ipc-types.ts 体积策略注释）。
 *
 * ⚠️ 本文件目前只是「按新 DTO 编译通过」的最小适配：卡片流的三态展开、组卡/叶子卡、
 * 全屏富文本（`MermaidMarkdown`）等 UI 重设计由 prompt-preview-ui-redesign Step 6 落地。
 */
import { useCallback, useEffect, useState } from "react";
import type {
  PromptPreviewTurnDto,
  PromptTurnCardDto,
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

/** 悬挂 tool_use（无 result）的详情占位文案。 */
const LOST_RESULT_PLACEHOLDER = "（未返回结果）";

/**
 * 卡片 → 详情正文（CodeEditor 的 `value`）。
 *
 * cards 是唯一正文载体，Modal 直接逐卡拼出可读全文；Step 6 会换成
 * `MermaidMarkdown` 富文本流，这里先保住「只读、无 onChange」的既有语义。
 */
function cardsToDetailText(cards: readonly PromptTurnCardDto[]): string {
  return cards
    .map((card) =>
      card.type === "toolGroup"
        ? [card.inputJson, card.result?.body ?? LOST_RESULT_PLACEHOLDER].join(
            "\n\n",
          )
        : card.body,
    )
    .filter((text) => text !== "")
    .join("\n\n");
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

  const renderCard = (card: PromptTurnCardDto) => {
    const open = expanded[card.id] ?? false;
    // toolGroup 卡在 template / user 轮不会出现（core 只在 assistant 轮产出），
    // 这里仍按联合类型收窄取展示标签与正文，避免 `any` 逃逸。
    const label =
      card.type === "toolGroup" ? card.toolName : (ROLE_LABELS[card.role] ?? card.role);
    const title =
      card.type === "toolGroup" ? card.toolName : segmentTitleLabel(card.role);
    const body =
      card.type === "toolGroup"
        ? cardsToDetailText([card])
        : card.body;
    return (
      <div
        key={card.id}
        className={`prompt-segment${open ? " is-expanded" : ""}`}
        data-card-id={card.id}
      >
        <button
          type="button"
          className="prompt-segment__header"
          aria-expanded={open}
          onClick={() =>
            setExpanded((prev) => ({ ...prev, [card.id]: !open }))
          }
        >
          <span className="prompt-segment__text">
            <span className="prompt-segment__role">{label}</span>
            <span className="prompt-segment__title">{title}</span>
            <span className="prompt-segment__preview">
              {collapsedHint(body)}
            </span>
          </span>
          <span className="prompt-segment__chevron" aria-hidden="true">
            {open ? "▼" : "▶"}
          </span>
        </button>
        <pre className="prompt-segment__body">{body || "（空）"}</pre>
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
                    {turn.summaryText}
                  </span>
                </span>
                <span className="prompt-segment__chevron" aria-hidden="true">
                  ▶
                </span>
              </button>
            </div>
          );
        }
        // template / user 轮按卡片顺序展示；单卡轮不加轮壳，视觉与单张卡片一致。
        const cards = turn.cards;
        if (cards.length <= 1) {
          return cards.map(renderCard);
        }
        return (
          <div
            key={turn.id}
            className={`prompt-turn prompt-turn--${turn.kind}`}
            data-turn-id={turn.id}
          >
            {cards.map(renderCard)}
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
              value={cardsToDetailText(detailTurn.cards)}
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
