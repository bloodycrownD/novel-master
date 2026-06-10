# Agent / 维护者约定

面向 Cursor Agent 与人工维护者的仓库级规则。技术细节见 [`.apm/kb/docs/monorepo.md`](.apm/kb/docs/monorepo.md)；迭代需求见 [`.apm/kb/docs/Iterations/`](.apm/kb/docs/Iterations/)。

## 仓库结构（简）

| 路径 | 说明 |
|------|------|
| `packages/core` | 领域层；**零平台依赖**，不塞 RN/Electron/Node 原生逻辑 |
| `packages/*-driver-*`、`config-forms` 等 | 平台 driver、共享表单 |
| `apps/desktop` | Electron 桌面端 |
| `apps/mobile` | React Native Android |
| `apps/cli` | `nm` 命令行 |
| `.github/workflows/release.yml` | 打 tag 触发全量 Release |

## 发版与版本号

### 原则

**Git tag、产物版本、关于页/更新检查显示的版本必须一致。**  
tag 形如 `v1.0.4` → 应用内版本为 `1.0.4`（去掉前缀 `v`）。

### 发新版前（在 `main` 上提交，再打 tag）

1. 将下列 **`package.json` 的 `version` 改为与即将发布的 tag 一致**（仅数字部分）：
   - `apps/desktop/package.json` — Electron `app.getVersion()`、关于页
   - `apps/mobile/package.json` — 关于页、`APP_VERSION`、更新检查
2. 确认 `apps/mobile/android/app/build.gradle` 里本地默认 `versionName` 与 tag 一致（CI 会注入 `-PversionName`，但 dev 包也应可读）。
3. 跑相关测试与构建（至少 `@novel-master/desktop`、`@novel-master/mobile` 受影响范围）。
4. 合并到 `main` 并推送代码，再打 **一个** tag 触发 Release（只需 `v*` tag，不必重复打多个版本 tag）：

```bash
git push origin main
git tag v1.0.4
git push origin v1.0.4
```

若 Release CI 失败需重跑：修正 workflow 后 `git tag -f v1.0.4 && git push origin v1.0.4 --force`（仍只保留一个 `v1.0.4`）。

### CI 行为（`.github/workflows/release.yml`）

- 触发：`push` 匹配 `v*` tag
- 并行构建：**Android APK** + **Windows NSIS** + **macOS DMG**
- CI 内会对 desktop / mobile 再执行 `npm version <tag名无v> --no-git-tag-version --allow-same-version`（仓库已 bump 时不会报错）；**仓库里仍应先改好 `package.json` 再发 tag**，这样 dev 构建与关于页在发版前即正确，且 tag 指向的 commit 自洽。
- 产物发布到 GitHub Releases：`bloodycrownD/novel-master`

### 更新检查

- Desktop / Mobile 各端自有 `update-check/`（**不进 `packages/core`**），查 `releases/latest`。
- 客户端 UI 偏好（如自动检查开关）在 KKV 模块 `nm-desktop-ui` / `nm-mobile-ui`，**不是** `nm-preferences`。

### 暂不要

- 未讨论前不要改 release workflow 为「仅 mobile / 仅 desktop」分端发版（见 [about-and-update-check spec](.apm/kb/docs/Iterations/about-and-update-check/spec.md)）。
- 发版 commit 不要包含 `.env`、keystore、`.cursor/` 等本地/敏感文件。

## 编码与改动范围

1. **最小 diff**：只改与任务相关的文件；不顺手重构、不扩大 scope。
2. **沿用现有风格**：命名、IPC、KKV、测试布局与邻近代码一致。
3. **平台代码放 app/driver 包**：计数、存储、更新检查等交付层逻辑放 `apps/*` 或 `packages/*-driver-*`，避免污染 `packages/core`。
4. **注释**：模块头与非常规分支写「为什么」；避免逐行翻译式注释。
5. **测试**：有行为变更时跑对应 workspace 测试；不添加无意义的断言。
6. **Git**：**仅在用户明确要求时** `git commit` / `push`；不要擅自提交。

## 文档（APM）

- 新迭代：`.apm/kb/docs/Iterations/<名称>/prd.md`、`spec.md`
- 改 kb 后：`apm kb index rebuild`
- Agent 实现功能前优先读对应 `spec.md`；PRD 定范围，SPEC 定实现。

## 环境

- Node **22+**（见 `.nvmrc`）
- 根目录：`npm install` → `npm run build`
- Desktop：`npm run desktop:dev`
- Mobile：`npm run mobile:android`
