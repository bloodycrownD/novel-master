/**
 * 只读文件/目录引用选择器：层级浏览 + 多选文件与目录。
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

/** 当前目录下的直子行（不含 cwd 自身；目录与文件均显示，含隐藏文件）。 */
export function listPickerChildRows(
  rows: readonly WorktreeListRowDto[],
  currentPath: string,
): WorktreeListRowDto[] {
  return rows.filter(r => isDirectChild(currentPath, r.path));
}

/** 根据目录/文件多选态生成确认附件（先 dir 后 text，各按 path）。 */
export function attachmentsFromPickerSelection(
  selectedDirs: Iterable<string>,
  selectedFiles: Iterable<string>,
): MessageAttachmentDto[] {
  return [
    ...[...selectedDirs].map(p => toAttach(p, 'dir')),
    ...[...selectedFiles].map(p => toAttach(p, 'text')),
  ];
}

function toggleInSet(prev: Set<string>, path: string): Set<string> {
  const next = new Set(prev);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  return next;
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
  const [selectedDirs, setSelectedDirs] = useState<Set<string>>(new Set());
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
    setSelectedDirs(new Set());
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 打开瞬时拉一次列表
  }, [open, projectId, sessionId]);

  const visibleRows = useMemo(
    () => listPickerChildRows(rows, currentPath),
    [rows, currentPath],
  );

  const parentPath = parentLogicalPath(currentPath);
  const canGoUp = parentPath != null;
  const canConfirm = selectedFiles.size > 0 || selectedDirs.size > 0;
  const currentDirSelected = selectedDirs.has(currentPath);

  const navigateInto = (dirPath: string) => {
    setCurrentPath(dirPath);
  };

  const toggleDirSelect = (dirPath: string) => {
    setSelectedDirs(prev => toggleInSet(prev, dirPath));
  };

  const selectCurrentDir = () => {
    setSelectedDirs(prev => toggleInSet(prev, currentPath));
  };

  const toggleFile = (path: string) => {
    setSelectedFiles(prev => toggleInSet(prev, path));
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
          <p className="file-ref-picker__hint">可多选文件与目录</p>
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
              const checked = selectedDirs.has(row.path);
              return (
                <li key={`d:${row.path}`}>
                  <div
                    className={`file-ref-picker__row file-ref-picker__row--split${checked ? ' is-selected' : ''}`}
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
                <div
                  className={`file-ref-picker__row file-ref-picker__row--split${checked ? ' is-selected' : ''}`}
                >
                  <button
                    type="button"
                    className="file-ref-picker__check"
                    aria-label={`选用文件 ${label}`}
                    aria-pressed={checked}
                    onClick={() => toggleFile(row.path)}
                  >
                    <span aria-hidden>{checked ? '☑' : '☐'}</span>
                  </button>
                  <button
                    type="button"
                    className="file-ref-picker__enter"
                    aria-label={`选用文件 ${label}`}
                    onClick={() => toggleFile(row.path)}
                  >
                    <span className="file-ref-picker__label">{label}</span>
                  </button>
                </div>
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
                attachmentsFromPickerSelection(selectedDirs, selectedFiles),
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
