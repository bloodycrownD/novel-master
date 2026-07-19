/**
 * 对话态无 MainTabs 底栏时，Composer dock 底部需覆盖 Home Indicator。
 */

/** 底部 padding：至少 base，且 ≥ safe-area bottom。 */
export function composerDockBottomPadding(
  safeAreaBottom: number,
  base = 8,
): number {
  return Math.max(base, safeAreaBottom);
}
