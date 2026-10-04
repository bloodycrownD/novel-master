/**
 * 工具结果阅读 Modal（chat 工具卡片 → 全屏结果阅读，通用兜底）。
 *
 * 所有无专属跳转目标的工具卡（fs / agent / search / curl / grep / glob …
 * 以及 read/write/edit 等在未挂文件回调时的回落），点击后在此展示
 * tool_result 全文——不落临时文件、不依赖 savedPath（正文就在消息里）。
 * 专属跳转（文件/子会话/技能详情）由 ToolCallCard 的优先级链前置，
 * 本阅读分支只是「点了至少有反应」的兜底。
 * 形态复用「预览提示词」的全屏阅读 Modal（`text-prompt-overlay` +
 * `prompt-editor-modal` + `prompt-fullscreen__*`，用户拍板参考其阅读效果）。
 *
 * 事件模式照 skill-ui 的 `dispatchOpenSettingsView` 先例：ToolCallCard 直接
 * dispatch，监听壳在 App 层单实例——`onOpenToolResult` 回调不穿透
 * ConversationPanel → MessageList → ToolCallCard 的长 props 链。
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

export const OPEN_TOOL_RESULT_EVENT = "open-tool-result-view";

export type ToolResultViewDetail = {
  /** Modal 标题（工具名，如 `search`）。 */
  readonly title: string;
  /** tool_result 正文全文。 */
  readonly content: string;
};

/**
 * 解析工具卡片的「结果阅读」载荷：正文非空用正文，否则回落 summary
 *（fs 空目录 / glob 0 paths / grep 0 matches 的 content 是空串，信息全
 * 在 summary——「0 entries」也是可读结果）；两者皆空返回 undefined
 * （卡片不可点）。不设工具集合——专属跳转工具（read 等）也产载荷，
 * 但 ToolCallCard 的优先级链保证它们仍走文件/子会话/技能跳转，本函数
 * 只在无专属去向时被消费（判定 + 载荷构造单源）。
 */
export function toolResultViewFor(tool: {
  readonly name: string;
  readonly resultContent?: string;
  readonly summary?: string;
}): ToolResultViewDetail | undefined {
  const pickReadable = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() !== "" ? value : undefined;
  const content =
    pickReadable(tool.resultContent) ?? pickReadable(tool.summary);
  if (content == null) {
    return undefined;
  }
  return { title: tool.name, content };
}

export function dispatchOpenToolResultView(
  detail: ToolResultViewDetail
): void {
  window.dispatchEvent(
    new CustomEvent<ToolResultViewDetail>(OPEN_TOOL_RESULT_EVENT, { detail })
  );
}

/** 纯展示层（给定 target 渲染），监听壳薄层复用；static render 可直测。 */
export function ToolResultViewOverlay({
  target,
  onClose,
}: {
  target: ToolResultViewDetail;
  onClose: () => void;
}) {
  return (
    <div className="text-prompt-overlay" onClick={onClose}>
      <div
        className="prompt-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${target.title}结果`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="prompt-fullscreen__title">{target.title}</div>
        <div className="prompt-fullscreen__body">
          {target.content === "" ? (
            <p className="prompt-fullscreen__empty">（空）</p>
          ) : (
            <div className="prompt-fullscreen__block">
              <pre className="prompt-fullscreen__raw">{target.content}</pre>
            </div>
          )}
        </div>
        <div className="prompt-editor-modal__footer">
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ToolResultViewerModal() {
  const [target, setTarget] = useState<ToolResultViewDetail | null>(null);
  const close = useCallback(() => setTarget(null), []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ToolResultViewDetail>).detail;
      if (detail != null && typeof detail.content === "string") {
        setTarget(detail);
      }
    };
    window.addEventListener(OPEN_TOOL_RESULT_EVENT, handler);
    return () => window.removeEventListener(OPEN_TOOL_RESULT_EVENT, handler);
  }, []);

  // Esc 关闭（照 RealPromptPanel：已被下游消费掉的 Esc 不拦截）
  useEffect(() => {
    if (target == null) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        setTarget(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [target]);

  if (target == null) {
    return null;
  }
  return <ToolResultViewOverlay target={target} onClose={close} />;
}
