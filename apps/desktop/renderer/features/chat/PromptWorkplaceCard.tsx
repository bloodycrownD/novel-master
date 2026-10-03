/**
 * workplace 组卡（常驻工作区段）：组头「workplace · N 文件」收起，展开后是
 * **紧凑文件列表**（每行 = 路径 + 展示档，单行不预览正文）；点文件行就地
 * 展开该文件的预览卡（块内正文预览）；点预览卡才开全屏原文 Modal——
 * 用户拍板的三级结构（列表 → 预览 → 全屏）。
 *
 * 数据源是 main 侧下发的 `files`（core 从 `assembleWorkplaceDisplay` 的 kkv
 * 规则快照源头直通，不从展示串反解）。
 *
 * **纯展示组件**：两级展开态都由父级（`RealPromptPanel` 的 expanded map）
 * 下发——组级 key = `${turnId}::${card.id}`，文件级 key =
 * `${turnId}::${card.id}:${path}`（同 map，前缀区分不串）。
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
  /** 文件行点按：toggle 该文件的预览（key = `${cardId}:${path}`）。 */
  onToggleFile: (cardId: string, path: string) => void;
  /** 展开中的文件路径集合。 */
  openFilePaths: ReadonlySet<string>;
  /** 点预览卡开全屏（正文 = 该文件块内正文）。 */
  onOpenFile: (cardId: string, path: string, body: string) => void;
}

export function PromptWorkplaceCard({
  card,
  expanded,
  onToggle,
  onToggleFile,
  openFilePaths,
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
        <div className="prompt-workplace__list">
          {card.files.map((file) => {
            const fileOpen = openFilePaths.has(file.path);
            return (
              <div key={file.path} className="prompt-workplace__file-block">
                {/* 第一级 → 第二级：文件列表行（纯路径，无正文）。 */}
                <button
                  type="button"
                  className="prompt-workplace__file"
                  data-file-path={file.path}
                  aria-expanded={fileOpen}
                  aria-label={`${fileOpen ? "收起" : "展开"}文件预览 ${file.path}`}
                  onClick={() => onToggleFile(card.id, file.path)}
                >
                  <span className="prompt-workplace__file-path">{file.path}</span>
                  <span className="prompt-workplace__file-display">
                    {DISPLAY_LABEL[file.display]}
                  </span>
                  <span className="prompt-workplace__file-chevron" aria-hidden="true">
                    {fileOpen ? "▼" : "▶"}
                  </span>
                </button>
                {/* 第二级 → 第三级：预览卡（点它开全屏）。 */}
                {fileOpen ? (
                  <button
                    type="button"
                    className="prompt-workplace__preview"
                    aria-label={`查看文件全文 ${file.path}`}
                    onClick={() => onOpenFile(card.id, file.path, file.body)}
                  >
                    {file.body}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
