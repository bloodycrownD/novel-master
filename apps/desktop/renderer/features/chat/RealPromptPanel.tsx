/**
 * 真实提示词查看面板（desktop，prompt-rounds）：三层结构。
 *
 * 1. 收起的**轮摘要卡**——role 徽标 pill（user 主蓝底白字 / assistant 与
 *    system 中性底，走 CSS `data-turn-kind`）+ `summaryText` 单行截断 +
 *    `metaText` 计数行；点头部就地展开/收起。轮卡不出 ⤢（用户拍板：全屏入口
 *    只在二级卡，二级整卡点按即进）；
 * 2. 展开区的**嵌套卡片流**——文本/thinking 叶子卡（无 kind 小标题、无 ⤢，
 *    整卡点开全屏）+ 工具组卡（组头状态点三态，组内 use/result 两格整格点开
 *    全屏；tool use 预览走 core `formatToolUsePreviewJson` 保结构截大 key）；
 * 3. **全屏只读原文**——复用 `.text-prompt-overlay` / `.prompt-editor-modal` 壳，
 *    正文容器 `.prompt-fullscreen__body` 内逐块 `<pre>` 纯文本铺开（用户拍板：
 *    只保留原文，无渲染档与切换）。
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
} from "@shared/ipc-types";
import { ipcPromptRealPreview } from "@/ipc/client";
import { Button } from "@/components/ui/Button";
import { PromptLeafCard, promptLeafKindLabel } from "./PromptLeafCard";
import {
  PromptToolGroupCard,
  type ToolGroupLeaf,
} from "./PromptToolGroupCard";
import { PromptWorkplaceCard } from "./PromptWorkplaceCard";

interface RealPromptPanelProps {
  projectId: string;
  sessionId: string;
  visible: boolean;
}

/** 轮层 role 徽标文案（轮的消息 role；合成段按真实 role 归轮，无 template 分类）。 */
const TURN_ROLE_LABELS: Record<PromptPreviewTurnDto["kind"], string> = {
  user: "user",
  assistant: "assistant",
  system: "system",
};

/** 空正文在全屏里的占位文案。 */
const EMPTY_TEXT_PLACEHOLDER = "（空）";

/** 全屏 Modal 的内容来源：某个叶子（单份正文）。 */
interface FullscreenTarget {
  /** Modal 标题（叶子标签）。 */
  title: string;
  /** 正文块（叶子恒为单块，保留数组形态与渲染循环对齐）。 */
  blocks: readonly string[];
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
      // 旧 main 下发的 payload 没有 `cards` 字段，裸读会在展开轮卡时抛
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

  /** workplace 某文件全屏：该文件块内正文单份（标题 = 路径）。 */
  const openWorkplaceFileFullscreen = useCallback(
    (_cardId: string, path: string, body: string) => {
      setFullscreen({ title: path, blocks: [body] });
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

  const renderCard = (card: PromptPreviewTurnDto["cards"][number], turnId: string) => {
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
    if (card.type === "workplace") {
      // 无组头：轮展开即见文件列表（用户拍板，不再嵌 workplace 组）。
      // 文件级展开态落在同一 expanded map：key 前缀 `${turnId}::${cardId}:`。
      const filePrefix = `${turnId}::${card.id}:`;
      const openFilePaths = new Set(
        Object.keys(expanded)
          .filter((key) => key.startsWith(filePrefix))
          .map((key) => key.slice(filePrefix.length)),
      );
      return (
        <PromptWorkplaceCard
          key={card.id}
          card={card}
          onToggleFile={(cardId, path) => toggleExpanded(`${turnId}::${cardId}:${path}`)}
          openFilePaths={openFilePaths}
          onOpenFile={openWorkplaceFileFullscreen}
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
        在会话工作区调整纳入规则可改变预览内容。点轮卡头部就地展开，点子卡进入全屏阅读。
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
                  // 叶子恒单块；索引参与 key 保证重复正文时也稳定。
                  <div
                    key={`raw-${index}-${content.slice(0, 8)}`}
                    className="prompt-fullscreen__block"
                  >
                    <pre className="prompt-fullscreen__raw">{content}</pre>
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
