/**
 * 通用批量多选状态（Agent/Provider/会话列表等非消息可见性场景）。
 */
import {useCallback, useMemo, useState} from 'react';

export function useBatchSelection() {
  const [active, setActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const enter = useCallback(() => {
    setActive(true);
    setSelectedIds(new Set());
  }, []);

  const exit = useCallback(() => {
    setActive(prev => (prev ? false : prev));
    setSelectedIds(prev => (prev.size === 0 ? prev : new Set()));
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectedIds(prev => {
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
      selectedIds,
      enter,
      exit,
      toggle,
      selectRange,
      isSelected,
    ],
  );
}
