/**
 * 工具组卡（一次 `tool_use` 一张）：组头「工具名 · 状态点」+ 可选「并行」徽标，
 * 就地展开后是**一对两格**——上格 tool use（等宽 JSON 预览）、下格 tool result
 * （正文预览 / 悬挂时「未返回结果」占位）。整格点开全屏原文（无显式 ⤢，
 * 用户拍板「点击就好进入全屏」）。
 *
 * tool use 预览是 main 侧 `formatToolUsePreviewJson` 算好下发的 DTO 字段
 * `inputPreview`（保结构截大 key：超长值截断、超长数组截项），不直接腰斩
 * pretty JSON；全屏仍看 `inputJson` 原文。renderer 不引 core 运行时。
 *
 * 状态点三色（语义色）：ok 绿 / error 红 / lost 灰，三态另配可读文案，
 * 不只靠颜色区分。
 *
 * **纯展示组件**：展开态由父级（`RealPromptPanel` 的 expanded map，受控 key 用
 * `turn.id + 组卡 id`）下发，全屏也只回抛 `onOpenLeaf`，不接任何跳转。
 * 刻意不复用聊天页 `ToolCallGroupCard` ——后者绑死聊天消息 DTO。
 */
import type {
  PromptToolGroupDto,
  PromptToolGroupStatusDto,
} from "@shared/ipc-types";

/** 悬挂 tool_use（`result === null`）的占位文案，槽位保留不隐藏。 */
export const LOST_RESULT_PLACEHOLDER = "未返回结果";

/**
 * 状态点配色走主题 CSS 变量（success/danger/中性，深浅主题自动跟随；
 * 对齐 app 工具卡先例 `.tool-call-card__status` 的语义色体系）。
 * 状态文案用主题正文色（`.prompt-tool-group__status` 的 `var(--text)`），状态点做辅助区分。
 */
export const TOOL_GROUP_STATUS_COLORS: Record<
  PromptToolGroupStatusDto,
  string
> = {
  ok: "var(--success)",
  error: "var(--danger)",
  lost: "var(--text-tertiary)",
};

/** 状态文案（三态可读）。 */
export const TOOL_GROUP_STATUS_LABELS: Record<
  PromptToolGroupStatusDto,
  string
> = {
  ok: "成功",
  error: "失败",
  lost: "丢失",
};

/** 组卡里的叶子格：一格 = 一份可全屏的正文（use 入参 / result 正文）。 */
export interface ToolGroupLeaf {
  /** 稳定 key（`${cardId}-use` / `-result`），expanded 与叶子 id 都用它。 */
  id: string;
  /** 格头标签。 */
  label: string;
  /** 全屏正文；`lost` 时是占位文案。 */
  body: string;
  /** 格内预览：use 格是 main 侧算好的保结构截大 key JSON（DTO `inputPreview`），
   * result 格与 body 同源。renderer 不引 core 运行时。 */
  preview: string;
  /** 悬挂格：预览与全屏都出占位文案，样式走灰化态。 */
  lost: boolean;
  /** 入参格：等宽字体。 */
  code: boolean;
}

export function toolGroupLeaves(card: PromptToolGroupDto): ToolGroupLeaf[] {
  return [
    {
      id: `${card.id}-use`,
      label: "tool use",
      body: card.inputJson,
      preview: card.inputPreview,
      lost: false,
      code: true,
    },
    {
      id: `${card.id}-result`,
      label: "tool result",
      body: card.result?.body ?? LOST_RESULT_PLACEHOLDER,
      preview: card.result?.body ?? LOST_RESULT_PLACEHOLDER,
      lost: card.result == null,
      code: false,
    },
  ];
}

interface PromptToolGroupCardProps {
  card: PromptToolGroupDto;
  /** 组卡展开态（受控，key = turn.id + card.id）。 */
  expanded: boolean;
  onToggle: (cardId: string) => void;
  /** 点某一格进全屏（正文由叶子 leaf 给出）。 */
  onOpenLeaf: (cardId: string, leaf: ToolGroupLeaf) => void;
}

export function PromptToolGroupCard({
  card,
  expanded,
  onToggle,
  onOpenLeaf,
}: PromptToolGroupCardProps) {
  const color = TOOL_GROUP_STATUS_COLORS[card.status];
  const statusLabel = TOOL_GROUP_STATUS_LABELS[card.status];
  return (
    <div
      className={`prompt-tool-group${expanded ? " is-expanded" : ""}`}
      data-card-id={card.id}
      data-card-status={card.status}
    >
      <button
        type="button"
        className="prompt-tool-group__head"
        aria-expanded={expanded}
        aria-label={`${expanded ? "收起" : "展开"}工具调用 ${card.toolName}`}
        onClick={() => onToggle(card.id)}
      >
        <span
          className="prompt-tool-group__dot"
          style={{ background: color }}
          data-status={card.status}
          aria-hidden="true"
        />
        <span className="prompt-tool-group__name">{card.toolName}</span>
        {card.parallel ? (
          <span className="prompt-tool-group__parallel">并行</span>
        ) : null}
        <span
          className="prompt-tool-group__status"
          data-status={card.status}
        >
          {statusLabel}
        </span>
        <span className="prompt-tool-group__chevron" aria-hidden="true">
          {expanded ? "▼" : "▶"}
        </span>
      </button>
      {expanded ? (
        <div className="prompt-tool-group__cells">
          {toolGroupLeaves(card).map((leaf) => (
            <button
              key={leaf.id}
              type="button"
              className={`prompt-group-cell${leaf.lost ? " is-lost" : ""}`}
              data-leaf-id={leaf.id}
              aria-label={`查看${leaf.label}，${card.toolName}`}
              onClick={() => onOpenLeaf(card.id, leaf)}
            >
              <span className="prompt-group-cell__tag">{leaf.label}</span>
              <span
                className={`prompt-group-cell__body${leaf.code ? " is-code" : ""}`}
              >
                {leaf.preview}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
