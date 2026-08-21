# 20260821 mermaid 全屏清晰度 C 线实现（impl-C-overlay）

## 请求

实现 spec（docs/Iterations/protocol-merge-agent-tool-mermaid-sharp/spec.md）Step C1 + C2：

- C1：`apps/mobile/src/web/webview-host/chat-transcript/mermaid-viewer-gestures.ts` 加纯函数 `computeBakedSvgSize(baseRendered, scale)`（fit 基准渲染尺寸 × scale，非 viewBox 原始值）、`rebasePanAfterBake(pan, scale)`（烘焙后残差换算）；pan clamp 公式参数化为 `max(0, (contentRendered - stage) / 2)`（contentRendered = 布局尺寸 × gesture.scale），旧公式 `viewport*(scale-1)/2` 废弃。
- C2：`MermaidViewerOverlay.tsx` pinch onTouchEnd 落定烘焙（D8 三件套：maxWidth/maxHeight none → px width/height → gesture 归一 + transform 纯 translate）；双击路径 180ms transition 结束后烘焙（D9）；无 viewBox 回退分支跳过烘焙；手势中逻辑零改动。
- 不改测试（C3 负责），需 `npm run build:webview` 通过；红线不动 snapshot.ts / stream.ts / mermaid-core.ts。

## 执行

worktree `.woktree/pms`，分支 `feat/protocol-merge-agent-tool-mermaid-sharp`。

关键几何结论（备查）：

- fit 基准渲染尺寸：打开时（scale=1、无 transform）在挂载 effect 里同步读 `svg.getBoundingClientRect()`（width/height 100% 布局下 SVG 盒 = viewport 盒）+ 解析 viewBox，按 meet 取 `fitRatio = min(盒宽/vb宽, 盒高/vb高)`，baseRendered = fitRatio × viewBox 尺寸。盒本身不是内容渲染尺寸（SVG 盒被 100% 拉满，内容 meet 居中内缩），直接拿盒当基准会让 pan clamp 在宽图上偏松。
- pan 烘焙换算是恒等映射：flex 居中 + meet 居中 + transform-origin 中心三层对齐，烘焙只改布局尺寸不动中心，pan（translate 的屏幕 px 偏移）参考点与单位都不变。`rebasePanAfterBake` 独立成函数是给坐标系锁定断言留挂点。
- 烘焙/解除烘焙成对：pinch 起点与双击 toggle 先解除烘焙（布局恢复 100%、gesture.scale 恢复绝对倍率），保证 clamp [1,6] 与双击档位判断始终在「相对 fit 的绝对倍率」坐标系；落定再烘回 px。若只烘不解除，二次 pinch 的 clamp 会变成相对上次落定值（[T, 6T]），无法捏回 fit。
- 烘焙 px 会被 flex-shrink 收缩（SVG UA overflow:hidden 使 min-width:auto 归零），三件套之外补内联 `flexShrink='0'`。
- 双击过渡后烘焙用 transitionend + 200ms 兜底定时器双保险；新手势 touchstart 时 flush 挂起烘焙，避免 transition 与手势竞争。

结果（20260821 完成）：

- C1：`mermaid-viewer-gestures.ts`——`clampMermaidViewerPan` 改为 (pan, contentRenderedW/H, stageW/H) 新公式；`computeMermaidViewerPinch` 后两参改为 layoutW/H + stageW/H，内部 content = layout × scale；新增 `computeBakedSvgSize`、`rebasePanAfterBake`（恒等换算）与 `MermaidViewerSize` 类型。
- C2：`MermaidViewerOverlay.tsx`——挂载 effect 同步测 fit 基准（svg rect + viewBox meet 换算）；`bake()`/`unbake()` 成对（pinch 起、双击 toggle 先解除，落定再烘）；双击过渡后烘焙 transitionend + 200ms 兜底；新手势 touchstart flush 挂起烘焙。
- 验证：`npm run build:webview` 通过；`tsc --noEmit -p src/web/tsconfig.json` 绕过存量 TS5101（tsconfig baseUrl 弃用警告，与本改动无关）后无类型错误。测试留 C3。

## 追加（20260821，impl-C3-tests）

### 请求

实现 spec Step C3：`apps/mobile/__tests__/mermaid-fullscreen.test.ts` 新增 T-MS1（bake 纯函数）/T-MS2（Overlay 烘焙契约）用例；T-MF2 按新签名改写（clamp viewport 单参 → contentRendered/stage 双参，pinch 加 layout 双参）；T-MF1/MF3/MF5 契约不破；`npm run build:webview` 后 dist 断言仍绿；`mermaid-webview.test.ts` 全绿。

### 执行

- T-MF2 适配：pan clamp 用例改传 (pan, contentRenderedW/H, stageW/H)，取布局=舞台=400x800、scale=3 → contentRendered=1200x2400，旧期望值（x∈[-400,400]、y∈[-800,800]）数值不变；pinch 用例补 layout 双参（fit 档未烘烖：布局=舞台）。
- T-MS1：computeBakedSvgSize 用例强调 fit 基准（400x300）非 viewBox 原始值；rebasePanAfterBake 恒等断言（含返回新对象防共享引用）；clamp 两态各一条（手势中 contentRendered=布局×scale；烘烖后=烘烖 px、scale=1），同参数同边界锁「两态经同一 clamp 不跳变」。
- T-MS2 源码断言两次纠错备查：①`overlay.indexOf('bake();', scheduleIdx)` 命中的是 `!viewport` 提前分支而非 finish 体内，改从 `const finish` 定义处向后定位；②finish 体内的 bake() 文本位置先于外层 addEventListener 行（回调体在定义处展开），时序断言改锁「finish 内先 removeEventListener 再 bake」；③文件头注释含「不经 setState」字样，`not.toContain('setState')` 会误伤，断言范围收窄到 onTouchMove 函数体（无 setState(/useState( 调用）+ 整文件 not.toMatch(/useState/)。
- worktree 依赖未装全（apps/mobile/node_modules 缺 markdown-it，主仓有），`npm install` 补齐后 mermaid-webview.test.ts 才能跑；lock 文件无改动。

### 结果

- 全部用例绿：mermaid-fullscreen.test.ts 21 个（T-MF1~MF5 + T-MS1 + T-MS2 + T-MF2 适配）、mermaid-webview.test.ts 9 个（T-MV/T-MT 系）；build:webview 重建后 T-MF5 dist 断言仍绿。
