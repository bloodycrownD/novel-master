---
zone: xc-ipc
agent: 横切/IPC 双侧断链 + X1 门禁 + CI 门禁纪律
files_scanned: >
  apps/desktop/shared/ipc-types.ts, apps/desktop/renderer/ipc/invoke-registry.ts,
  apps/desktop/renderer/ipc/client.ts, apps/desktop/src/main/ipc/handler-registry.ts,
  apps/desktop/src/main/ipc/handlers/{projects,sessions,vfs,workplace,messages,smart-sort-rule,skills}.ts,
  apps/desktop/renderer/{App.tsx,features/chat/*,features/settings/*,hooks/*,providers/*,layout/*},
  apps/desktop/shared/logic/*.ts, apps/desktop/eslint.config.mjs, eslint.config.base.mjs,
  .github/workflows/ci.yml, packages/core/src/service/chat/impl/message-transcript-effects.service.ts,
  packages/core/src/service/chat/impl/message.service.ts,
  packages/core/src/domain/message-checkpoint/logic/truncate-tail-in-transaction.ts,
  packages/core/src/public/{events,chat,provider}.ts
---

## 摘要

IPC 面断链终裁：以 `IPC_CHANNELS` 155 条为全集做五层机器比对（L0/ipc-census.md），对 12 条断链逐条定性（真死 / 有意预留 / 层间漂移）。顺带把「X1 门禁 9 处 renderer 直连 core 违规」逐处落到 `@shared/logic/*` 映射，并实测 CI 里 lint/typecheck 的真实错误面，给出 continue-on-error 的收口方案。

## 职责与边界

本机位**不评判业务功能正确性**，只判定「通道 / 封装 / 消费点」三层是否存在、四层口径是否一致。X1 部分只做**映射方案**（改走哪个 `@shared/logic/*` 出口、是否需要新增再导出），不执行改动。CI 部分只给处置建议，不改 workflow。

## 对外接口

本报告不新增接口；引用面见下表。

| 面 | 位置 | 角色 |
|---|---|---|
| `IPC_CHANNELS` | `apps/desktop/shared/ipc-types.ts:20-200` | 155 条通道全集（invoke 148 / push 7） |
| `invokeRegistry` | `apps/desktop/renderer/ipc/invoke-registry.ts` | ③ 层 invoke 封装（约 148 个 `ipcXxx`） |
| `client.ts` | `apps/desktop/renderer/ipc/client.ts:40-200` | ④ 层再导出（解构自 invokeClient） |
| `registerHandlersFromRegistry` | `apps/desktop/src/main/ipc/handler-registry.ts:223-483` | ① 层注册 |
| X1 gate | `apps/desktop/eslint.config.mjs:71-88` | `no-restricted-imports` 禁 renderer 引 `@novel-master/core*` |

## 数据访问

- `IPC_CHANNELS`：见上，无 DB/KKV 直连。
- 本机位发现的核心缓存面（与 `truncateMessagesAfter` 定级直接相关）：
  - `SESSION_KKV_DOMAIN_USAGE_STATS` / `USAGE_STATS_TOOL_USE_COUNT_KEY` — `packages/core/src/domain/session-kkv/model/session-kkv-domains.ts:87`
  - prompt token 热层 + KKV 行双删 — `packages/core/src/infra/tokenizer/logic/session-api-prompt-token-store.ts`（`invalidateSessionApiPromptTokenEntry`）
  - `rule_snapshot` / `file_cache` 两域 — `packages/core/src/service/chat/impl/message-transcript-effects.service.ts:162-182`

## 依赖关系

- renderer **不得** import core（X1），一切 core 入口经 `@shared/logic/*`（`apps/desktop/shared/logic/` 下 12 个薄再导出文件，全为 `export { ... } from "@novel-master/core/xxx"` 形态，无 `export *`）。
- main **可以**直连 core（`apps/desktop/src/**` 全量合法），X1 gate 只对 `renderer/**` 生效（`eslint.config.mjs:73`）。

---

## 发现清单

### 一、12 条 IPC 断链逐条定性

先给结论表（处置 = 建议动作，理由见各条）：

| # | 通道 | 断点 | 定性 | 处置 |
|---|---|---|---|---|
| 1 | `PROJECTS_GET_AGENT_CONFIG` | ⑤ 无消费 | **真死删** | 删通道 + handler + DTO |
| 2 | `PROJECTS_UPDATE_AGENT_CONFIG` | ⑤ 无消费 | **真死删** | 同上 |
| 3 | `SESSIONS_GET_AGENT_BINDING` | ⑤ 无消费 | **真死删**（写侧活着，读侧冗余） | 删读侧 |
| 4 | `VFS_LIST` | ③ 未封装 | **真死删** | 删通道 + handler |
| 5 | `VFS_START_DRAG` | ③ 未封装 | **有意预留（非断链）** | 保留，普查口径修正 |
| 6 | `WORKPLACE_CAPTURE_SESSION_BLOCK` | ⑤ 无消费 | **真死删**（有单测续命） | 删通道，测试同删 |
| 7 | `MESSAGES_HIDE_RANGE` | ⑤ 无消费 | **层间漂移须补 或 真死删**（拍板二选一） | 见 F-xc-ipc-7 |
| 8 | `MESSAGES_SHOW_RANGE` | ⑤ 无消费 | 同上 | 见 F-xc-ipc-7 |
| 9 | `MESSAGES_TRUNCATE_AFTER` | ⑤ 无消费 | **层间漂移须补（连带修 core 漏失效）** | 见 F-xc-ipc-9 / F-xc-ipc-9b |
| 10 | `SMART_SORT_RULE_IMPORT_RULES` | ⑤ 无消费 | **真死删**（被 yamlImport 取代） | 删通道 + handler |
| 11 | `SMART_SORT_RULE_EXPORT_RULES` | ⑤ 无消费 | **真死删**（被 yamlExport 取代） | 删通道 + handler |
| 12 | `SKILLS_EDIT` | ⑤ 无消费 | **真死删**（被 skillsWrite 取代） | 删通道 + handler |

汇总：**真死删 8 条**（1/2/3/4/6/10/11/12）、**有意预留 1 条**（5）、**层间漂移须补 3 条**（7/8/9，且 9 带一个 core 侧真 bug）。

---

**F-xc-ipc-1 | P2 | `apps/desktop/src/main/ipc/handlers/projects.ts:81-108`**

```
85:    // 项目智能体已下线：恒返回 follow 默认，不读取列内残留数据。
86:    return { ok: true, data: { mode: "follow" } };
...
101:    console.warn("[nm-desktop] projects.updateAgentConfig called but project agent feature is removed; ...")
```

handler 注释自陈「项目智能体已下线」并标 `@deprecated`（:94「保留 handler 以兼容外部脚本调用」）。但 ⑤ 层实测零消费，且**「外部脚本」在 Electron 语境下不存在**——renderer 是唯一客户端，preload 只暴露通用 `invoke/on/off`（`src/preload/preload.ts:3`）。通道 + handler + `ProjectAgentConfigDto` 三层都是为已下线功能留的壳。

**建议**：删 `IPC_CHANNELS.PROJECTS_GET_AGENT_CONFIG` / `PROJECTS_UPDATE_AGENT_CONFIG`（ipc-types.ts:43-44 附近）、`handleProjectsGetAgentConfig` / `handleProjectsUpdateAgentConfig`、registry.ts:235-239 绑定、invoke-registry.ts:204-211 封装、client.ts:50-51 导出、`test/projects-agent-config-handlers.test.ts` 整文件。
**置信**：confirmed。

---

**F-xc-ipc-2 | P2 | `apps/desktop/src/main/ipc/handlers/sessions.ts:174-184`**

```
179:    const config = await rt.sessions.getSessionAgentConfig(req.sessionId);
```

与写侧成对：`handleSessionsSetAgentBinding` 返回最新 config（handler 注释 :189-191「UI 拿到后可直接刷新本地状态（无需重新 GET）」），renderer `SessionDetailDrawer.tsx:625` 正是这么用的——调完 set 直接用返回值。读侧因此**结构上冗余**，不是漏接线。

core 侧 `getSessionAgentConfig` 本身活着（`session.service.ts:261`，被 prompt/agent-meta 等 5 个 main 服务与 mobile 全量使用），只有这条 IPC 是死的。

**建议**：删 IPC 三层（通道 / handler / 封装 / 导出）+ `test/sessions-agent-binding-handlers.test.ts` 里只测读侧的三处断言（:74/:97/:317），保留 set 侧用例。
**置信**：confirmed。

---

**F-xc-ipc-3 | P2 | `apps/desktop/renderer/ipc/invoke-registry.ts`（VFS_LIST 缺口）+ `handlers/vfs.ts:112-130`**

`handleVfsList` 是完整实现（走 `getVfsForScope` + `vfs.list`），但 invoke-registry 里**没有对应封装**，⑤ 层更没有消费。renderer 的树视图数据源已经换成 `ipcPhysicalList`（`WorkspaceTree.tsx:94`）与 `ipcWorkplaceBuildListRows`（同文件 :95）——`VFS_LIST` 是被这两个通道整体取代的旧版。

**建议**：删 `IPC_CHANNELS.VFS_LIST` + `handleVfsList` + registry.ts:263 绑定。
**置信**：confirmed。

---

**F-xc-ipc-4 | P3 | `apps/desktop/shared/ipc-types.ts:71-72` + `handler-registry.ts:280-286`**

```
280:  // startDrag 须在 drag 流程中同步触发，使用 send 而非 invoke；失败经 VFS_START_DRAG_FAILED 回传
281:  ipcMain.on(
```

这一条**不是断链**，是 census 的五层口径对 send 型通道的必然误报。L0/ipc-census.md:526 自己已经写明「这是预期形态，不是缺陷（preload 的 `startDrag()` 专用方法走 `ipcRenderer.send`）」，链路完整：preload `startDrag()` → `ipcRenderer.send` → `ipcMain.on` → handler → 失败经 `VFS_START_DRAG_FAILED` push 回 renderer（`workspace-batch-dnd.ts:18/:92` 两处消费）。

**建议**：不改代码。改 L0 口径——census 脚本把 `VFS_START_DRAG` 归入 send 型四段链路统计，断链总数从 12 修正为 **11**。
**置信**：confirmed（intentional）。

---

**F-xc-ipc-5 | P2 | `apps/desktop/src/main/ipc/handlers/workplace.ts:143-155`**

```
148:    await rt.sessionKkv.clearSession(req.sessionId);
150:    await notifyComposerStatusAfterSessionKkvCleared(rt, req.sessionId);
```

功能是「手动重置常驻工作区缓存」（`ipc-types.ts:626` 注释）。renderer 侧零消费，唯一的引用者是单测——而且**测试用例名自己就写了「遗留」**：

```
apps/desktop/test/workplace-handlers.test.ts:189
  it("遗留 captureSessionBlock IPC 清空 session kkv 并推空状态条", ...)
```

「测试续命的死码」典型（与 status.md L0b 的 580 条「仅测试消费」同型）。功能本身仍有价值（清 file_cache 能治「工作区文件改了但提示词还用旧快照」），只是当前没有 UI 入口。

**建议**：二选一并写进 backlog——(a) 真死删：删通道/handler/封装/导出 + `workplace-handlers.test.ts:189-231` 整个 it 块；(b) 若认为「手动重置」是待做功能，则补一个 renderer 入口（WorkspaceHeaderActions 已有 `pullTemplate`/`pushTemplate` 两个按钮，加第三个成本低）。倾向 (a)：清 file_cache 的正规入口已存在（`clearSessionPromptCaches`，`service/vfs/logic/clear-session-prompt-caches.ts`），走那条路即可。
**置信**：confirmed。

---

**F-xc-ipc-6 | P2 | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts:154-176`**

`handleSmartSortRuleExportRules` / `handleSmartSortRuleImportRules` 是裸 JSON bundle 通道。renderer 的导入导出已全部改走 YAML 对话框通道：`ipcSmartSortRuleYamlExport` / `ipcSmartSortRuleYamlImport`（`SettingsViews.tsx:1788` / `:1803`，2 处消费），而这两个通道在 main 侧**内部转调同一对 core 方法**（`smart-sort-rule-yaml.service.ts:25/:37`）。

即：core 的 `exportRules`/`importRules` 活着（CLI 也在用，`apps/cli/src/sort-rule/commands.ts:171/:184`），死掉的只是 desktop 上这对 JSON 通道。

**建议**：删 `SMART_SORT_RULE_IMPORT_RULES` / `SMART_SORT_RULE_EXPORT_RULES` 通道 + 两个 handler + invoke-registry.ts:589-596 + client.ts:149-150。core 与 CLI 侧一行不动。
**置信**：confirmed。

---

**F-xc-ipc-7 | P2 | `apps/desktop/src/main/ipc/handlers/skills.ts:133-150`**

```
138:    const result = await rt.skills().editSkillFile(
```

`handleSkillsEdit` 走 core 的 `editSkillFile`（oldString/newString 定点替换）。但 desktop 的技能编辑 UI 走的是**整文件覆写** `ipcSkillsWrite`（`SkillDetailView.tsx:167` / `:203`），返回 `{version}` 而非 `{version, replacements}`——UI 侧根本拿不到 `replacements`。

core 的 `editSkillFile` 本身是活的，被 LLM 工具用（`skill-tool.ts:486`）与 core 自测（`seed-builtin-skills.test.ts:62/:94`）。死的只是 desktop 这条 IPC。

**建议**：删 `SKILLS_EDIT` 通道 + `handleSkillsEdit` + invoke-registry.ts:629-632 + client.ts:159。
**置信**：confirmed。

---

**F-xc-ipc-8 | P2 | `apps/desktop/shared/ipc-types.ts:90-91` + `handlers/messages.ts:211-245`**

`MESSAGES_HIDE_RANGE` / `MESSAGES_SHOW_RANGE` 的 handler 是完整实现（`rt.messageTranscriptEffects.hideMessagesInRange`），invoke 封装也在（invoke-registry.ts:368-375），唯独 ⑤ 层零消费。

**这不是漏接线，是 UI 被主动删掉了。** git 史实锤：

```
722e27d5  Desktop：删除消息批量操作 UI（useBatchSelection 补 enter()）
  apps/desktop/renderer/features/chat/ConversationPanel.tsx | 341 +-------------------
```

该 commit 的 diff 里明确删掉了三行调用：
```
-  ipcMessagesHideRange,
-  ipcMessagesShowRange,
-  ipcMessagesTruncateAfter,
-        const result = await ipcMessagesHideRange({ ...
-        const result = await ipcMessagesShowRange({ ...
-        const result = await ipcMessagesTruncateAfter({ ...
```
同时 `messageBatch` 传参链、`chat-batch-bar`、`MessageList` 批量勾选一并移除（该 commit 共 -483/+32 行）。残留物是 `transcript-selectable-role.ts` 里的一整套 batch 纯函数再导出（`computeHideRangeFromSelection` / `computeShowRangeFromSelection` / `selectVisibilityBatchEligibleIdsFromAnchor` / `tailBatchDeleteAfterSeq` 等 10 个符号），现在**零消费**。

**处置（拍板建议）**：两条路都有代价，我给倾向 + 理由——
- **倾向 A「层间漂移须补」**：core 侧 `computeHideRangeFromSelection` 等纯函数是 mobile 与 desktop 共享资产（`shared/logic/chat.ts:49-53`），mobile 侧 `transcript-selectable-role.ts` 同样只做再导出、也无消费（实测 mobile 全仓 `hideRange` 只出现在 CLI 一处）。也就是说**双端的批量隐藏 UI 都不存在**，不是 desktop 掉队。
- 若近期不做批量隐藏功能（当前无任何 backlog 提及），则应走 **B「真死删」**：删三条 IPC + `transcript-selectable-role.ts` 的 desktop 副本 + `shared/logic/chat.ts` 里那 10 个零消费符号（mobile 副本同删），core 的 `visibility-batch-range.ts` / `tail-batch-range.ts` 保留（core 自测在用）。

无论 A/B，**现在必须做的**是：把「三通道 + 双端 batch 纯函数 + MessageBatchMode 类型」作为一个整体在台账上挂账，避免下一次普查重复发现。

**置信**：confirmed（UI 删除事实），处置方向 suspected（取决于产品是否要重做批量隐藏）。

---

**F-xc-ipc-9 | P2 | `apps/desktop/src/main/ipc/handlers/messages.ts:247-261`（IPC 侧）**

`MESSAGES_TRUNCATE_AFTER` 与 F-8 同源同 commit（UI 删除）。IPC 侧定性：层间漂移，同 F-8 处置。

**但它带的 core 侧 bug 是真的**，见 F-xc-ipc-9b。

**置信**：confirmed。

---

**F-xc-ipc-9b | P2 | `packages/core/src/service/chat/impl/message-transcript-effects.service.ts:63-77`**

这是本轮对 status.md 里 `core-service-chat` 那条「截断路径漏失效 P1」的**终裁**，把它从 P1 降到 **P2**。理由分三层：

**① 事实成立（confirmed）——漏失效本身**
```ts
63:  async truncateMessagesAfter(projectId, sessionId, afterSeq, options?) {
69:    await this.deps.conn.transaction(async (tx) => {
70:      await truncateTailInTransaction(createTruncateTailDepsFromTx(tx), {...});
71:    });
77:  }
```
`truncateTailInTransaction`（`domain/message-checkpoint/logic/truncate-tail-in-transaction.ts:58-98`）只做四件事：删 checkpoint、删消息 tail、（可选）sweep revisions、清 backfill 游标 + composer status 域。**不碰 prompt token 热层/KKV 行，也不碰 `usage_stats.toolUseCount`**。

**② 兄弟路径全都失效（confirmed）**——同一语义的三条路径都做了双失效：
- `message.service.ts:459-460`（`truncateAfter` 清空整 session）：`invalidatePromptTokens` + `invalidateToolUseCount`
- `message.service.ts:490-491`（`truncateAfter` 截 tail）：同上两件
- `message-rollback.service.ts:269-289`（回滚物理删尾）：`invalidateSessionApiPromptTokenEntry` + toolUseCount 哨兵空串
- `message-transcript-effects.service.ts:186-189`（**同一个类的** `setMessageFloorAtMessage`）：`invalidateSessionApiPromptTokenEntry`

也就是说：**同文件里紧挨着的 `setMessageFloorAtMessage` 做了，`truncateMessagesAfter` 没做**——这是遗漏，不是设计取舍。

**③ 为什么降级到 P2（这是关键）——没有可达用户路径**
- core 侧 `truncateMessagesAfter` 的调用方全集：`message-transcript-effects.service.ts:63`（自身定义）+ desktop handler（`messages.ts:252`）——**仅此两处**，其余全是 core 单测的 mock（`agent-runner-*.test.ts` 的 `truncateMessagesAfter: async () => {}`）。
- desktop 侧该 handler 的 IPC 封装已在 invoke-registry（:376）与 client.ts（:94），但 ⑤ 层零消费 → **通道从未被 renderer 点过**。
- mobile 侧无任何调用（`messageTranscriptEffects` 在 mobile 只被 `setMessageFloorAtMessage` 用，见 `useChatTabMessageActions.ts:429`）。
- CLI 无调用。

**结论**：漏失效的**代码缺陷 confirmed**，但**当前用户零可感**——没有任何 UI 路径能触发它。这与 `core-prompt` 那条「normalizeAgentPromptLayoutDomain 白名单漏字段但消费链无生产调用方」的处理口径一致（status.md:60 主代理已降级 P2，理由同一）。**建议定级 P2，并标注「潜伏」**：一旦 F-8/F-9 走 A 案（补回批量隐藏 UI，truncateAfter 是批量删除的自然实现），这条立刻升级为 P1。

修法（一并给出）：在 `truncateMessagesAfter` 事务提交后补两件失效，照抄同文件 `setMessageFloorAtMessage:186` 的 `invalidateSessionApiPromptTokenEntry` + `message.service.ts:460` 的 toolUseCount 哨兵空串；注意不要放进事务内（`message.service.ts:84-90` 注释明写「所有调用点都在 `conn.transaction` 块外」，KKV 删除已 await、失败只吞 warn）。

**置信**：confirmed（缺陷与不可达性均实测）。

---

### 二、X1 门禁 9 处 renderer 直连 core —— 逐处映射

**实测基线**（`cd apps/desktop && npx eslint renderer --format json`，本机位实跑）：
```
errors 9  warnings 17
{ "no-restricted-imports": 9, "@typescript-eslint/no-unused-vars": 12, (warning-only): 5 }
```
9 条 `no-restricted-imports` 分布在 **8 个文件**（ShellNavProvider 占 2 处）。加上 `src test shared` 侧另有 2 条 `no-regex-spaces`（`test/preview-annotate.test.ts:398`、`test/preview-recogito-md.test.ts:139`）——desktop 全量 lint **error=11 / warning=24**。

**已备出口 = 零成本**（`@shared/logic/*` 已有该符号，只改 import 一行）：

| 违规点 | 当前 import | 改走 | 出口是否已备 |
|---|---|---|---|
| `renderer/App.tsx:2` | `validateVfsEntryName` ← `@novel-master/core/vfs` | `@shared/logic/vfs` | ✅ 已备（`shared/logic/vfs.ts:13`） |
| `renderer/features/chat/chat-link-route.ts:19` | `isHttpUrl, resolveChatLinkTarget` ← `core/chat` | `@shared/logic/chat` | ❌ 需新增 2 个（见下） |
| `renderer/features/chat/conversation-abort-retain.ts:1-4` | type `AgentRunFinishedPayload`, `AgentStepCommittedPayload` ← `core/events` | `@shared/logic/events` | ✅ 已备（`shared/logic/events.ts:13-14`） |
| `renderer/features/chat/ConversationPanel.tsx:13-18` | type `AgentRunFailedPayload` / `AgentRunFinishedPayload` / `AgentRunStartedPayload` / `AgentStepCommittedPayload` ← `core/events` | `@shared/logic/events` | ⚠️ 部分：已备 2 个，缺 `AgentRunFailedPayload` / `AgentRunStartedPayload` |
| `renderer/hooks/useAgentRunLifecycle.ts:12-16` | type `AgentRunFailedPayload` / `AgentRunFinishedPayload` / `AgentRunStartedPayload` ← `core/events` | `@shared/logic/events` | ⚠️ 同上，缺 2 个 |
| `renderer/hooks/useAgentStream.ts:26-43` | 8 个 `EVENT_AGENT_*` 常量 + 8 个 payload type ← `core/events` | `@shared/logic/events` | ❌ 需新增 10 个 |
| `renderer/hooks/useAgentStreamMetrics.ts:30` | `CHARACTERS_PER_TOKEN_RATIO` ← `core/provider` | `@shared/logic/provider` | ❌ 需新增 1 个 |
| `renderer/providers/ShellNavProvider.tsx:35-40` | `EVENT_AGENT_RUN_FINISHED`, `EVENT_AGENT_STEP_COMMITTED` + 2 type ← `core/events` | `@shared/logic/events` | ✅ 全备（`shared/logic/events.ts:11-14`） |
| `renderer/providers/ShellNavProvider.tsx:60` | `chatLinkNotFoundMessage` ← `core/chat` | `@shared/logic/chat` | ❌ 需新增 1 个 |

**需新增的再导出（共 3 个文件、14 个符号，全部是纯转发）**：

1. `apps/desktop/shared/logic/events.ts` — 补 10 个（core 侧全部现成，`public/events.ts:6-29` 已导出）：
   - 常量 6：`EVENT_AGENT_RUN_STARTED` / `EVENT_AGENT_RUN_FAILED` / `EVENT_AGENT_STREAM_TEXT_DELTA` / `EVENT_AGENT_STREAM_THINKING_DELTA` / `EVENT_AGENT_STREAM_TOOL_USE` / `EVENT_AGENT_STREAM_USAGE`
   - type 8 中的 4：`AgentRunStartedPayload` / `AgentRunFailedPayload` / `AgentStreamTextDeltaPayload` / `AgentStreamThinkingDeltaPayload` / `AgentStreamToolUsePayload` / `AgentStreamUsagePayload`（6 个）
   - 小计 **12 个符号**（6 常量 + 6 type）。注：`useAgentStream.ts` 另需 `EVENT_AGENT_RUN_FAILED`/`STARTED` 与 `useAgentRunLifecycle`/`ConversationPanel` 需 `AgentRunFailedPayload`/`AgentRunStartedPayload`，三者合并去重后即此集。
2. `apps/desktop/shared/logic/chat.ts` — 补 3 个：`isHttpUrl` / `resolveChatLinkTarget` / `chatLinkNotFoundMessage`（core `public/chat.ts:137` 一行已全导出，源码 `domain/chat/logic/resolve-chat-link-target.ts:34/44/107`）
3. `apps/desktop/shared/logic/provider.ts` — 补 1 个：`CHARACTERS_PER_TOKEN_RATIO`（core `public/provider.ts:140`）

**注记（回应 status.md:59 的「shared/logic/events.ts 自身 2 符号零消费」）**：该说法已过时。`shared/logic/events.ts` 现由 `SessionDetailDrawer.tsx:54-59` 消费，4 个符号全在用。补完新增导出后该文件将覆盖全部 9 处违规中的 6 处。

**总量**：改 8 个文件的 import（12 行）+ 3 个 shared/logic 文件各加一段 `export {} from`（约 20 行）。零逻辑改动、零行为变更。

**置信**：confirmed（eslint 实跑 + core 导出面逐符号核过）。

---

### 三、CI Lint/Typecheck continue-on-error 处置建议

**现状**（`.github/workflows/ci.yml:53-63`）：
```yaml
- name: Lint
  continue-on-error: true
  run: npm run lint --workspaces --if-present
- name: Typecheck
  continue-on-error: true
  run: npm run typecheck --workspaces --if-present
```
注释自称「仓库里还有既存错误」（:6），并指向 `cr-fix-spec gates/G-1` 分步收敛（:7）。

**实测（本机位在 `D:\Dev\nm-worktree\mcr` 逐 workspace 跑）**：

**Typecheck：实际是干净的 —— 注释里的既存错误不存在。**
```
npm run typecheck --workspaces --if-present   →  全部 16 workspace 通过，0 error
```
我第一次跑 desktop typecheck 时看到 185 条错误，**全部是 TS2307 `Cannot find module '@novel-master/core'`**——那是本 worktree 的 `packages/core/dist` 没建造成的**环境假象**，不是仓库缺陷。执行 `npm run build -w @novel-master/core` + 六个 driver 包 build 之后，desktop typecheck **零错误通过**。CI 的 `Build workspaces` 步骤（ci.yml:50-51）在 Lint/Typecheck **之前**执行，所以 CI 上这 185 条根本不会出现。

> **这条是本次 CI 建议的核心结论：Typecheck 的 `continue-on-error` 是在为一个不存在的债务背书，应当立刻摘掉。**

**Lint：债务是真的，但规模远小于「既存错误」的暗示，且大部分是配置问题不是代码问题。**

逐 workspace 实测（`npx eslint . --format json`，error 数）：

| workspace | errors | warnings | 主要成因 |
|---|---|---|---|
| `apps/mobile` | 27 | 405 | `react-hooks/exhaustive-deps` 21 + `import/first` 规则未装 4 + `no-undef`（shim 缺 globals）2 |
| `apps/cli` | 23 | 1 | 解析错误（test 目录不在 tsconfig） |
| `apps/desktop` | **11** | 24 | **`no-restricted-imports` 9（X1）+ `no-regex-spaces` 2** |
| `packages/tdbc-driver-op-sqlite` | 9 | 1 | 解析错误（同上模式） |
| `packages/tdbc-driver-rn` | 8 | 1 | 解析错误 |
| `packages/tokenizer-driver-node` | 6 | 0 | 解析错误 |
| `packages/tdbc-driver-better-sqlite3` | 5 | 1 | 解析错误 |
| `packages/llm-sse-native` | 4 | 0 | 解析错误 |
| `packages/sksp-android` | 3 | 0 | 解析错误 |
| `packages/core` | 3 | 106 | `no-control-regex` 1 / `prefer-const` 1 / `no-useless-escape` 1 |
| `packages/sksp-{linux,mac,windows}` 各 2 | 6 | 0 | 解析错误 |
| `packages/tokenizer-driver-rn` | 2 | 0 | 解析错误 |
| `packages/cloud-sync-driver-s3` | 2 | 0 | 解析错误 |
| `packages/tdbc-conformance` | 1 | 0 | 解析错误 |
| **合计** | **118** | **537** | 其中「解析错误」（`was not found by the project service`）约 **60 条** |

关键观察：**约半数 error（60/118）是 eslint 的 tsconfig 覆盖问题，不是代码缺陷**——driver 包把 `test/` 目录写进了 `lint` script 但没写进 tsconfig `include`，于是每个测试文件报一条解析错误。这是**配置 bug，零代码改动可修**（把 `test/**` 加进 tsconfig include，或从 lint script 里去掉 test）。

真正需要改代码的：desktop 11（X1 9 + 2 正则空格）、mobile 27（react-hooks 依赖数组，改动有回归风险）、core 3、解析错误约 60（配置）。

**处置建议（三步，按投入产出排序）**：

1. **立刻**：删 `ci.yml:62` Typecheck 的 `continue-on-error`，改为 blocking。依据：本机位实测 typecheck 全绿，且 CI 的 build 步骤在前面。此改动零风险，且立刻把 typecheck 从「装饰」变成真门禁。
2. **紧接着（本次 CR 落地时一并做）**：修 driver 包的 tsconfig 覆盖（消掉约 60 条解析错误）+ 修 desktop 的 X1 9 处（见本报告第二节）+ 2 条 `no-regex-spaces` + core 3 条。这批做完，desktop/core/drivers 全绿。
3. **分步收口**：Lint 的 `continue-on-error` 保留到 mobile 的 27 条 `react-hooks/exhaustive-deps` + `import/first`（规则未装，需 `eslint-plugin-import`）+ `no-undef`（shim 需补 globals）处理完。**建议把 mobile 单列一条 CI job**，或给 mobile 的 `lint` script 加 `--max-warnings` 上限（它已有 `--max-warnings 321`，实测 405 warnings **已经超了**——说明这条上限当前也是失效的，值得单独记一条）。收口完成前，desktop/core 可以先从 continue-on-error 里摘出来单列为 blocking job。

**另注**：`--max-warnings 321`（`apps/mobile/package.json`）与实测 405 warnings 的差距，意味着 mobile lint 目前**无论 error 与否都在失败**——`continue-on-error` 掩盖的是这个。这条建议主代理单独立项。

**置信**：confirmed（全部为本机位实跑数字，非照抄）。

---

## 争议与存疑

1. **F-8/F-9 的 A/B 处置我没有拍死**。批量隐藏/截断 UI 是 2026-07-11 主动删的（commit 722e27d5，-483/+32），删除本身是有意的；但删完之后 core 与双端的 batch 纯函数资产整片悬空，我没有产品侧的依据判断「是否要重做」。若产品确认不做，走 B（真死删）；若要做，走 A（补 UI + 连带修 F-9b）。**这个二选一需要用户/主代理拍板**，我不越权。

2. **`VFS_LIST` 是否还有非 UI 消费方**。我扫的是 `apps/` + `packages/` 的 `.ts/.tsx`，`examples/`、`scripts/` 未逐一核。若 examples 里有脚本直连这个通道，删除前需再确认一次（L0 口径把 `scripts/`、`examples/` 排除在生产文件外）。

3. **`shared/logic/events.ts` 补到 16 个符号后是否触发新的 X1 违规**：不会。X1 只禁 `renderer/**` 引 core（`eslint.config.mjs:73`），`shared/**` 在 `files: ["src/**", "shared/**"]` 块里（:52）用的是 `sharedTsRules`，无 `no-restricted-imports`。所以再导出层本身就是 X1 机制的设计出口。但这也意味着 **`shared/logic/*` 没有任何纪律约束**——现在 12 个文件全是纯转发，但没人拦着它 `export *` 或塞工厂函数进去。这算 intentional（文件头注释都写了禁令）还是缺口，交给主代理。

4. **`PROJECTS_*_AGENT_CONFIG` 的「兼容外部脚本调用」**：handler 的 `@deprecated` 注释（:94）这么写，但 Electron 的 IPC 只有 renderer 能调。我按「renderer 是唯一客户端」判死。若仓库外另有通过 `webContents.executeJavaScript` 之类方式调用的脚本（不在本仓），删除前需人工确认——我看不到这类调用方。

5. **mobile 的 27 条 lint error 我只做了归类，没有逐条判定该不该修**。`react-hooks/exhaustive-deps` 21 条里可能有已知 intentional（比如带 eslint-disable 注释被覆盖的、或刻意的 stale-closure 语义）。这属于 mobile-ui 机位的地盘，我只提供 CI 处置视角。

6. **`packages/core` 的 `prefers-const` 那条**（`annotate-source-range.ts:379`）改起来一行，但它和 status.md 里 core-chat 那批发现是否重叠我没核——reduce 阶段注意去重。
