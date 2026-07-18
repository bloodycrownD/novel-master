---
date: 2026-07-18
dependency: Iterations/mobile-webview-preact-htm/prd.md
---

# webview-imperative-shell-debt Feature PRD

## 背景

父迭代 `mobile-webview-preact-htm` 已将双包视图结构迁到 Preact + TSX，并完成 ui/runtime 分层与装配（P0-3）。迁移后仍残留一批**本可声明式表达的壳级命令式 DOM**（如上下文菜单用 `createElement` 挂 `document.body`），与 `ui/*.tsx` 并存，阅读成本高，易被误判为「半套框架」。

同时须区分：**不是债**的刻意命令式——流式 body 增量岛（父 SPEC P0-2）、桥/启动协议、静态 html 壳锚点上的事件委托等。本需求按「有债清债」推进，**不预先缩成单一文件**，而以落地时清单为准；已知菜单 overlay 为明确主债。

## 目标（含成功指标）

1. 清理 WebView boot 真源中剩余的**壳级 UI 命令式债务**，使浮层/壳生命周期尽量落在 `ui/**` + main 注册路径，与父迭代心智一致。  
2. **终端用户可见行为零回归**（长按菜单、关闭、定位、grace；以及其它被清债触及的交互）。  
3. **不削弱**父约束：P0-3（runtime ✗→ ui、禁 runtime 内 `preact.render`）、P1-4（菜单可见前 measure）、P0-2（流式 body 所有权）。

**成功指标**

- 已知/盘点出的壳级债项均有归宿：声明式（Preact Portal/组件）或文档标明「非债 / 已知限制」。  
- 菜单：runtime 不再以 `createElement`+`appendChild(body)` 作为菜单壳主路径；仍满足可见前 measure、无先错位再跳。  
- `build:webview` + 相关 boot-script 意图绿；行为与基线一致。

## 用户与场景

| 角色 | 场景 |
|------|------|
| 开发者 | 改菜单/浮层时主要改 `ui/` 与注册点，而不是在 runtime 手搓挂 body。 |
| 终端用户 | 无感知；长按菜单与流式体验不回退。 |

## 范围

### 包含范围

1. **盘点** `apps/mobile/src/web` 内与「壳级 UI」同类的命令式写法（`createElement` / 挂 `body` / 手搓浮层生命周期等），形成债项清单。  
2. **清理**清单中的债：优先上下文菜单 overlay（backdrop + `#context-menu` 壳）迁声明式（Portal 或等价）；其它同类债同期或同迭代内收口。  
3. 保持 P0-3：结构在 `ui`；runtime 门面；main 注册。  
4. 保持 P1-4：菜单 mount 后、可见前 measure + `layoutContextMenu`。  
5. 更新契约测关键字（若符号/结构变化）；README 最短说明「壳债 vs 刻意命令式」若有需要。

### 不包含范围

1. **流式 text/thinking body 增量 DOM**（父 P0-2：刻意岛屿，**不算本需求之债**）。  
2. 改桥协议、菜单项产品集合、流式产品 UX、视觉改版。  
3. 为「全 Preact」重写 boot 壳事件委托、滚动协议、主题 CSS 变量桥（属协议/锚点，非浮层 UI 债；除非盘点证明其与壳债不可分且用户另确认）。  
4. Desktop；开 minify；引入 htm / preact/compat。

## 核心需求（3–7 条）

1. **债清完**：不预设「只做菜单」；以盘点清单为准，有债则清，无债则在文档标明非债。  
2. **菜单壳声明式**：backdrop + 菜单容器生命周期进入 Preact（Portal/等价），内容与壳统一由已注册视图刷新驱动。  
3. **装配边界不变**：runtime 不 import `ui/**`（TrustedHtml 例外）、不在 runtime 内 `preact.render`；经 main 注册。  
4. **菜单体验不变**：可见前 measure/定位；grace / overlay 关闭语义保留。  
5. **流式非债隔离**：清理过程不得把 stream 增量路径「顺手 Preact 化」。  
6. **行为与契约意图零回归**：构建与 boot-script 意图可通过。

## 验收标准

- [ ] Given 债项清单，When 迭代结束，Then 每条债为「已声明式化」或「标明非债/已知限制」，无悬空项。  
- [ ] Given 长按消息打开菜单，When 测量与定位完成，Then 无可见的先错位再跳；关闭/点项/grace 与基线一致。  
- [ ] Given runtime/menu（或等价），When 打开菜单，Then 壳主路径不再依赖 `document.createElement` + `body.appendChild` 手搓（改由注册的 Preact 视图）。  
- [ ] Given 流式 delta，When 迭代合并后，Then 增量仍在 runtime、无因本需求引入的每 delta 整表 remount。  
- [ ] Given `build:webview` 与相关契约测，When 跑自动门禁，Then 绿；关键意图符号按矩阵可修订但不可丢。  
- [ ] Given 代码审查，When 检查依赖方向，Then 仍满足 P0-3。

## 约束与依赖

- 依赖父 PRD：`Iterations/mobile-webview-preact-htm/prd.md`（及已落地的 ui/runtime、P0-3/P1-4/P0-2）。  
- 工程旁路（`@web`、JSX automatic）可沿用，非本需求目标。

## 风险与待确认项

- 盘点时可能发现「灰区」（半协议半 UI）；默认标非债或拆后续，避免与流式/桥绑死。  
- Portal + 同步 measure 时序若处理不当会回退闪烁——验收以 P1-4 为准。
