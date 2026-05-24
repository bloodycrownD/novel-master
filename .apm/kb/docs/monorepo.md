# Novel Master Monorepo

## 布局

| 路径 | 包名 | 说明 |
|------|------|------|
| `packages/core` | `@novel-master/core` | TDBC、SqlTemplateParser、**VFS**（`VfsService`） |
| `packages/tdbc-driver-*` | 各 driver | better-sqlite3、RN 等（RN App 用 `@novel-master/tdbc-driver-rn/native`） |
| `apps/cli` | `@novel-master/cli` | CLI：`novel-master` / **`nm`**（`npm link`） |
| `apps/mobile` | `@novel-master/mobile` | RN 脚手架：设备端 VFS 开发验证页（Android Debug） |
| `scripts/vfs-test-sync` | `@novel-master/vfs-test-sync` | dev-only：VFS ↔ 本地目录 force 同步 |

## 根脚本

| 脚本 | 说明 |
|------|------|
| `npm run build` | 各 workspace 构建 |
| `npm run test` | 各 workspace 测试 |
| `npm run link:cli` | build + `npm link` CLI（全局 `nm` / `novel-master`） |
| `npm run vfs:watch` | watch 同步，默认镜像 `./tmp/mirror` |
| `npm run vfs:push` / `vfs:pull` | force 全量 push/pull |
| `npm run vfs:sync -- …` | 自定义参数：`push` / `pull` / `watch` |
| `npm run mobile:start` | Metro for `@novel-master/mobile` |
| `npm run mobile:android` | `run-android` for `@novel-master/mobile` |

## VFS 开发速查

- **DB 默认**：`./.novel-master/novel.db`（已 `.gitignore`，不进仓库）
- **镜像目录**：`./tmp/mirror`（已 `.gitignore`）
- **Node**：`.nvmrc` 为 `22.22.0`（与 Cursor / `better-sqlite3` 预编译一致）；`nvm use` 后 `npm rebuild better-sqlite3`
- **CLI**（全局 VFS 仅 `/template/…` 逻辑路径）：
  ```bash
  npm run link:cli
  nm vfs write /template/foo.md --text "hello"
  nm vfs read /template/foo.md
  nm project create --name "My Project"
  nm session create --project <projectId>
  nm message append --session <sessionId> --role user --content "hi"
  nm kkv set --module app --key cfg --value "{}"
  nm project vfs list /template --project <projectId>
  nm session vfs list / --project <projectId> --session <sessionId>
  ```
- **同步脚本**：`npm run vfs:watch`（stderr 会打印 `watch started`）

## 技术栈

- Node.js **22**（推荐，见 `.nvmrc`）
- TypeScript 6，ESM
- `tsconfig.base.json` 共享编译选项

## `@novel-master/core` 路径别名

- `packages/core` 内使用 **`@/*` → `src/*`**（见 `packages/core/tsconfig.json`）。
- 跨顶层目录（`infra`、`domain`、`errors`、`service`、`bootstrap`）用 `@/…`；同一 domain 模块内仍可用 `../model`、`../port` 等同目录相对路径。
- 构建：`tsc` + **`tsc-alias`** 将 `@/` 改写为相对路径写入 `dist/`（Node 可直接 `import`）。
- 测试：`tsx --tsconfig tsconfig.test.json`（含 `src` + `test`）。

## APM 知识库

- 迭代文档：`.apm/kb/docs/Iterations/<名称>/prd.md`、`spec.md`
- 子 feature：`.apm/kb/docs/Iterations/<名称>/features/<变更>/prd.md`、`spec.md`
- 会话开始：`apm read`；改 kb 后：`apm kb index rebuild`
- `.apm/` 为本地工作区（默认不进 Git）

## Git 忽略（本地数据）

```
.novel-master/   # VFS SQLite
tmp/             # 镜像目录等
```
