/**
 * 聊天 transcript 滚动数学单源（纯数值，无 DOM）。
 *
 * RN 宿主 `webview-host/chat-transcript/scroll.ts` 与 webview runtime
 * `web/chat-transcript/webview/runtime/scroll/scroll.ts` 共用本文件：
 * 宿主侧保留同名入口（测试直测），runtime 只做「取值 → 调公式 → 写回」。
 * 数值常量真源：`web/shared/constants.ts`。
 */
import {NEAR_BOTTOM_THRESHOLD_PX} from './constants';

/** 滚动数学纯函数分组（宿主与 webview runtime 共用的唯一实现）。 */
export const ScrollMath = {
  /** Pixels from visual bottom (DOM forward order: newest at bottom). */
  offsetFromBottom: (scrollTop: number, scrollHeight: number, clientHeight: number): number => Math.max(0, scrollHeight - scrollTop - clientHeight),

  /** 已有距底偏移时的贴底判定（避免重复取值）。 */
  isNearBottomOffset: (offset: number, threshold: number = NEAR_BOTTOM_THRESHOLD_PX): boolean => offset <= threshold,

  /** True when scrollTop is within threshold of the visual bottom. */
  nearBottom: (scrollTop: number, scrollHeight: number, clientHeight: number, threshold: number = NEAR_BOTTOM_THRESHOLD_PX): boolean => ScrollMath.isNearBottomOffset(ScrollMath.offsetFromBottom(scrollTop, scrollHeight, clientHeight), threshold),

  /** Pin scroll to visual bottom (open session / stream follow). */
  scrollTopForBottom: (scrollHeight: number, clientHeight: number): number => Math.max(0, scrollHeight - clientHeight),

  /** Restore scrollTop from cached distance-from-bottom (T6 workspace↔chat). */
  scrollTopForOffsetFromBottom: (scrollHeight: number, clientHeight: number, offsetY: number): number => Math.max(0, scrollHeight - clientHeight - offsetY),

  /**
   * After prependPage (not sessionSnapshot): preserve reading position.
   * scrollTop += scrollHeight - prependedScrollHeight — see spec §prepend 稳定.
   */
  scrollTopAfterPrepend: (previousScrollTop: number, previousScrollHeight: number, nextScrollHeight: number): number => previousScrollTop + (nextScrollHeight - previousScrollHeight),

  /** After tail removal (rollback/delete): keep reading position without overshooting max scroll. */
  clampScrollTop: (previousScrollTop: number, scrollHeight: number, clientHeight: number): number => Math.min(previousScrollTop, ScrollMath.scrollTopForBottom(scrollHeight, clientHeight)),
} as const;
