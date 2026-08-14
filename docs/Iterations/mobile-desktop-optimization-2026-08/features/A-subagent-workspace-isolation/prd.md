---
date: 2026-08-11
dependency: mobile-desktop-optimization-2026-08/prd.md
---

# Feature A — 子会话工作区隔离 PRD

> **⚠️ 语义修订（2026-08-14，用户拍板）**：本文及 spec 所述「子会话从空产生独立工作区」的语义已被推翻。最终语义：**子会话共享父会话工作区**（子 agent 的 VFS 工具全部在父 session scope 操作，写入出现在父工作区，嵌套时孙指向根父）；**仅规则快照隔离**（rule_snapshot/file_cache 存子 session 自己的 KKV，规则评估按父工作区，`kkvScopeSessionId` 恒等自身）。实现已在 feature-d-bug-fixes 分支重做（commit 82903df/a6700b2/c4c9ae2/94810a4）。阅读本文时以下章节按新语义理解。

## 背景

Novel Master 的子会话（subagent）能力在 `agent-subagent` 迭代落地：主 agent 通过 `task` 工具派生子 agent 执行子任务，子 agent 的对话历史落在独立的 `chat_session`（`parent_session_id` 指向父），UI 上可点工具卡片进入只读浏览页。

当时的实现做了一个**刻意的设计选择**——子会话不建立自己的工作区 scope，而是复用父会话的 VFS / 常驻工作区缓存。证据分布在四处：

- `createSubSession`（`packages/core/src/service/chat/impl/session.service.ts:134-166`）只 `insert` session 记录（带 `parentSessionId`），完全不碰 VFS——不调 `initializeSessionWorkspace`、不创建 child scope、不调 `copyVfsTree`。
- `workplaceScopeSessionId`（`packages/core/src/domain/agent/session/agent-session.port.ts:20-27`）接口定义里，主 session 等于自身、子 session 指向父 session，注释直接写「子 session 常驻前缀读父 session 的 rule_snapshot / file_cache」。
- `runChildAgent` 装配期（`packages/core/src/service/agent/logic/run-agent-turn.ts:622, 654-658`）显式把父 session 的工作区喂给子 agent：VFS 用 `runtime.sessionVfs(parentProjectId, parentSessionId)`；`ChatAgentSession` 构造时传 `childSessionId`（消息落子 session）+ `parentSessionId`（工作区归属）。
- `agent-runner`（`packages/core/src/service/agent/impl/agent-runner.ts:208-212`）用 `workplaceScopeSessionId` 组装 `wtScope`：`{ kind: "session", projectId, sessionId: session.workplaceScopeSessionId }`。
- UI 层也跟着共享：desktop 的 `nav-workspace.ts:19-20` 把子会话 view 映射到 `"chat"` workspace scope（注释写「与父会话共享聊天工作区预览面板」）；mobile 的 `SubagentSessionScreen.tsx:262-272` 的 `onOpenToolFile` 走 `FileEditor scopeKind='session'`，但子会话页根本没有常驻工作区面板。

这个选择在当初是为了让「子 agent 帮忙查大纲设定」这类场景能直接读到父工作区文件，但实际用下来暴露出一个**上下文一致性**问题：

> 常驻工作区里带着缓存（`rule_snapshot`、`file_cache` 等）。主会话这样没问题——因为主会话的写文件操作就是工作区内容的来源，缓存不动不影响上下文完整性。但子会话不一样：子会话**没有自己的工具调用历史**（消息历史落在 `childSessionId`，但工具调用产生的文件操作挂在父 session 的工作区），如果子会话还加载父会话的工作区缓存，会出现「加载的工作区内容和实际提示词不一致」——子会话的提示词里没有父会话那些工具调用的上下文，但工作区缓存却带着父会话的快照。

换句话说，子 agent 看到的工作区「内容」和它「知道的事」对不上，这在重度使用场景下会让子 agent 做出与上下文不符的判断。本次迭代要在不破坏既有 subagent 闭环的前提下，把子会话的工作区**完全隔离**出来。

## 目标（含成功指标）

**目标**：让子会话用自己的 `sessionId` 从空工作区开始，独立产生常驻工作区内容；子 agent 加载的工作区与其提示词上下文一致；desktop 端 UI 能在子会话页看到子会话自己的工作区预览（mobile 端 UI 预览本期降级，v2 待定）。

**成功指标**：

1. 子会话首次进入时，工作区为空（不携带父会话的 `rule_snapshot` / `file_cache` / 任何文件，也不携带项目模板文件）。
2. 子 agent 在子会话中产生的文件操作落入子 session 自己的 VFS scope，与父会话工作区互不影响。
3. 父会话的工作区在子会话执行前后保持不变（隔离可验证）。
4. desktop 子会话浏览页能看到子会话自己的工作区内容，并在子 agent 产生文件变更时刷新；mobile 端 Core 隔离同样生效（通过 desktop 或日志可验证），UI 预览 v2 补。
5. Core 单测覆盖：子会话工作区初始化、scope 隔离、VFS 变更通知父会话刷新（保持现有机制）、三层嵌套一致性四条核心断言。
6. 现有自动化测试套件无回归。

## 用户与场景

**目标用户**：重度使用者——长会话里频繁派发子智能体处理子任务的人。这类用户最容易察觉到「子 agent 读到的工作区和它实际知道的事对不上」这种隐性问题。

**典型场景**：

- 用户让主 agent「派个子 agent 去整理一下第 10 章的人物关系图」。子 agent 进去后，它的工作区应该是空的（它并不知道主会话之前写过哪些文件），从零开始根据主 agent 给的 prompt 工作；它产出的文件落在自己的工作区，用户在子会话页能看到。
- 用户连续派多个子 agent 处理不同子任务，每个子 agent 互不干扰——A 子 agent 的工作区不会泄漏给 B 子 agent。
- 子 agent 写完文件后，主 agent 的工作区通过现有的 `vfsMutated` 通知机制得到刷新提示（这一条保持现状，不在本次改动）。

## 范围

### 包含范围

**Core — 工作区隔离**

- `createSubSession` 给子 session 初始化独立的工作区（新建空初始化方法，不复用会拷贝项目模板的 `initializeSessionWorkspace`），**从空开始**，不拷贝父快照、不拷贝项目模板。
- `workplaceScopeSessionId` 对子 session 改成指向自身（`childSessionId`），不再指向父 session。
- `runChildAgent` 装配时，VFS 用 `childSessionId` 而非 `parentSessionId`。
- 子 agent 的 `wtScope` 随 `workplaceScopeSessionId` 语义变更自然落到子 session。
- 子会话的 VFS 变更仍通过 `STEP_COMMITTED` / `RUN_FINISHED` 的 `vfsMutated` 标志通知父会话刷新（保持现有通知机制，不引入新通道）。

**Apps — UI 工作区预览**

- desktop：`ChatRail` 子会话 view + `nav-workspace.ts` 的 scope 映射，让子会话 view 指向子 session 自己的 workspace scope（不再映射到父的 `"chat"` scope）。
- mobile：**本期不做 UI 预览**（v2 待定）。mobile 端没有可复用的工作区预览组件（主会话屏幕只有对话面板和会话列表，子会话浏览页只有 transcript + 文件打开），新建组件工作量过大，本期只隔离 Core 层 scope，UI 预览后续补。Core 隔离对 mobile 同样生效（子 agent 工作区已独立），只是 mobile 端暂无预览面板展示。

**测试**

- Core 单测：子会话工作区初始化、scope 隔离、VFS 变更通知、三层嵌套一致性。
- desktop 手工对照：子会话页工作区预览可见、可刷新。
- mobile：本期不做 UI 预览测试（v2 待定），Core 隔离通过 desktop 端或日志验证。

### 不包含范围

- **子会话工作区内容清理**：子会话结束后工作区内容**保留**（下次进入还能看到），不主动清理。这是默认行为——若 SPEC 阶段评估认为保留不合理，标注为待确认，但默认按保留处理。
- **跨子会话工作区共享**：不引入「多个子会话共享同一个工作区」之类的能力，每个子会话独立。
- **父会话工作区变更回流子会话**：本次只做「子会话独立」，不做「父会话变更反向同步给子会话」。
- **工作区隔离之外的行为变更**：子会话的递归上限、abort 级联、结果回流等既有机制全部保持不变。

## 核心需求

1. **子会话工作区从空初始化**：`createSubSession` 在 insert session 记录后，为子 session 初始化一个空的常驻工作区（不拷贝项目模板文件、不拷贝父会话的任何文件或缓存 `rule_snapshot` / `file_cache`）。注意不能复用现有的 `initializeSessionWorkspace`（它会从 project template 拷贝整棵 VFS + workplace scope），需要新建一个只初始化空结构的方法。
2. **工作区归属指向子 session**：`workplaceScopeSessionId` 对子 session 返回 `childSessionId`，使子 agent 的 `wtScope`、常驻工作区读写都落到子 session 自己的 scope。
3. **子 agent VFS 用子 session**：`runChildAgent` 装配子 agent 的 `BuiltinToolContext.vfs` 时，用 `runtime.sessionVfs(projectId, childSessionId)`，不再用 `parentSessionId`。
4. **双端 UI 挂工作区预览（desktop）/ mobile 降级**：desktop 子会话 view（`ChatRail` + `nav-workspace.ts`）展示子会话自己的工作区内容；子 agent 产生文件变更时通过现有 `vfsMutated` 机制刷新。mobile 本期不做 UI 预览（无可复用组件，v2 待定），但 Core 层隔离对 mobile 同样生效。
5. **通知机制保持**：子会话的 VFS 变更仍通过 `STEP_COMMITTED` / `RUN_FINISHED` 事件里的 `vfsMutated` 标志通知父会话刷新（父会话侧不感知子会话工作区是隔离的，通知口径不变）。

## 验收标准

**子会话工作区从空初始化**

- **Given** 一个已存在的主会话 P（工作区有若干文件 + `rule_snapshot` + `file_cache`）
- **When** 主 agent 调用 `task` 工具派生子 agent，`createSubSession(parentSessionId=P)` 执行
- **Then** 子 session 记录 C 被插入，`parent_session_id = P`
- **Then** 子 session C 拥有一个空的常驻工作区 scope（`session:{projectId}:{C}`），其中不含 P 的任何文件、不含 P 的 `rule_snapshot` / `file_cache`
- **Then** P 的工作区内容在 `createSubSession` 前后保持不变

**工作区归属指向子 session**

- **Given** 子 session C 已创建
- **When** 查询 `C.workplaceScopeSessionId`
- **Then** 返回 `C` 自身（`childSessionId`），而非 `P`

**子 agent 工作区读写隔离**

- **Given** 子 session C 已创建，子 agent 开始运行
- **When** 子 agent 调用 write 工具写入文件 `outline.md`
- **Then** 文件落在 C 的工作区 scope（`session:{projectId}:{C}`），不出现在 P 的工作区
- **Then** 子 agent 后续 read / glob / grep 能读到自己刚写的 `outline.md`
- **Then** P 的工作区在子 agent 运行前后保持不变（隔离可验证）

**子 agent 上下文与工作区一致**

- **Given** 子 session C 已创建（空工作区）
- **When** 子 agent 加载工作区（`rule_snapshot` / `file_cache`）
- **Then** 加载到的是 C 自己的空工作区，不含 P 的任何快照
- **Then** 子 agent 的提示词上下文（无父会话工具调用历史）与加载到的工作区内容一致

**desktop UI 工作区预览**

- **Given** 子 agent 在子会话 C 中产生了文件变更（如写入 `outline.md`）
- **When** 用户在 desktop 端进入子会话 view（C）
- **Then** `ChatRail` 展示 C 自己的工作区预览（scope 指向 C，不再共享父的 `"chat"` scope）
- **Then** 子 agent 后续产生文件变更时，预览面板通过 `vfsMutated` 机制刷新

**mobile UI 预览（本期降级）**

- mobile 端 `SubagentSessionScreen` 本期不做工作区预览面板（mobile 无可复用的工作区预览组件，新建工作量过大，v2 待定）。
- Core 层隔离对 mobile 同样生效：子 agent 工作区已独立、`vfsMutated` 通知机制保持。
- mobile 用户在子会话浏览页点工具卡片里的文件仍能正常打开（`onOpenToolFile` 走 `FileEditor scopeKind='session'` 行为不变）。

> 注：mobile 降级是 SPEC 阶段基于实际代码评估的结果——mobile 主会话屏幕（`ChatTabScreen`）只有对话面板和会话列表，没有工作区/文件树预览组件可复用。详见 SPEC「UI 改动」章节。

**VFS 变更通知父会话（保持现状）**

- **Given** 子 agent 在 C 中产生 VFS 变更
- **When** 子 agent 的 `STEP_COMMITTED` / `RUN_FINISHED` 事件触发
- **Then** 事件携带 `vfsMutated` 标志，父会话 P 收到刷新通知（机制与现状一致）

**子会话结束后工作区保留（默认行为）**

- **Given** 子 agent 运行结束，子会话 C 的工作区有内容
- **When** 用户再次进入子会话 C 的浏览页
- **Then** C 的工作区内容仍在（保留，不主动清理）

> 注：若 SPEC 阶段评估认为「子会话结束后保留工作区」不合理（如担心累积孤儿数据），可标注为待确认；默认按保留处理。

## 约束与依赖

- 依赖已合并的 `agent-subagent` 迭代（子会话数据模型、`task` 工具闭环、`createSubSession` 路径已存在）。
- 依赖 `mobile-desktop-optimization-2026-08` 父迭代的总纲（`mobile-desktop-optimization-2026-08/prd.md`）。
- Core 改动位于 `@novel-master/core`；apps 层负责 UI 工作区预览挂载。
- 不涉及数据库 schema 变更（`chat_session` 已有 `parent_session_id`，VFS scope 按 `session:{projectId}:{sessionId}` 字面索引，新建 child scope 不需要新表/新列）。

## 非功能需求（业务/体验）

- 子 agent 进入子会话后，工作区是空的——它根据主 agent 给的 prompt 从零开始工作，符合「子任务独立」的直觉。
- desktop 子会话浏览页能看到子 agent 产出的文件，用户不需要切回主会话才能确认子 agent 干了什么。
- mobile 端本期不做工作区预览（v2 待定），但 Core 隔离对 mobile 同样生效，用户仍可通过工具卡片打开子 agent 产出的单个文件。
- 主会话用户无感知：主会话工作区不受子会话影响，刷新机制沿用现状。
