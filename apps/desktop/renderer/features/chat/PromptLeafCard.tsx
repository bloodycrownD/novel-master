/**
 * 叶子卡（text / thinking）：限 3 行预览，整卡点开全屏原文。
 *
 * 无 kind 小标题行（用户拍板：轮层徽标已标 role，卡片内再标一遍 user/assistant
 * 纯冗余）、无显式 ⤢（点击就好进入全屏）。
 *
 * **纯展示组件**：不接聊天页的跳转/回调语义，只把「点开全屏」这一件事交给父级
 * （`RealPromptPanel` 持 Modal 状态）。刻意不复用 `ToolCallCard` / `ToolCallGroupCard`
 * ——那两个绑死聊天消息 DTO（`ToolCallBlock` 形态），与预览侧 DTO
 * 不是同一套数据。
 */
import type { PromptTextCardDto } from "@shared/ipc-types";

/** 详情标题：thinking 卡单独叫「thinking」，其余读 core 给的 role 展示标签（空则「文本」）。 */
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
      <span className="prompt-leaf-card__preview">{card.body}</span>
    </button>
  );
}
