/**
 * 通用批量多选状态（项目/会话/Provider 等）。
 */
import { useCallback, useMemo, useState } from "react";

export type MessageBatchMode = "hide" | "restore" | "delete";

export function useBatchSelection() {
  const [mode, setMode] = useState<MessageBatchMode | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const active = mode != null;

  /** 通用批量入口（会话/VFS/Provider 等非消息可见性场景）。 */
  const enter = useCallback(() => {
    setMode("hide");
    setSelectedIds(new Set());
  }, []);

  const exit = useCallback(() => {
    setMode((prev) => (prev != null ? null : prev));
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  /** 重置并设置勾选集合（批量范围全选）。 */
  const selectRange = useCallback((ids: Iterable<string>) => {
    setSelectedIds(new Set(ids));
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );

  return useMemo(
    () => ({
      active,
      mode,
      selectedIds,
      selectedCount: selectedIds.size,
      enter,
      exit,
      toggle,
      selectRange,
      isSelected,
    }),
    [
      active,
      mode,
      selectedIds,
      enter,
      exit,
      toggle,
      selectRange,
      isSelected,
    ],
  );
}
