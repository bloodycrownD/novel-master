# @novel-master/desktop

Electron 桌面应用包（**壳 + 占位 renderer**）。

## UI 原型在哪？

**请在 `examples/desktop/` 迭代布局原型**（浏览器打开，无需 Electron）。

本包的 `renderer/` 仅为 Electron 启动占位，**不与 examples 同步**。正式产品将用 React/Vue 重写 renderer。

## Scripts

- `npm run build -w @novel-master/desktop` — 编译 main/preload TypeScript
- `npm run dev -w @novel-master/desktop` — 构建并启动 Electron（显示占位页）
## 目录

- `src/main.ts` — Electron 主进程
- `src/preload.ts` — preload 桥（预留）
- `renderer/index.html` — 占位说明页
