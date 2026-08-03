# Mobile App 脚手架 PRD

## 背景

- **novel-master** 为 monorepo，已具备 `@novel-master/core`（含 **VFS**）、`@novel-master/tdbc-driver-rn`（`react-native-quick-sqlite`）、`@novel-master/cli`（`nm vfs …`）及本地开发工具（`vfs:watch` 等）。
- **banzhu**（`D:\Dev\Java\banzhu`）为独立的 RN 阅读器 + CLI 产品，具备线路/搜书/书架/阅读等完整业务能力；其 **产品形态与模块划分** 可作为远期参考，但 **本迭代不得通过复制 banzhu 仓库或整目录迁入** 来创建 app。
- 需要在 monorepo 内用 **官方 RN 脚手架（`@react-native-community/cli init` 或等价稳定流程）** 新建 **`apps/mobile`**，验证「RN App ↔ workspace 包 ↔ 设备端 SQLite/VFS」架构可行；阅读器业务与站点解析 **不在本期**。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 可运行的 RN 工程 | 在 monorepo 根目录执行约定脚本后，`apps/mobile` 能 **Android Debug** 启动（Metro + `run-android`），显示非崩溃的首屏 |
| Monorepo 集成 | `apps/mobile` 作为 npm workspace 成员；能 **import** `@novel-master/core`、`@novel-master/tdbc-driver-rn`（TypeScript 解析与 Metro 打包无报错） |
| VFS 架构验证 | App 内提供 **开发向 VFS 验证页**（非产品目标），在真机/模拟器上完成与 CLI 对齐的核心操作 |
| 可维护的创建方式 | 仓库内文档记录 **init 命令、版本号、手工补丁**；新 clone 者按文档可复现，而非依赖从 banzhu 拷贝 `android/` 树 |

**量化验收（首期）：**

- Android：`assembleDebug` 或 `run-android` **一次成功**（文档写明 JDK/SDK 前提）。
- VFS 验证页：至少 **6 类操作** 各有一条可判定成功路径（见验收标准）。
- 根目录 `npm run build` / `npm test` **不因新增 app 而失败**（app 自身 test 可为占位）。

## 用户与场景

| 用户 | 场景 |
|------|------|
| 本仓库开发者 | 在 monorepo 内启动 RN，确认 RN driver + VFS 在设备上可用 |
| Agent / 后续迭代 | 在干净脚手架之上增量实现阅读器（参考 banzhu 产品，代码另迭代迁入 `packages/`） |
| 维护者 | 升级 RN 或 core 时，用 VFS 页快速回归「写库 → 读库」链路 |

## 范围

### 包含范围

1. **新建 `apps/mobile`**
   - 包名：`@novel-master/mobile`；显示名：**Novel Master**（可调）。
   - 使用 **当前 `@react-native-community/cli` 稳定版** 初始化（**不**锁定 banzhu 的 0.85.1；在 README/kb 中 **记录实际 RN/React 版本**）。
   - **禁止**将 banzhu 的 `src/app`、`android/`、`ios/` 整树复制为起点；允许 **只读参考** banzhu 的 Gradle 补丁思路等（若 init 后遇到同类问题再按需最小补丁）。

2. **Monorepo 接线**
   - 根 `package.json` workspaces 已含 `apps/*`（保持）。
   - Metro / Babel 配置支持 **workspace 包**（`watchFolders`、`resolver` 等按 RN 官方 monorepo 指引）。
   - App 依赖：`@novel-master/core`、`@novel-master/tdbc-driver-rn`；peer：`react-native-quick-sqlite`。
   - 设备端 DB 路径与策略在 SPEC 阶段定案（PRD 要求：默认 **应用私有目录**，与 CLI 的 `.novel-master/novel.db` **可不同路径**，但同一 VFS 语义）。

3. **Android 首期平台**
   - 文档与验收 **仅要求 Android**。
   - iOS 目录若 init 自带可保留，**不**作为本期验收项。

4. **VFS 验证页（开发向，UI 可简陋）**
   - 单屏或极简多屏即可；**不是**产品阅读 UI。
   - 能力须与 **`nm vfs` CLI 对齐**（开发调试用途）：
     - `list`（含递归选项或等价）
     - `read`（纯文本展示）
     - `write`（路径 + 文本）
     - `replace`（old/new）
     - `delete`
     - `glob`（模式 + 结果列表）
   - 操作结果可见（成功/错误信息）；错误不导致红屏未捕获崩溃。

5. **文档**
   - 本 PRD；后续 SPEC 另文档。
   - `apps/mobile/README.md`：环境、init 复现步骤、`npm run android`、VFS 页入口说明。

### 不包含范围

- banzhu 阅读器功能：线路、搜书、榜单、书架、章节阅读、字形图、WebView 排版等。
- 将 banzhu 的 `src/infra` / `src/cli` **迁入** monorepo（另开迭代）。
- iOS 编译运行、应用商店发布、混淆/签名流水线。
- 与 `vfs-test-sync` 镜像目录同步、桌面 CLI 共用同一 DB 文件（可选未来；本期不承诺）。
- 精美 UI、无障碍、国际化、埋点、登录账号体系。
- 生产级错误处理、离线策略、多数据库迁移工具。

## 核心需求

1. **脚手架创建**：在 `apps/mobile` 用 RN CLI **新建** 工程，提交 `android/` 等生成物；变更记录 init 版本与必要 post-init 手工步骤。
2. **Workspace 依赖**：App 通过 workspace 引用 `@novel-master/core` 与 `@novel-master/tdbc-driver-rn`，启动时完成 VFS bootstrap（与 core 现有 API 一致）。
3. **SQLite 驱动**：设备端安装并链接 `react-native-quick-sqlite`，TDBC RN driver 可打开 DB 并执行 VFS 相关 DDL/DML。
4. **VFS 验证页**：提供开发页，覆盖 list / read / write / replace / delete / glob，行为与 CLI 语义一致（路径规范、错误类型与 CLI 同族）。
5. **Android 可运行**：开发者按 README 可在模拟器或真机看到首屏 + 进入 VFS 验证页并完成一次 write → read。
6. **仓库卫生**：不引入 banzhu 专有资源（图标、站点配置、`.banzhu/`）；根 `.gitignore` 继续忽略本地 `tmp/`、`.novel-master/`（app 私有 DB 路径若不同，在 SPEC 中补充 ignore 规则）。

## 验收标准

### A. 工程与构建

- **A1** Given 干净 clone（Node 版本满足根 `.nvmrc`），When 在仓库根 `npm install` 并构建相关 workspace，Then `apps/mobile` 依赖安装无 peer 冲突报错（`react-native-quick-sqlite` 已安装）。
- **A2** Given Android SDK 已配置，When 在 `apps/mobile` 执行文档中的 Android 启动命令，Then App 安装并启动，首屏无致命崩溃。
- **A3** Given 仅修改 `packages/core` 中 VFS 对外类型签名（模拟破坏性变更），When 在 app 中 typecheck/build，Then 能在本地构建阶段暴露不兼容（证明接线真实，而非 copy-paste 死代码）。

### B. VFS 验证页（与 CLI 对齐）

以下均在 **VFS 验证页** 完成；路径使用 VFS 绝对路径风格（如 `/dev/note.md`），与 CLI 一致。

- **B1 list** Given 空库或已有条目，When 执行 list（含至少一种递归或深层路径场景），Then 列表展示当前路径下条目（可与 CLI `nm vfs list` 对照）。
- **B2 write + read** Given 任意合法路径，When write 文本内容再 read，Then 展示内容与写入一致；write 的 stdout 等价信息（如 version）可在 UI 或日志中可见。
- **B3 replace** Given 已存在文件，When replace old→new，Then read 结果为替换后全文。
- **B4 delete** Given 已存在文件，When delete，Then 再次 read 返回与 CLI 一致的「不存在」类错误（非未处理异常）。
- **B5 glob** Given 多条匹配路径，When 执行 glob（如 `**/*.md`），Then 展示命中列表，与 CLI `nm vfs glob` 结果集一致（顺序可不同，集合一致）。
- **B6 错误展示** Given 非法路径或空 old 片段的 replace，When 触发操作，Then UI 显示可读错误信息，App 不崩溃。

### C. 边界与约束

- **C1** 仓库中 **不存在** 从 banzhu 复制的 `src/app` 业务模块或 banzhu 品牌资源作为起点。
- **C2** PRD 范围内 **无** 镜像站 HTTP、无书架 UI、无章节阅读器组件。
- **C3** 根目录 `npm test` 在合并本迭代后仍通过（各 workspace 既有测试 + app 占位测试若有）。

## 约束与依赖

| 项 | 说明 |
|----|------|
| 参考项目 | banzhu：产品与模块参考；**禁止**整仓复制作为 init |
| 已有包 | `@novel-master/core`、`@novel-master/tdbc-driver-rn`、`@novel-master/cli` |
| RN 版本 | **CLI 当前稳定版**（与 banzhu 0.85.1 可能不同，必须在 README 写明） |
| Node | 与 monorepo `.nvmrc`（22.22.0）一致 |
| 平台 | Android 验收必须；iOS 不验收 |
| 后续迭代 | 阅读器 MVP、banzhu infra 迁入 `packages/*` 单独立项 |

## 风险与待确认项

| 风险 | 缓解 |
|------|------|
| RN 最新版与 monorepo TS/Metro workspace 不兼容 | 文档记录锁定版本；必要时 pin RN 小版本 |
| `react-native-quick-sqlite` 与 New Architecture 兼容性 | SPEC 中选定架构开关；真机冒烟 |
| Metro 未正确解析 workspace 导致运行时找不到 core | 按官方 monorepo 示例配置 + 冒烟测试 |
| VFS 页操作过多导致 UI 臃肿 | 明确为开发页；可 Tab/折叠，不要求美观 |

**待 SPEC 定案：** 设备 DB 文件路径、bootstrap 调用点（App 启动 vs 进入 VFS 页）、是否与 CLI 共用迁移脚本。

## 里程碑（可选）

| 阶段 | 交付 |
|------|------|
| M1 | `apps/mobile` init + Android 空壳跑通 |
| M2 | workspace + Metro 接 core / tdbc-driver-rn |
| M3 | VFS 验证页六类操作 + README |
| M4 | 根构建/测试绿 + kb SPEC（另文档） |
