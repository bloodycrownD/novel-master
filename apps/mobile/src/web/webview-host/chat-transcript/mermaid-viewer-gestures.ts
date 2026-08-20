/**
 * Mermaid 全屏查看器手势纯函数（pinch/pan clamp、双击状态机）。
 * rich-document / chat-transcript 两管线经 shared/mermaid-fullscreen 共用；
 * 纯计算无 DOM 依赖，照 menu-overlay-guards 样板 Jest 直测。
 */

/** pinch 最小缩放（原始 fit 尺寸）。 */
export const MERMAID_VIEWER_MIN_SCALE = 1;

/** pinch 最大缩放档位。 */
export const MERMAID_VIEWER_MAX_SCALE = 6;

/** 双击放大档位（原始 ↔ 放大两档切换）。 */
export const MERMAID_VIEWER_DOUBLE_TAP_SCALE = 2.5;

/** 双击间隔阈值（ms）：两次轻触间隔超过它视为独立单击。 */
export const MERMAID_DOUBLE_TAP_INTERVAL_MS = 300;

/** 单指位移超过此值视为拖拽（抑制 tap 关闭 / 双击误判）。 */
export const MERMAID_VIEWER_TAP_SLOP_PX = 8;

export type MermaidViewerPan = { x: number; y: number };

export type MermaidViewerTransform = { scale: number; pan: MermaidViewerPan };

/** pinch 缩放 clamp：不小于原始档、不大于最大档；NaN 回退原始档。 */
export function clampMermaidViewerScale(scale: number): number {
  if (Number.isNaN(scale)) {
    return MERMAID_VIEWER_MIN_SCALE;
  }
  return Math.min(
    MERMAID_VIEWER_MAX_SCALE,
    Math.max(MERMAID_VIEWER_MIN_SCALE, scale),
  );
}

/**
 * 平移边界 clamp：内容以容器中心为原点放量，
 * 当前缩放下可达范围为 ±size*(scale-1)/2，越界收回到边缘。
 */
export function clampMermaidViewerPan(
  pan: MermaidViewerPan,
  scale: number,
  viewportWidth: number,
  viewportHeight: number,
): MermaidViewerPan {
  const maxX = Math.max(0, (viewportWidth * (scale - 1)) / 2);
  const maxY = Math.max(0, (viewportHeight * (scale - 1)) / 2);
  // `+ 0` 归一 -0（clamp 边界会产出 -0，deep equal 时与 0 不等）
  return {
    x: Math.min(maxX, Math.max(-maxX, pan.x)) + 0,
    y: Math.min(maxY, Math.max(-maxY, pan.y)) + 0,
  };
}

/**
 * pinch 变换：以双指中点为锚缩放（中点处内容视口坐标稳定），
 * 返回 clamp 后的 scale/pan。focusX/Y 为中点相对容器中心的坐标。
 */
export function computeMermaidViewerPinch(
  prev: MermaidViewerTransform,
  startDistance: number,
  currentDistance: number,
  focusX: number,
  focusY: number,
  viewportWidth: number,
  viewportHeight: number,
): MermaidViewerTransform {
  const ratio = startDistance > 0 ? currentDistance / startDistance : 1;
  const scale = clampMermaidViewerScale(prev.scale * ratio);
  const factor = prev.scale > 0 ? scale / prev.scale : 1;
  // screen = world*scale + pan；锚点不动 → newPan = focus - (focus - pan)*factor
  const pan = clampMermaidViewerPan(
    {
      x: focusX - (focusX - prev.pan.x) * factor,
      y: focusY - (focusY - prev.pan.y) * factor,
    },
    scale,
    viewportWidth,
    viewportHeight,
  );
  return { scale, pan };
}

export type MermaidViewerDoubleTap =
  | { kind: 'ignore' }
  | { kind: 'toggle'; scale: number };

/**
 * 双击状态机：上次轻触时间戳在阈值内 → 原始 ↔ 放大档位切换；
 * 超阈值（或无上次记录）→ ignore，由调用方记录本次时间戳。
 */
export function resolveMermaidViewerDoubleTap(
  lastTapAtMs: number,
  nowMs: number,
  currentScale: number,
): MermaidViewerDoubleTap {
  if (
    lastTapAtMs <= 0 ||
    nowMs - lastTapAtMs > MERMAID_DOUBLE_TAP_INTERVAL_MS
  ) {
    return { kind: 'ignore' };
  }
  const next =
    currentScale > MERMAID_VIEWER_MIN_SCALE
      ? MERMAID_VIEWER_MIN_SCALE
      : MERMAID_VIEWER_DOUBLE_TAP_SCALE;
  return { kind: 'toggle', scale: clampMermaidViewerScale(next) };
}
