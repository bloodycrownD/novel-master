---
date: 2026-08-22 00:10
title: mermaid 全屏放大模糊根因与「落定烘焙」修复
keywords: mermaid, 全屏查看器, 栅格化, will-change, 烘焙, transform, fit 基准
abstract: 模糊根因是 will-change 合成层栅格化（非渲染分辨率）；采用「手势中 transform 保帧率、落定烘焙 px 触发矢量重排」方案实现并测试全绿（21+9 用例），待 iOS/Android 真机验证。
---

user:
mermaid 还是糊，看起来还是对渲染的图片放大，不是实时 svg。像素能否提高？

assistant:
根因不是渲染分辨率：`mermaid-core.ts` 输出 SVG 直接 innerHTML 插入（初始化 startOnLoad:false、securityLevel:'strict'、未显式关 htmlLabels），普通预览态（max-width:100% + viewBox）是矢量缩放。模糊出在全屏查看器的缩放实现：`.mermaid-fullscreen-viewport { will-change: transform }` 提升合成层后，手势每帧写 `style.transform`，层在 scale=1 时栅格化成位图，放大（最大 6x、双击 2.5x）只是位图采样、SVG 矢量从不重绘；onTouchEnd 只固化状态无重绘补偿（推断 iOS WKWebView 持续不重栅一直糊、Android Blink 手势稳定后延迟重栅先糊后清，可作真机判别手段）。修复方向首选：手势中 transform 保帧率 + 落定后按倍率改写 SVG width/height（px）触发矢量重排并归一 gesture；次选 fontSize 超采样（需扩渲染缓存键）；不建议只删 will-change。两条管线共用 Overlay，修一处双入口（预览+聊天）生效。已并入三合一迭代 C 线（`docs/Iterations/protocol-merge-agent-tool-mermaid-sharp/` Step C1-C4）。

user:
继续干吧（按 spec 实现 C 线）。

assistant:
实现要点（备查）：
- **fit 基准渲染尺寸** = fitRatio × viewBox（挂载 effect 同步读 svg.getBoundingClientRect() + 解析 viewBox 按 meet 取 min 比）——SVG 盒被 100% 拉满、内容 meet 居中内缩，直接拿盒当基准会让宽图 pan clamp 偏松；`computeBakedSvgSize(baseRendered, scale)` 非 viewBox 原始值。
- **烘焙/解除烘焙必须成对**：pinch 起点与双击 toggle 先解除（布局恢复 100%、gesture.scale 恢复绝对倍率），保证 clamp [1,6] 与双击档位判断始终在「相对 fit 的绝对倍率」坐标系；若只烘不解除，二次 pinch 的 clamp 变成相对上次落定值 [T,6T]，无法捏回 fit。
- pan 烘焙换算是恒等映射（flex 居中 + meet 居中 + transform-origin 中心三层对齐，烘焙只改布局尺寸不动中心），`rebasePanAfterBake` 独立成函数给坐标系锁定断言留挂点；pan clamp 公式改 `max(0,(contentRendered-stage)/2)`（contentRendered = 布局 × gesture.scale，旧公式 viewport*(scale-1)/2 废弃）。
- 烘焙 px 会被 flex-shrink 收缩（SVG UA overflow:hidden 使 min-width:auto 归零），三件套（maxWidth/maxHeight none + px 宽高 + transform 纯 translate）之外补内联 `flexShrink='0'`——spec 评审 P0-1 正是 styles 的 `svg { max-width:100% }` 会把烘焙 px 钳回 viewport 盒。
- 双击过渡后烘焙用 transitionend + 200ms 兜底定时器双保险；新手势 touchstart 时 flush 挂起烘焙，避免 transition 与手势竞争。
测试（C3）：T-MS1 锁 bake 纯函数（fit 基准非 viewBox、rebase 恒等且返回新对象）与「手势中/烘焙后两态同参数同 clamp 边界不跳变」；T-MS2 源码断言三次纠错备查——indexOf 定位要避开同名提前分支（从 `const finish` 定义处向后找）、回调体在定义处展开（时序断言锁「finish 内先 removeEventListener 再 bake」）、文件头注释含「不经 setState」会误伤 not.toContain（断言范围收窄到 onTouchMove 函数体 + 整文件 not.toMatch(/useState/)）。`npm run build:webview` 通过，mermaid-fullscreen 21 + mermaid-webview 9 用例全绿。worktree 依赖未装全时（apps/mobile 缺 markdown-it）先 `npm install` 补齐。待 C4 真机验收：iOS/Android 重栅差异、6x 巨型图内存/耗时。
