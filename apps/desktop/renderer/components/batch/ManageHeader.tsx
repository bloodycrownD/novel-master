import type { ReactNode } from "react";

/** 批量模式次操作（如「启用」/「禁用」）：主操作（删除）右侧依次渲染。 */
export type ManageHeaderBatchAction = {
  label: string;
  onClick: () => void;
  tone?: 'danger' | 'primary';
  /** 不传则跟随 selectedCount === 0 的统一禁用规则。 */
  disabled?: boolean;
};

type ManageHeaderProps = {
  title: string;
  batchMode: boolean;
  selectedCount: number;
  onEnterBatch: () => void;
  onCancelBatch: () => void;
  onDelete?: () => void;
  /** 批量模式下追加的「全选/全不选」动作；不传则不渲染该按钮。 */
  onSelectAll?: () => void;
  /** 当前是否已全选（决定按钮文案「全不选」/「全选」）。 */
  allSelected?: boolean;
  hint?: string;
  normalActions?: ReactNode;
  /**
   * 批量模式主操作文案（缺省「删除」，与移动版语义一致，spec D12）；
   * 未传 onPrimaryAction 时回落到 onDelete。
   */
  primaryActionLabel?: string;
  /** 批量模式主操作回调；不传则回落到 onDelete。 */
  onPrimaryAction?: () => void;
  primaryActionTone?: 'danger' | 'primary';
  /** 批量模式次操作数组；每项在主操作右侧渲染（spec D12）。 */
  actions?: ManageHeaderBatchAction[];
};

export function ManageHeader({
  title,
  batchMode,
  selectedCount,
  onEnterBatch,
  onCancelBatch,
  onDelete,
  onSelectAll,
  allSelected,
  hint,
  normalActions,
  primaryActionLabel = '删除',
  onPrimaryAction,
  primaryActionTone = 'danger',
  actions,
}: ManageHeaderProps) {
  const runPrimary = onPrimaryAction ?? onDelete;
  const batchActionsDisabled = selectedCount === 0;

  return (
    <div className="list-manage-header">
      {batchMode ? (
        <div className="list-manage-header__batch-row">
          <button type="button" className="list-manage-header__link" onClick={onCancelBatch}>
            取消
          </button>
          <span className="list-manage-header__count">已选 {selectedCount} 项</span>
          {onSelectAll ? (
            <button type="button" className="list-manage-header__link" onClick={onSelectAll}>
              {allSelected ? "全不选" : "全选"}
            </button>
          ) : null}
          {runPrimary ? (
            <button
              type="button"
              className={`list-manage-header__link${
                primaryActionTone === 'danger' ? ' list-manage-header__link--danger' : ''
              }`}
              disabled={batchActionsDisabled}
              onClick={runPrimary}
            >
              {primaryActionLabel}
            </button>
          ) : null}
          {(actions ?? []).map((action) => {
            const disabled = action.disabled ?? batchActionsDisabled;
            return (
              <button
                key={action.label}
                type="button"
                className={`list-manage-header__link${
                  action.tone === 'danger' ? ' list-manage-header__link--danger' : ''
                }`}
                disabled={disabled}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            );
          })}
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
