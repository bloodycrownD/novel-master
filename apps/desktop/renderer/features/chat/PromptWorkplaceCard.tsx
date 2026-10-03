/**
 * workplace 组卡（常驻工作区段）：组头「workplace · N 文件」收起，就地展开后
 * 逐文件一张小卡——路径 + 展示档（全文/仅文件名/头信息，kkv 规则快照原值）+
 * 块内正文预览；点文件卡开全屏原文 Modal。
 *
 * 数据源是 main 侧下发的 `files`（core 从 `assembleWorkplaceDisplay` 的 kkv
 * 规则快照源头直通，不从展示串反解——用户拍板）。
 *
 * **纯展示组件**：展开态由父级（`RealPromptPanel` 的 expanded map）下发，
 * 全屏只回抛 `onOpenFile`，不接任何跳转。形态与工具组卡同款
 * （blockCard 左 3px 粗条 + 组头一行，见 shell.css `.prompt-workplace*`）。
 */
import type { PromptWorkplaceDto } from "@shared/ipc-types";

/** 展示档文案（三态可读，规则快照原值直译）。 */
const DISPLAY_LABEL: Record<
  PromptWorkplaceDto["files"][number]["display"],
  string
> = {
  full: "全文",
  filename: "仅文件名",
  header: "头信息",
};

interface PromptWorkplaceCardProps {
  card: PromptWorkplaceDto;
  /** 组卡展开态（受控，key = turn.id + card.id）。 */
  expanded: boolean;
  onToggle: (cardId: string) => void;
  /** 点某文件开全屏（正文 = 该文件块内正文）。 */
  onOpenFile: (cardId: string, path: string, body: string) => void;
}

export function PromptWorkplaceCard({
  card,
  expanded,
  onToggle,
  onOpenFile,
}: PromptWorkplaceCardProps) {
  return (
    <div
      className={`prompt-workplace${expanded ? " is-expanded" : ""}`}
      data-card-id={card.id}
    >
      <button
        type="button"
        className="prompt-workplace__head"
        aria-expanded={expanded}
        aria-label={`${expanded ? "收起" : "展开"}工作区文件 ${card.files.length} 个`}
        onClick={() => onToggle(card.id)}
      >
        <span className="prompt-workplace__name">workplace</span>
        <span className="prompt-workplace__count">{card.files.length} 文件</span>
        <span className="prompt-workplace__chevron" aria-hidden="true">
          {expanded ? "▼" : "▶"}
        </span>
      </button>
      {expanded ? (
        <div className="prompt-workplace__cells">
          {card.files.map((file) => (
            <button
              key={file.path}
              type="button"
              className="prompt-workplace__file"
              data-file-path={file.path}
              aria-label={`查看工作区文件 ${file.path}`}
              onClick={() => onOpenFile(card.id, file.path, file.body)}
            >
              <span className="prompt-workplace__file-head">
                <span className="prompt-workplace__file-path">{file.path}</span>
                <span className="prompt-workplace__file-display">
                  {DISPLAY_LABEL[file.display]}
                </span>
              </span>
              <span className="prompt-workplace__file-body">{file.body}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
