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

describe('mermaid 全屏查看器共享模块源码契约 (T-MF1)', () => {
  it('runtime 含委托/克隆/post 双向通知，不含失败态匹配', () => {
    const runtime = webSrc('shared/mermaid-fullscreen/mermaid-fullscreen.ts');
    // document 级 click 事件委托：整树重建不丢监听
    expect(runtime).toContain("closest('.mermaid-block__chart')");
    // 克隆不移动：原图 DOM 零改动
    expect(runtime).toContain('cloneNode(true)');
    expect(runtime).toContain('querySelector(\'svg\')');
    // 对称消息模式：开/关都通知 RN
    expect(runtime).toContain("'mermaidViewerOpened'");
    expect(runtime).toContain("'mermaidViewerClosed'");
    // 失败态（源码回退）不匹配选择器，天然不可进全屏
    expect(runtime).not.toContain('.mermaid-failed');
    expect(runtime).toContain("classList.add('mermaid-viewer-open')");
  });

  it('样式常量：主题变量 + z-index 对齐 menu 量级 + 禁滚动', () => {
    const styles = webSrc(
      'shared/mermaid-fullscreen/mermaid-fullscreen-styles.ts',
    );
    expect(styles).toContain('MERMAID_FULLSCREEN_CSS');
    expect(styles).toContain('var(--bg');
    expect(styles).toContain('var(--surface');
    expect(styles).toContain('var(--text');
    expect(styles).toMatch(/9998/);
    expect(styles).toContain('.mermaid-fullscreen-backdrop');
    expect(styles).toContain('body.mermaid-viewer-open');
  });
});

describe('mermaid 全屏查看器两管线接线 (T-MF3)', () => {
  it('两 index.html 含 portal 宿主；两 main.ts 含注册与委托；两 bridge 含 closeMermaidViewer 分支', () => {
    // rich-document：#overlay-portal 与 #doc 平级；chat：#mermaid-viewer-portal 与 #menu-portal 平级
    expect(webSrc('rich-document/index.html')).toContain(
      'id="overlay-portal"',
    );
    expect(webSrc('chat-transcript/index.html')).toContain(
      'id="mermaid-viewer-portal"',
    );

    // 两 main.ts：注册渲染入口 + 事件委托挂接（模块初始化处，不进渲染链路）
    for (const rel of [
      'rich-document/webview/main.ts',
      'chat-transcript/webview/main.ts',
    ]) {
      const main = webSrc(rel);
      expect(main).toContain('registerMermaidViewerView');
      expect(main).toContain('attachMermaidViewerDelegation');
      expect(main).toContain('MermaidViewerOverlay');
    }

    // 两 bridge：closeMermaidViewer 分支（关覆盖层 + post closed）
    expect(webSrc('rich-document/webview/runtime/bridge.ts')).toContain(
      "msg.type === 'closeMermaidViewer'",
    );
    expect(webSrc('chat-transcript/webview/runtime/bridge/bridge.ts')).toContain(
      "case 'closeMermaidViewer':",
    );
  });

  it('rich-document main 挂接不进 setDocument 视图刷新链路（T-MV1 顺序不变）', () => {
    const main = webSrc('rich-document/webview/main.ts');
    // T-MV1 钉住的顺序仍成立
    expect(main).toMatch(
      /renderMermaidBlocks\(docRoot\)[\s\S]*refreshAnnotateAfterDocument/,
    );
    // 全屏注册在 registerSetDocumentView 回调之外（模块初始化处）
    expect(main).toMatch(
      /\}\);\n\nbindAnnotateUi[\s\S]*registerMermaidViewerView/,
    );
  });
});

describe('mermaid 全屏查看器 RN 返回键契约 (T-MF4)', () => {
  it('ChatTranscriptWebView 两消息上浮；hook 拦截位在 menu 前；RichDocumentWebView 自注册 BackHandler', () => {
    // chat：两消息照 menuOpened→onWebMenuOpenChange 先例上浮
    const chatWeb = rnSrc('components/chat/ChatTranscriptWebView.tsx');
    expect(chatWeb).toContain("message.type === 'mermaidViewerOpened'");
    expect(chatWeb).toContain("message.type === 'mermaidViewerClosed'");
    expect(chatWeb).toContain('onWebMermaidViewerOpenChange');
    // 返回键关闭下发通道（照 menuCloseSignal 先例）
    expect(chatWeb).toContain("type: 'closeMermaidViewer'");

    // hook：拦截位存在且排在 menu 拦截之前（盖在一切会话 surface 之上）
    const hook = rnSrc('hooks/useAndroidChatBackHandler.ts');
    expect(hook).toContain('mermaidViewerOpen');
    expect(hook).toContain('closeMermaidViewer');
    const mermaidIdx = hook.indexOf('if (mermaidViewerOpen)');
    const menuIdx = hook.indexOf('if (messageMenuOpen)');
    expect(mermaidIdx).toBeGreaterThan(-1);
    expect(menuIdx).toBeGreaterThan(-1);
    expect(mermaidIdx).toBeLessThan(menuIdx);

    // rich-document：组件内自注册（Android only、随 focus、判 isFocused 防吞上层返回）
    const richWeb = rnSrc('components/vfs/RichDocumentWebView.tsx');
    expect(richWeb).toContain('BackHandler.addEventListener');
    expect(richWeb).toContain("Platform.OS !== 'android'");
    expect(richWeb).toContain('navigation.isFocused()');
    expect(richWeb).toContain("type: 'closeMermaidViewer'");
    expect(richWeb).toContain("message.type === 'mermaidViewerOpened'");
    expect(richWeb).toContain("message.type === 'mermaidViewerClosed'");
  });
});

describe('mermaid 全屏查看器 dist 产物契约 (T-MF5)', () => {
  it('两包 app.js 含全屏模块标识；app.css 含 .mermaid-fullscreen 样式；index.html 含 portal', () => {
    for (const pkg of ['chat-transcript', 'rich-document'] as const) {
      const appJs = readWebViewDistFile(pkg, 'app.js');
      expect(appJs).toContain('mermaidViewerOpened');
      expect(appJs).toContain('mermaidViewerClosed');
      expect(appJs).toContain('closeMermaidViewer');
      // esbuild 打印层会把单引号规范化为双引号，dist 断言用双引号形态
      expect(appJs).toContain('closest(".mermaid-block__chart")');
      expect(appJs).toContain('cloneNode(true)');

      const appCss = readWebViewDistFile(pkg, 'app.css');
      expect(appCss).toContain('.mermaid-fullscreen-backdrop');
      expect(appCss).toContain('.mermaid-fullscreen-close');
      expect(appCss).toContain('body.mermaid-viewer-open');
    }
    expect(readWebViewDistFile('rich-document', 'index.html')).toContain(
      'overlay-portal',
    );
    expect(readWebViewDistFile('chat-transcript', 'index.html')).toContain(
      'mermaid-viewer-portal',
    );
  });

  it('按压暗示进入两包富文本样式（rich-content-styles 单源）', () => {
    const styles = webSrc('shared/rich-content-styles.ts');
    expect(styles).toContain('.mermaid-block__chart:active');
    for (const pkg of ['chat-transcript', 'rich-document'] as const) {
      expect(readWebViewDistFile(pkg, 'app.css')).toContain(
        '.mermaid-block__chart:active',
      );
    }
  });
});

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
