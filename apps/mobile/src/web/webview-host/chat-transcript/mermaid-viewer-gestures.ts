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

/** 尺寸（px）。 */
export type MermaidViewerSize = { width: number; height: number };

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
 * 平移边界 clamp（烘焙坐标系）：内容以舞台中心为原点居中放量，
 * 可达范围为 ±max(0, (contentRendered - stage) / 2)，越界收回到边缘。
 * contentRendered 为当前视觉内容尺寸 = 布局尺寸 × gesture.scale
 * （手势中 scale>1 时布局仍是 fit 尺寸，必须乘 scale；烘焙后布局即
 * 烘焙 px、scale=1），stage 取舞台尺寸，双参显式传入。
 * 旧公式 viewport*(scale-1)/2 在烘焙归一 scale=1 后退化为 0（无法
 * 平移），不可沿用。
 */
export function clampMermaidViewerPan(
  pan: MermaidViewerPan,
  contentRenderedWidth: number,
  contentRenderedHeight: number,
  stageWidth: number,
  stageHeight: number,
): MermaidViewerPan {
  const maxX = Math.max(0, (contentRenderedWidth - stageWidth) / 2);
  const maxY = Math.max(0, (contentRenderedHeight - stageHeight) / 2);
  // `+ 0` 归一 -0（clamp 边界会产出 -0，deep equal 时与 0 不等）
  return {
    x: Math.min(maxX, Math.max(-maxX, pan.x)) + 0,
    y: Math.min(maxY, Math.max(-maxY, pan.y)) + 0,
  };
}

/**
 * pinch 变换：以双指中点为锚缩放（中点处内容视口坐标稳定），
 * 返回 clamp 后的 scale/pan。focusX/Y 为中点相对容器中心的坐标。
 * layoutWidth/Height 为当前布局尺寸（手势中布局保持 fit 基准尺寸，
 * 烘焙态为烘焙 px），视觉内容尺寸 = 布局 × scale，pan clamp 按它算边界。
 */
export function computeMermaidViewerPinch(
  prev: MermaidViewerTransform,
  startDistance: number,
  currentDistance: number,
  focusX: number,
  focusY: number,
  layoutWidth: number,
  layoutHeight: number,
  stageWidth: number,
  stageHeight: number,
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
    layoutWidth * scale,
    layoutHeight * scale,
    stageWidth,
    stageHeight,
  );
  return { scale, pan };
}

export type MermaidViewerDoubleTap =
  | { kind: 'ignore' }
  | { kind: 'toggle'; scale: number };

/**
 * 烘焙尺寸换算：SVG width/height 落定的 px = fit 基准渲染尺寸 × scale。
 * baseRendered 是 fit 态（width/height 100% + preserveAspectRatio meet）
 * 的实际渲染尺寸（= fitRatio × viewBox 尺寸），不是 viewBox 原始值——
 * 后者与 CSS 百分比布局基准脱节，烘焙后会跳变。scale 为相对 fit 的
 * 视觉总倍率（NaN 等非法值按 1 兜底）。
 */
export function computeBakedSvgSize(
  baseRendered: MermaidViewerSize,
  scale: number,
): MermaidViewerSize {
  const factor = Number.isFinite(scale) ? scale : 1;
  return {
    width: baseRendered.width * factor,
    height: baseRendered.height * factor,
  };
}

/**
 * 烘焙后 pan 残差换算：scale 烘进 SVG 布局尺寸、transform 复位为纯
 * translate后，求视觉等价的新 pan。
 * 几何上这是恒等映射：内容中心经 flex 居中 + meet 居中始终与 viewport
 * 中心（transform-origin）重合，烘焙只改布局尺寸不动中心对齐，pan
 * （translate 的屏幕像素偏移）参考点与单位都不变。独立成函数是给
 * 坐标系锁定断言留挂点（未来若烘焙 px 取整需补偿，改这里）。
 */
export function rebasePanAfterBake(
  pan: MermaidViewerPan,
  _scale: number,
): MermaidViewerPan {
  return { x: pan.x + 0, y: pan.y + 0 };
}

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
