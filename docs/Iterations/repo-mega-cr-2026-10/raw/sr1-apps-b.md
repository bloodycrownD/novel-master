---
zone: apps-mobile
agent: sr1-apps-b（readonly reviewer · 组 B = §3 AM-1 + §4 N-P1-03）
files_scanned: fix-spec/wave-b-apps.md §3/§4、ledger-v2.md §2.7/§7(#13/#14)、PLAN.md 一章+四章、docs/apm/RULE.md(85/102/109/111/125/139)、apps/mobile/src/services/session-stream-unit-manager.service.ts、apps/mobile/src/services/scope-key-cache.ts、apps/mobile/src/services/chat-session-view-cache.ts、apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts、apps/mobile/src/screens/tabs/chat-tab/ChatTabProvider.tsx、apps/mobile/src/screens/stack/FileEditorScreen.tsx、apps/mobile/src/screens/stack/SubagentSessionScreen.tsx、apps/mobile/src/components/agent/prompt-editor-callback.ts、apps/mobile/src/navigation/types.ts、apps/mobile/src/runtime/types.ts、apps/mobile/{package.json,jest.config.js,tsconfig.build.json}、packages/core/src/{service/chat/impl/project.service.ts,service/chat/session.port.ts,service/chat/impl/session.service.ts,domain/chat/repositories/impl/sqlite-session.repository.ts,domain/feature-flags/user-vfs-unified-tool-turn.ts}、apps/mobile/__tests__/{use-chat-tab-scope-batch-delete.test.ts,session-stream-unit-manager.service.test.ts,file-editor-screen.test.tsx,test-utils/core-shim.ts}
baseline_verified: HEAD=fe79b7810c0c78c48a18c76486359d7d45e253fa（实跑 `git log -1` 与 spec 抬头一致）
---

# sr1-apps-b · wave-b-apps 组 B 审查报告（AM-1 + N-P1-03）

> 方法：所有 file:line 与引文于本轮在 `fe79b781` 工作区**亲自打开核对**，未照抄 spec；
> 病症从代码重推导（读调用方/读口/类型链，不读原报告论证）；只读，未改任何 spec/生产/测试代码。

## 摘要

组 B 两条都是「真病 + 方向正确」的条目：AM-1（`forgetSession` 生产零调用 + 两张无界 Map）与
N-P1-03（`FileEditor` 路由 params 里的函数成员）病症**全部重推导成立**，行号**无漂移**。
但两条的**修法各有一处会在实现后失效的洞**：AM-1 的项目删除补调用漏掉子 agent 会话（读口语义被误读），
N-P1-03 的 take 回调若不在 `useRef` 里初始化、重渲染即丢失。更关键的是**两处验收断言没有牙**
（一条被 jest 的 babel 抹掉类型、一条被 mock 掉唯一的信息来源），违反 RULE:85 第一条。
⇒ 本组 **not-ready**，9 条 must-fix（其中 3 条高），全部可在一次 doc-fix 内闭合。

---

## 1 · 逐条 verdict

| 条目 | 七要素齐备性 | 病症重推导 | 修法可行性 | 验收可测性 | 依赖闭合 | verdict |
|---|---|---|---|---|---|---|
| **§3 AM-1** forgetSession + 两张 Map LRU | 齐 | ✅ 成立（见 §2 消费方表） | ⚠️ 步骤 1/2 可行；**步骤 3 有语义洞**（`listByProject` 只返顶层会话）；步骤 4-6 可行 | ❌ 验收 1/2/3 有牙；**验收 3 对项目删除无牙**（mock 掉唯一信息源）；**验收 4 的填充缝未给出**（`settledProjections` 无注入口） | ✅ 前置无；拍板项 #13 前提成立 | **not-ready**（4 must-fix，1 高） |
| **§4 N-P1-03** 死路由参数 | 齐 | ✅ 成立：全仓 `onSessionVfsSaved` 恰 3 处命中，其中 0 个调用方传它；其余 5 个 params 逐一有消费（`path`14/`scopeKind`6/`projectId`11/`sessionId`9/`skillRef`7 次） | ⚠️ 模块形状正确（`prompt-editor-callback.ts` 逐字对齐）；**步骤 3 的 take 位置错**（渲染期裸调 ⇒ 重渲染即丢） | ❌ **验收锁 A 是废断言**（类型层断言在 jest 里被 babel 抹除，且 `tsconfig.build.json` 排除 `__tests__`）；锁 B/C/D 有效 | ✅ 前置无；口径 1 处（子会话屏 no-op）已声明不阻塞 | **not-ready**（5 must-fix，2 高） |

**行号核对结论**：两条 spec 引用的**症状行号全部在位**（逐条见 §4 表），无漂移；
问题集中在**行号被用于「测试夹具/消费点」时错位**（3 处）与**计数/类型名笔误**（4 处）。

---

## 2 · 消费方清单核对表（任务重点 ①：AM-1 三处删除成功分支补调的清单完整性）

### 2.1 `forgetSession` 全仓消费方（`git grep -n forgetSession -- apps packages` 实跑）

| 位置 | 性质 | 判定 |
|---|---|---|
| `session-stream-unit-manager.service.ts:50` | 注释 | 非消费方 |
| `…:246` / `:323` | 注释 | 非消费方 |
| `…:717` | **定义行** | — |
| `__tests__/session-stream-unit-manager.service.test.ts:764` | 注释 | 非消费方 |
| `…service.test.ts:765` | 调用 | 测试消费方 1 |
| `__tests__/session-stream-unit-persist.test.ts:771` | 用例名 | 非消费方 |
| `…persist.test.ts:779` / `:785` / `:795` | 调用 | 测试消费方 2/3/4 |

⇒ **生产消费方 = 0**（spec 断言 ✅ 成立）；测试侧 6 行命中（4 次调用 + 2 行注释/用例名），
spec 写「测试侧 6 处命中」✅ 与实跑一致。**spec 的病症核心成立。**

### 2.2 移动端「会话/项目删除」全部调用点（补调清单完整性核对）

| # | file:line | 调用 | spec 是否列入 |
|---|---|---|---|
| 1 | `useChatTabScope.ts:524` | `await runtime.sessions.delete(targetSessionId)`（`handleDeleteSession`） | ✅ 步骤 1 |
| 2 | `useChatTabScope.ts:570` | `await runtime.sessions.delete(id)`（`deleteSelectedSessions` 循环体） | ✅ 步骤 2 |
| 3 | `useChatTabScope.ts:596` | `await runtime.projects.delete(id)`（`handleDeleteProjects` 循环体） | ✅ 步骤 3 |

全仓 `apps/mobile/src` 内 `.delete(` / `deleteSession` / `deleteProject` 逐条扫过：
除上述 3 处外，其余命中全部是 `Map/Set.delete`、`Set.delete(listener)`、`agentRegistry.delete`、
`providers.delete`、`messages.delete`、`vfs.delete`、`kkv.delete` 等**与会话/项目无关**的删除。
**core 侧也不存在「会话/项目已删除」事件**（`packages/core/src/domain/events/model/event-types.ts:8-21`
只有 8 个 agent/subagent 事件，无 `session.deleted` / `project.deleted`）⇒ 不存在第 4 个补调点，
也不存在「靠事件兜底」的更优解。

⇒ **「三处」清单完整，无遗漏 ✅**。这是本组最扎实的一块。

### 2.3 两张 Map 的全部使用点（步骤 5「映射 1:1 无缺口」核对）

| Map | `get` | `set` | 按键删 | 全清 | 迭代 |
|---|---|---|---|---|---|
| `idleMessageViews` | `:896 :906 :983 :998 :1026`（5 ✅） | `:923 :929 :991 :1003 :1019 :1028 :1043 :1624`（**8，spec 写 9 ✗**，但列举完整 ⇒ 无缺口） | `:739`（1 ✅） | `:1971`（1 ✅） | **零命中 ✅** |
| `settledProjections` | `:685 :706`（2 ✅） | `:636 :1421 :1443`（3 ✅） | `:738`（1 ✅） | `:1970`（1 ✅） | **零命中 ✅** |

⇒ 「命中即 delete+set 重排顺序不影响任何既有逻辑」✅ 成立（无 `for…of` / `.keys()` / `.entries()`）。
`dispose()` 走 `.clear()`（`:1970-1971`）⇒ 对应提案 API 的 `clearAll()` ✅。
**键 = 裸 `sessionId`**（`:923/:636` 的 set 第一参即 sessionId）✅ 与 spec 一致。

### 2.4 LRU 语义与拍板项 #13「不降级」前提的自洽（任务重点 ②）

| 核对项 | 实跑结论 |
|---|---|
| 拍板项 #13 前提（两张 Map 仍无界） | ✅ 成立：`session-stream-unit-manager.service.ts:353` `new Map<…>()`、`:358` `new Map<…>()`，无任何 LRU（ledger §7 #13 状态栏 revalidate-b 结论照旧成立） |
| 500 是否同口径 | ✅ `chat-session-view-cache.ts:12` `createScopeKeyCache<SessionViewCache>({maxEntries: 500})`；`__tests__/scope-cache-lru-bound.test.ts:26` `const CAP = 500`。另有 3 处同值（`enrich-transcript-rows.ts:6`、`chat-list-scroll-cache.ts:11`、`chat-transcript-scroll-cache.ts:24`）⇒ 500 是仓内既定口径 |
| **淘汰会不会挤掉活跃会话** | ❌ 不会。活跃/settled run 的消息面在**另一张 `units` 表**（`:312`，独立上限 `SESSION_STREAM_MAX_SETTLED_UNITS=8`，`:158` + `evictSettledOverflow:1592-1606`）；`readMessagesSnapshot:886-895` 有单元且 `snap.messages.length>0` 时**只读投影、不回落 idle** ⇒ idle 表淘汰对活跃 run 不可见。spec 风险 1 的推理 ✅ 成立 |
| 淘汰后的用户可见后果 | ✅ spec 的缓解路径真实存在：`ChatTabProvider.tsx:279-286` 会话切换 effect 必调 `loadSessionTailMessages(sessionId,{projectId})`（`manager:850-861` → 无单元走 `loadIdleTailMessages:948-976`，view cache 命中即采纳、miss 回源 DB）；另有 `ChatTabScreen.tsx:127` 的 `hydrateSessionMessages`（`manager:915-936`，公开同步入口） |
| 分页中途被淘汰是否崩 | ✅ 安全：`loadIdleOlderMessages:998-1001` 有 `current == null → return` 守卫；`:999` 之后所有写都基于重读 |
| 与 #13「不降级」的关系 | ✅ 自洽：LRU 是**降内存上界**、forgetSession 是**保删除正确性**，两者互补；#13 的备选口径「降 P2 也保留 LRU」与本条两半拆分（步骤 4-6 独立）✅ 设计正确 |

### 2.5 N-P1-03 的「哪些参数真死」核对（任务重点 ③）

| param（`navigation/types.ts:39-53`） | `FileEditorScreen.tsx` 内命中次数 | 真死？ |
|---|---|---|
| `path` | 14 | 否 |
| `scopeKind` | 6 | 否 |
| `projectId` | 11 | 否 |
| `sessionId` | 9 | 否 |
| `skillRef` | 7 | 否 |
| **`onSessionVfsSaved`（`:51-52`）** | 解构 `:60` + 调用 `:190`，**调用方 0**（8 个 `navigate('FileEditor')` 无一传它） | ✅ **唯一真死** |

`navigate('FileEditor', …)` 8 处逐一核对 scopeKind：
`useChatTabScope.ts:625`(session) / `:632`(project) / `SubagentSessionScreen.tsx:185`(session) /
`:215`(session) / `:222`(project) / `GlobalTemplateScreen.tsx:29`(**physical**) /
`SkillDetailScreen.tsx:96`(**skill**) ⇒ **session 3 处 + 非 session 4 处**。
spec 写「session 共 3 处，project/meta 共 3 处」⇒ **session 数 ✅、另一侧应为 4 且含 physical/skill（✗ 计数与措辞）**。

---

## 3 · must-fix 清单（9 条；H=阻塞 execute-ready，L=doc-fix 一次闭合）

| # | 级别 | 条目 | 问题 | 证据 | 建议改法 |
|---|---|---|---|---|---|
| **B-1** | **H** | §4 验收锁 A | **废断言**：「对 params 逐字段取 `typeof`」写在 `file-editor-saved-callback.test.ts` 里**永远不会红**——mobile jest 用 `@react-native/jest-preset`（babel-jest，`jest.config.js:11`）**不做类型检查**，类型表达式被转译抹除；且 `tsconfig.build.json` 的 `exclude` 含 `__tests__/**/*`，验收命令 `npx tsc --noEmit -p tsconfig.build.json` **根本不覆盖测试文件** ⇒ 违反 RULE:85 第一条「有牙吗」 | `apps/mobile/jest.config.js:11`（`preset: '@react-native/jest-preset'`）；`apps/mobile/tsconfig.build.json` exclude 段 | 把断言搬到 **`src/` 内的编译期断言**（如 `src/navigation/param-serializability.ts`：`type AssertNoFn<T> = …` + `const _ok: AssertNoFn<RootStackParamList['FileEditor']> = true;`），由 `tsconfig.build.json` 覆盖 ⇒ 验收命令改为「`tsc --noEmit -p tsconfig.build.json` 报 `:52` 被加回即红」；jest 侧只保留运行时可测的回调模块用例 |
| **B-2** | **H** | §4 修法步骤 3 | **修法本身有洞**：`const onSessionVfsSaved = takeFileEditorOnSessionVfsSaved();` 写在**渲染体**里 ⇒ 首次 `setContent`（挂载加载完成必然触发）后的任何一次重渲染都会再 take 一次拿到 `null` 并覆盖局部变量 ⇒ **回调事实上永不生效**，正好复现原病灶。仓库正确范式是 `useRef(take…)` 惰性初始化 | 正确范式：`PromptEditorScreen.tsx:105-107` `const onSavedRef = useRef<PromptEditorOnSaved \| null>(takePromptEditorOnSaved());`；模块注释 `prompt-editor-callback.ts:17`「读后即清，防串台」 | 步骤 3 改写为 `const onSessionVfsSavedRef = useRef<(() => void) \| null>(takeFileEditorOnSessionVfsSaved());`，`:190` 处 `onSessionVfsSavedRef.current?.()`；**并在验收里补一条**：保存前先制造一次重渲染（改动 content / 触发 `setSaving`）仍能取到回调——否则改回裸调也照样绿 |
| **B-3** | **H** | §3 修法步骤 3 + 验收锁 C | **项目删除只清得掉顶层会话**：默认案 `const doomed = await runtime.sessions.listByProject(id);` —— 该读口 SQL 硬编码 `parent_session_id IS NULL`，**子 agent 会话不在结果里**；而 manager 恰恰为子会话写过 `settledProjections`（`:1414-1427` 消费型分支 `:1421`）。⇒ 项目删除后子会话条目仍泄漏。更糟的是**验收锁 C 把 `listByProject` mock 掉了**（唯一能暴露该缺口的信息源），于是这条断言对「子会话漏清」**恒绿** ⇒ RULE:85 第一条失守 | `packages/core/src/domain/chat/repositories/impl/sqlite-session.repository.ts:38-49`（`:44` `AND parent_session_id IS NULL`）；core 自己的项目删除正是为此做 BFS 展开并留了警告注释：`packages/core/src/service/chat/impl/project.service.ts:160-171`（`:162` 「子 agent 会话需要 BFS 展开，否则会留孤儿」）；而 `SessionService` 端口**没有** `listByParentSession`（`packages/core/src/service/chat/session.port.ts:14-88` 只有 `listByProject`） | 三选一并写进 spec：①**（推荐，Wave B 内可落）** 显式把缺口写进默认案——步骤 3 只覆盖顶层会话，补一句「子 agent 会话靠 LRU 半张兜底」+ `handleDeleteProjects` 留 TODO + 登记 RULE，验收锁 C 增一条**负向断言**（子会话 id 不在 `forgetSession` 参数里，且注明这是已知缺口）；② 给 `SessionService` 加 `listByParentSession` 并在 mobile 侧 BFS（**跨到 core、动公共接口 ⇒ 触发 RULE:109，须扫 `test/` 手写假实现**）→ 应另立条目；③ 让 `project.delete` 返回被删 sessionId 列表（同上，跨簇） |
| **B-4** | M | §3 测试策略 | **漏改既有夹具 ⇒ 自称「最关键交叉回归」直接变红**：补调后 `runtime.sessionStreamUnitManager.forgetSession(...)` 会在既有测试的 `mockRuntime`（**无该字段**）上抛 `TypeError`，被 `deleteSelectedSessions` 的 `catch` 吞成 toast ⇒ `use-chat-tab-scope-batch-delete.test.ts:145` 的 `expect(mockShowToast).not.toHaveBeenCalled()` 变红，`handleDeleteProjects` 三条同理。spec 只说「夹具整份复制到新文件」，没说改原文件 | `apps/mobile/__tests__/use-chat-tab-scope-batch-delete.test.ts:52-76`（mockRuntime 无 `sessionStreamUnitManager`）、`:127 :158 :189 :222 :248`（5 处删除路径调用）；全仓仅此一个文件触碰删除路径 | 测试策略补一条：**必须**在 `use-chat-tab-scope-batch-delete.test.ts` 的 `mockRuntime` 上加 `sessionStreamUnitManager: {forgetSession: jest.fn()}`（只改测试夹具、不碰生产代码，符合 RULE），并把它同时写进「回归线」小节 |
| **B-5** | M | §3 验收 4 | **填充缝未给出，测试落不了地**：`idleMessageViews`/`settledProjections` 都是 `private`，无 test-only 注入口。`idleMessageViews` 可经公开 `hydrateSessionMessages(projectId, sessionId)`（`:915`，无单元即写）灌；`settledProjections` 则只能靠 501 次 run 收尾（`:1421/:1443`，每次还带 `upsertSettledRunStateQuietly` + `persistFinalRateQuietly` 的 fire-and-forget）或注 fake `runStateService.listByStatuses(['settled'])` 走 hydrate 回填（`:626-655`）——spec 两者都没写，执行者只能即兴发挥 | `manager:915-936`、`:636`、`:626-655`、`:1414-1427` | 测试策略里写死两条填充路径：`idleMessageViews` 用 `hydrateSessionMessages` 循环；`settledProjections` 用 fake `runStateService` 返回 `CAP+1` 条 settled 行 + `markHydrated()` 后 `await hydrate()`（**注意 hydrate 逐行 `await this.yieldQuantum()`，需注 `yieldQuantum: async () => {}`**，见 `:291`/`:631`） |
| **B-6** | L | §3 步骤 5 | 计数笔误：`idleMessageViews` 的 `set` 是 **8 次**不是 9 次（spec 自己列的 8 个行号是对的，故**映射仍 1:1 无缺口**，只是数字写错） | 见 §2.3 | 9→8 |
| **B-7** | L | §3 测试策略 | 行号错：manager 构造夹具在 `session-stream-unit-manager.service.test.ts:72-77`（`new SessionStreamUnitManager({runtime, runAgentTurn, yieldQuantum})`），spec 写 `:142`（该行是另一条用例的 `subscribe`） | 实跑 | `:142` → `:72-77`；另 `use-chat-tab-scope-batch-delete.test.ts` 的数组在 `:49-50`、`mockRuntime` 在 `:52-76`（spec 写 `:52-70`），一并修正 |
| **B-8** | L | §4 验收锁 A + 回归线 | ① 不存在 `FileEditorParamList` 这个类型（全仓 0 命中），须写实际类型表达式 `RootStackParamList['FileEditor']`；② 回归线两个文件名错：`prompt-editor-callback.test.ts` **不存在**（同范式的真实覆盖是 `prompt-editor-screen.test.tsx` / `composer-fullscreen.test.tsx`）；`chat-link-route.test.ts` **不存在**，真文件是 `chat-link-nav.test.ts`；③ 本条真正该守的 `SubagentSessionScreen` 覆盖是 `__tests__/subagent-session-screen-metrics.test.tsx`，spec 漏列 | 实跑 `Test-Path` 四项 + `git grep -ln "SubagentSessionScreen"` | 逐项替换；「若存在」的写法改成确定文件名（本仓这些文件都稳定存在） |
| **B-9** | L | §4 证据段 + §3 风险段 | ① §4 写「session 共 3 处，project/meta 共 3 处」，实为 **3 + 4**，且非 session 的 4 处含 `physical`（`GlobalTemplateScreen.tsx:31`）与 `skill`（`SkillDetailScreen.tsx:98`），不是 project/meta；② §3 风险 1 引 `loadSessionTailMessages（:847-875）`，实为 JSDoc 起于 `:843`、函数体 `:850-861`、idle 实现在 `:948-976` | 实跑 | 计数与行号一并校正（不影响修法本身——修法只碰 3 处 session 调用点） |

### 3.1 已实跑核对为 ✅、**不需要**改的项（防 doc-fix 误伤）

- §3 病症四项残留（`idleMessageViews` 深拷贝 `:1624-1628`、`settledProjections`、`pendingChildParentByChild:326/718-725`、`decrementAgentActive` 唯一减点 `:732`）：全部在位。
- §3「不复用 `createScopeKeyCache`」的理由成立：`ScopeKeyCache` 把 `key(projectId, sessionId)`（`scope-key-cache.ts:8`）与 `clearByProjectPrefix`（`:14`）列为**必需**成员，两张 Map 的键是裸 sessionId ⇒ 会出现两个永不调用的死成员。理由正确。
- §3 `runtime` 可达性：`useChatTabScope.ts:51`（类型）/ `:62`（解构）+ `runtime/types.ts:119` `sessionStreamUnitManager: SessionStreamUnitManager` ⇒ 无需新增依赖/Context。
- §3 验收命令：`npx tsc --noEmit -p tsconfig.build.json`（= `package.json` 的 `build` ✅）、`npm test -- --maxWorkers=2`（RULE:111 的 `npx jest --maxWorkers=2` 1604/1604 ✅；注意 `pretest` 会先 build core+webview，属既有设施）、`npm run lint`（`--max-warnings 321` ✅ 实跑一致）。
- §3 牙齿自查的取向正确：验收 4/5 用「size 探针 + 具体 id 的读口」，正是 RULE:125/139 要求的「换实现必须同步换观测面」的正解，优于「map 里没有这个 key」的弱观测。
- §3 两张 Map 的 LRU test 文件必须独立成文件（jest 按文件隔离、避免 `runStartupMaintenanceOnce` 类进程级标记被首条用例消费）✅ 判断正确。
- §4 模块范式：`prompt-editor-callback.ts:1-22` 的形状（模块级 `let` / setter 覆盖 / take 清空 / `:2-6` 与 `:12` 的注释理由）与 spec 描述逐字一致 ✓。
- §4 接线目标：`bumpWorktreeUiToken` 定义于 `useChatTabScope.ts:612-614`、hook 返回于 `:762-763`、类型在 `ChatTabProvider.tsx:99`；其效果是 `ChatConversationPanel.tsx:344` 的 `key={session-vfs-${vfsRefreshKey}}` 重挂载 ⇒ 确实是「工作区列表刷新」入口，零新增 state ✅。
- §4 验收 2 的分支可达性：`FileEditorScreen.tsx:175-178` 的 session 分支另有 `isUserVfsUnifiedToolTurnEnabled()` 守卫，但 `packages/core/src/domain/feature-flags/user-vfs-unified-tool-turn.ts:11` 默认 `true`、`:32` 只在 `NM_USER_VFS_UNIFIED_TOOL_TURN=0` 时关；`test-utils/core-shim.ts:77-80` 原样转出 ⇒ **测试环境默认走得到该分支，不会恒红** ✅（建议 spec 补一句显式说明，免得执行者误加 mock）。
- §4 回归线中真实存在的文件：`file-editor-screen.test.tsx` ✅、`use-chat-tab-scope-{batch-delete,token-debounce,parallel-queries}.test.ts` ✅。
- §3 回归线中真实存在的文件：`session-stream-unit-{manager.service,persist,messages,pipeline,s6-wiring}.test.ts` ✅、`chat-session-view-cache.test.ts` ✅、`scope-cache-lru-bound.test.ts` ✅、`scope-key-cache.test.ts` ✅、`chat-tab-screen.integration.test.tsx` ✅、`chat-composer.integration.test.tsx` ✅、`use-chat-tab-scope-batch-delete.test.ts` ✅、T-U1 用例名在 `:654` ✅、`forgetSession` 用例在 `:764-765` ✅。
- 依赖闭合：两条均「前置=无」✅；`SPEC.md:23` 的分片表与本分片 4 条 + 2 注记完全一致 ✅；拍板项 #13 不在 `state.md:11` 的 `blocked_by_decision` 名单内，spec 按默认案撰写 + 给出「改判 P2 时保 LRU」的回退 ✅（小建议：PLAN 第 11 条要求 `blocked-by-decision` 标记，可在本条加一行显式标记以免终局遗漏，但不阻塞）。

---

## 4 · 关键行号逐处核对表（spec 声称 vs 实跑）

| spec 声称 | 实跑 | 判定 |
|---|---|---|
| `session-stream-unit-manager.service.ts:353` settledProjections | `:353` ✅ | ✅ |
| `:358` idleMessageViews | `:358` ✅ | ✅ |
| `:717` forgetSession 定义 | `:717` ✅ | ✅ |
| `:732` decrementAgentActive | `:732` ✅ | ✅ |
| `:738/:739` 两次 delete、`:740` notifyChanged | ✅ 逐行一致 | ✅ |
| `:1970/:1971` clearAll | ✅ | ✅ |
| `:158-158` / `:1592-1606` settled LRU | `:158` / `:1592-1606` ✅ | ✅ |
| `:1618-1629` removeUnit 交接、深拷贝 `:1624` | `:1618-1635`，`:1624-1628` ✅ | ✅ |
| `:915` hydrateSessionMessages | `:915` ✅ | ✅ |
| `useChatTabScope.ts:51/:62` runtime 入参 | ✅ | ✅ |
| `:521-541` / `:524` / `:526` | ✅ | ✅ |
| `:564-589` / `:567` 部分成功注释 / `:570` | ✅ | ✅ |
| `:591-610` / `:598` 三连 clear | ✅ | ✅ |
| `:612-614` / `:762-763` bumpWorktreeUiToken | ✅ | ✅ |
| `:616` openFileEditor / `:625` / `:632` | ✅ | ✅ |
| `navigation/types.ts:51-52` onSessionVfsSaved | ✅ 逐字一致 | ✅ |
| `navigation/types.ts:60-61` PromptEditor 注释 | ✅ | ✅ |
| `FileEditorScreen.tsx:35/:60/:190` | ✅ | ✅ |
| `SubagentSessionScreen.tsx:185/:215/:222` | ✅ | ✅ |
| `prompt-editor-callback.ts:2-6` / `:17-22` | ✅（`:17-18` 注释、`:18-22` take 实现） | ✅ |
| `chat-session-view-cache.ts:12` maxEntries 500 | ✅ | ✅ |
| `chat-session-view-cache.ts:46-49` size 探针先例 | ✅（`:47-49` `sessionViewCacheSize`） | ✅ |
| `scope-cache-lru-bound.test.ts:26` CAP=500 | ✅ | ✅ |
| `session-stream-unit-manager.service.test.ts:654` T-U1 | ✅ | ✅ |
| `:764-765` forgetSession 用例 | ✅ | ✅ |
| `:142`（当作构造夹具） | ❌ 实为 `:72-77` | ✗ B-7 |
| `use-chat-tab-scope-batch-delete.test.ts:52-70` | `:52-76`（数组在 `:49-50`） | ~ B-7 |
| `session-stream-unit-manager.service.test.ts:1140` interrupted 用例 | ✅ `:1140` `it('interrupted 不启动宽限定时器（常驻至替换/LRU 淘汰）'…)` | ✅ |

---

## 5 · 结论

**组 B verdict：No-Go（execute-ready = 否）。**

一句话理由：两条的病症与行号全部重推导成立、方向也对，但**修法各有一处会在实现后失效的洞**
（AM-1 项目删除漏子 agent 会话、N-P1-03 的 take 不放 `useRef`）**外加两条没有牙的验收**
（N-P1-03 的类型层断言被 jest 的 babel 抹除、AM-1 项目删除锁被 mock 掉唯一信息源），
共 9 条 must-fix（3 高），须先 doc-fix 闭合再谈 execute-ready。
