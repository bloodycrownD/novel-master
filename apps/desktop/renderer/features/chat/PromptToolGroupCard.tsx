/**
 * 工具组卡（一次 `tool_use` 一张）：组头「工具名 · 状态点」+ 可选「并行」徽标，
 * 就地展开后是**一对两格**——上格 tool use（等宽 JSON 预览）、下格 tool result
 * （正文预览 / 悬挂时「未返回结果」占位）。两格各自可点开全屏富文本。
 *
 * 状态点三色（语义色，不随主题变）：ok 绿 / error 红 / lost 灰，与设计基准 demo
 * 的 tool-group 一致；三态另配可读文案，不只靠颜色区分。
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

/** 状态点 / 状态文案配色：ok 绿 / error 红 / lost 灰。 */
export const TOOL_GROUP_STATUS_COLORS: Record<
  PromptToolGroupStatusDto,
  string
> = {
  ok: "#34c759",
  error: "#f87171",
  lost: "#9ca3af",
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
  /** 悬挂格：预览与全屏都出占位文案，样式走灰化态。 */
  lost: boolean;
  /** 入参格：等宽字体 + 3 行限高。 */
  code: boolean;
}

export function toolGroupLeaves(card: PromptToolGroupDto): ToolGroupLeaf[] {
  return [
    {
      id: `${card.id}-use`,
      label: "tool use",
      body: card.inputJson,
      lost: false,
      code: true,
    },
    {
      id: `${card.id}-result`,
      label: "tool result",
      body: card.result?.body ?? LOST_RESULT_PLACEHOLDER,
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
          style={{ color }}
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
              aria-label={`查看 ${leaf.label} 全文`}
              onClick={() => onOpenLeaf(card.id, leaf)}
            >
              <span className="prompt-group-cell__head">
                <span className="prompt-group-cell__tag">{leaf.label}</span>
              </span>
              <span
                className={`prompt-group-cell__body${leaf.code ? " is-code" : ""}`}
              >
                {leaf.body}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}