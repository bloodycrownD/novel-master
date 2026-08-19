/**
 * Mermaid 全屏查看器覆盖层（两管线共用 Preact 组件）。
 * 挂载/卸载由各管线 main render 到 body 级 portal（#overlay-portal /
 * #mermaid-viewer-portal）；克隆 SVG 在 effect 内挂入视口容器（fit-to-screen：
 * 有 viewBox → width/height 100% 靠 preserveAspectRatio meet 适配，缺省回退容器满宽）。
 *
 * 手势：touch 事件接 mermaid-viewer-gestures 纯函数；进行中直接写
 * style.transform（不经 setState，避免 60fps 被重渲节流），手势结束固化到 ref。
 * 关闭：点空白（stage 非视口区）/ 右上角关闭按钮 / 宿主返回键（bridge 下发）。
 */
import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  MERMAID_VIEWER_TAP_SLOP_PX,
  clampMermaidViewerPan,
  computeMermaidViewerPinch,
  resolveMermaidViewerDoubleTap,
  type MermaidViewerPan,
} from '@web/webview-host/chat-transcript/mermaid-viewer-gestures';

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

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    // mermaid 内联 style（max-width 等）会限制 fit；克隆件样式全权由覆盖层接管
    const svg = svgClone as SVGElement;
    svg.removeAttribute('style');
    if (svg.getAttribute('viewBox')) {
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
    } else {
      // 根节点 width/height 与 viewBox 均缺 → 回退容器满宽
      svg.setAttribute('width', '100%');
    }
    viewport.appendChild(svg);
    return () => {
      svg.remove();
    };
  }, [svgClone]);

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

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length === 2) {
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
      gesture.current = computeMermaidViewerPinch(
        { scale: session.baseScale, pan: session.basePan },
        session.startDist,
        Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        (a.clientX + b.clientX) / 2 - cx,
        (a.clientY + b.clientY) / 2 - cy,
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
      gesture.current.pan = clampMermaidViewerPan(
        { x: session.basePan.x + dx, y: session.basePan.y + dy },
        gesture.current.scale,
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
    const decision = resolveMermaidViewerDoubleTap(
      lastTapAt.current,
      now,
      gesture.current.scale,
    );
    lastTapAt.current = now;
    if (decision.kind !== 'toggle') {
      return;
    }
    const { w, h } = stageMetrics();
    gesture.current = {
      scale: decision.scale,
      pan: clampMermaidViewerPan({ x: 0, y: 0 }, decision.scale, w, h),
    };
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.style.transition = 'transform 180ms ease-out';
      applyTransform();
      window.setTimeout(() => {
        viewport.style.transition = '';
      }, 200);
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
