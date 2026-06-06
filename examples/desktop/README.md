# Desktop UI 原型

浏览器优先的桌面端布局原型（纯 HTML/CSS/JS）。**在此目录迭代 UI**；`apps/desktop` 仅保留 Electron 壳，将来用 React/Vue 重写，不与本目录同步。

## 布局（冻结）

```text
#preview-pane  |  #explorer-pane  |  #chat-rail
文件预览        |  工作区树+动态标题  |  嵌套导航 + 我的/配置
```

| 区域 | 说明 |
|------|------|
| 左 `#preview-pane` | 文件预览/编辑（mock store）；顶栏主题切换 |
| 中 `#explorer-pane` | 工作区树（标题随导航：全局 / 会话 / 聊天工作区） |
| 右 `#chat-rail` | 顶栏 **对话 \| 我的**；项目→会话→聊天 drill-down；配置子页 `pageStack` 压栈 |

**不**使用主分支旧版 `#sidebar` + `#mainContent` + `#rightSidebar` 布局。

## 能力清单（mock + localStorage）

| 能力 | 位置 | 持久化 |
|------|------|--------|
| 项目 / 会话 / 聊天 drill-down | chat rail「对话」 | 导航状态（内存） |
| 我的（工作区/数据/配置） | chat rail「我的」 | `nm-desktop-shell-state-v1` |
| agent管理 / 编辑 | rail 配置栈 | 同上 |
| 服务商 → 模型 → 采样 | rail 配置栈 | 同上 |
| 压缩条件 / 事件配置 | rail 配置栈 | 同上 |
| 正则组 / 规则 | rail 配置栈 | 同上 |
| 全局模板 | rail + explorer 全局树 | 同上 |
| 会话菜单（agent/模型/提示词/日志） | conversation ☰ | 同上 |
| 文件预览 / 编辑 | preview-pane | `previewFiles` in store |
| 主题浅/深 | preview 顶栏 | `nm-desktop-theme` |
| 数据库导入/导出 | 我的 → 数据管理 | JSON 文件 |

## 打开方式

```bash
# Windows
start index.html

# macOS
open index.html
```

直接双击 `index.html` 或用浏览器打开即可，无需构建或 npm 脚本。

## 文件

- `index.html` — 三栏 DOM + nav-view 容器
- `shell.css` — 样式（含 `[data-theme=dark]`）
- `shell.js` — 导航状态机、mock store、配置页渲染

## QA（spec 手动矩阵静态验收）

```bash
node examples/desktop/scripts/verify-spec-matrix.mjs
node --check examples/desktop/shell.js
npm test --workspace=@novel-master/desktop
```

覆盖 M-01–M-04（mobile DOM/源码）与 D-01–D-06（desktop DOM/源码）及 Round-2 CR 项。

## 相关文档

- [prototype-optimization SPEC](../../.apm/kb/docs/Iterations/prototype-optimization/spec.md)
- [desktop-main-shell PRD](../../.apm/kb/docs/Iterations/desktop-main-shell/prd.md)（历史；以本目录三栏布局为准）
