/**
 * Mermaid 全屏查看器覆盖层（两管线共用 Preact 组件）。
 * 挂载/卸载由各管线 main render 到 body 级 portal（#overlay-portal /
 * #mermaid-viewer-portal）；克隆 SVG 在 effect 内挂入视口容器（fit-to-screen：
 * 有 viewBox → width/height 100% 靠 preserveAspectRatio meet 适配，缺省回退容器满宽）。
 *
 * 手势：touch 事件接 mermaid-viewer-gestures 纯函数；进行中直接写
 * style.transform（不经 setState，避免 60fps 被重渲节流），手势结束固化到 ref。
 * 落定烘焙（D8）：pinch 抬指 / 双击 180ms 过渡结束后，把 scale 烘进 SVG
 * 布局尺寸（width/height px），合成层位图即矢量布局尺寸，放大不再拉伸模糊；
 * pinch 起点与双击 toggle 先解除烘焙（布局恢复 100%、gesture.scale 恢复
 * 绝对倍率），保证 clamp 档位与双击判断始终在「相对 fit 的绝对倍率」坐标系。
 * 无 viewBox 的回退分支不烘焙，维持纯 transform 行为。
 * 关闭：点空白（stage 非视口区）/ 右上角关闭按钮 / 宿主返回键（bridge 下发）。
 */
import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  MERMAID_VIEWER_MIN_SCALE,
  MERMAID_VIEWER_TAP_SLOP_PX,
  clampMermaidViewerPan,
  computeBakedSvgSize,
  computeMermaidViewerPinch,
  rebasePanAfterBake,
  resolveMermaidViewerDoubleTap,
  type MermaidViewerPan,
  type MermaidViewerSize,
} from '@web/webview-host/chat-transcript/mermaid-viewer-gestures';

/** 双击档位过渡时长（D9：过渡结束后才烘焙）。 */
const MERMAID_BAKE_TRANSITION_MS = 180;

/** 过渡后烘焙的兜底定时器（略宽于过渡时长，防 transitionend 丢失）。 */
const MERMAID_BAKE_FALLBACK_MS = 200;

export type MermaidViewerOverlayProps = {
  svgClone: Element;
  onClose: () => void;
};

type DragSession = {
  startX: number;
  startY: number;
  basePan: MermaidViewerPan;
};

type PinchSession = {
  startDist: number;
  baseScale: number;
  basePan: MermaidViewerPan;
};

export function MermaidViewerOverlay({
  svgClone,
  onClose,
}: MermaidViewerOverlayProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ scale: number; pan: MermaidViewerPan }>({
    scale: 1,
    pan: { x: 0, y: 0 },
  });
  const drag = useRef<DragSession | null>(null);
  const pinch = useRef<PinchSession | null>(null);
  const lastTapAt = useRef(0);
  const moved = useRef(false);
  // 烘焙态：svg 引用、fit 基准渲染尺寸、viewBox 有无、已烘进布局的绝对倍率
  const svgRef = useRef<SVGElement | null>(null);
  const baseRenderedRef = useRef<MermaidViewerSize | null>(null);
  const hasViewBoxRef = useRef(false);
  const bakedTotalRef = useRef(MERMAID_VIEWER_MIN_SCALE);
  const pendingBakeTimer = useRef<number | null>(null);
  const pendingBakeFinish = useRef<(() => void) | null>(null);

  /** 手势中唯一写 transform 的出口（不 setState）。 */
  const applyTransform = () => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const { scale, pan } = gesture.current;
    viewport.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
  };

  const stageMetrics = () => {
    const rect = stageRef.current!.getBoundingClientRect();
    return {
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      w: rect.width,
      h: rect.height,
    };
  };

  /** clamp/烘焙共用的布局基准：fit 基准渲染尺寸 × 已烘焙倍率（未烘焙=1）。 */
  const layoutSize = (): MermaidViewerSize => {
    const base = baseRenderedRef.current;
    const { w, h } = stageMetrics();
    if (!base) {
      // viewBox 解析失败的防御退化：以舞台为内容尺寸（等价旧 viewport 公式）
      return { width: w, height: h };
    }
    const total = bakedTotalRef.current;
    return { width: base.width * total, height: base.height * total };
  };

  /** 取消挂起的「过渡后烘焙」；flush=true 时立即以当前 gesture 态落定。 */
  const clearPendingBake = (flush: boolean) => {
    if (pendingBakeTimer.current !== null) {
      window.clearTimeout(pendingBakeTimer.current);
      pendingBakeTimer.current = null;
    }
    const finish = pendingBakeFinish.current;
    pendingBakeFinish.current = null;
    if (!finish) {
      return;
    }
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.removeEventListener('transitionend', finish);
    }
    if (flush) {
      finish();
    }
  };

  /**
   * 落定烘焙（D8 三件套，缺一即失效）：
   * ① svg.style.maxWidth/maxHeight = 'none' 内联解除 viewport svg 的
   *   max-width/max-height 百分比钳制（顺带 flexShrink 归零，防 flex 收缩烘焙 px）；
   * ② SVG width/height 落为 fit 基准渲染尺寸 × 总倍率（px）；
   * ③ gesture 归一 {scale: 1, pan: 换算残差}，transform 复位为纯 translate。
   * 烘焙后平移仍由 transform 承担，stage 的 overflow: hidden 裁剪溢出。
   * 无 viewBox 回退分支跳过；总倍率回 fit 档时也跳过（保持 100% 布局即视觉等价）。
   */
  const bake = () => {
    const viewport = viewportRef.current;
    const svg = svgRef.current;
    const base = baseRenderedRef.current;
    if (!viewport || !svg || !base || !hasViewBoxRef.current) {
      return;
    }
    const total = bakedTotalRef.current * gesture.current.scale;
    viewport.style.transition = '';
    if (total <= MERMAID_VIEWER_MIN_SCALE) {
      return;
    }
    const size = computeBakedSvgSize(base, total);
    svg.style.maxWidth = 'none';
    svg.style.maxHeight = 'none';
    svg.style.flexShrink = '0';
    svg.setAttribute('width', String(size.width));
    svg.setAttribute('height', String(size.height));
    bakedTotalRef.current = total;
    const pan = rebasePanAfterBake(gesture.current.pan, gesture.current.scale);
    gesture.current = { scale: 1, pan };
    viewport.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
  };

  /**
   * 解除烘焙：布局恢复 100%（fit 态）、gesture.scale 恢复绝对倍率。
   * pinch 与双击的档位计算（clamp [1,6]、双击状态机）都按相对 fit 的绝对
   * 值进行，烘焙期间该值记在 bakedTotal。视觉等价：布局 × scale 组合不变。
   */
  const unbake = () => {
    const svg = svgRef.current;
    if (
      bakedTotalRef.current === MERMAID_VIEWER_MIN_SCALE ||
      !svg ||
      !hasViewBoxRef.current
    ) {
      return;
    }
    svg.style.maxWidth = '';
    svg.style.maxHeight = '';
    svg.style.flexShrink = '';
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    gesture.current.scale = bakedTotalRef.current;
    bakedTotalRef.current = MERMAID_VIEWER_MIN_SCALE;
    applyTransform();
  };

  /** 双击过渡结束后烘焙（D9）：transitionend 与等长兜底定时器双保险。 */
  const scheduleBakeAfterTransition = () => {
    const viewport = viewportRef.current;
    if (!viewport) {
      bake();
      return;
    }
    clearPendingBake(false);
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      if (pendingBakeTimer.current !== null) {
        window.clearTimeout(pendingBakeTimer.current);
        pendingBakeTimer.current = null;
      }
      pendingBakeFinish.current = null;
      const current = viewportRef.current;
      if (current) {
        current.style.transition = '';
        current.removeEventListener('transitionend', finish);
      }
      bake();
    };
    pendingBakeFinish.current = finish;
    viewport.addEventListener('transitionend', finish);
    pendingBakeTimer.current = window.setTimeout(
      finish,
      MERMAID_BAKE_FALLBACK_MS,
    );
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    // mermaid 内联 style（max-width 等）会限制 fit；克隆件样式全权由覆盖层接管
    const svg = svgClone as SVGElement;
    svg.removeAttribute('style');
    const viewBox = svg.getAttribute('viewBox');
    if (viewBox) {
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
    } else {
      // 根节点 width/height 与 viewBox 均缺 → 回退容器满宽
      svg.setAttribute('width', '100%');
    }
    viewport.appendChild(svg);
    svgRef.current = svg;
    // fit 基准渲染尺寸在此刻测量最稳：scale=1 且无 transform，rect 未被缩放。
    // width/height 100% 下 SVG 盒 = viewport 盒；有 viewBox 时内容经 meet
    // 内缩居中，基准渲染尺寸 = fitRatio × viewBox 尺寸（不是盒本身）；
    // 无 viewBox 时盒即内容尺寸（该分支不烘焙，仅作 clamp 布局基准）。
    const rect = svg.getBoundingClientRect();
    const parts = viewBox
      ? viewBox.trim().split(/[\s,]+/).map(Number)
      : null;
    const viewBoxValid =
      !!parts &&
      parts.length === 4 &&
      Number.isFinite(parts[2]) &&
      parts[2] > 0 &&
      Number.isFinite(parts[3]) &&
      parts[3] > 0;
    if (viewBoxValid && rect.width > 0 && rect.height > 0) {
      const vbWidth = parts![2];
      const vbHeight = parts![3];
      const fitRatio = Math.min(rect.width / vbWidth, rect.height / vbHeight);
      baseRenderedRef.current = {
        width: vbWidth * fitRatio,
        height: vbHeight * fitRatio,
      };
      hasViewBoxRef.current = true;
    } else if (rect.width > 0 && rect.height > 0) {
      baseRenderedRef.current = { width: rect.width, height: rect.height };
      hasViewBoxRef.current = false;
    }
    return () => {
      clearPendingBake(false);
      svg.remove();
      svgRef.current = null;
      baseRenderedRef.current = null;
      hasViewBoxRef.current = false;
      bakedTotalRef.current = MERMAID_VIEWER_MIN_SCALE;
    };
  }, [svgClone]);

  const onTouchStart = (event: TouchEvent) => {
    // 挂起中的「过渡后烘焙」先落定，避免 transition 与新手势写 transform 竞争
    clearPendingBake(true);
    if (event.touches.length === 2) {
      // pinch 起点解除烘焙：布局回 fit、gesture.scale 恢复绝对倍率，
      // 保证本会话的 clamp 与落定烘焙都在同一绝对坐标系
      unbake();
      const a = event.touches[0];
      const b = event.touches[1];
      pinch.current = {
        startDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
        baseScale: gesture.current.scale,
        basePan: gesture.current.pan,
      };
      drag.current = null;
    } else if (event.touches.length === 1) {
      const touch = event.touches[0];
      drag.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        basePan: gesture.current.pan,
      };
    }
    moved.current = false;
  };

  const onTouchMove = (event: TouchEvent) => {
    // 覆盖层内禁原生滚动/双击缩放（stage 另有 touch-action:none 双保险）
    event.preventDefault();
    if (event.touches.length === 2 && pinch.current) {
      const a = event.touches[0];
      const b = event.touches[1];
      const session = pinch.current;
      const { cx, cy, w, h } = stageMetrics();
      const layout = layoutSize();
      gesture.current = computeMermaidViewerPinch(
        { scale: session.baseScale, pan: session.basePan },
        session.startDist,
        Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        (a.clientX + b.clientX) / 2 - cx,
        (a.clientY + b.clientY) / 2 - cy,
        layout.width,
        layout.height,
        w,
        h,
      );
      applyTransform();
      moved.current = true;
      return;
    }
    if (event.touches.length === 1 && drag.current) {
      const touch = event.touches[0];
      const session = drag.current;
      const dx = touch.clientX - session.startX;
      const dy = touch.clientY - session.startY;
      if (Math.hypot(dx, dy) > MERMAID_VIEWER_TAP_SLOP_PX) {
        moved.current = true;
      }
      const { w, h } = stageMetrics();
      const layout = layoutSize();
      gesture.current.pan = clampMermaidViewerPan(
        { x: session.basePan.x + dx, y: session.basePan.y + dy },
        layout.width * gesture.current.scale,
        layout.height * gesture.current.scale,
        w,
        h,
      );
      applyTransform();
    }
  };

  const onTouchEnd = (event: TouchEvent) => {
    if (event.touches.length === 0) {
      pinch.current = null;
      drag.current = null;
      handleTapIfAny();
      // pinch 落定烘焙（D8）；双击 toggle 已调度「过渡后烘焙」的场合让位，
      // 避免立即烘焙取消过渡动画
      if (!pendingBakeFinish.current) {
        bake();
      }
      return;
    }
    if (event.touches.length === 1) {
      // 双指抬一指：以剩余指为新拖拽起点，避免跳变
      pinch.current = null;
      const touch = event.touches[0];
      drag.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        basePan: gesture.current.pan,
      };
    }
  };

  /** 轻触结束：双击状态机判定；toggle 档位切换带过渡（手势路径无过渡）。 */
  const handleTapIfAny = () => {
    if (moved.current) {
      lastTapAt.current = 0;
      return;
    }
    const now = Date.now();
    // 档位判断用绝对总倍率：烘焙态 gesture.scale=1 不代表回到 fit 档
    const decision = resolveMermaidViewerDoubleTap(
      lastTapAt.current,
      now,
      bakedTotalRef.current * gesture.current.scale,
    );
    lastTapAt.current = now;
    if (decision.kind !== 'toggle') {
      return;
    }
    unbake();
    const { w, h } = stageMetrics();
    const layout = layoutSize();
    gesture.current = {
      scale: decision.scale,
      pan: clampMermaidViewerPan(
        { x: 0, y: 0 },
        layout.width * decision.scale,
        layout.height * decision.scale,
        w,
        h,
      ),
    };
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.style.transition = `transform ${MERMAID_BAKE_TRANSITION_MS}ms ease-out`;
      applyTransform();
      scheduleBakeAfterTransition();
    }
  };

  /** 点空白关闭：目标不在视口（图本体）内才算空白；拖拽后的合成 click 忽略。 */
  const onStageClick: JSX.MouseEventHandler<HTMLDivElement> = (event) => {
    if (moved.current) {
      return;
    }
    const target = event.target as Element;
    if (target && target.closest('.mermaid-fullscreen-viewport')) {
      return;
    }
    onClose();
  };

  return (
    <div class="mermaid-fullscreen-backdrop">
      <div
        ref={stageRef}
        class="mermaid-fullscreen-stage"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClick={onStageClick}
      >
        <div ref={viewportRef} class="mermaid-fullscreen-viewport" />
      </div>
      <button
        type="button"
        class="mermaid-fullscreen-close"
        aria-label="关闭"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}
