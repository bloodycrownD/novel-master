/**
 * 只读文件/目录引用选择器：层级浏览 + 多选文件 + 单目录确认。
 * 复用 worktree listRows IPC，不嵌 VfsFileManager。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MessageAttachmentDto, WorktreeListRowDto } from '@shared/ipc-types';
import { ipcWorktreeBuildListRows, vfsScope } from '@/ipc/client';
import {
  isDirectChild,
  parentLogicalPath,
} from '@/features/workspace/vfs-tree-utils';

export type FileReferencePickerProps = {
  open: boolean;
  projectId: string;
  sessionId: string;
  onClose: () => void;
  onConfirm: (attachments: MessageAttachmentDto[]) => void;
};

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function toAttach(
  path: string,
  type: MessageAttachmentDto['type'],
): MessageAttachmentDto {
  return {
    name: basename(path),
    source: 'attach',
    type,
    content: null,
    path,
  };
}

/** 当前目录下的直子行（不含 cwd 自身；隐藏文件排除）。 */
export function listPickerChildRows(
  rows: readonly WorktreeListRowDto[],
  currentPath: string,
): WorktreeListRowDto[] {
  return rows.filter(r => {
    if (!isDirectChild(currentPath, r.path)) {
      return false;
    }
    if (r.kind === 'dir') {
      return true;
    }
    return r.displayState !== 'hidden';
  });
}

/** 根据目录/文件互斥选中态生成确认附件。 */
export function attachmentsFromPickerSelection(
  selectedDir: string | null,
  selectedFiles: Iterable<string>,
): MessageAttachmentDto[] {
  if (selectedDir != null) {
    return [toAttach(selectedDir, 'dir')];
  }
  return [...selectedFiles].map(p => toAttach(p, 'text'));
}

export function FileReferencePicker({
  open,
  projectId,
  sessionId,
  onClose,
  onConfirm,
}: FileReferencePickerProps) {
  const [rows, setRows] = useState<WorktreeListRowDto[]>([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    const result = await ipcWorktreeBuildListRows(
      vfsScope('session', projectId, sessionId),
    );
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      setRows([]);
      return;
    }
    setRows(result.data);
  }, [projectId, sessionId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    // 打开时重置 cwd 与选中集；仅依赖 open/scope，避免 load 引用抖动导致死循环
    setCurrentPath('/');
    setSelectedFiles(new Set());
    setSelectedDir(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 打开瞬时拉一次列表
  }, [open, projectId, sessionId]);

  const visibleRows = useMemo(
    () => listPickerChildRows(rows, currentPath),
    [rows, currentPath],
  );

  const parentPath = parentLogicalPath(currentPath);
  const canGoUp = parentPath != null;
  const canConfirm = selectedFiles.size > 0 || selectedDir != null;
  const currentDirSelected = selectedDir === currentPath;

  const navigateInto = (dirPath: string) => {
    setCurrentPath(dirPath);
  };

  const toggleDirSelect = (dirPath: string) => {
    setSelectedFiles(new Set());
    setSelectedDir(prev => (prev === dirPath ? null : dirPath));
  };

  const selectCurrentDir = () => {
    setSelectedFiles(new Set());
    setSelectedDir(prev => (prev === currentPath ? null : currentPath));
  };

  const toggleFile = (path: string) => {
    setSelectedDir(null);
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  if (!open) {
    return null;
  }

  return (
    <div className="file-ref-picker" role="dialog" aria-modal="true">
      <div className="file-ref-picker__backdrop" onClick={onClose} />
      <div className="file-ref-picker__panel">
        <header className="file-ref-picker__head">
          <h3>引用文件</h3>
          <p className="file-ref-picker__hint">多选文件，或选择一个目录</p>
          <div className="file-ref-picker__nav">
            <span className="file-ref-picker__cwd" title={currentPath}>
              {currentPath}
            </span>
            <button
              type="button"
              className="file-ref-picker__nav-btn"
              disabled={!canGoUp}
              onClick={() => {
                if (parentPath != null) {
                  setCurrentPath(parentPath);
                }
              }}
            >
              上一级
            </button>
            <button
              type="button"
              className="file-ref-picker__nav-btn"
              onClick={selectCurrentDir}
            >
              {currentDirSelected ? '取消选用' : '选择当前文件夹'}
            </button>
          </div>
        </header>
        {error ? <p className="file-ref-picker__error">{error}</p> : null}
        <ul className="file-ref-picker__list">
          {loading ? <li className="file-ref-picker__empty">加载中…</li> : null}
          {!loading && visibleRows.length === 0 ? (
            <li className="file-ref-picker__empty">暂无文件</li>
          ) : null}
          {visibleRows.map(row => {
            const label = basename(row.path) || row.path;
            if (row.kind === 'dir') {
              const checked = selectedDir === row.path;
              return (
                <li key={`d:${row.path}`}>
                  <div
                    className={`file-ref-picker__row file-ref-picker__row--dir${checked ? ' is-selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="file-ref-picker__check"
                      aria-label={`选用目录 ${label}`}
                      aria-pressed={checked}
                      onClick={() => toggleDirSelect(row.path)}
                    >
                      <span aria-hidden>{checked ? '☑' : '☐'}</span>
                    </button>
                    <button
                      type="button"
                      className="file-ref-picker__enter"
                      aria-label={`进入目录 ${label}`}
                      onClick={() => navigateInto(row.path)}
                    >
                      <span aria-hidden>📁</span>
                      <span className="file-ref-picker__label">{label}/</span>
                      <span className="file-ref-picker__chevron" aria-hidden>
                        ›
                      </span>
                    </button>
                  </div>
                </li>
              );
            }
            const checked = selectedFiles.has(row.path);
            return (
              <li key={`f:${row.path}`}>
                <button
                  type="button"
                  className={`file-ref-picker__row${checked ? ' is-selected' : ''}`}
                  onClick={() => toggleFile(row.path)}
                >
                  <span aria-hidden>{checked ? '☑' : '☐'}</span>
                  <span>{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <footer className="file-ref-picker__foot">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="file-ref-picker__confirm"
            disabled={!canConfirm}
            onClick={() => {
              onConfirm(
                attachmentsFromPickerSelection(selectedDir, selectedFiles),
              );
              onClose();
            }}
          >
            确认
          </button>
        </footer>
      </div>
    </div>
  );
}
