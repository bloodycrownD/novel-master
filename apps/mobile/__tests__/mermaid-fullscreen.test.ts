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
  computeBakedSvgSize,
  computeMermaidViewerPinch,
  rebasePanAfterBake,
  resolveMermaidViewerDoubleTap,
} from '../src/web/shared/mermaid-fullscreen/mermaid-viewer-gestures';
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

  it('attach 幂等守卫 + open 前成对校验 _renderView/_post（防叠加监听/白屏开门）', () => {
    const runtime = webSrc('shared/mermaid-fullscreen/mermaid-fullscreen.ts');
    // 重复 attach 只更新 post，不叠加 document 监听器
    expect(runtime).toMatch(/if \(_delegationAttached\)/);
    // 开门前成对校验：渲染器缺失白屏、post 缺失无法通知 RN 关闭
    expect(runtime).toMatch(/if \(!_renderView \|\| !_post\)/);
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

    // 两 main.ts：portal 一行挂接 + 事件委托（模块刈处，不进渲染链路；web/C-orch-5）
    for (const rel of [
      'rich-document/webview/main.ts',
      'chat-transcript/webview/main.ts',
    ]) {
      const main = webSrc(rel);
      expect(main).toContain('mountMermaidViewerPortal');
      expect(main).toContain('attachMermaidViewerDelegation');
    }

    // 挂接块单源：mountMermaidViewerPortal 内含 Overlay 渲染与卸载
    const mount = webSrc('shared/mermaid-fullscreen/mermaid-fullscreen.ts');
    expect(mount).toContain('function mountMermaidViewerPortal');
    expect(mount).toContain('MermaidViewerOverlay');

    // 两 bridge：closeMermaidViewer 分支（关覆盖层 + post closed）
    expect(webSrc('rich-document/webview/runtime/bridge.ts')).toContain(
      "msg.type === 'closeMermaidViewer'",
    );
    expect(webSrc('chat-transcript/webview/runtime/bridge.ts')).toContain(
      "case 'closeMermaidViewer':",
    );
  });

  it('rich-document main 挂接不进 setDocument 视图刷新链路（T-MV1 顺序不变）', () => {
    const main = webSrc('rich-document/webview/main.ts');
    // T-MV1 钉住的顺序仍成立
    expect(main).toMatch(
      /renderMermaidBlocks\(docRoot\)[\s\S]*refreshAnnotateAfterDocument/,
    );
    // 全屏挂接在 registerSetDocumentView 回调之外（模块刈处一行调用）
    expect(main).toMatch(
      /\}\);\n\nbindAnnotateUi[\s\S]*mountMermaidViewerPortal/,
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

  it('chat 链路把 mermaid viewer 开关态接到 useAndroidChatBackHandler（照 menu 同款模式）', () => {
    // Provider：拦截态 + 下发信号 + 关闭回调（照 webMenuOpen/webMenuCloseSignal 先例）
    const provider = rnSrc('screens/tabs/chat-tab/ChatTabProvider.tsx');
    expect(provider).toContain('mermaidViewerOpen');
    expect(provider).toContain('mermaidViewerCloseSignal');
    expect(provider).toContain('closeMermaidViewer');

    // ConversationPanel：两 props 从 context 下传到 ChatTranscriptWebView
    const panel = rnSrc('screens/tabs/chat-tab/ChatConversationPanel.tsx');
    expect(panel).toContain(
      'mermaidViewerCloseSignal={mermaidViewerCloseSignal}',
    );
    expect(panel).toContain(
      'onWebMermaidViewerOpenChange={ctx.setMermaidViewerOpen}',
    );

    // NavigationProvider：closeMermaidViewer 转发（照 closeMessageMenu 先例）
    const navProvider = rnSrc(
      'screens/tabs/chat-tab/ChatTabNavigationProvider.tsx',
    );
    expect(navProvider).toContain('closeMermaidViewer: ctx.closeMermaidViewer');

    // Screen：back state 拦截位 + 关闭动作接线
    const screen = rnSrc('screens/tabs/ChatTabScreen.tsx');
    expect(screen).toContain('mermaidViewerOpen: ctx.mermaidViewerOpen');
    expect(screen).toContain(
      'closeMermaidViewer: nav.actions.closeMermaidViewer',
    );
  });
});

describe('mermaid 全屏查看器 dist 产物契约 (T-MF5)', () => {
  it('两包 app.js 含全屏模块标识；app.css 含 .mermaid-fullscreen 样式；index.html 含 portal', () => {
    for (const pkg of ['chat-transcript', 'rich-document'] as const) {
      const appJs = readWebViewDistFile(pkg, 'app.js');
      expect(appJs).toContain('mermaidViewerOpened');
      expect(appJs).toContain('mermaidViewerClosed');
      expect(appJs).toContain('closeMermaidViewer');
      // 引号风格容忍（prettier singleQuote 后 dist 产物为单引号），只锁选择器语义
      expect(appJs).toMatch(/closest\(['"]\.mermaid-block__chart['"]\)/);
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

describe('mermaid 全屏查看器烘焙纯函数 (T-MS1)', () => {
  it('computeBakedSvgSize：fit 基准渲染尺寸 × scale（非 viewBox 原始值）', () => {
    // 舞台 400x800、viewBox 800x600 → fitRatio = min(400/800, 800/600) = 0.5
    // → fit 基准渲染尺寸 400x300（meet 内缩），不是 viewBox 的 800x600
    const baseRendered = {width: 400, height: 300};
    expect(computeBakedSvgSize(baseRendered, 2.5)).toEqual({
      width: 1000,
      height: 750,
    });
    // scale=1 即 fit 基准本身（总倍率回 fit 档的场合）
    expect(computeBakedSvgSize(baseRendered, 1)).toEqual(baseRendered);
    // NaN 等非法倍率按 1 兜底，不产出 NaN px
    expect(computeBakedSvgSize(baseRendered, Number.NaN)).toEqual(baseRendered);
  });

  it('rebasePanAfterBake：恒等映射，输出 pan 数值不变（锁坐标系）', () => {
    // 几何论证：flex 居中 + meet 居中 + transform-origin 中心三层对齐，
    // 烘焙只改布局尺寸不动中心，pan（translate 的屏幕 px 偏移）参考点与
    // 单位都不变——烘焙前后平移由同一坐标系承担，无需换算
    expect(rebasePanAfterBake({x: -37.5, y: 12.25}, 2.5)).toEqual({
      x: -37.5,
      y: 12.25,
    });
    expect(rebasePanAfterBake({x: 0, y: 0}, 6)).toEqual({x: 0, y: 0});
    // 返回新对象：调用方拿它直接写入 gesture.current，不共享旧引用
    const pan = {x: 1, y: 2};
    expect(rebasePanAfterBake(pan, 3)).not.toBe(pan);
  });

  it('clamp 新坐标系边界 max(0,(contentRendered-stage)/2)：手势中（布局×scale）', () => {
    // 手势中布局保持 fit 基准 400x300，scale=3 → contentRendered=1200x900；
    // 舞台 400x800 → maxX=(1200-400)/2=400，maxY=(900-800)/2=50
    const layout = {width: 400, height: 300};
    const scale = 3;
    expect(
      clampMermaidViewerPan(
        {x: 500, y: 60},
        layout.width * scale,
        layout.height * scale,
        400,
        800,
      ),
    ).toEqual({x: 400, y: 50});
    expect(
      clampMermaidViewerPan(
        {x: -500, y: -60},
        layout.width * scale,
        layout.height * scale,
        400,
        800,
      ),
    ).toEqual({x: -400, y: -50});
    // 界内不动
    expect(
      clampMermaidViewerPan(
        {x: 100, y: 20},
        layout.width * scale,
        layout.height * scale,
        400,
        800,
      ),
    ).toEqual({x: 100, y: 20});
  });

  it('clamp 新坐标系边界：烘焙后（contentRendered=烘焙 px、scale=1）', () => {
    // 烘焙后布局即烘焙 px（fit 400x300 × 总倍率 3 = 1200x900）、scale=1，
    // 与手势中同公式同边界——两态经同一 clamp，落定瞬间平移不跳变
    expect(clampMermaidViewerPan({x: 500, y: 60}, 1200, 900, 400, 800)).toEqual(
      {x: 400, y: 50},
    );
    // 内容不超舞台（fit 档）→ 边界 0，锁中心
    expect(clampMermaidViewerPan({x: 120, y: -80}, 400, 300, 400, 800)).toEqual(
      {x: 0, y: 0},
    );
  });
});

describe('mermaid 全屏查看器落定烘焙契约 (T-MS2)', () => {
  it('onTouchEnd 抬指落定烘焙；双击已调度过渡烘焙时让位', () => {
    const overlay = webSrc('shared/mermaid-fullscreen/MermaidViewerOverlay.tsx');
    // pinch 抬指即烘（D8）；pendingBakeFinish 让位避免立即烘焙取消过渡动画
    expect(overlay).toMatch(/if \(!pendingBakeFinish\.current\) \{\s*bake\(\);\s*\}/);
    // pinch 起点先解除烘焙：档位计算回到「相对 fit 的绝对倍率」坐标系
    expect(overlay).toMatch(/unbake\(\);[\s\S]*pinch\.current = \{/);
  });

  it('烘焙前置 maxWidth/maxHeight=none 再写 px 尺寸，flexShrink 补零', () => {
    const overlay = webSrc('shared/mermaid-fullscreen/MermaidViewerOverlay.tsx');
    // bake 函数体内顺序锁定：先解除 viewport svg 的百分比钳制，再落 px
    const bakeStart = overlay.indexOf('const bake = () => {');
    const unbakeStart = overlay.indexOf('const unbake = () => {');
    expect(bakeStart).toBeGreaterThan(-1);
    expect(unbakeStart).toBeGreaterThan(bakeStart);
    const bakeBody = overlay.slice(bakeStart, unbakeStart);
    const maxWIdx = bakeBody.indexOf("svg.style.maxWidth = 'none'");
    const maxHIdx = bakeBody.indexOf("svg.style.maxHeight = 'none'");
    const widthIdx = bakeBody.indexOf(
      "svg.setAttribute('width', String(size.width))",
    );
    const heightIdx = bakeBody.indexOf(
      "svg.setAttribute('height', String(size.height))",
    );
    expect(maxWIdx).toBeGreaterThan(-1);
    expect(maxHIdx).toBeGreaterThan(maxWIdx);
    expect(widthIdx).toBeGreaterThan(maxHIdx);
    expect(heightIdx).toBeGreaterThan(widthIdx);
    // 烘焙 px 会被 flex 收缩，内联 flexShrink 归零防护
    expect(bakeBody).toContain("svg.style.flexShrink = '0'");
    // 烘焙换算走纯函数，gesture 归一 scale=1、transform 复位纯 translate
    expect(bakeBody).toContain('computeBakedSvgSize(base, total)');
    expect(bakeBody).toContain('rebasePanAfterBake(');
    // 花括号内空格容忍（bracketSpacing:false），锁 scale=1 归一语义
    expect(bakeBody).toMatch(/gesture\.current = \{\s*scale: 1,\s*pan\s*\}/);
  });

  it('双击过渡后烘焙时序：transitionend 监听 + 兜底定时器双保险', () => {
    const overlay = webSrc('shared/mermaid-fullscreen/MermaidViewerOverlay.tsx');
    // 过渡结束后才烘焙（D9）：双击 toggle 只调度 scheduleBakeAfterTransition，
    // 烘焙收敛在 finish 回调内（先摘监听与定时器，再 bake）
    const finishIdx = overlay.indexOf('const finish = () => {');
    const removeListenerIdx = overlay.indexOf(
      "current.removeEventListener('transitionend', finish)",
    );
    const bakeInFinishIdx = overlay.indexOf('bake();', finishIdx);
    expect(finishIdx).toBeGreaterThan(-1);
    expect(removeListenerIdx).toBeGreaterThan(finishIdx);
    expect(bakeInFinishIdx).toBeGreaterThan(removeListenerIdx);
    // transitionend 丢失时由兜底定时器触发同一 finish（略宽于过渡时长）
    expect(overlay).toMatch(
      /window\.setTimeout\(\s*finish,\s*MERMAID_BAKE_FALLBACK_MS,?\s*\)/,
    );
  });

  it('手势中仍直写 transform（不 setState、不经重渲）', () => {
    const overlay = webSrc('shared/mermaid-fullscreen/MermaidViewerOverlay.tsx');
    // 手势中唯一写 transform 的出口（直写 style，不经重渲）
    expect(overlay).toContain('viewport.style.transform =');
    // onTouchMove 体内：调 applyTransform 直写，无状态调用
    // （文件头注释含「不经 setState」字样，断言范围收窄到手势函数体）
    const moveIdx = overlay.indexOf(
      'const onTouchMove = (event: TouchEvent) => {',
    );
    const moveEnd = overlay.indexOf(
      'const onTouchEnd = (event: TouchEvent) => {',
    );
    expect(moveIdx).toBeGreaterThan(-1);
    expect(moveEnd).toBeGreaterThan(moveIdx);
    const moveBody = overlay.slice(moveIdx, moveEnd);
    expect(moveBody).toContain('applyTransform();');
    expect(moveBody).not.toContain('setState(');
    expect(moveBody).not.toContain('useState(');
    // 组件本身无状态（ref 驱动，重渲染不选手势路径）
    expect(overlay).not.toMatch(/useState/);
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

  it('pan clamp：按视觉内容尺寸算可达范围，内容不超舞台时锁中心', () => {
    // 布局 400x800（fit 档 = 舞台）、scale=1 → 不可平移
    expect(clampMermaidViewerPan({x: 120, y: -80}, 400, 800, 400, 800)).toEqual({
      x: 0,
      y: 0,
    });
    // 布局 400x800、scale=3 → contentRendered=1200x2400 → x ∈ [-400, 400]，y ∈ [-800, 800]
    expect(
      clampMermaidViewerPan({x: 500, y: 900}, 1200, 2400, 400, 800),
    ).toEqual({
      x: 400,
      y: 800,
    });
    expect(
      clampMermaidViewerPan({x: -500, y: -900}, 1200, 2400, 400, 800),
    ).toEqual({
      x: -400,
      y: -800,
    });
    expect(
      clampMermaidViewerPan({x: 100, y: 200}, 1200, 2400, 400, 800),
    ).toEqual({
      x: 100,
      y: 200,
    });
  });

  it('pinch 变换：中点锚定缩放且结果被 clamp', () => {
    // 原始档中心放大 2x：focus=(0,0) 时 pan 保持 0
    // （fit 档未烘焙：布局=舞台=400x800，contentRendered=布局×scale）
    const centered = computeMermaidViewerPinch(
      {scale: 1, pan: {x: 0, y: 0}},
      100,
      200,
      0,
      0,
      400,
      800,
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
