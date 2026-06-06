/**
 * Shared multi-select state for list batch management (prototype list-batch-active).
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
      isSelected,
      setSelectedIds,
    }),
    [active, selectedIds, enter, exit, toggle, isSelected, setSelectedIds],
  );
}
