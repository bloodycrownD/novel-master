/**
 * workplace 文件列表卡（常驻工作区段）：**无组头**——轮摘要已标 workplace，
 * 点轮展开直接见文件列表（每行 = 路径 + 展示档，单行不预览正文）；点文件行
 * 就地展开该文件的预览卡（块内正文预览）；点预览卡才开全屏原文 Modal——
 * 用户拍板的层级：轮 → 文件列表 → 预览 → 全屏（不再嵌 workplace 组）。
 *
 * 数据源是 main 侧下发的 `files`（core 从 `assembleWorkplaceDisplay` 的 kkv
 * 规则快照源头直通，不从展示串反解）。
 *
 * **纯展示组件**：文件级展开态由父级（`RealPromptPanel` 的 expanded map）下发，
 * key = `${turnId}::${card.id}:${path}`。
 */
import type { PromptWorkplaceDto } from "@shared/ipc-types";

/** 展示档文案：与 VFS/工作区侧 `displayStateLabel` 同源（全内容/文件头/文件名）。 */
const DISPLAY_LABEL: Record<
  PromptWorkplaceDto["files"][number]["display"],
  string
> = {
  full: "全内容",
  filename: "文件名",
  header: "文件头",
};

interface PromptWorkplaceCardProps {
  card: PromptWorkplaceDto;
  /** 文件行点按：toggle 该文件的预览（key = `${cardId}:${path}`）。 */
  onToggleFile: (cardId: string, path: string) => void;
  /** 展开中的文件路径集合。 */
  openFilePaths: ReadonlySet<string>;
  /** 点预览卡开全屏（正文 = 该文件块内正文）。 */
  onOpenFile: (cardId: string, path: string, body: string) => void;
}

export function PromptWorkplaceCard({
  card,
  onToggleFile,
  openFilePaths,
  onOpenFile,
}: PromptWorkplaceCardProps) {
  return (
    <div className="prompt-workplace" data-card-id={card.id}>
      <div className="prompt-workplace__list">
        {card.files.map((file) => {
          const fileOpen = openFilePaths.has(file.path);
          return (
            <div key={file.path} className="prompt-workplace__file-block">
              {/* 轮 → 文件列表：单行路径 + 展示档（无正文）。 */}
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
              {/* 列表行 → 预览卡（点它开全屏）。 */}
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
    </div>
  );
}
