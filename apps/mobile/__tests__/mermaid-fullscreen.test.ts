/**
 * T-MF1~T-MF5：mermaid 全屏查看器契约与纯逻辑。
 * DOM 契约照 T-MV2「读源码 + dist」惯例（Jest 为 RN 环境，无 jsdom）；
 * 手势纯函数照 menu-overlay-guards 样板 Jest 直测。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
  MERMAID_VIEWER_DOUBLE_TAP_SCALE,
  MERMAID_VIEWER_MAX_SCALE,
  MERMAID_VIEWER_MIN_SCALE,
  clampMermaidViewerPan,
  clampMermaidViewerScale,
  computeMermaidViewerPinch,
  resolveMermaidViewerDoubleTap,
} from '../src/web/webview-host/chat-transcript/mermaid-viewer-gestures';
import {readWebViewDistFile} from './helpers/read-webview-dist';

const webSrc = (rel: string) =>
  readFileSync(join(__dirname, '../src/web', rel), 'utf8');

const rnSrc = (rel: string) =>
  readFileSync(join(__dirname, '../src', rel), 'utf8');

describe('mermaid 全屏查看器手势纯函数 (T-MF2)', () => {
  it('pinch 缩放 clamp：不小于 min、不大于 max、非法值回退 min', () => {
    expect(clampMermaidViewerScale(0.3)).toBe(MERMAID_VIEWER_MIN_SCALE);
    expect(clampMermaidViewerScale(MERMAID_VIEWER_MIN_SCALE)).toBe(
      MERMAID_VIEWER_MIN_SCALE,
    );
    expect(clampMermaidViewerScale(2.5)).toBe(2.5);
    expect(clampMermaidViewerScale(99)).toBe(MERMAID_VIEWER_MAX_SCALE);
    expect(clampMermaidViewerScale(Number.NaN)).toBe(MERMAID_VIEWER_MIN_SCALE);
    expect(clampMermaidViewerScale(Number.POSITIVE_INFINITY)).toBe(
      MERMAID_VIEWER_MAX_SCALE,
    );
  });

  it('pan clamp：按当前缩放算可达范围，scale=1 时锁中心', () => {
    // 视口 400x800，scale=1 → 不可平移
    expect(clampMermaidViewerPan({x: 120, y: -80}, 1, 400, 800)).toEqual({
      x: 0,
      y: 0,
    });
    // scale=3 → x ∈ [-400, 400]，y ∈ [-800, 800]
    expect(clampMermaidViewerPan({x: 500, y: 900}, 3, 400, 800)).toEqual({
      x: 400,
      y: 800,
    });
    expect(clampMermaidViewerPan({x: -500, y: -900}, 3, 400, 800)).toEqual({
      x: -400,
      y: -800,
    });
    expect(clampMermaidViewerPan({x: 100, y: 200}, 3, 400, 800)).toEqual({
      x: 100,
      y: 200,
    });
  });

  it('pinch 变换：中点锚定缩放且结果被 clamp', () => {
    // 原始档中心放大 2x：focus=(0,0) 时 pan 保持 0
    const centered = computeMermaidViewerPinch(
      {scale: 1, pan: {x: 0, y: 0}},
      100,
      200,
      0,
      0,
      400,
      800,
    );
    expect(centered.scale).toBe(2);
    expect(centered.pan).toEqual({x: 0, y: 0});

    // 中点在 (50, 40)：锚点处内容不动 → pan = focus*(1-factor)
    const anchored = computeMermaidViewerPinch(
      {scale: 1, pan: {x: 0, y: 0}},
      100,
      200,
      50,
      40,
      400,
      800,
    );
    expect(anchored.scale).toBe(2);
    expect(anchored.pan.x).toBeCloseTo(-50);
    expect(anchored.pan.y).toBeCloseTo(-40);

    // 过度捏合被 clamp 回 min，且不产生 NaN
    const clamped = computeMermaidViewerPinch(
      {scale: 1, pan: {x: 0, y: 0}},
      100,
      0,
      0,
      0,
      400,
      800,
    );
    expect(clamped.scale).toBe(MERMAID_VIEWER_MIN_SCALE);
    expect(Number.isFinite(clamped.pan.x)).toBe(true);
  });

  it('双击状态机：两档切换与连触防抖', () => {
    const t0 = 1000;
    // 首次轻触（无上次记录）→ ignore
    expect(resolveMermaidViewerDoubleTap(0, t0, 1)).toEqual({kind: 'ignore'});
    // 阈值内二次轻触：原始 → 放大档
    expect(
      resolveMermaidViewerDoubleTap(t0, t0 + 250, MERMAID_VIEWER_MIN_SCALE),
    ).toEqual({kind: 'toggle', scale: MERMAID_VIEWER_DOUBLE_TAP_SCALE});
    // 放大档 → 切回原始
    expect(
      resolveMermaidViewerDoubleTap(
        t0,
        t0 + 250,
        MERMAID_VIEWER_DOUBLE_TAP_SCALE,
      ),
    ).toEqual({kind: 'toggle', scale: MERMAID_VIEWER_MIN_SCALE});
    // 超过间隔阈值 → 独立单击，ignore（防连触误判）
    expect(
      resolveMermaidViewerDoubleTap(
        t0,
        t0 + 301 + 250,
        MERMAID_VIEWER_MIN_SCALE,
      ),
    ).toEqual({kind: 'ignore'});
  });
});
