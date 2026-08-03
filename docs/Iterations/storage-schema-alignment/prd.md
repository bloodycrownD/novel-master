# Bootstrap 存储层对齐 PRD

## 背景

Novel Master 的持久化由 `packages/core/src/bootstrap` 统一定义：17 张实体表 + 单表 `kkv_entry`（按 `module` 命名空间分区）。`apps/mobile` 与 `apps/cli` 共用同一套 `bootstrapNovelMaster` DDL 与 core 服务。

**Mobile 产品形态（P0 §0–§13）已验证**，但存储分层仍停留在脚手架阶段：

- `PersistentState` 已承载六指针，使用正常；
- `PersistentPreferences` v1 仅 `session-fs.versionCheck` 一项，**mobile 已 wiring 却零调用**；
- 大量**跨端工作区行为**（流式输出、工具卡详情、检查点保留条数等）落在 `nm-mobile-ui`，与 `mobile-app` spec 早期「避免 Core port 膨胀」定案一致，但 **mobile 成熟后未回填 core**。

历次迭代（`persistent-state-and-preferences`、`model-context-settings`、`ui-optimization` 等）已多次调整边界，缺少一次系统性盘点与 **Preferences v2 上收**。

当前还存在：表列双写冗余、`checkpointRetention` 等 key 半实现、历史 module 残留等问题。

本 PRD 定义**存储对齐 + Preferences v2**：厘清归属、上收 app 行为配置到 core、分阶段收敛。**产品权威在 app（mobile/desktop）；CLI 为验证/排障工具。**

## 目标（含成功指标）


| 指标                    | 目标值                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 差距清单覆盖率               | 17 表 + 6 core KKV module + `nm-mobile-ui` 逐项有「应有归属 / 现状 / 处置」                                                               |
| **Preferences v2 上收** | `llmStream`、`showFullToolParams`、`checkpointRetention` 迁入 `nm-preferences` + 显式 `PersistentPreferences` API；mobile / CLI 共用 |
| `**nm-mobile-ui` 瘦身** | 仅保留纯客户端项（theme、版本 guard、引擎回滚 flag）；行为类 key 清零                                                                               |
| 跨端 **app** 指针契约 | mobile 与 desktop 对 project/session/**model**/agent/regex 指针行为一致；**不以 CLI 的 provider 指针为准** |
| core 端口使用率            | mobile **全面接入** `runtime.preferences`；不再通过 `appUi` 读写行为配置                                                                   |
| 文档与代码一致               | bootstrap JSDoc、分层原则与实现一致                                                                                                   |


## 用户与场景


| 角色                           | 场景                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| Core 维护者                     | 行为配置走 `PersistentPreferences`；指针走 `PersistentState`；策略文档走专用 Store                     |
| Mobile 开发者                   | Profile / Chat 读 `runtime.preferences`；`appUi` 只管 theme 与回滚 flag                      |
| **Desktop 开发者**              | Renderer 经 IPC 读 `preferences`；`nm-desktop-ui` 仅 theme（及 P2 富文本）；**勿**重复存 `llmStream` |
| CLI 用户 / Mobile / Desktop 用户 | 同一 DB 文件在任一端打开时，v2 行为配置语义一致                                                           |
| 排障者                          | `nm preferences list` 可见全部工作区行为配置，不再分散在各 Client UI module                             |


## 范围

### 包含范围

1. **差距审计**与 **Mobile / Desktop 存储全景**（见 spec §客户端存储全景）。
2. **Preferences v2**：core 显式 API、`nm-preferences` 新 key、bootstrap 从 `**nm-mobile-ui` + `nm-desktop-ui`** 迁移、CLI 子命令、**mobile + desktop** 改读 `preferences`。
3. **P0/P1 结构修复**：agent 冗余列、`hidden` migration、tokenCounter 死路径等（**不含** app 侧补齐 `currentProviderId`）。
4. **分层原则 v2**：State / Preferences / Policy Store / Client UI 四层（见 spec）。
5. `**vfs_entry.external_uri` 保留为预留列**（WONTFIX，不删 DDL）。

> **说明**：Desktop 完整实现在 `apps/desktop`（Electron + IPC + React）；与 mobile 同为 **产品权威端**。

### 不包含范围

- Core checkpoint **FIFO 淘汰算法**实现（Preferences v2 只定存储与 UI；Core 后续读 `session-fs.checkpointRetention`）
- 更换存储引擎
- **Desktop UI 新功能**（会话日志 Banner、showFullToolParams 等 desktop 尚未有的屏）— 仅 wiring 已有/规划项
- VFS external storage 功能实现
- `chatRichText` 上收 core（**P2 可选**；mobile + desktop 均暂留各自 Client UI module）

## 核心需求

1. **表/KKV 错位清单**（spec §差距矩阵）。
2. **Preferences v2 上收**（**本迭代核心**）
  自 `nm-mobile-ui` 迁入 `nm-preferences` 的行为配置：

  | 原 key                 | 新 key                            | 默认      |
  | --------------------- | -------------------------------- | ------- |
  | `llmStream`           | `chat.llmStream`                 | `true`  |
  | `showFullToolParams`  | `chat.showFullToolParams`        | `false` |
  | `checkpointRetention` | `session-fs.checkpointRetention` | `100`   |

  - core 提供 typed getter/setter/reset（非裸 `getPreference` 给 UI 层）。
  - bootstrap 一次性迁移：自 `**nm-mobile-ui` 与 `nm-desktop-ui`**（及历史登记的 Client UI module）复制行为 key → `nm-preferences`，再删除旧 key（见 PRD §Core 抽取原则、spec §Bootstrap 迁移）。
  - **mobile + desktop** 设置页 / ChatComposer 改读 `runtime.preferences`（desktop 经 IPC `preferences/`* handler）。
  - CLI 扩展 `nm preferences get|set|reset` 支持上述 key。
3. `**nm-mobile-ui` / `nm-desktop-ui` 定案（瘦身后）**
  - **mobile** 保留：`theme`、版本 guard、引擎回滚 flag；可选暂留 `chatRichText`（P2）。
  - **desktop** 保留：`theme`；可选暂留 `chatRichText`（P2）。无版本 guard / 引擎回滚 key（当前实现）。
4. **工作区指针契约（app 权威）**  
   - **App（mobile/desktop）**：以 `currentModelId`（`applicationModelId`）为 LLM/Provider 上下文权威；维护 project/session/agent/regex 指针。  
   - **`currentProviderId`**：**CLI 专用**（`nm provider use` / `resolve-provider-scope`）；app **不**调用 `setCurrentProviderId`。  
   - App 删除 provider 时 **可** `resetCurrentProviderId`（清理 CLI 遗留行），非产品语义必需。  
   - mobile 对齐 desktop 的 `session-fs.versionCheck` 设置（Preferences，非指针）。
5. **历史残留清理**
  `global-config`、`tokenCounter.mode`、`agent_definition` 冗余列等（spec 分级）。
6. **迁移缺口补全**
  `chat_message.hidden`、`vfs_entry.entry_kind` bootstrap migration。
7. **预留列**
  `external_uri` / `storage_kind` 文档化保留。

## Core 抽取原则（定案补充 2026-06-06）

本节记录对 **Preferences v2 及 core 边界** 的评审结论，供 Phase 1/2 实现与后续迭代引用。

### 分层判据（什么进 core、什么留客户端）


| 判据                                                       | 归属                                | 示例                                          |
| -------------------------------------------------------- | --------------------------------- | ------------------------------------------- |
| 同一 workspace DB 在 **mobile / CLI / desktop** 打开时，行为语义应一致 | **Preferences**（`nm-preferences`） | 流式输出、工具卡完整参数、检查点保留条数、SessionFs 版本校验         |
| 仅影响**单端呈现**、安装升级或功能回滚                                    | **Client UI**（`nm-mobile-ui` 等）   | `theme`、版本 guard、引擎回滚 flag                  |
| 当前会话/工作区**指针**（选中了谁）                                     | **State**（`nm-workspace-state`）   | app：`currentProject/Session/Model/Agent/Regex*`；CLI 额外：`currentProviderId` |
| 结构化策略文档、需独立演进                                            | **Policy Store**（专用 module）       | `nm-events`、`nm-compaction-conditions`      |
| 模型/Provider **实体配置**（随记录走）                               | **实体表 + domain service**          | `llm_saved_model.settings.tokenCounterMode` |


**不上收到 core 的硬规则**：无跨端行为语义、或仅服务单端渲染/回滚 → 不得进入 `PersistentPreferences`。

**产品权威**：mobile + desktop 为有效产品；CLI 为验证/排障工具，**存储契约以 app 为准**，不要求 app 迁就 CLI 独有指针。

### 工作区指针：app 以 model 为权威（定案 2026-06-06）

| 指针 | App（mobile/desktop） | CLI |
|------|----------------------|-----|
| `currentProjectId` / `currentSessionId` | 读写 | 读写 |
| `currentModelId` | **权威**（Model Picker `setCurrentModelId`） | `nm model use` / flag |
| `currentAgentId` / `currentRegexGroupId` | 读写 | 读写 |
| `currentProviderId` | **不 set**；delete provider 时可 reset 清理 | **`nm provider use` 专用** |

**理由**：core 域内业务路径以 `applicationModelId` / `currentModelId` 驱动；`getCurrentProviderId` 仅服务 CLI scope 解析。要求 app 同步 provider 指针无产品收益，且与「model 即工作区选型」UX 重复。

**共享 DB 注意**：自 CLI 导入的 DB 可能含 `currentProviderId`；app 忽略即可。自 app 导出给 CLI 时，CLI 用户需 `nm provider use` 或 `--providerId`（或后续 CLI 可从 model 推导 provider，**非本迭代**）。

### v2 上收范围（定案，不扩 scope）

**本迭代迁入 `nm-preferences` 的仅 3 项**（加 v1 已有 `session-fs.versionCheck`）：

- `chat.llmStream`
- `chat.showFullToolParams`
- `session-fs.checkpointRetention`

**明确不上收（首期）**：

- `chatRichText` — **P2 可选**；CLI 无富文本呈现前不迁
- `theme`、版本 guard、引擎回滚 flag — 永久留 Client UI module

**不新建共享 package**：跨端共享只通过 `**PersistentPreferences` / `PersistentState` 等 core port**；各客户端保留独立 `AppUiPreferences` + KKV module，**不做** `@novel-master/client-ui-prefs` 一类抽取。

### API 与存储契约

1. **Typed port 优先**：v2 key 必须由 `PersistentPreferences` 显式 getter/setter/reset 暴露；**禁止** UI 层裸调 `setPreference` 写 v2 key（CLI `nm preferences` 除外）。
2. **单一事实来源**：bootstrap 迁移完成后，行为 key **只**存在于 `nm-preferences`；Client UI module 不得再读写同语义 key。
3. **默认值在 core 实现**：缺 key 时由 `DefaultPersistentPreferences` 返回文档化默认，不依赖 Client UI 的 `APP_UI_DEFAULTS` 兜底行为配置。
4. **Core 内部读 preferences，不直读 KKV**：SessionFs FIFO 等后续逻辑注入 `PersistentPreferences`，不得再读 Client UI module 或裸 `kkv.get('nm-preferences', ...)` 绕过 port（CLI/list 除外）。

### Bootstrap 迁移（core 职责）

- 迁移在 `bootstrapNovelMaster` 事务内、**幂等**执行：`new key` 不存在时才从旧 Client UI key 复制；**始终**删除已登记的旧 key（无 old key 则跳过）。
- 迁移表以 **语义 key** 为准：`llmStream` → `chat.llmStream` 等；若历史上存在**多个 Client UI module 命名空间**存过相同语义 key，**同一 migration map 应全部登记**，避免旧库残留（实现见 spec §Bootstrap 迁移）。
- 冲突策略：`nm-preferences` 已有新 key 时 **以 new 为准**，不覆盖。

### 与 P0 结构修复的关系（正交但同批交付价值）

Preferences v2 与下列项 **无依赖**，但同属「存储对齐」：


| 项                                         | 与 v2 关系                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `agent_definition` 冗余列                    | 表结构清理，不涉及 preferences                                                   |
| `chat_message.hidden` migration           | 共享 bootstrap；与 v2 并行                                                    |
| `tokenCounter.mode`（`nm-preferences` 死路径） | **非 v2 上收**；移除公开读路径；模型级计数仍走 `llm_saved_model.settings.tokenCounterMode` |


Phase 顺序：**P0 结构可与 Preferences v2 分分支，但 v2 的 core + bootstrap 应先于 mobile 改 UI**，避免 double-write。

### 跨端同一 DB 的预期（app 为主，CLI 为辅）

- 行为配置（v2 key）在同一 workspace 文件内 **读写同一存储**；app 间修改互可见。
- Client UI key（如 `theme`）**不要求**跨端同步。
- **`currentProviderId`**：CLI 可读/写；app 不依赖。不要求 app 与 CLI 该指针一致。

### Desktop 现状摘要（2026-06-06 代码复核）

`apps/desktop` 已接 **完整 core runtime**（`createDesktopNovelMasterRuntime`，better-sqlite3 + SKSP + IPC）。


| 项                                            | Desktop 现状                                             | v2 目标                                        |
| -------------------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| Client UI module                             | `nm-desktop-ui`                                        | 瘦身后仅 `theme`（+ P2 `chatRichText`）            |
| `llmStream`                                  | `WorkspaceSettingsView` + `ChatComposer` 经 `ipcAppUi`* | → `preferences.getLlmStreamEnabled()`        |
| `chatRichText`                               | 同上 + `ConversationPanel`                               | P2 暂留 `nm-desktop-ui`                        |
| `session-fs.versionCheck`                    | **已接** `ipcPreferences`*                               | ✅ 保持；mobile 应对齐                              |
| `showFullToolParams` / `checkpointRetention` | **未实现**                                                | v2 新增 UI + 读 preferences |
| `currentProviderId`                          | 不 set（delete 时 reset 清理 CLI 遗留）                      | **WONTFIX** — CLI 专用，app 以 model 为准 |
| Worktree / VFS / SessionFs                   | IPC handlers 齐全                                        | 表存储，无 KKV 错位                                 |


## 验收标准

### 文档验收

- spec 含 Mobile + Desktop 存储全景 + Preferences v2 章节
- PRD 含 **§Core 抽取原则**；SPEC 含 **§Core 抽取实现要点**
- 已 `apm kb index rebuild`

### Preferences v2 验收

- Given 用户在 mobile Profile 修改「流式输出」，When 重启 App，Then `nm-preferences`/`chat.llmStream` 持久化，且 `nm-mobile-ui`/`llmStream` **不存在**
- Given 用户在 mobile Profile 修改「检查点保留条数」，When 重启，Then `session-fs.checkpointRetention` 为正整数（默认 100）；会话日志 Banner 读同一值
- Given 用户在 mobile Profile 切换「显示完整工具参数」，When 进入 Chat，Then `chat.showFullToolParams` 生效
- Given 旧库仅有 `nm-mobile-ui.llmStream=false`，When `bootstrapNovelMaster` 运行，Then 迁移为 `chat.llmStream=false` 并删除旧 key
- Given CLI `nm preferences list`，Then 输出含 `chat.llmStream`、`chat.showFullToolParams`、`session-fs.checkpointRetention`（已设或默认不写 list 均可，get 必须正确）
- Given mobile `runtime.preferences`，Then 行为配置**不**再经 `appUi.get/set` 对应 key
- Given desktop `WorkspaceSettingsView` 修改流式输出，Then `nm-preferences`/`chat.llmStream` 持久化，且 `nm-desktop-ui`/`llmStream` **不存在**
- Given 旧库 `nm-desktop-ui.llmStream=false`，When bootstrap，Then 迁移为 `chat.llmStream=false` 并删除 desktop 旧 key

### P0 结构验收

- `agent_definition` 无 write-only 冗余列
- `chat_message.hidden` 旧库 bootstrap 可 ADD
- `tokenCounter.mode` 公开读路径已移除
- app **未**新增 `setCurrentProviderId`（符合 §工作区指针定案）

### 回归验收

- `npm run build`（core + mobile + cli）通过
- `packages/core/test/persistent/`*、mobile 相关测试通过