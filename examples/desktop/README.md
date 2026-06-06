# Desktop UI 原型

浏览器优先的桌面端布局原型（纯 HTML/CSS/JS）。**在此目录迭代 UI**；`apps/desktop` 仅保留 Electron 壳，将来用 React/Vue 重写，不与本目录同步。

## 布局

| 区域 | 说明 |
|------|------|
| 左 | 文件预览 |
| 中 | 工作区树（标题随导航切换：全局 / 会话 / 聊天工作区） |
| 右 | Chat 嵌套导航（项目 → 会话 → 聊天，对齐 mobile） |

## 打开方式

**直接打开**

```bash
# Windows
start index.html

# macOS
open index.html
```

直接双击 `index.html` 或用浏览器打开即可，无需构建或 npm 脚本。

## 文件

- `index.html` — 结构 + mock 数据
- `shell.css` — 样式（对齐 mobile lightTheme）
- `shell.js` — 导航与工作区联动逻辑

## 相关文档

- [desktop-main-shell PRD](../../.apm/kb/docs/Iterations/desktop-main-shell/prd.md)
