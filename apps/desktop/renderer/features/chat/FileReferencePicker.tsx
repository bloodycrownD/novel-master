/**
 * 只读文件/目录引用选择器：多选文件 + 单目录确认。
 * 复用 worktree listRows IPC，不嵌 VfsFileManager。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MessageAttachmentDto, WorktreeListRowDto } from '@shared/ipc-types';
import { ipcWorktreeBuildListRows, vfsScope } from '@/ipc/client';

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

export function FileReferencePicker({
  open,
  projectId,
  sessionId,
  onClose,
  onConfirm,
}: FileReferencePickerProps) {
  const [rows, setRows] = useState<WorktreeListRowDto[]>([]);
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
    setSelectedFiles(new Set());
    setSelectedDir(null);
    void load();
  }, [open, load]);

  const visibleRows = useMemo(
    () =>
      rows.filter(r => {
        if (r.kind === 'dir') {
          return true;
        }
        return r.displayState !== 'hidden';
      }),
    [rows],
  );

  if (!open) {
    return null;
  }

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

  const pickDir = (path: string) => {
    setSelectedFiles(new Set());
    setSelectedDir(prev => (prev === path ? null : path));
  };

  const canConfirm = selectedFiles.size > 0 || selectedDir != null;

  return (
    <div className="file-ref-picker" role="dialog" aria-modal="true">
      <div className="file-ref-picker__backdrop" onClick={onClose} />
      <div className="file-ref-picker__panel">
        <header className="file-ref-picker__head">
          <h3>引用文件</h3>
          <p className="file-ref-picker__hint">多选文件，或选择一个目录</p>
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
                  <button
                    type="button"
                    className={`file-ref-picker__row${checked ? ' is-selected' : ''}`}
                    onClick={() => pickDir(row.path)}
                  >
                    <span aria-hidden>📁</span>
                    <span>{label}/</span>
                  </button>
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
              if (selectedDir != null) {
                onConfirm([toAttach(selectedDir, 'dir')]);
              } else {
                onConfirm(
                  [...selectedFiles].map(p => toAttach(p, 'text')),
                );
              }
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
