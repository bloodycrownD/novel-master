/**
 * 真实提示词查看面板（desktop，prompt-rounds）：三层结构。
 *
 * 1. 收起的**轮摘要卡**——role 徽标（user 青 / assistant 紫 / template 灰）+
 *    `summaryText` 单行截断 + `metaText` 计数行 + `⤢` 整轮全屏；点头部就地展开/收起；
 * 2. 展开区的**嵌套卡片流**——文本/thinking 叶子卡 + 工具组卡（组头状态点三态，
 *    组内 use/result 两格各可点开全屏）；
 * 3. **全屏只读富文本**——复用 `.text-prompt-overlay` / `.prompt-editor-modal` 壳，
 *    正文容器 `.prompt-fullscreen__body` 内跑 `MermaidMarkdown`（只读，不接 onLinkClick；
 *    `CodeEditor` 已从本面板退役）。
 *
 * 数据是「轮」数组（core `buildPromptPreviewTurnsFromLayout`），`cards` 是唯一正文
 * 载体，`body` / `items` / `summary` 已从 DTO 退役（见 shared/ipc-types.ts 体积策略）。
 *
 * 展开态是**受控 map**（轮 key = `turn.id`，组卡 key = `${turn.id}::${card.id}`）：
 * 长会话一次只留需要看的展开区，重渲染不丢态。
 */
import { useCallback, useEffect, useState } from "react";
import type {
  PromptPreviewTurnDto,
  PromptTextCardDto,
  PromptTurnCardDto,
} from "@shared/ipc-types";
import { ipcPromptRealPreview } from "@/ipc/client";
import { Button } from "@/components/ui/Button";
import { MermaidMarkdown } from "@/components/MermaidMarkdown";
import { PromptLeafCard, promptLeafKindLabel } from "./PromptLeafCard";
import {
  PromptToolGroupCard,
  toolGroupLeaves,
  type ToolGroupLeaf,
} from "./PromptToolGroupCard";

interface RealPromptPanelProps {
  projectId: string;
  sessionId: string;
  visible: boolean;
}

/** 轮层 role 徽标文案（不是消息角色，是「轮」这一层）。 */
const TURN_ROLE_LABELS: Record<PromptPreviewTurnDto["kind"], string> = {
  user: "user",
  assistant: "assistant",
  template: "template",
};

/**
 * 轮层徽标配色（语义色，不随主题变），对齐设计基准 demo：
 * user 青 / assistant 紫 / template 中性灰。
 */
const TURN_ROLE_COLORS: Record<PromptPreviewTurnDto["kind"], string> = {
  user: "#2dd4bf",
  assistant: "#a78bfa",
  template: "#9ca3af",
};

/** 空正文在全屏里的占位文案。 */
const EMPTY_TEXT_PLACEHOLDER = "（空）";

/** 全屏 Modal 的内容来源：整轮（cards 逐卡富文本流）或某个叶子（单份正文）。 */
interface FullscreenTarget {
  /** Modal 标题（轮摘要 / 叶子标签）。 */
  title: string;
  /** 整轮 = 逐卡富文本流；叶子 = 单份正文。 */
  blocks: readonly string[];
}

/** 轮内一张卡的正文（组卡两格都进正文流，忠实还原发给模型的内容）。 */
function cardBodies(card: PromptTurnCardDto): string[] {
  return card.type === "toolGroup"
    ? toolGroupLeaves(card).map((leaf) => leaf.body)
    : [card.body];
}

export function RealPromptPanel({
  projectId,
  sessionId,
  visible,
}: RealPromptPanelProps) {
  const [turns, setTurns] = useState<PromptPreviewTurnDto[]>([]);
  // 展开态 map：轮卡 key = turn.id，组卡 key = `${turn.id}::${card.id}`。
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // 全屏 Modal 打开中的内容（null = 未打开）。
  const [fullscreen, setFullscreen] = useState<FullscreenTarget | null>(null);

  const load = useCallback(async () => {
    const result = await ipcPromptRealPreview({ projectId, sessionId });
    if (result.ok) {
      // 归一化 `cards` 兜底：Electron dev 下 renderer 会 HMR 而 main 进程不重启，
      // 旧 main 下发的 payload 没有 `cards` 字段，裸读会在展开轮卡 / ⤢ 时抛
      // undefined（renderer 全仓无 ErrorBoundary，整页会卸载）。这里单点兜空数组。
      setTurns(result.data.map((turn) => ({ ...turn, cards: turn.cards ?? [] })));
    }
  }, [projectId, sessionId]);

  useEffect(() => {
    if (visible) {
      void load();
    }
  }, [visible, load]);

  // 换会话清展开态与全屏：core 的轮 id 是会话内相对的 `turn-${seq}`，切会话后
  // 上一会话的展开态会被新会话同 id 的轮「继承」（口径对齐 mobile 的 load 清空）。
  useEffect(() => {
    setExpanded({});
    setFullscreen(null);
  }, [projectId, sessionId]);

  const closeFullscreen = useCallback(() => setFullscreen(null), []);

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
  }, []);

  /** 整轮全屏：cards 逐卡一段富文本（无 `[段名]` 前缀，视觉分隔即可）。 */
  const openTurnFullscreen = useCallback((turn: PromptPreviewTurnDto) => {
    setFullscreen({
      title: `${TURN_ROLE_LABELS[turn.kind] ?? turn.kind} · ${turn.summaryText}`,
      blocks: turn.cards.flatMap(cardBodies).filter((text) => text !== ""),
    });
  }, []);

  /** 叶子卡全屏：该卡正文单份。 */
  const openLeafFullscreen = useCallback((card: PromptTextCardDto) => {
    setFullscreen({ title: promptLeafKindLabel(card), blocks: [card.body] });
  }, []);

  /** 组卡某一格全屏：该格正文单份。 */
  const openGroupLeafFullscreen = useCallback(
    (_cardId: string, leaf: ToolGroupLeaf) => {
      setFullscreen({ title: leaf.label, blocks: [leaf.body] });
    },
    [],
  );

  // Esc 关闭全屏 Modal。已被下游消费掉的 Esc（defaultPrevented）不拦截。
  useEffect(() => {
    if (fullscreen == null) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        setFullscreen(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [fullscreen]);

  if (!visible) {
    return null;
  }

  const renderCard = (card: PromptTurnCardDto, turnId: string) => {
    if (card.type === "toolGroup") {
      return (
        <PromptToolGroupCard
          key={card.id}
          card={card}
          expanded={expanded[`${turnId}::${card.id}`] ?? false}
          // 组卡 key 与读取侧同口径拼 `${turnId}::${cardId}`，否则展开态写进去读不出来。
          onToggle={(cardId) => toggleExpanded(`${turnId}::${cardId}`)}
          onOpenLeaf={openGroupLeafFullscreen}
        />
      );
    }
    return <PromptLeafCard key={card.id} card={card} onOpen={openLeafFullscreen} />;
  };

  return (
    <div className="real-prompt-list" id="real-prompt-list">
      {turns.map((turn) => {
        const open = expanded[turn.id] ?? false;
        const roleLabel = TURN_ROLE_LABELS[turn.kind] ?? turn.kind;
        const roleColor = TURN_ROLE_COLORS[turn.kind] ?? TURN_ROLE_COLORS.template;
        return (
          <div
            key={turn.id}
            className={`prompt-turn prompt-turn--${turn.kind} prompt-turn-card${open ? " is-expanded" : ""}`}
            data-turn-id={turn.id}
            data-turn-kind={turn.kind}
          >
            <div className="prompt-turn-card__head">
              <button
                type="button"
                className="prompt-turn-card__toggle"
                aria-expanded={open}
                aria-label={`${open ? "收起" : "展开"}${roleLabel}轮，${turn.summaryText.slice(0, 20)}`}
                onClick={() => toggleExpanded(turn.id)}
              >
                <span
                  className="prompt-turn-card__role"
                  style={{ color: roleColor }}
                  data-turn-kind={turn.kind}
                >
                  {roleLabel}
                </span>
                <span className="prompt-turn-card__summary">
                  {turn.summaryText}
                </span>
                <span className="prompt-segment__preview prompt-turn-card__meta">
                  {turn.metaText}
                </span>
              </button>
              <button
                type="button"
                className="prompt-turn-card__fullscreen"
                aria-label={`整轮全屏，${roleLabel} ${turn.summaryText.slice(0, 20)}`}
                data-action="turn-fullscreen"
                onClick={() => openTurnFullscreen(turn)}
              >
                ⤢
              </button>
              <span
                className="prompt-segment__chevron"
                aria-hidden="true"
                data-state={open ? "open" : "closed"}
              >
                {open ? "▼" : "▶"}
              </span>
            </div>
            {open ? (
              <div className="prompt-turn-card__body">
                {turn.cards.map((card) => renderCard(card, turn.id))}
              </div>
            ) : null}
          </div>
        );
      })}
      <p className="real-prompt-hint">
        在会话工作区调整纳入规则可改变预览内容。点轮卡头部就地展开，点 ⤢ 或任意卡片进入全屏阅读。
      </p>
      {fullscreen != null ? (
        <div className="text-prompt-overlay" onClick={closeFullscreen}>
          <div
            className="prompt-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${fullscreen.title}详情`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="prompt-fullscreen__title">{fullscreen.title}</div>
            <div className="prompt-fullscreen__body">
              {fullscreen.blocks.length === 0 ? (
                <p className="prompt-fullscreen__empty">{EMPTY_TEXT_PLACEHOLDER}</p>
              ) : (
                fullscreen.blocks.map((content, index) => (
                  // 同一轮里正文可能重复（两格同文），索引参与 key 保证唯一稳定。
                  <div
                    key={`${index}-${content.slice(0, 8)}`}
                    className="prompt-fullscreen__block"
                  >
                    {/* 只读富文本：不接 onLinkClick（预览侧不做链接路由）。 */}
                    <MermaidMarkdown content={content} />
                  </div>
                ))
              )}
            </div>
            <div className="prompt-editor-modal__footer">
              <Button variant="secondary" onClick={closeFullscreen}>
                关闭
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}