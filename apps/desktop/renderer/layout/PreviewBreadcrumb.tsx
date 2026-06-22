import type { WorkspacePanelScope } from "@shared/ipc-types";
import {
  logicalPathForSegmentIndex,
  logicalPathSegments,
} from "../features/workspace/vfs-tree-utils";

export interface PreviewBreadcrumbProps {
  filePath: string;
  workspaceScope: WorkspacePanelScope;
  onSelectPath: (path: string) => void;
  onExpandDir: (path: string) => void;
}

export function PreviewBreadcrumb({
  filePath,
  workspaceScope: _workspaceScope,
  onSelectPath,
  onExpandDir,
}: PreviewBreadcrumbProps) {
  const segments = logicalPathSegments(filePath);

  if (segments.length === 0) {
    return (
      <span className="column-header__meta preview-breadcrumb" id="preview-filename">
        /
      </span>
    );
  }

  return (
    <nav
      className="column-header__meta preview-breadcrumb"
      id="preview-filename"
      aria-label="文件路径"
    >
      <ol className="preview-breadcrumb__list">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          const segmentPath = logicalPathForSegmentIndex(segments, index);
          return (
            <li key={segmentPath} className="preview-breadcrumb__item">
              {index > 0 ? (
                <span className="preview-breadcrumb__sep" aria-hidden>
                  ›
                </span>
              ) : null}
              {isLast ? (
                <button
                  type="button"
                  className="preview-breadcrumb__segment preview-breadcrumb__segment--current"
                  aria-current="page"
                  onClick={() => onSelectPath(filePath)}
                >
                  {segment}
                </button>
              ) : (
                <button
                  type="button"
                  className="preview-breadcrumb__segment"
                  onClick={() => onExpandDir(segmentPath)}
                >
                  {segment}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
