# Novel Master Monorepo

## 布局

| 路径 | 包名 | 说明 |
|------|------|------|
| `packages/core` | `@novel-master/core` | 核心业务库，导出 `greet` 等 API |
| `apps/cli` | `@novel-master/cli` | CLI，`novel-master` 二进制入口 |

## 根脚本

- `npm run build` — 各 workspace 构建（`tsc`）
- `npm run dev` — 开发模式
- `npm run test` — 测试（各包若有）
- `npm run clean` — 清理 `dist`

## 技术栈

- Node.js >= 20
- TypeScript 6，ESM（`"type": "module"`）
- `tsconfig.base.json` 共享编译选项
- CLI 开发可用 `tsx src/index.ts`

## APM

项目根目录 `.apm/` 为 Agent 外置记忆（`apm read` / `dynamic` / `persist`）。与仓库内其他 `memory/` 目录无关。
