---
zone: xc-dead-apps
agent: 横切代理（W3 死路径狩猎 · apps + periph packages）
files_scanned: |
  L0/dead-exports.md 中 apps/* 行 700 条（零消费）+ 224 条（仅测试消费），合计覆盖 294 个 apps 文件；
  其中 194 个文件「全部导出为零消费」被本机位重扫；另自建 periph 包普查 90 个生产文件 / 178 个导出
  （L0 未覆盖 packages/{cloud-sync-driver-s3,llm-sse-native,sksp-*,tdbc-*,tokenizer-driver-*}）；
  底层索引 2373 个仓内 .ts/.tsx/.js/.mjs 文件（全仓 import 解析）。
  产出 40 条实核条目 + 统一删除 backlog。
---

## 摘要

`apps/{mobile,desktop,cli}` 与外围包（periph packages）里堆积了两类"看着像死、其实分两种"的代码：
一类是**整文件孤儿**（零 importer、无内部自用、无测试），一类只是**导出冗余**（符号在文件内部活着，
只是没被外部 import）。L0 的 `dead-exports.md` 只判"导出零消费"，把这两类混在同一张表里，
直接照表删会把活代码连根拔。本机位对 apps 侧 700 条零消费导出做全仓符号级复扫，
实核出 **40 条**：其中 **22 条真死**（可进删除 backlog，实测合计 ≈ 2.2k 行）、**11 条假阳性**
（构建入口 / jest moduleNameMapper / 默认导出钩子 / 别名重导出）、**7 条属"只去 export 不删码"**。
periph 包侧基本干净：90 个生产文件 178 个导出里只有 8 条零引用，且全是类型别名或小函数。

## 职责与边界

- **本机位职责**：核实 L0 `dead-exports.md` 中 apps + periph 行的真假；把 W1/W2 已知的死文件并进**统一删除 backlog**。
- **不在本机位范围**：core 内部实现的逻辑正确性（归 `xc-dead-core`）；IPC 语义与口径分叉（归 `xc-ipc`）；knip 配置本身（归 tools）。
- **与 xc-dead-core 的口径统一**：① 先判**文件**是否可达（谁能 import 它，含 tsconfig/babel 路径别名、NodeNext `.js` 后缀、平台后缀变体、动态 `import()`、构建入口），再判**符号**；② 符号在定义文件内部被使用 → 记 `de-export` 不记死码；③ 命中 `jest.config.js` moduleNameMapper / esbuild `entryPoints` / electron-builder 钩子 → 记假阳性；④ 名字进了 allowlist 快照 → 记 `snapshot-gated`。

## 对外接口

| 出口 | 位置 | 说明 |
|---|---|---|
| `AgentDefinitionEditorForm` | `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx:176` | 1048 行组件，**零 importer** |
| `hideToolTurn` / `deleteToolTurn` | desktop `.../features/chat/tool-turn-actions.ts:12,42`；mobile `.../components/chat/tool-turn-actions.ts:10,34` | 双端同名重复实现 |
| `AppMenuBar` | `apps/desktop/renderer/layout/AppMenuBar.tsx:14` | 唯一 renderer 侧 `ipcShellMenuPopup` 调用点 |
| `FILE_OPEN_TOOL_NAMES` | `packages/core/src/domain/tool/builtin/vfs-tools.ts:69` → `packages/core/src/index.ts:195` | 被 `main-entry-allowlist.json:12` 锁住 |
| `hideRange`（AgentSession 侧） | `packages/core/src/domain/agent/session/agent-session.port.ts:52` | 与 `MessageService.hideRange`（活的）同名不同口 |

## 数据访问

本机位不触碰数据层，但删除前置条件会牵出数据面：

- `apps/desktop/shared/ipc-types.ts:90-91`：`MESSAGES_HIDE_RANGE: 'nm:messages/hideRange'` / `MESSAGES_SHOW_RANGE`。
  `main` 侧 `handler-registry.ts:303-304` 已 `bindReq`，renderer 侧 `invoke-registry.ts:371,375` 已注册 `ipcMessagesHideRange/ipcMessagesShowRange`，
  但**全仓无任何组件调用**（见 F-10）。
- `apps/mobile/src/services/session-messages-loader.ts:9-10` 依赖 `@novel-master/core/chat` 与 `@/runtime/types`；
  删除会使 6 个测试文件的 `jest.mock` factory 解析失败（见 F-8）。
- periph 包 `packages/tdbc-driver-op-sqlite/src/adapter.ts:8`、`packages/tdbc-driver-rn/src/adapter.ts:8`
  的 `OpSqliteRows` / `QuickSqliteRows` 是 TDBC 驱动协议的类型别名，删类型不影响运行时，但属 `docs/apm/RULE.md` 里
  "quick-sqlite 旧驱动保留作回滚线"的范围，**动前须确认 rollback 线还挂不挂这两个包**。

## 依赖关系

```
apps/desktop/renderer/features/chat/tool-turn-actions.ts   （死）
        └── ipcMessagesHide / ipcMessagesShow / ipcMessagesDelete
              ├── renderer/ipc/invoke-registry.ts:360-
              └── renderer/ipc/client.ts:90
                    → IPC_CHANNELS.MESSAGES_HIDE|SHOW|DELETE
                          └── main/ipc/handler-registry.ts bindReq（活的 handler）

apps/desktop/renderer/layout/AppMenuBar.tsx                 （死）
        └── ipcShellMenuPopup → IPC_CHANNELS.SHELL_MENU_POPUP
              └── main/ipc/handler-registry.ts:476 bindEventReq

apps/{desktop/renderer,mobile/src}/**/transcript-selectable-role.ts（双端死）
        └── @shared/logic/chat（desktop）— 删掉后该 re-export 层只剩死导出
```

---

## 方法与口径（含自校验）

1. **文件可达性解析**（自建，脚本 `tmp/w3-xc/verify.mjs`）：对 2373 个仓内代码文件抽取
   `from '…'` / `import('…')` / `require('…')`，按 ① 相对路径 ② tsconfig/babel 路径别名
   （desktop `@/*`→`renderer/*`、`@shared/*`→`shared/*`、`@assets/*`；mobile `@/*`→`src/*`、`@web/*`→`src/web/*`）
   ③ NodeNext 风格 `.js` 后缀指向 `.ts` 源 ④ 平台后缀变体（`.android/.ios/.web/.native/.node`）
   四路解析到物理文件。
2. **自校验**：同一套解析器下，`apps/desktop/shared/logic/*.ts` 若不做别名处理会被误判为零 importer；
   加上别名后它们全部消失（`@shared/logic/skills` 等确有 2-3 个 renderer 调用方）——证明别名支持是必需的。
   同理 `apps/desktop/src/main/services/update-check.service.ts` 依赖 `ipc/handlers/app-info.ts:26` 的
   **动态 `await import()`**，补上动态导入匹配后它从零名单消失。
3. **内部自用判定**：符号在定义文件内出现在非 `export` 行 → 判 `de-export`（符号活着）。
4. **实测规模**：`apps/*` 零消费导出 **700** 条、仅测试消费 **224** 条；194 个「全部导出死」文件中，
   经解析器复扫后**零 importer 的只有 20 个**（不是 194 个）——**L0 表里 174 个文件级条目其实是"导出死"不是"文件死"**。

---

## 40 条实核核实表

> 口径：`零 importer` = 全仓无任何文件（含测试）import 它；`body` = 符号在定义文件内部被使用。
> 「可删」= 删整个文件；「去 export」= 只删 `export` 关键字，保留实现。

### A 组 · 真死文件（零 importer + 无内部自用 + 无测试）—— 进 backlog

| # | 文件:行 | 符号 | 行数 | 结论 |
|---|---|---|---|---|
| A1 | `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx:176` | `AgentDefinitionEditorForm`(+Handle/Props/BuildResult) | **1048** | 真死，可删 |
| A2 | `apps/desktop/renderer/features/chat/tool-turn-actions.ts:12,42` | `hideToolTurn`/`deleteToolTurn` | 55 | 真死，可删 |
| A3 | `apps/mobile/src/components/chat/tool-turn-actions.ts:10,34` | 同名双端重复 | 48 | 生产死（1 个测试消费） |
| A4 | `apps/desktop/renderer/features/chat/transcript-selectable-role.ts:12` | 12 个 re-export + `buildTailBatchRows` | 48 | 真死，可删 |
| A5 | `apps/mobile/src/components/chat/transcript-selectable-role.ts` | 11 个 re-export + `chatMessagesToTailBatchRows` | 50 | 真死，可删 |
| A6 | `apps/mobile/src/components/chat/flush-run-ui.ts:1` | `flushAgentStepUi`/`flushRunUi` | 41 | 生产死（1 个测试消费） |
| A7 | `apps/desktop/renderer/features/workspace/useWorkspaceTree.ts:7,30` | `usePreviewSelection`/`useTreeRefreshToken`/`useTreeLoader` | 67 | 真死，可删 |
| A8 | `apps/desktop/renderer/layout/AppMenuBar.tsx:14` | `AppMenuBar` | 41 | 真死，可删 |
| A9 | `apps/mobile/src/components/batch/ListBatchBar.tsx:15` | `ListBatchBar` | 57 | 真死，可删 |
| A10 | `apps/desktop/renderer/hooks/useStreamTailGenerating.ts:8` | `useStreamTailGenerating` | 11 | 真死，可删 |
| A11 | `apps/mobile/src/hooks/useStreamTailGenerating.ts:8` | 同名双端重复 | 13 | 真死，可删 |
| A12 | `apps/cli/src/vfs/errors.ts:4,7,20` | `EXIT_USAGE`/`EXIT_RUNTIME`/`formatCliError`/`exitCodeForError` | 29 | 真死，可删 |
| A13 | `apps/cli/src/vfs/runtime.ts:13,18` | `createVfsRuntime`/`resolveDbPath` | 25 | 真死，可删 |
| A14 | `apps/desktop/scripts/fix-settings-utf8.mjs` | 整脚本 | **548** | 真死**且是地雷**（见 F-2） |
| A15 | `apps/desktop/renderer/layout/sanitize-annotate-preview-html.ts` | `sanitizeAnnotatePreviewHtml` | 49 | 生产死（1 个测试消费） |
| A16 | `apps/mobile/src/webview-host/chat-transcript/stream-tail-html-state.ts` | `nextStreamTailHtmlField` | 17 | 生产死（1 个测试消费） |
| A17 | `apps/mobile/src/vfs/errors.ts` | 全文件 | 5 | 生产死（1 个测试消费） |

### B 组 · 级联死 / 死链（删上游后才彻底死）

| # | 文件:行 | 符号 | 结论 |
|---|---|---|---|
| B1 | `apps/desktop/renderer/ipc/invoke-registry.ts:360,368,375` | `ipcMessagesHide`/`ipcMessagesHideRange`/`ipcMessagesShowRange` | `ipcMessagesHide/Show/Delete` 的唯一调用点是 A2；range 三条**零调用**（已注册未接线） |
| B2 | `apps/desktop/src/main/ipc/handler-registry.ts:303-304` | `MESSAGES_HIDE_RANGE` / `MESSAGES_SHOW_RANGE` | main 侧 handler 活的，但 renderer 侧无人调 → **已注册未接线**（与 w2-core-service-chat F-w2-01 互证） |
| B3 | `apps/desktop/src/main/ipc/handler-registry.ts:476` | `SHELL_MENU_POPUP` | 唯一 renderer 消费者是 A8；删 A8 后该通道五层全死 |
| B4 | `apps/desktop/shared/ipc-types.ts:90-91` | `MESSAGES_HIDE_RANGE`/`MESSAGES_SHOW_RANGE` 常量 | 删通道须同步删常量 |

### C 组 · 假阳性（L0 判死、实际不可删）

| # | 文件:行 | 符号 | 假阳性成因（实测证据） |
|---|---|---|---|
| C1 | `apps/mobile/src/web/chat-transcript/webview/main.ts:1` | `bootTranscript` | **构建入口**：`apps/mobile/scripts/build-webview.mjs:31` `entryRel: 'chat-transcript/webview/main.ts'` → esbuild `entryPoints` |
| C2 | `apps/mobile/src/web/shared/mermaid-fullscreen/mermaid-fullscreen-styles.ts:8` | `MERMAID_FULLSCREEN_CSS` | 构建入口：`build-webview.mjs:209` `loadWebModule(...)` 注入两包 app.css |
| C3 | `apps/mobile/src/web/shared/rich-content-styles.ts` | 3 个零消费导出 | 构建入口：`build-webview.mjs:207`；文件本体活 |
| C4 | `apps/desktop/scripts/after-pack.mjs:14` | `afterPack` | **默认导出** + electron-builder `afterPack` 钩子，且有测试 `apps/desktop/test/after-pack.test.js:4` |
| C5 | `apps/mobile/test-utils/core-shim.ts`（59 条） | 全部 | `apps/mobile/jest.config.js:58` `'^@novel-master/core$': '<rootDir>/test-utils/core-shim.ts'` |
| C6 | `apps/mobile/test-utils/notifee-mock.ts`（7 条） | 全部 | `jest.config.js:45` moduleNameMapper |
| C7 | `apps/mobile/test-utils/react-native-reanimated-mock.tsx`（3 条） | 全部 | `jest.config.js:37` |
| C8 | `apps/mobile/test-utils/react-native-blob-util-mock.ts`（2 条） | 全部 | `jest.config.js:47` |
| C9 | `apps/mobile/test-utils/op-sqlite-mock.ts`（1 条） | 全部 | `jest.config.js:48` |
| C10 | `apps/desktop/src/main/services/update-check.service.ts:9` | `runUpdateCheck` | **动态导入**：`apps/desktop/src/main/ipc/handlers/app-info.ts:26` `await Promise.all([…, import(...)])` |
| C11 | `apps/desktop/src/main/ipc/handler-registry.ts:223` | `registerHandlersFromRegistry` | **别名重导出**：`apps/desktop/src/main/ipc/register-handlers.ts:4` `export { registerHandlersFromRegistry as registerIpcHandlers }` |

### D 组 · 「只去 export，不删码」（符号活着）

| # | 文件:行 | 符号 | 证据 |
|---|---|---|---|
| D1 | `apps/desktop/src/main/shell-menu.ts:28` | `buildApplicationMenu` | 文件内 `:94 Menu.setApplicationMenu(buildApplicationMenu())` 自用 |
| D2 | `apps/desktop/src/main/ipc/forward-agent-activity.ts:37` | `detachAgentActivityForwarder` | `:31, :33` 自用；`main.ts:40,162,174` 用的是本地同名变量 |
| D3 | `apps/desktop/src/main/update-check/app-meta.ts:6,13` | `GITHUB_REPO`/`githubRepoUrl` | `:11,18,22,26` 内部解构自用；`:17 githubReleasesUrl` / `:25 licenseUrl` 才是真死函数 |
| D4 | `apps/mobile/src/update-check/app-meta.ts` | `githubReleasesUrl`/`githubRepoUrl`/`licenseUrl` | 与 D3 同名重复，双端都是死的 |
| D5 | `apps/desktop/src/main/update-check/types.ts:1` / `apps/mobile/src/update-check/types.ts:1` | `UpdateCheckStatus` | 双端同名文件同名类型，均零消费 |
| D6 | `apps/desktop/renderer/hooks/useAgentStream.ts` | `UseAgentStreamOptions`/`UseAgentStreamResult` | 文件本体**活**（`docs/apm/RULE.md`「子会话写入刷新」条目引用它作守卫） |
| D7 | `apps/desktop/shared/ipc-types.ts`（22 条 DTO） | `AgentPickerRowDto` 等 | 全部在同文件内被 IPC 泛型/通道表引用，**1741 行活文件**，只删 `export` |
| D8 | `apps/desktop/src/main/update-check/resolve-latest-release.ts:20` | `resolveLatestReleaseFromList` | `resolveLatestRelease` 活（有测试）；只有 `…FromList` 死。`docs/Iterations/about-and-update-check/spec.md:187` 写明是「预留」——**intentional 预留，但已无兑现路径** |
| D9 | `apps/desktop/src/main/services/agent-yaml.service.ts` | `decodeAgentYamlText`/`encodeAgentYamlText` | 文件被 `ipc/handlers/agent-registry.ts:26` 引用，死的只是这两个导出 |

### E 组 · periph packages（L0 未覆盖，本机位补扫）

periph 12 个包（`cloud-sync-driver-s3`/`llm-sse-native`/`sksp-{android,linux,mac,windows}`/
`tdbc-{conformance,driver-better-sqlite3,driver-op-sqlite,driver-rn}`/`tokenizer-driver-{node,rn}`）
共 **90 个生产文件 / 178 个导出 / 零引用 8 条**，且无孤儿文件（`eslint.config.mjs` 除外，那是 lint 配置）：

| # | 文件:行 | 符号 |
|---|---|---|
| E1 | `packages/tokenizer-driver-node/src/impl/web-tokenizer-counter.ts:125,143` | `ClaudeWebTokenCounter`/`messagesToOpenAiStyle` |
| E2 | `packages/tokenizer-driver-node/src/impl/sentencepiece-token-counter.ts:35` | `SentencePieceTokenCounter` |
| E3 | `packages/tokenizer-driver-node/src/impl/encoding-cache.ts:66` | `NodeEncodingFactory` |
| E4 | `packages/llm-sse-native/src/transport.ts:77` | `RequestHeadersLike` |
| E5 | `packages/sksp-android/src/native.ts:9` | `SkspNativeEncryptResult` |
| E6 | `packages/tdbc-driver-op-sqlite/src/adapter.ts:8` | `OpSqliteRows` |
| E7 | `packages/tdbc-driver-rn/src/adapter.ts:8` | `QuickSqliteRows` |

**结论：periph 包侧基本无死码**，值得单列的是 L0 的**覆盖缺口**（见 F-21）。

### F 组 · 并入统一 backlog 的 core 侧已知死项（口径与 xc-dead-core 对齐）

| # | 位置 | 结论 |
|---|---|---|
| F-a | `packages/core/src/domain/agent/session/agent-session.port.ts:52` + `service/agent/impl/chat-agent-session.ts:53` + `service/agent/impl/ephemeral-overlay-agent-session.ts:71` + `domain/agent/session/impl/in-memory-agent-session.ts:60` | **`hideRange` 的 AgentSession 侧四声明**。生产调用方 0；唯一消费是 `packages/core/test/agent/agent-session.test.ts:26`。注意与**活着的** `MessageService.hideRange`（`service/chat/impl/message.service.ts:389`，被 `message-transcript-effects.service.ts:51,125,151` + `apps/cli/src/message/commands.ts:174` 调用）**同名不同口**，删时勿误伤 |
| F-b | `packages/core/src/domain/tool/builtin/vfs-tools.ts:69` → `packages/core/src/index.ts:195` | **`FILE_OPEN_TOOL_NAMES` 公开副本**，与 `domain/tool/logic/vfs-tool-file-path.ts:10` 的本地副本字面重复（`{read, write, edit}`）。**snapshot-gated**：名字已进 `packages/core/test/package-exports/snapshots/main-entry-allowlist.json:12` |
| F-c | `packages/core/src/domain/tool/logic/subagent-tool-session-id.ts:33` | `isTaskToolUse` 全仓仅定义行 1 处（连测试都没有），34 行整模块可删 |

---

## 发现清单

### F-xc-dead-apps-1 | **P1** | `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx:176`

> ```
> 176: export const AgentDefinitionEditorForm = forwardRef<
> 177:   AgentDefinitionEditorFormHandle,
> 178:   AgentDefinitionEditorFormProps
> ```

**描述**：1048 行整文件孤儿。本机位独立复扫确认：全仓 2373 个代码文件中**零个** import 它；
符号 `AgentDefinitionEditorForm` / `…Handle` / `…Props` / `…BuildResult` 的全部命中都在文件自身。
它与仍在役的 `AgentEditorView.tsx` 是两套并存的 agent 编辑表单。

**建议**：整文件删除。删除前须处理两处连带：
① `docs/apm/memory/20260825-*.md:242` 与 `20260829-curl-upgrade-impl.md:20` 记录的三处 hint 文案同步
（`20260906-web-search-tool-overflow-sink.md:64` 已注明「`AgentDefinitionEditorForm` 未挂载组件照旧同步」，
即这个孤儿文件仍在被当作"文案第三处"维护——**这是它唯一的活价值：文案债的占位符**）；
② `BUILTIN_TOOL_CATALOG` hint 的 `/10`→`/11` 断言若有引用本文件的测试需先摘。

**置信**：confirmed（与 `w2-desktop-features.md:100-108` F-desktop-features-1 独立复核一致）

---

### F-xc-dead-apps-2 | **P1** | `apps/desktop/scripts/fix-settings-utf8.mjs:38,54`

> ```
> 3:  * Run: node apps/desktop/scripts/fix-settings-utf8.mjs
> 38/54: const raw = execSync("git show d825173:…" )
> ```

**描述**：548 行一次性 CJK 修复脚本，**无任何调用方**（package.json scripts、CI、文档均无引用；
`docs/Iterations/config-forms-merge-into-core/spec.md:71` 只是历史记录）。它是"未接线地雷"：
跑一次就从固定 commit `d825173` 取出 `AgentEditor*` 文件覆写工作区，在当前 1048 行孤儿表单已存在、
`AgentEditorView` 已重构的树上执行会回滚并 ENOENT 崩。

**建议**：直接删除整文件（比"删死导出"更彻底——`EventsConfigView` 只是它内部的一个导出）。
`w3-xc-sweep31.md:169-177`（F-xc-sweep31-1）已从"地雷"角度报同一条，本条从"死文件 backlog"角度并入，结论一致。

**置信**：confirmed

---

### F-xc-dead-apps-3 | **P2** | `apps/desktop/renderer/features/chat/transcript-selectable-role.ts:12` + `apps/mobile/src/components/chat/transcript-selectable-role.ts`

**描述**：双端同名同职责的薄 re-export 层，各 48 / 50 行，**两端都零 importer**。
它们 re-export 的 `@shared/logic/chat` 侧函数本身在 desktop 有别的活消费者
（`message-blocks.ts:4`、`preview-annotate.ts:26,38` 等 14 处），但这两个 re-export 层整体没人用。

**连带**：删掉后 `@shared/logic/chat` 侧的 `TailBatchRow` 类型转发与 tail-batch 选择逻辑就完全没有 renderer 消费方，
`docs/apm/RULE.md` 记录的 tail 批量删除 UI 能力实际处于"后端在、前端无入口"状态。
`w2-core-service-chat.md:283`（F-w2-01）已从 IPC 侧指出 `nm:messages/truncateAfter` 已注册未接线，本条是同一事实的 UI 侧对偶。

**建议**：删两文件 + 连带复核 tail 批量 UI 是否已下线；若确认下线，`IPC_CHANNELS.MESSAGES_TRUNCATE_AFTER` 一并摘。

**置信**：confirmed

---

### F-xc-dead-apps-4 | **P2** | `apps/desktop/renderer/features/chat/tool-turn-actions.ts:12` + `apps/mobile/src/components/chat/tool-turn-actions.ts:10`

**描述**：双端同名重复（desktop 55 行 / mobile 48 行）。desktop 端**完全零引用**；mobile 端生产零引用，
只有 `apps/mobile/__tests__/tool-turn-actions.test.ts` 一个测试（4 个 it）消费。
成因可追溯：`docs/Iterations/desktop-regression-fixes-2026-09/prd.md:157` 写明「消息菜单亦无『隐藏』项」，
即 hide/delete tool-turn 是已下线的能力，实现留在了代码里。

**连带（重要）**：`ipcMessagesHide`/`ipcMessagesShow`/`ipcMessagesDelete` 在 renderer 侧的唯一调用点就是
`apps/desktop/renderer/features/chat/tool-turn-actions.ts:7,20,28,31`。删掉它，这三条 IPC 通道
（`MESSAGES_HIDE` / `MESSAGES_SHOW` / `MESSAGES_DELETE`）从 renderer 到 main handler 变成全链无人调用。

**建议**：双端文件 + 对应测试一起删；IPC 通道是否一并摘需与 `xc-ipc` 机位对齐（main 侧 handler 仍活着）。

**置信**：confirmed

---

### F-xc-dead-apps-5 | **P2** | `apps/desktop/renderer/layout/AppMenuBar.tsx:14`

> ```
> 2: import { ipcShellMenuPopup } from "../ipc/client";
> 17:   void ipcShellMenuPopup({ menuId, x: rect.left, y: rect.bottom });
> ```

**描述**：41 行整组件孤儿（`L0/ipc-census.md:517-518` 已把本文件标为 `SHELL_MENU_POPUP` /
`SHELL_SET_TITLEBAR_THEME` 的第 1 号 renderer 消费方）。菜单已由 Electron 原生菜单接管
（`apps/desktop/src/main/shell-menu.ts:94 Menu.setApplicationMenu(...)`，live）。

**连带**：删掉后 `IPC_CHANNELS.SHELL_MENU_POPUP`（`ipc-types.ts:199`）+
`main/ipc/handler-registry.ts:476 bindEventReq` 全链死。

**建议**：删组件 + 摘通道。**注意**：`SHELL_SET_TITLEBAR_THEME` 在 census 里与本通道同行出现，
须核实它是否另有消费方再决定是否同删。

**置信**：confirmed（与 `w2-desktop-core.md:349-355` F-desktop-core-12 一致）

---

### F-xc-dead-apps-6 | **P2** | `apps/mobile/src/components/chat/flush-run-ui.ts:1`

**描述**：41 行，**仅 mobile 半边死**。desktop 半边
（`apps/desktop/renderer/features/chat/flush-run-ui.ts`，27 行）是活的——
被 `apps/desktop/renderer/features/chat/conversation-abort-retain.ts:7` import。
mobile 半边生产零引用，只有 `apps/mobile/__tests__/flush-run-ui.test.ts` 消费。

**建议**：删 mobile 半边 + 其测试；desktop 半边保留。
`docs/Iterations/agent-chat-ux-bugfix/spec.md:105` 曾明确「Desktop 不改 `flush-run-ui.ts` 签名」——
spec 约束的是 desktop，删 mobile 不违反。

**置信**：confirmed（独立复核 `w1-mobile-chat-ui.md:115`）

---

### F-xc-dead-apps-7 | **P2** | `apps/desktop/renderer/hooks/useStreamTailGenerating.ts:8` + `apps/mobile/src/hooks/useStreamTailGenerating.ts:8`

> ```
> 8: export function useStreamTailGenerating(uiRunning: boolean): StreamTailGenerating {
> 9:   return { streamTailGenerating: uiRunning };
> ```

**描述**：双端各一份（11 / 13 行），实现就是 `uiRunning` 的恒等包装。全仓 grep `useStreamTailGenerating`
只命中两处定义行。属"能力退化成透传后没人接线"的残留。

**建议**：双端同删（24 行）。低风险。

**置信**：confirmed

---

### F-xc-dead-apps-8 | **P2** | `apps/mobile/src/services/session-messages-loader.ts:15,23`

**描述**：39 行，生产零引用（`loadSessionMessages` / `loadSessionMessagesTail`）。
但**有 6 个测试文件对它做 `jest.mock`**：

- `apps/mobile/__tests__/chat-tab-screen.integration.test.tsx:209`（:421 注释明写「该 loader 的 hook 消费方已退役」）
- `apps/mobile/__tests__/chat-tab-screen-legacy-scroll.test.tsx:157`
- `apps/mobile/__tests__/composer-fullscreen.test.tsx:231`
- `apps/mobile/__tests__/use-chat-tab-message-actions-rollback.test.ts:37`
- `apps/mobile/__tests__/use-chat-tab-message-actions-set-floor.test.ts:23`
- `apps/mobile/__tests__/use-chat-tab-message-actions-token-peak.test.ts:32`

**这是本 backlog 里"删除会立刻崩测试"的头号条目**：`jest.mock(path, factory)` 对不存在的模块会抛
`Cannot find module`。删除前置条件 = 先摘掉这 6 处 `jest.mock` 块（它们 mock 的目标已经不存在，
mock 本来就已是空转）。

**建议**：先删 6 处 `jest.mock`，再删文件。

**置信**：confirmed

---

### F-xc-dead-apps-9 | **P2** | `apps/cli/src/vfs/errors.ts:4,7,20`

**描述**：29 行整文件孤儿（`EXIT_USAGE`/`EXIT_RUNTIME`/`formatCliError`/`exitCodeForError` 全零消费）。
同时 `apps/cli/src/cli-errors.ts:1` 另有一套 CLI 错误格式化 + 退出码（88 行，含 `EXIT_RUNTIME` 同名常量），
两套并存。`apps/cli/src/vfs/parse-args.ts:68` 的 `ParsedCliArgs` 也是同类死导出，
但该文件有 **30 个 importer**（活跃），只能去 export。

**建议**：删 `vfs/errors.ts`；`cli-errors.ts` 的 `EXIT_RUNTIME` 去 export；`parse-args.ts` 的
`ParsedCliArgs` 去 export。CLI 错误口径应收口到 `cli-errors.ts` 单源。

**置信**：confirmed

---

### F-xc-dead-apps-10 | **P2** | `apps/desktop/renderer/ipc/invoke-registry.ts:371,375` + `apps/desktop/src/main/ipc/handler-registry.ts:303-304`

**描述**：`MESSAGES_HIDE_RANGE` / `MESSAGES_SHOW_RANGE` / `MESSAGES_TRUNCATE_AFTER` 三条通道
**已注册未接线**——main 侧 `bindReq` 有、renderer 侧 `invoke-registry` 有 `ipcMessagesHideRange` /
`ipcMessagesShowRange`，但全仓**没有任何组件调用它们**。

**建议**：这三条是"能力已下线、链路未拆"的典型。摘链路前先确认 core 侧 `hideRange` 语义
（压缩 / 置位由 `message-transcript-effects.service.ts` 内部调用，不走 IPC）不会受影响——
本条与 F-a 是同一件事的两端。**P2 而非 P1**：链路上没有"点了没反应"的活 UI，只是白挂 handler。

**置信**：confirmed（与 `w2-core-service-chat.md:283`、`w2-desktop-core.md:467` 互证）

---

### F-xc-dead-apps-11 | **P2** | `packages/core/src/domain/agent/session/agent-session.port.ts:52`（hideRange 四声明）

**描述**：`hideRange` 在 core 有两套同名不同口的口径——
**活**的 `MessageService.hideRange`（`message.service.ts:389`，被 transcript-effects ×3 与
`apps/cli/src/message/commands.ts:174` 调用），**死**的 `AgentSession.hideRange`
（port + `chat-agent-session.ts:53` + `ephemeral-overlay-agent-session.ts:71` 委托 + `in-memory-agent-session.ts:60`，
共 4 处声明，生产调用方 0，只被 `packages/core/test/agent/agent-session.test.ts:26` 一个测试消费）。

**建议**：连同 `agent-session.test.ts` 里那条 it 一起删。**删除前置条件**：`AgentSession` 端口的
其余方法若也只剩这一条死方法，port 可能整体可摘——须与 xc-dead-core 对齐，避免重复裁决。
RULE.md 未把 `AgentSession.hideRange` 列为有意保留，**非 intentional**。

**置信**：confirmed

---

### F-xc-dead-apps-12 | **P2** | `packages/core/src/domain/tool/builtin/vfs-tools.ts:69` + `packages/core/src/index.ts:195`

> ```
> vfs-tool-file-path.ts:10   const FILE_OPEN_TOOL_NAMES = new Set(["read", "write", "edit"]);
> vfs-tools.ts:69            export const FILE_OPEN_TOOL_NAMES = new Set<FileToolName>([...]);
> ```

**描述**：同一白名单两份实现，字面重复，公开那份零消费。

**删除前置条件（硬门槛）**：`FILE_OPEN_TOOL_NAMES` 已写进
`packages/core/test/package-exports/snapshots/main-entry-allowlist.json:12`。
删它必须**同步改这份 allowlist 快照**，否则 `packages/core/test/package-exports/` 的快照测试直接红。
正确改法是让 `vfs-tool-file-path.ts` 引用公开版（单源），而非删公开版——除非确定双端永不需要它。

**置信**：confirmed（w1-core-tool.md:280 已列同一争议，此处给出口径：**单源化，不是删除**）

---

### F-xc-dead-apps-13 | **P2** | `packages/core/src/domain/tool/logic/subagent-tool-session-id.ts:33`

**描述**：`isTaskToolUse` 全仓仅 1 处命中（自己的定义行），连测试都没有。同文件的
`resolveSubagentSessionId` 也只有一个测试引用、未从 `index.ts`/`public/chat.ts` 导出。
34 行整模块可删。

**置信**：confirmed（与 w1-core-tool.md:60-64 一致）

---

### F-xc-dead-apps-14 | **P2** | `apps/desktop/src/main/update-check/app-meta.ts:17,25` + `apps/mobile/src/update-check/app-meta.ts` + 双端 `types.ts:1`

**描述**：更新检查的 GitHub URL 工具函数在双端各写一份，且**两份的这几个函数都没人用**：
desktop `githubReleasesUrl`/`licenseUrl` 死（renderer 不能直接 fetch，见文件头 CORS 注释），
mobile `githubReleasesUrl`/`githubRepoUrl`/`licenseUrl` 同死。双端 `types.ts` 里的 `UpdateCheckStatus`
也同名同死。真正活着的是 `githubLatestReleaseApiUrl` 与 `resolveLatestRelease`。

**建议**：双端 `app-meta.ts` 各留 `GITHUB_REPO` + `githubLatestReleaseApiUrl`（去 export 其余）；
`types.ts` 的 `UpdateCheckStatus` 去 export 或删。属"双端重复实现 + 双端都死"的一格。

**置信**：confirmed

---

### F-xc-dead-apps-15 | **P2** | `apps/desktop/renderer/features/workspace/useWorkspaceTree.ts:7`

**描述**：67 行整文件孤儿，三个 hook（`usePreviewSelection` / `useTreeRefreshToken` / `useTreeLoader`）
零 importer、零内部自用、零测试。文件树能力后来改由 `ShellNavProvider` 旁路订阅 agent stream 实现
（`docs/apm/RULE.md`「子会话写入刷新（desktop）」条目）。旧 CR 已多次点名
（`docs/Iterations/cr-fix-spec/review/phase1-lens/D1-09-dead-code.md:108`、
`w2-desktop-features.md:312` F-desktop-features-11），一直未删。

**建议**：整文件删除。低风险。

**置信**：confirmed

---

### F-xc-dead-apps-16 | **P2** | `apps/mobile/src/components/batch/ListBatchBar.tsx:15`

**描述**：57 行整组件孤儿，零引用。批量操作已由 `components/batch/ManageHeader.tsx` 承担
（`w2-mobile-ui.md:151-152` F-mobile-ui-12 已核实并记录同一结论）。

**建议**：整文件删除。低风险。

**置信**：confirmed

---

### F-xc-dead-apps-17 | **P3** | `apps/desktop/renderer/layout/sanitize-annotate-preview-html.ts` + `apps/mobile/src/webview-host/chat-transcript/stream-tail-html-state.ts` + `apps/mobile/src/vfs/errors.ts`

**描述**：三个小文件（49 / 17 / 5 行）生产零引用，各有 1 个测试消费。
量级小，但同属"测试锁住了生产已死的代码"这一格。

**建议**：随测试一起删；或先删测试再删文件（无依赖风险）。

**置信**：confirmed

---

### F-xc-dead-apps-18 | **P3** | L0 `dead-exports.md` apps 行整体（方法论）

**描述**：本机位对 700 条 apps 零消费导出做符号级复扫后，得到的关键结构性结论是：

> **194 个"全部导出都死"的文件里，只有 20 个真正零 importer。其余 174 个是"导出死"不是"文件死"。**

具体成因分布（按可复核的解析器缺项）：

1. **只被内部使用**（最大一类）：`apps/desktop/shared/ipc-types.ts` 22 条 DTO（1741 行活文件）、
   `apps/desktop/src/main/shell-menu.ts`、`apps/desktop/src/main/ipc/forward-agent-activity.ts` 等。
2. **别名重导出**：`registerHandlersFromRegistry as registerIpcHandlers`（C11）。
3. **动态 `import()`**：`update-check.service.ts`（C10）。
4. **tsconfig/babel 路径别名**：`@shared/logic/*`、`@/`、`@web/*`——人工 grep 极易误判，
   例如 `apps/desktop/shared/logic/{skills,smart-sort,vfs,config-forms-stored-config-validity}.ts`
   若不解析别名会被判成孤儿，实则均有 2-3 个 renderer 消费方。
5. **构建入口**：`build-webview.mjs` 的 4 个 `entryRel` + 3 个 `loadWebModule` 目标（C1-C3）。
6. **jest moduleNameMapper**：`apps/mobile/test-utils/*` 5 个文件共 72 条零消费导出（C5-C9）。

L0 自己在"五、方法与已知局限"里已声明前两类与 test-utils 的口径问题（"文件内自用"列、
"应先排除该目录再定级"），**本条不重复报为 L0 缺陷**，而是把它变成一条可执行的判读规则：
**L0 表的每一行必须先判文件可达性，再判符号**。

**置信**：confirmed

---

### F-xc-dead-apps-19 | **P3** | apps 内大量 `Props`/`Options` 类型零消费导出

**描述**：`apps/desktop/renderer/**` 与 `apps/mobile/src/**` 里大批组件的 `XxxProps` / `XxxOptions`
类型被 export 但零外部消费（组件本体活着）。典型：
`apps/mobile/src/components/batch/ManageHeader.tsx`（10 条）、`apps/mobile/src/theme/ThemeProvider.tsx`（83 条）、
`apps/desktop/renderer/providers/ShellNavProvider.tsx`（12 条）、`apps/mobile/src/storage/chat-composer-draft.ts`（11 条）。

这些**不是死码**——符号在文件内部全活。可行的批量动作只有一个：**去掉 `export` 关键字**。

**建议**：**不要**把它们当死码排进删除 backlog。若要收口，单独开一条"app 层类型去 export"的机械清理，
并先确认不会破坏 `@/` 别名下的类型再导出需求。

**置信**：confirmed（列为 intentional-acceptable 现状，非缺陷）

---

### F-xc-dead-apps-20 | **P3** | periph packages 死码普查（补 L0 覆盖缺口）

**描述**：L0 `dead-exports.md` 头部自述范围是「`packages/core/src` + `apps/{mobile,desktop,cli}`」，
**`packages/` 下另外 12 个包完全没进普查**。本机位补扫：90 个生产文件、178 个导出、零引用仅 8 条（E1-E7），
且没有孤儿源文件。结论是 periph 包侧健康，但**这个"健康"是本机位新测的，不是 L0 结论**——
`L0/coverage-matrix.md` 应把这 90 个文件登记为已覆盖，否则后续机位会重复劳动或误以为已扫过。

**建议**：在 coverage-matrix 里补登记 periph 包；8 条零引用导出作为 P3 清理项。

**置信**：confirmed

---

## 统一删除 backlog

> 每条：`文件/符号` · `规模` · `连带测试` · `删除前置条件`。**合计 ≈ 2.2k 行**（不含去 export 类）。

| # | 文件 / 符号 | 规模 | 连带测试 | 删除前置条件 |
|---|---|---|---|---|
| B-01 | `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx` | **1048 行** | 无直接测试 | 先摘三处 hint 文案同步里对本文件的引用（apm memory 20260825/20260829/20260906）；确认无 `/10→/11` 断言指向它 |
| B-02 | `apps/desktop/scripts/fix-settings-utf8.mjs` | **548 行** | 无 | 无（直接删）。**顺带消除未接线地雷** |
| B-03 | `apps/desktop/renderer/features/chat/transcript-selectable-role.ts` | 48 行 | 无 | 与 B-05 同批 |
| B-04 | `apps/mobile/src/components/chat/transcript-selectable-role.ts` | 50 行 | 无 | 同上 |
| B-05 | `IPC_CHANNELS.MESSAGES_TRUNCATE_AFTER` + `transcript-selectable-role` 侧的 tail 批量选择逻辑 | 通道 1 条 | — | 与 `xc-ipc` 对齐；须确认 tail 批量 UI 已下线（当前 renderer 零入口） |
| B-06 | `apps/desktop/renderer/features/chat/tool-turn-actions.ts` | 55 行 | 无 | 无 |
| B-07 | `apps/mobile/src/components/chat/tool-turn-actions.ts` | 48 行 | `apps/mobile/__tests__/tool-turn-actions.test.ts`（4 个 it） | 同批删测试 |
| B-08 | `IPC_CHANNELS.MESSAGES_HIDE` / `MESSAGES_SHOW` / `MESSAGES_DELETE` + `invoke-registry.ts:360-380` + `client.ts:90` | 通道 3 条 | — | B-06/B-07 落地后 renderer 零调用；与 `xc-ipc` 对齐后摘 main 侧 `bindReq` |
| B-09 | `apps/mobile/src/components/chat/flush-run-ui.ts` | 41 行 | `apps/mobile/__tests__/flush-run-ui.test.ts` | 同批删测试。**desktop 半边保留** |
| B-10 | `apps/desktop/renderer/layout/AppMenuBar.tsx` | 41 行 | 无 | 无 |
| B-11 | `IPC_CHANNELS.SHELL_MENU_POPUP` + `handler-registry.ts:476` | 通道 1 条 | — | 先核实 `SHELL_SET_TITLEBAR_THEME` 是否另有消费方 |
| B-12 | `apps/desktop/renderer/features/workspace/useWorkspaceTree.ts` | 67 行 | 无 | 无 |
| B-13 | `apps/mobile/src/components/batch/ListBatchBar.tsx` | 57 行 | 无 | 无 |
| B-14 | `apps/desktop/renderer/hooks/useStreamTailGenerating.ts` | 11 行 | 无 | 无 |
| B-15 | `apps/mobile/src/hooks/useStreamTailGenerating.ts` | 13 行 | 无 | 无 |
| B-16 | `apps/cli/src/vfs/errors.ts` | 29 行 | 无 | 无（CLI 错误口径已由 `cli-errors.ts` 承担） |
| B-17 | `apps/mobile/src/services/session-messages-loader.ts` | 39 行 | **6 个测试的 `jest.mock`** | ⚠️ **必须先摘 6 处 `jest.mock`**，否则测试全红 |
| B-18 | `apps/desktop/renderer/layout/sanitize-annotate-preview-html.ts` | 49 行 | `apps/desktop/test/preview-annotate-source-anchor.test.ts:26,48` | 同批删/改测试 |
| B-19 | `apps/mobile/src/webview-host/chat-transcript/stream-tail-html-state.ts` | 17 行 | `apps/mobile/__tests__/stream-tail-html-state.test.ts` | 同批删测试 |
| B-20 | `apps/mobile/src/vfs/errors.ts` | 5 行 | `apps/mobile/__tests__/errors.test.ts` | 同批删测试 |
| B-21 | `packages/core/src/domain/agent/session/agent-session.port.ts` 的 `hideRange` + `chat-agent-session.ts:53` + `ephemeral-overlay-agent-session.ts:71` + `in-memory-agent-session.ts:60` | 4 处声明 | `packages/core/test/agent/agent-session.test.ts:21-26` | 与 xc-dead-core 去重；**勿伤活的 `MessageService.hideRange`** |
| B-22 | `packages/core/src/domain/tool/logic/subagent-tool-session-id.ts` | 34 行 | 无（`resolveSubagentSessionId` 有 1 测试） | 删 `isTaskToolUse`；`resolveSubagentSessionId` 视测试去留 |
| B-23 | `FILE_OPEN_TOOL_NAMES` 重复 | 1 处 const | — | ⚠️ **`packages/core/test/package-exports/snapshots/main-entry-allowlist.json:12` 快照同步**；推荐单源化（`vfs-tool-file-path.ts` 引公开版）而非删公开版 |
| B-24 | `MESSAGES_HIDE_RANGE` / `MESSAGES_SHOW_RANGE` 通道 + `invoke-registry.ts:371,375` + `handler-registry.ts:303-304` | 通道 2 条 | `apps/desktop/test/messages-set-floor-handler.test.ts:85` 仍测 core 侧同名 API | 与 B-21 同批（同一能力的两端） |
| B-25 | `apps/desktop/src/main/update-check/app-meta.ts` 的 `githubReleasesUrl`/`licenseUrl` + `apps/mobile/src/update-check/app-meta.ts` 同名三项 + 双端 `types.ts` 的 `UpdateCheckStatus` | 约 6 函数 + 2 类型 | 无 | 无；双端同批处理 |
| B-26 | `apps/cli/src/cli-errors.ts` 的 `EXIT_RUNTIME` 去 export + `apps/cli/src/vfs/parse-args.ts` 的 `ParsedCliArgs` 去 export | 2 处 | 无 | **只去 export，不删文件**（两文件都有活跃 importer） |
| B-27 | periph 8 条零引用导出（E1-E7） | 8 符号 | 无 | 逐个确认不是 `package.json` `exports` 对外契约面 |

**去 export（不删码）单独成批**（约 40+ 符号，零行为风险）：
`shared/ipc-types.ts` 22 条 DTO、`shell-menu.ts:buildApplicationMenu`、
`forward-agent-activity.ts:detachAgentActivityForwarder`、`update-check/app-meta.ts` 的 `GITHUB_REPO`/`githubRepoUrl`、
`useAgentStream.ts` 的 `UseAgentStreamOptions`/`UseAgentStreamResult`、
`agent-yaml.service.ts` 的 `decode/encodeAgentYamlText`、
`resolve-latest-release.ts:resolveLatestReleaseFromList`（**spec 写明是预留**，`docs/Iterations/about-and-update-check/spec.md:187`——
建议保留或删须用户拍板）、以及 F-19 的大批组件 Props 类型。

---

## 争议与存疑

1. **`resolveLatestReleaseFromList` 是不是「有意预留」？** `docs/Iterations/about-and-update-check/spec.md:187`
   明写「预留：导出 … 供未来分端 workflow 替换实现」。按协议 §3「RULE/迭代文档写明是故意设计的，标 intentional 不当问题报」，
   **本机位不敢自行判死**。我倾向删（"未来分端 workflow"已随 GitHub 统一 releases API 失去意义），
   但这是拍板级，须用户定。**置信：suspected**。

2. **`AgentSession.hideRange` 与 `MessageService.hideRange` 同名不同口，是刻意分层还是历史残留？**
   我按"零生产调用 + 只有 1 个测试"判死（置信 confirmed），但 `ephemeral-overlay-agent-session.ts:50-52` 有注释
   「overlay compaction 若要实现，在 ephemeral overlay 上实现 `hideRange`」——**这条注释构成"为未来预留"的弱证据**，
   指向 intentional 的可能。我未读那条注释的完整上下文，**留给 xc-dead-core 裁决**，不在本机位单方面删。

3. **`FILE_OPEN_TOOL_NAMES` 该"单源化"还是"删公开副本"？** w1-core-tool.md:280 已提出同一问题未决。
   本机位给的口径是**单源化**（保留公开副本、删本地副本），理由：公开面已被 allowlist 快照锁住，
   删它要动快照，而让双端读到单源更符合 RULE.md 的"单源"惯例。**置信：suspected**（方向建议，非实测结论）。

4. **`apps/desktop/shared/logic/chat.ts`（115 行）删掉两个 re-export 层后会变成什么样？**
   它现在有 14 个 renderer 消费方（`message-blocks.ts:4`、`preview-annotate.ts:26,38` 等），
   所以**不会**整文件死，但 tail-batch 那批导出（`TailBatchRow`/`TranscriptSelectableRole`/
   `computeTailBatch*`）届时将只剩测试消费。本机位**未逐条核实这批导出在 `chat.ts` 内的其它消费**，
   列为删 B-03/B-04 时的**复查项**。

5. **`docs/apm/memory/20260906-web-search-tool-overflow-sink.md:64` 说「`AgentDefinitionEditorForm` 未挂载组件照旧同步」**——
   这暗示这个 1048 行孤儿仍被当作"hint 文案第三处"在维护。我把它列为 B-01 的前置条件，
   但**没有去核那三处 hint 文案当前实际在哪个文件里**，故 B-01 的前置条件描述是推测性的。**置信：suspected**。

6. **本机位未覆盖**：`apps/mobile/src/web/**` 下的 webview runtime 有一批"全部导出死"但文件被
   `main.ts` 入口间接拉起的模块（如 `runtime/menu/menu.ts` 11 条、`runtime/stream/stream.ts` 9 条）。
   它们经 `@web/` 别名被 `main.ts` 引用，属于**可达**；我按"只去 export"处理，
   但没有逐个确认 11 条 `menu.ts` 导出（如 `invokeRegisteredRenderContextMenu`、
   `RenderContextMenuView` 这类"由 boot 注入的视图实现"）是否真的只是 export 冗余——
   **这类"注册表注入型"导出需要人工读 boot 装配逻辑才能定**，本机位留作 P3 线索交给 `xc-webview` 类机位或 W6 验证。

7. **`L0/coverage-matrix.md` 显示 29 个文件 `UNASSIGNED`（含 `apps/desktop/scripts/*`）**——
   这些脚本文件的归属机位未定，dead 维度上除 B-02 外无其它发现，但派单登记时应把它们明确认领。