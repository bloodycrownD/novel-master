---
date: 2026-07-18
---

# webview-imperative-shell-debt 技术规格（SPEC）

> **PRD**：[`prd.md`](./prd.md)  
> **需求来源**：父 Preact 迭代后壳级命令式债清理；用户定案「有债清债、不人为缩范围」；盘点结论：挂 body 主债 ≈ 仅 CT 菜单 overlay  
> **前置**：`Iterations/mobile-webview-preact-htm`（P0-3 / P1-4 / P0-2）

## 设计目标

1. 按盘点清单清理 **壳级 UI 命令式债**；无悬空债项（已清或标明非债/已知限制）。  
2. 上下文菜单：**backdrop + 容器 + 项** 均由 Preact 声明式产出；挂载用 **main `render` 到独立宿主**（Portal 等价，**不上** `preact/compat`）。  
3. 不削弱 P0-3、P1-4；**不改**流式 body 增量岛（P0-2 非债）。  
4. 行为零回归；契约意图可测。

## 总体方案

### 债 / 非债定案（盘点完整）

| 项 | 判定 | 动作 |
|----|------|------|
| CT 菜单 `#menu-backdrop` + `#context-menu` 的 `createElement` + `body.appendChild` / 手搓 `.remove()` | **债** | 本迭代必清 |
| 菜单 overlay / grace / `menu-open` / layout 逻辑 | 逻辑非债 | 保留在 `runtime/menu`；不再依赖手搓壳前提 |
| `ContextMenu` 菜单项 | 已声明式 | 扩展为完整 Overlay 或拆分组件 |
| 流式 `createElement(.bubble-body)` / `insertAdjacentHTML` / `StreamBodyHost` | **非债 P0-2** | 禁止本迭代改造 |
| tool-invoking「生成中」条 | **已清（单路径）** | 壳归 Preact `ToolInvokingBar`；runtime 只 state + `renderRows` |
| boot 壳委托 / 桥主题 / 静态 html 锚点 / TrustedHtml | **非债** | 不动 |
| `renderToolGroup*` 无引用拼串 | 可选死代码 | 非门禁；可顺手删 |

### 架构（菜单清债后）

```text
state.menu 变更
    → runtime renderContextMenu() 门面
    → 已注册实现（仅 main）：
         render(h(MenuOverlay, props), menuPortalRoot)
    → MenuOverlay（ui）：backdrop + #context-menu + items
    → P1-4：隐藏 → measure → layoutContextMenu → 可见
关闭 → render(null, menuPortalRoot)（或空树）；勿裸 .remove() 甩掉 Preact 根
```

**Portal 等价**：`menuPortalRoot` = `document.body` 下**独立**稳定节点（推荐 `index.html` 增加 `#menu-portal`，避免与 `#rows` 的 `render` 互毁）。禁止 `preact/compat.createPortal`。

### 唯一定案

| 项 | 定案 |
|----|------|
| 清债范围 | 盘点清单；主路径 = 菜单壳；其它 createElement 按上表非债/已知限制 |
| 壳实现 | `ui/menu` Preact（可 `MenuOverlay.tsx` + 复用/内联 items） |
| 装配 | main 注册完整菜单视图；runtime 仅门面 + layout/手势/overlay |
| 关闭 | 经注册卸载；禁止仅 `getElementById().remove()` 作为主路径 |
| P1-4 | 可见前 measure；`useLayoutEffect` 或同步 `render` 后立刻 measure |
| 流式 | 明确非债；CR 拒收「顺手 Preact 化 stream」 |
| 构建 | IIFE + classic script + minify:false 不变 |

### Context Bundle

```yaml
iteration_name: webview-imperative-shell-debt
requirement_path: Iterations/mobile-webview-preact-htm/features/webview-imperative-shell-debt/prd.md
spec_path: Iterations/mobile-webview-preact-htm/features/webview-imperative-shell-debt/spec.md
explore_summary: |
  挂 body 债仅菜单 overlay；Portal 等价 = main render 到 #menu-portal；
  P0-3/P1-4；stream/boot 非债；CT-01 弱化 menuRoot/createElement
impact_files:
  - apps/mobile/src/web/chat-transcript/index.html
  - apps/mobile/src/web/chat-transcript/webview/main.ts
  - apps/mobile/src/web/chat-transcript/webview/ui/menu/**
  - apps/mobile/src/web/chat-transcript/webview/runtime/menu/menu.ts
  - apps/mobile/__tests__/chat-transcript-boot-script.test.ts
constraints:
  - no preact/compat; no runtime preact.render; no stream body rewrite
  - P1-4 measure before visible
  - minify false
blocking_steps: [1, 2, 3, 4, 5]
```

## 最终项目结构（菜单相关增量）

```text
chat-transcript/
  index.html                 # 可选：#menu-portal
  webview/
    main.ts                  # 注册 MenuOverlay → #menu-portal
    ui/menu/
      ContextMenu.tsx        # 项（可保留）
      MenuOverlay.tsx        # 新增：backdrop + 容器 + 项 + 可选 measure 钩子
    runtime/menu/menu.ts     # 门面；无 createElement 挂 body
```

## 变更点清单

| 区域 | 变更 |
|------|------|
| html | 增加 `#menu-portal`（推荐） |
| ui/menu | `MenuOverlay` 声明 backdrop + context-menu + items |
| main | 注册完整 overlay；关闭/空菜单 `render(null, …)` |
| runtime/menu | 删除壳 `createElement`/`appendChild(body)`/裸 `.remove()` 主路径；保留 layout/overlay/grace/长按 |
| 测试 | CT-01 按下方修订矩阵 |
| 文档 | README 一句：壳债已清 vs 流式命令式非债 |
| 标明 | stream / tool-invoking 旁路 / boot / 桥 = 非债或已知限制 |

## 兼容性与迁移

1. **行为**：菜单项集合、锚点算法、grace、宿主事件名不变。  
2. **API**：`registerRenderContextMenu` 签名可改为接收完整 overlay props（可去掉 `menuRoot`）；契约测按 token 修订。  
3. **回滚**：revert 本 feature。

## 契约测修订（T-BR-CT-01）

| 必须保留 | 可改为 token | 允许删除（改断言） |
|----------|--------------|-------------------|
| `layoutContextMenu`、`handleMenuOverlayEvent`、`resolveMenuAnchor`、`attachMenuNativeTextBlock`、`menu-open`、`MENU_OPEN_GRACE_MS`；overlay 关闭入口可检（`menuOverlayHandler` 或等价） | `context-menu`、`menu-backdrop`、`menu-item`、`registerRenderContextMenu`、`MenuOverlay`/`ContextMenu`；P1-4 弱证据（visibility/hidden/measure/`useLayoutEffect` 任一） | `menuRoot` 宿主参数字面；`createElement`+`appendChild(body)` 作菜单壳**正断言**（可改为 `not.toMatch` 防回潮）；overlay `addEventListener` 整行精确字面 |

**禁止**：为绿测开 minify；删 grace / layout 意图。

## 详细实现步骤

- Step 1 — phase-inventory-doc — blocking: yes — qa: auto：将本 SPEC 债/非债表写入实现注或 README 一句；确认无第二处挂 body 壳债。  
- Step 2 — phase-menu-overlay-ui — blocking: yes — qa: auto：实现 `MenuOverlay`（backdrop + 容器 + 项）；P1-4 隐藏→measure→定位→可见。  
- Step 3 — phase-menu-wire — blocking: yes — qa: auto：main 注册到 `#menu-portal`；runtime 门面去掉 createElement 挂 body；关闭走 unmount。  
- Step 4 — phase-contracts — blocking: yes — qa: auto：修订 CT-01；`build:webview` + boot-script 绿。  
- Step 5 — phase-docs — blocking: yes — qa: auto：README 壳债 vs 流式非债；已知限制写明 tool-invoking 旁路。  
- Step 6 — phase-device-qa — blocking: no — qa: manual_user：真机长按菜单定位/关闭/grace。

## 测试策略

- **自动**：`build:webview`；CT boot-script（含 CT-01）；webview-boot tsc。  
- **手工**：Step 6。

### 测试用例

| ID | Step | blocking | 说明 |
|----|------|----------|------|
| T-ISD-01 | 1 | yes | 债/非债清单无悬空；stream 标非债 |
| T-ISD-02 | 2–3 | yes | 菜单壳主路径无 `createElement`+`body.appendChild`；存在 Portal 等价挂载 |
| T-ISD-03 | 3 | yes | P0-3：runtime 无 import ui / 无 runtime 内 preact.render |
| T-ISD-04 | 2–3 | yes | P1-4：可见前 measure 可检 |
| T-ISD-05 | 4 | yes | CT-01 意图绿；minify:false |
| T-ISD-06 | 5 | yes | 文档标明非债/已知限制 |
| T-ISD-07 | 6 | no | 真机菜单 smoke |

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 与 `#rows` 共 body 根互毁 | 独立 `#menu-portal` |
| 关闭泄漏 | 必须 `render(null, portal)` |
| P1-4 闪烁 | 同步 measure 或 useLayoutEffect；真机验 |
| 误改 stream | T-ISD-01 / CR 拒收 |

**回滚**：git revert 本 feature 提交。
