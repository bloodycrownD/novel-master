import type { ReactNode } from "react";

type ManageHeaderProps = {
  title: string;
  batchMode: boolean;
  selectedCount: number;
  onEnterBatch: () => void;
  onCancelBatch: () => void;
  onDelete?: () => void;
  hint?: string;
  normalActions?: ReactNode;
};

export function ManageHeader({
  title,
  batchMode,
  selectedCount,
  onEnterBatch,
  onCancelBatch,
  onDelete,
  hint,
  normalActions,
}: ManageHeaderProps) {
  return (
    <div className="list-manage-header">
      {batchMode ? (
        <div className="list-manage-header__batch-row">
          <button type="button" className="list-manage-header__link" onClick={onCancelBatch}>
            取消
          </button>
          <span className="list-manage-header__count">已选 {selectedCount} 项</span>
          <button
            type="button"
            className="list-manage-header__link list-manage-header__link--danger"
            disabled={selectedCount === 0}
            onClick={onDelete}
          >
            删除
          </button>
        </div>
      ) : (
        <div className="list-manage-header__normal-row">
          <span className="list-manage-header__title">{title}</span>
          <div className="list-manage-header__actions">
            <button type="button" className="list-manage-header__btn" onClick={onEnterBatch}>
              管理
            </button>
            {normalActions}
          </div>
        </div>
      )}
      {batchMode && hint ? (
        <p className="list-manage-header__hint">{hint}</p>
      ) : null}
    </div>
  );
}
