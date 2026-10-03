/**
 * 叶子卡（text / thinking）：kind 标签 + 限 2 行预览，整卡可点开全屏富文本。
 *
 * 「就地展开 → 全屏」链路的最末端：预览只给两行（`-webkit-line-clamp:2`，见
 * shell.css `.prompt-leaf-card__preview`），全文走 Modal 的 `MermaidMarkdown`。
 *
 * **纯展示组件**：不接聊天页的跳转/回调语义，只把「点开全屏」这一件事交给父级
 * （`RealPromptPanel` 持 Modal 状态）。刻意不复用 `ToolCallCard` / `ToolCallGroupCard`
 * ——那两个绑死聊天消息 DTO（`ToolCallBlock` 形态），与预览侧 `PromptTurnCardDto`
 * 不是同一套数据。
 */
import type { PromptTextCardDto } from "@shared/ipc-types";

/** thinking 卡单独叫「thinking」，其余读 core 给的 role 展示标签（空则「文本」）。 */
export function promptLeafKindLabel(card: PromptTextCardDto): string {
  if (card.type === "thinking") {
    return "thinking";
  }
  return card.role === "" ? "文本" : card.role;
}

interface PromptLeafCardProps {
  card: PromptTextCardDto;
  /** 点整卡进全屏（父级打开 Modal）。 */
  onOpen: (card: PromptTextCardDto) => void;
}

export function PromptLeafCard({ card, onOpen }: PromptLeafCardProps) {
  const label = promptLeafKindLabel(card);
  return (
    <button
      type="button"
      className={`prompt-leaf-card${card.type === "thinking" ? " prompt-leaf-card--thinking" : ""}`}
      data-card-id={card.id}
      data-card-kind={card.type}
      aria-label={`${label}，${card.body.slice(0, 20)}`}
      onClick={() => onOpen(card)}
    >
      <span className="prompt-leaf-card__head">
        <span className="prompt-leaf-card__kind">{label}</span>
        {/* 显式全屏入口（aria-hidden：点击冒泡到整卡 button，同一个 onOpen 动作；
            button 不能嵌 button，span 承载视觉即可）。 */}
        <span className="prompt-leaf-card__fullscreen" aria-hidden="true">
          ⤢
        </span>
      </span>
      <span className="prompt-leaf-card__preview">{card.body}</span>
    </button>
  );
}