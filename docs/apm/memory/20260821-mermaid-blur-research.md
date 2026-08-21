# 调研：mermaid 全屏查看器放大模糊的根因与修复方向

日期：2026-08-21
前置：见 `20260820-chat-improvements-followup.md`（mermaid 渲染与全屏查看器的开发历程）

## 背景

用户反馈：mobile mermaid 预览对复杂图放大查看很模糊，问像素能否提高。

## 结论摘要

- **根因不是渲染分辨率**：`mermaid-core.ts` 输出 SVG 直接 innerHTML 插入，全链路无栅格化/DPI 环节，普通预览态（max-width:100% + viewBox）是矢量缩放。模糊出在全屏查看器的缩放实现。
- **机制**：`mermaid-fullscreen-styles.ts` L26 的 `.mermaid-fullscreen-viewport { will-change: transform }` 提升合成层 → `MermaidViewerOverlay.tsx` L74-82 手势每帧写 `style.transform = translate() scale()` → 层在 scale=1 时栅格化成位图，放大（最大 6x、双击 2.5x）只是位图采样，SVG 矢量从不重绘。`onTouchEnd` 只固化状态无重绘补偿；双击走 transition 同样不重绘。
- **佐证**：spec.md L18 选 transform 只为性能（避免 setState 节流），风险节只提卡顿未提栅格化；PRD L18 验收标准"可清晰阅读大图细节"实际未达成。
- **推断（未实测）**：iOS WKWebView 对 will-change 层持续不重栅（一直糊）；Android Blink 手势稳定后延迟重栅（先糊后清）——可作真机判别手段。次级因素：mermaid 默认 htmlLabels=true（foreignObject 文字）在部分 WebView 也被位图化。

## 修复方向（按优先级）

1. **首选：手势中 transform 保帧率 + 落定时烘焙重绘**——onTouchEnd/双击落定后按 `viewBox 宽高 × scale` 改写 SVG `width/height`（px），触发矢量重排，同时归一 gesture（scale 回 1、pan 按比例换算）。改动集中 MermaidViewerOverlay.tsx + mermaid-viewer-gestures.ts 加换算函数。回归面：`clampMermaidViewerPan` 边界数学按 transform-scale 假设，T-MF2 断言需同步更新。
2. 次选：全屏时放大 `themeVariables.fontSize` 重渲染再缩回（超采样），需扩 mermaid-core 渲染缓存键（现仅 theme+source）。
3. 不建议只删 will-change（手势动画期间照样提升合成层）。

## 关键位置

- `apps/mobile/src/web/shared/mermaid-fullscreen/MermaidViewerOverlay.tsx`（applyTransform、克隆 SVG 属性改写 L59-67）
- `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-fullscreen-styles.ts` L23-28
- `apps/mobile/src/web/webview-host/chat-transcript/mermaid-viewer-gestures.ts` L8-14（1x~6x、双击 2.5x）
- `apps/mobile/__tests__/mermaid-fullscreen.test.ts`（T-MF1-5，T-MF5 不锁 viewport 样式）
- 两条管线共用 Overlay，修一处双入口（预览+聊天）生效；宿主 WebView props 与 viewport meta 无需动。

## 状态

2026-08-21：已并入三合一迭代 `docs/Iterations/protocol-merge-agent-tool-mermaid-sharp/`（C 部分采用「手势中 transform、落定烘焙」方案，spec Step C1-C4）。

## 未闭合

- iOS/Android 真机重栅格化行为差异未实测；方案 1 需双平台验证。
- 烘焙重绘在 6x 巨型图上的内存/耗时表现未评估。
