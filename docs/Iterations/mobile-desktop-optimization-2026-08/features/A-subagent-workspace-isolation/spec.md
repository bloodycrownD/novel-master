---
date: 2026-08-11
---

# Feature A — 子会话工作区隔离 技术规格（SPEC）

> 需求文档：`docs/Iterations/mobile-desktop-optimization-2026-08/features/A-subagent-workspace-isolation/prd.md`
> 父迭代：`docs/Iterations/mobile-desktop-optimization-2026-08/prd.md`
> 依赖前置：`agent-subagent`（子会话数据模型、`task` 工具、`createSubSession` 已落地）

## 设计目标

把子会话的工作区从「复用父 session」改成「用自己 `sessionId` 从空产生」，让子 agent 加载到的工作区与其提示词上下文一致。Core 层是本期必须落地的范围（四处 Core 改动 + 通知机制保持），UI 工作区预览则按端区分：desktop 做子会话 view 的 scope 切换，mobile 因为没有现成的工作区预览组件可复用，本期降级为「Core 隔离落地、UI 预览待 v2」。

非目标：子会话结束后清理工作区（默认保留）、跨子会话工作区共享、父会话变更反向同步子会话、subagent 既有机制（递归上限、abort 级联、结果回流）的任何改动。

## 总体方案

### 数据流总览（改动前 vs 改动后）

**改动前**（子会话复用父 session 工作区）：

```
createSubSession(parentSessionId=P)
  └ 仅 insert session 记录 C（parentSessionId=P），完全不碰 VFS
runChildAgent 装配
  ├ vfs = runtime.sessionVfs(projectId, P)        // ← 父 session VFS
  ├ new ChatAgentSession(messages, childSessionId=C, parentSessionId=P)  // 工作区归属=P（构造第三位位置参数）
  └ session.workplaceScopeSessionId === P          // ← 子 session 指向父
agent-runner 组装 wtScope
  └ wtScope = { kind:"session", projectId, sessionId: P }   // ← 落到父 session scope
UI
  ├ desktop nav-workspace.ts: 子会话 view → "chat" scope（共享父）
  └ mobile SubagentSessionScreen: 无常驻工作区面板
```

**改动后**（子会话独立工作区）：

```
createSubSession(parentSessionId=P)
  ├ insert session 记录 C（parentSessionId=P）
  └ 初始化空 child scope（新建方法 initializeEmptySessionWorkspace，
      不调 replaceVfsSubtree / copyScope，仅建空 KKV 结构）
runChildAgent 装配
  ├ vfs = runtime.sessionVfs(projectId, C)         // ← 改：子 session VFS
  └ new ChatAgentSession(messages, childSessionId=C, childSessionId=C)  // 第三位位置参数改传 C（工作区归属=C）
agent-runner 组装 wtScope
  └ wtScope = { kind:"session", projectId, sessionId: C }   // ← 自然落到子 session
UI
  ├ desktop nav-workspace.ts: 子会话 view 新增独立 scope（需提升 subagentSessionId 到 nav 层）
  └ mobile SubagentSessionScreen: v1 不做工作区预览（v2 待定，见范围降级）
通知机制（不变）
  └ STEP_COMMITTED / RUN_FINISHED 的 vfsMutated 标志照常通知父会话刷新
```

### 关键设计决策

| 决策点 | 结论 | 依据 |
|---|---|---|
| 子会话工作区起点 | **完全隔离，从空开始**，不拷贝父快照、也不拷贝项目模板 | 用户决策。子会话没有父会话的工具调用历史，加载父快照会导致「工作区内容与提示词上下文不一致」 |
| `createSubSession` 初始化方式 | **新建 `initializeEmptySessionWorkspace` 方法**，只初始化空 KKV 结构（`rule_snapshot`/`file_cache` 起点为空），**不调** `replaceVfsSubtree`（不拷贝项目 VFS 树）、**不调** `copyScope`（不拷贝 workplace scope） | 现有的 `initializeSessionWorkspace`（`packages/core/src/service/template/logic/initialize-session-workspace.ts:25-52`）会从 project template 拷贝整棵 VFS + workplace project scope，这会带进来一整套项目模板文件，与「从空开始」的产品意图冲突。子会话要的是真正的空工作区，所以不能用这个方法 |
| `createSubSession` 事务包裹 | 将 insert + 初始化包进 `this.deps.conn.transaction`，事务内用 `reposFor(tx)` 的 repo | 主会话 create（`session.service.ts:114-131`）已经是在事务内调 `initializeSessionWorkspace(tx, ...)`。当前 `createSubSession`（`session.service.ts:134-166`）完全不在事务里，只调 `this.deps.sessions.insert`。改动后初始化需要事务连接，必须补事务 |
| `workplaceScopeSessionId` 语义变更 | 子 session 改成返回 `childSessionId`（自身），不再返回 `parentSessionId` | 让 `wtScope`、常驻工作区读写都落到子 session |
| `ChatAgentSession` 构造 | 构造第三位位置参数 `workplaceScopeSessionId` 从传 `parentSessionId` 改成传 `childSessionId` | 实际构造签名（`chat-agent-session.ts:20-24`）是 `constructor(messages, sessionId, workplaceScopeSessionId = sessionId)`，位置参数。实际调用（`run-agent-turn.ts:654-658`）也是位置参数：`new ChatAgentSession(runtime.messages, childSessionId, parentSessionId)`。改动只需把第三位从 `parentSessionId` 换成 `childSessionId` |
| `runChildAgent` 的 VFS 装配 | `runtime.sessionVfs(projectId, childSessionId)`，不再用 `parentSessionId` | 子 agent 的工具操作（read/write/glob/grep）直接落到子 session scope |
| 常驻前缀（KKV）读取 | 无需额外改动，天然满足「从空开始」。`sessionKkv.get(sessionId, domain, key)` 按 `sessionId` 路由（`session-kkv.port.ts:16-21`），而 `toolCtx.sessionId` 已经是 `childSessionId`（`run-agent-turn.ts:669`） | 子 agent 读 `rule_snapshot`/`file_cache` 时用的是 `childSessionId`，会读到子 session 的空 KKV（子 session 新建无缓存）。这与「从空开始」一致 |
| VFS 变更通知父会话 | **保持现状**：`STEP_COMMITTED` / `RUN_FINISHED` 的 `vfsMutated` 标志照常发 | 父会话侧不感知子会话是否隔离，通知口径不变，避免引入新通道 |
| 子会话结束后工作区 | **默认保留**（下次进入还能看到），不主动清理 | 用户决策。若后续评估认为不合理可再议，但默认按保留 |
| desktop UI 工作区预览 scope | 子会话 view 映射到子 session 自己的 workspace scope | 子会话有自己的工作区内容，UI 自然展示子 session scope |
| mobile UI 工作区预览 | **v1 不做**，降级为「Core 隔离落地、UI 预览待 v2」 | mobile 端 `ChatTabScreen` 只有 `ChatConversationPanel` + `ChatSessionListPanel`，`SubagentSessionScreen` 只有 `ChatTranscriptWebView` + `onOpenToolFile` 走 `FileEditor`，根本不存在可复用的工作区/文件树预览组件。新建一个 mobile 工作区预览组件（拉文件列表、订阅 vfsMutated、适配 mobile 屏幕布局）工作量过大，本期范围不合适，降级到 v2 |

### `createSubSession` 改动

当前实现（`packages/core/src/service/chat/impl/session.service.ts:134-166`）只 insert session 记录，且不在事务内：

```ts
async createSubSession(
  parentSessionId: string,
  projectId: string,
  title?: string | null,
): Promise<ChatSession> {
  const parent = await this.deps.sessions.findById(parentSessionId);
  // ...校验...
  const session: ChatSession = {
    id: randomUUID(),
    projectId,
    title: title ?? null,
    parentSessionId,
    createdAtMs: now,
    updatedAtMs: now,
  };
  await this.deps.sessions.insert(session);
  return session;
}
```

改动要点：

1. **新建 `initializeEmptySessionWorkspace` 方法**（不能复用 `initializeSessionWorkspace`）。现有的 `initializeSessionWorkspace`（`packages/core/src/service/template/logic/initialize-session-workspace.ts:25-52`）会调 `replaceVfsSubtree`（把 project 的 VFS 树整体拷到 session）和 `worktree.copyScope`（拷 workplace project scope 到 session scope），也就是说调它之后子会话工作区不是空的，而是带着一整套项目模板文件。这与 PRD「从空开始」「不含任何文件」的要求冲突。新方法只初始化空的 KKV 结构（`rule_snapshot`/`file_cache` 起点为空），不拷贝任何 VFS/workplace 内容。
2. **包进事务**。当前 `createSubSession` 完全不在事务里，而初始化需要事务连接（对齐主会话 create 路径 `session.service.ts:114-131` 的 `this.deps.conn.transaction`）。
3. **事务内用 `reposFor(tx)` 的 repo**，不能再用 `this.deps.sessions.insert`（那是在事务外连接上操作）。

改动后伪代码：

```ts
async createSubSession(
  parentSessionId: string,
  projectId: string,
  title?: string | null,
): Promise<ChatSession> {
  const parent = await this.deps.sessions.findById(parentSessionId);
  // ...校验父 session 存在且同项目...（这部分在事务外读，保持现状）
  return this.deps.conn.transaction(async (tx) => {
    const r = reposFor(tx);
    const now = Date.now();
    const session: ChatSession = {
      id: randomUUID(),
      projectId,
      title: title ?? null,
      parentSessionId,
      createdAtMs: now,
      updatedAtMs: now,
    };
    await r.sessions.insert(session);
    // 新增：为子 session 初始化空工作区（不拷贝项目模板/父快照）
    await initializeEmptySessionWorkspace(tx, projectId, session.id);
    return session;
  });
}
```

**关于 `initializeEmptySessionWorkspace` 的设计**：可以新建一个独立函数（与 `initializeSessionWorkspace` 同目录，从 `@/service/template/logic/` import），也可以给 `initializeSessionWorkspace` 加一个 `empty: true` 选项跳过 `replaceVfsSubtree`/`copyScope`。推荐前者（职责更清晰）：新函数只负责「为 session 建立空的工作区结构起点」，不碰 VFS 树、不拷 scope，与项目模板完全解耦。实施时按这个方向落地。

### `workplaceScopeSessionId` 语义变更

当前接口（`packages/core/src/domain/agent/session/agent-session.port.ts:20-27`）：

```ts
interface AgentSessionLike {
  /**
   * 工作区归属 session id。主 session 等于自身；
   * 子 session 指向父 session（子 session 常驻前缀读父 session 的 rule_snapshot / file_cache）。
   */
  readonly workplaceScopeSessionId: string;
}
```

改动：子 session 改成指向自身。实现层（`ChatAgentSession` 构造，见下一节 `runChildAgent` 装配）把第三位位置参数从 `parentSessionId` 改成 `childSessionId`。注释更新为：

```ts
/**
 * 工作区归属 session id。主 session 等于自身；
 * 子 session 也等于自身（子会话工作区隔离，从空产生常驻工作区内容）。
 */
readonly workplaceScopeSessionId: string;
```

### `runChildAgent` 装配改动

当前装配（`packages/core/src/service/agent/logic/run-agent-turn.ts:622, 654-658`）：

```ts
// L622 附近
const vfs = runtime.sessionVfs(parentProjectId, parentSessionId);   // ← 父 session VFS

// L654-658 附近——位置参数构造，第三位是 workplaceScopeSessionId
const session = new ChatAgentSession(
  runtime.messages,
  childSessionId,        // 第二位 sessionId：消息落子 session
  parentSessionId,       // ← 第三位 workplaceScopeSessionId：工作区归属=父
);
```

`ChatAgentSession` 构造签名（`packages/core/src/service/agent/impl/chat-agent-session.ts:20-24`）是位置参数，不是对象字面量：

```ts
constructor(
  private readonly messages: MessageService,
  readonly sessionId: string,
  readonly workplaceScopeSessionId: string = sessionId,
)
```

改动：VFS 装配改用 `childSessionId`；构造第三位位置参数从 `parentSessionId` 改成 `childSessionId`。

```ts
const vfs = runtime.sessionVfs(parentProjectId, childSessionId);   // ← 改：子 session VFS

const session = new ChatAgentSession(
  runtime.messages,
  childSessionId,        // 第二位 sessionId：消息落子 session
  childSessionId,        // ← 第三位 workplaceScopeSessionId 改传子 session：工作区归属=子
);
```

第三位参数名本来就是 `workplaceScopeSessionId`（默认值是 `sessionId`），不存在「用 `parentSessionId` 字段表达工作区归属」这回事，也没有「字段名待确认」的问题——实际代码就是位置参数，主会话路径走默认值（不传第三位，等价于传 `sessionId` 自身），子会话路径当前显式传了 `parentSessionId`，改动只需把它换成 `childSessionId`。

### `agent-runner` `wtScope` 组装（无需改动代码，语义自然落地）

`packages/core/src/service/agent/impl/agent-runner.ts:208-212`：

```ts
const wtScope = {
  kind: "session",
  projectId,
  sessionId: session.workplaceScopeSessionId,   // ← 读 session 对象
};
```

因为 `session.workplaceScopeSessionId` 在装配层已改成 `childSessionId`，这里**不需要改代码**——`wtScope` 自然落到子 session scope。

### UI 改动

> 范围说明：Core 层的隔离是本期 P0 范围（必须落地），UI 预览按端区分。desktop 做子会话 view 的 scope 切换（复用既有 `ExplorerPane` + `WorkspaceTree`）；mobile 因为没有可复用的工作区预览组件，本期降级为「不做 UI 预览」（v2 待定）。详见下方各端说明。

#### desktop（`apps/desktop/renderer/layout/ChatRail.tsx` + `apps/desktop/renderer/state/nav-workspace.ts` + `apps/desktop/renderer/providers/ShellNavProvider.tsx` + `apps/desktop/renderer/layout/ExplorerPane.tsx`）

实际代码结构与原 SPEC 假设不同，需要澄清：

1. **`nav-workspace.ts` 是字符串枚举映射，不是对象结构映射**。当前 `nav-workspace.ts:13-21` 的 `WorkspaceScope` 是字符串字面量联合 `"global" | "session" | "chat"`，`NAV_TO_WORKSPACE` 是 `Record<NavViewId, WorkspaceScope>` 映射表（子会话 view 映射到 `"chat"`）。改动是改这个枚举/映射表（例如新增 `"subagent-session"` 值，或给 `subagent-conversation` 映射到 `"session"`），不是写 `{ kind: "session", projectId, sessionId }` 这种对象。
2. **真实的 scope 组装在 `ExplorerPane.tsx`**。`ExplorerPane`（`ExplorerPane.tsx:42-50`）从 `useShellNav()` 拿 `workspaceScope`（字符串）+ `projectId` + `sessionId`，再调 `vfsScope(panelScope, projectId, sessionId)` 组装实际的 VFS scope 请求。也就是说「让子会话预览指向子 session」的关键，是让 `ExplorerPane` 在子会话 view 下能拿到子 `sessionId`。
3. **`subagentSessionId` 当前在 `ChatRail` 本地 state，刻意不进全局 nav**。`ChatRail.tsx:68-70` 用 `useState` 维护 `subagentSessionId`，`ChatRail.tsx:66-67` 的注释明确写「子智能体只读会话面板的 sessionId 在 ChatRail 本地维护，**避免污染全局导航状态**」（P2-11 决策：全局 nav 仍指向父会话）。而 `ExplorerPane` 读的 `sessionId` 来自 `ShellNavProvider`（全局 nav state，`ShellNavProvider.tsx:215` 的 `useState<string | undefined>()`）。

**设计冲突与决策点（需主代理拍板，见待确认项）**：要让 `ExplorerPane` 在子会话 view 下展示子 session 的工作区，必须让子 `sessionId` 流到 `ExplorerPane`。有两条路：

- **方案 A（提升到 nav 层）**：把 `subagentSessionId` 从 `ChatRail` 本地 state 提升到 `ShellNavProvider`，在子会话 view 下让全局 `sessionId` 指向子 session。这会反转 P2-11「避免污染全局 nav」的决策，需要评估对其他读全局 `sessionId` 的组件（预览 tab、批量操作、agent config 等）的副作用。
- **方案 B（新增独立 provider/context）**：保留 `ChatRail` 本地 state 不变，另开一个「subagent workspace scope」context，让 `ExplorerPane` 在子会话 view 下优先读这个 context 里的子 `sessionId`。对全局 nav 零侵入，但多一层 context。

不管走哪条路，`nav-workspace.ts` 的枚举/映射表都要改（让 `subagent-conversation` view 不再映射到 `"chat"`），且要让子 `sessionId` 能流到 `ExplorerPane` 的 `vfsScope()` 组装。实施时先 grep `useShellNav()` 的所有消费点评估方案 A 的副作用，再定方案。

**改动清单**：
- `nav-workspace.ts`：`WorkspaceScope` 枚举新增 `"subagent-session"`（或给 `subagent-conversation` 改映射），`NAV_TO_WORKSPACE["subagent-conversation"]` 不再指向 `"chat"`；`WORKSPACE_TITLES` 补上新 scope 的标题。
- `ShellNavProvider.tsx`（方案 A）或新增 context（方案 B）：让子会话 view 下 `sessionId` 能流到 `ExplorerPane`。
- `ExplorerPane.tsx`：确认 `vfsScope(panelScope, projectId, sessionId)` 在子会话 view 下拿到的是子 `sessionId`。
- `ChatRail.tsx`：方案 A 下移除本地 `subagentSessionId` state，改从 nav 读；方案 B 下保持现状，补 context 填充。

**QA 点**：子会话 view 下 `ExplorerPane` 展示子 session 工作区文件；子 agent 写文件后通过 `vfsMutated` 刷新（现有 `workspaceMutatedMatchesNav` 匹配逻辑 `ShellNavProvider.tsx:157-165` 要覆盖新 scope）；回主会话 view 后主工作区不受影响。

#### mobile（`apps/mobile/src/screens/stack/SubagentSessionScreen.tsx`）

**本期降级：不做工作区预览（v2 待定）**。

mobile 端不存在可复用的工作区预览组件——`ChatTabScreen.tsx`（主会话屏幕）只有 `ChatConversationPanel` + `ChatSessionListPanel`，根本没有工作区/文件树/文件预览组件；`SubagentSessionScreen.tsx` 本身只有 `ChatTranscriptWebView` + `onOpenToolFile`（走 `FileEditor scopeKind='session'`），也没有工作区面板。要在 mobile 上做工作区预览，需要新建一个组件，涉及：

1. 怎么拉工作区文件列表（调什么 API/service——desktop 走 `ipc/client` 的 `vfsScope()`，mobile 没有对等路径）。
2. 怎么订阅 `vfsMutated` 刷新（mobile 的事件订阅机制与 desktop 不同）。
3. UI 布局方案（mobile 屏幕有限，不能像 desktop 侧栏常驻，需要设计可展开/收起的面板或单独 tab）。

工作量评估：新建组件 + 适配 mobile 交互 + 测试，不低于 2-3 天，超出本期范围。所以 v1 只隔离 Core 层 scope（子 agent 工作区已独立，`vfsMutated` 通知机制保持），UI 预览后续补。在「风险与实现注」里标注这个降级决策。

> 注：mobile 的 `onOpenToolFile` 走 `FileEditor scopeKind='session'` 行为不变（已指向 session scope），用户点工具卡片里的文件仍能正常打开编辑。

### 通知机制（保持现状）

子会话的 VFS 变更通过 `STEP_COMMITTED` / `RUN_FINISHED` 事件里的 `vfsMutated` 标志通知父会话刷新——这条机制**完全不动**。父会话侧不感知子会话工作区是否隔离，收到 `vfsMutated` 后照常刷新自己的工作区视图。本次只是让子会话有自己的 scope，通知口径不变。

## 最终项目结构

### 新增文件

| 文件 | 说明 |
|------|------|
| `packages/core/src/service/template/logic/initialize-empty-session-workspace.ts`（暂定名） | 新增：为子 session 初始化空工作区结构，不拷贝项目模板/父快照。与 `initialize-session-workspace.ts` 同目录，职责解耦 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `packages/core/src/service/chat/impl/session.service.ts` | `createSubSession` 包进 `this.deps.conn.transaction`；事务内用 `reposFor(tx)` 的 repo；insert 后调 `initializeEmptySessionWorkspace(tx, projectId, session.id)` |
| `packages/core/src/domain/agent/session/agent-session.port.ts` | `workplaceScopeSessionId` 注释更新（语义改为子 session 指向自身） |
| `packages/core/src/service/agent/logic/run-agent-turn.ts` | `runChildAgent` 装配：VFS 用 `childSessionId`（L622）；`ChatAgentSession` 构造第三位位置参数从 `parentSessionId` 改成 `childSessionId`（L654-658） |
| `apps/desktop/renderer/state/nav-workspace.ts` | `WorkspaceScope` 枚举/`NAV_TO_WORKSPACE` 映射表：`subagent-conversation` 不再映射 `"chat"`，改为子 session 独立 scope |
| `apps/desktop/renderer/providers/ShellNavProvider.tsx`（方案 A）或新增 context（方案 B） | 让子会话 view 下子 `sessionId` 能流到 `ExplorerPane`（见 UI 改动决策点） |
| `apps/desktop/renderer/layout/ExplorerPane.tsx` | 确认 `vfsScope(panelScope, projectId, sessionId)` 在子会话 view 下拿到子 `sessionId`；`workspaceMutatedMatchesNav` 覆盖新 scope |
| `apps/desktop/renderer/layout/ChatRail.tsx` | 方案 A：移除本地 `subagentSessionId` state，改从 nav 读；方案 B：保持现状，补 context 填充 |
| 相关测试（Core 单测 + desktop 手工） | 新增子会话工作区隔离用例 |

> `agent-runner.ts` 的 `wtScope` 组装**不需要改代码**——它读 `session.workplaceScopeSessionId`，语义变更后自然落到子 session。
>
> mobile 端 `SubagentSessionScreen.tsx` 本期**不改**（v1 不做 UI 预览，v2 待定）。

## 变更点清单

| 编号 | 模块 | 变更 | 风险 |
|------|------|------|------|
| C-1 | core/template | 新增 `initializeEmptySessionWorkspace`（不拷贝 VFS/scope，只建空 KKV 结构） | 低：新方法，职责独立 |
| C-2 | core/session | `createSubSession` 包进事务 + 调 `initializeEmptySessionWorkspace` | 中：事务包裹改动需核对 `reposFor(tx)` 用法与父 session 校验时机（事务外读 vs 事务内读） |
| C-3 | core/session | `workplaceScopeSessionId` 子 session 语义改为指向自身 | 中：影响所有读该字段的下游（wtScope 组装、工作区读写）——需确认无遗漏调用点 |
| C-4 | core/agent | `runChildAgent` VFS 装配改用 `childSessionId` | 中：子 agent 工具操作的目标 scope 改变，需验证 read/write/glob/grep 全链路 |
| C-5 | core/agent | `ChatAgentSession` 构造第三位位置参数从 `parentSessionId` 改成 `childSessionId` | 低：配合 C-3，构造签名是位置参数 |
| C-6 | desktop/ui | `nav-workspace.ts` 枚举/映射表 + `ShellNavProvider`/context + `ExplorerPane` + `ChatRail`：让子会话 view 展示子 session 工作区 | 中：需解决 `subagentSessionId` 从 `ChatRail` 本地流向 `ExplorerPane` 的设计冲突（方案 A/B 决策） |
| C-7 | mobile/ui | **本期不做**（v2 待定）：mobile 无可复用的工作区预览组件，降级处理 | —（降级，见风险与实现注） |
| C-8 | 测试 | Core 单测 + desktop 手工对照 | — |

## 详细实现步骤

### Step 1 — phase-core-session — blocking: yes — qa: auto

**改动 `createSubSession`**：

1. 新建 `initializeEmptySessionWorkspace`（与 `initialize-session-workspace.ts` 同目录）。这个方法只初始化空 KKV 结构（`rule_snapshot`/`file_cache` 起点为空），**不调** `replaceVfsSubtree`、**不调** `copyScope`——因为现有的 `initializeSessionWorkspace` 会从 project template 拷贝整棵 VFS + workplace project scope，带进来一整套项目模板文件，与「从空开始」冲突。
2. 在 `packages/core/src/service/chat/impl/session.service.ts` 的 `createSubSession` 方法中：把 insert + 初始化包进 `this.deps.conn.transaction`；事务内用 `reposFor(tx)` 的 repo（不再用 `this.deps.sessions.insert`，改为 `r.sessions.insert`）；insert 后调 `await initializeEmptySessionWorkspace(tx, projectId, session.id)`。

核对点：
- `initializeEmptySessionWorkspace` 签名设计为 `(tx: TdbcConnection, projectId: string, sessionId: string) => Promise<void>`，与 `initializeSessionWorkspace` 的事务连接约定一致（主 session create 路径已验证事务用法）。
- `createSubSession` 当前入参签名是 `(parentSessionId, projectId, title?)`（位置参数），`projectId` 已在入参里。
- 父 session 校验（`findById` + 同项目检查）可以保持在事务外读（当前就是这样），也可以进事务——实施时按主 session create 的风格对齐（主 session create 的校验在事务外，insert + 初始化在事务内）。
- 不调 `replaceVfsSubtree` / `copyScope` / `copyVfsTree`——从空开始。

**QA（auto）**：Core 单测——`createSubSession` 后子 session 工作区为空（无文件、无 `rule_snapshot` / `file_cache`），父 session 工作区不变。

### Step 2 — phase-core-session-scope — blocking: yes — qa: auto

**改动 `workplaceScopeSessionId` 语义**：在 `packages/core/src/domain/agent/session/agent-session.port.ts` 更新注释（子 session 指向自身）。实现层（`ChatAgentSession`）的 `workplaceScopeSessionId` 取值改为 `childSessionId`。

核对点：
- 全局 grep `workplaceScopeSessionId` 的所有读点，确认无遗漏（已知：`agent-runner.ts:208-212` 的 `wtScope` 组装；可能还有工作区读写路径）。
- 主 session 路径不受影响（主 session 的 `workplaceScopeSessionId` 仍等于自身）。

**QA（auto）**：Core 单测——子 session 的 `workplaceScopeSessionId === childSessionId`；主 session 的 `workplaceScopeSessionId === self`。

### Step 3 — phase-core-agent — blocking: yes — qa: auto

**改动 `runChildAgent` 装配**：在 `packages/core/src/service/agent/logic/run-agent-turn.ts` 的 `runChildAgent` 闭包中：
- VFS 装配改为 `runtime.sessionVfs(parentProjectId, childSessionId)`（L622 附近）。
- `ChatAgentSession` 构造第三位位置参数从 `parentSessionId` 改成 `childSessionId`（L654-658 附近）。构造签名是位置参数 `constructor(messages, sessionId, workplaceScopeSessionId = sessionId)`，不是对象字面量。

核对点：
- `ChatAgentSession` 构造签名以实际代码为准（位置参数，第三位名是 `workplaceScopeSessionId`，默认值是 `sessionId`）。主 session 路径走默认值（不传第三位），子 session 路径当前显式传 `parentSessionId`，改成传 `childSessionId`。
- `agent-runner.ts:208-212` 的 `wtScope` 无需改代码（读 `session.workplaceScopeSessionId`，语义变更后自然落地）。
- 子 agent 的 read/write/glob/grep 全链路验证（工具操作的目标 scope 是子 session）。
- 常驻前缀（KKV）读取无需额外改动：`sessionKkv.get(sessionId, ...)` 按 `sessionId` 路由，`toolCtx.sessionId` 已是 `childSessionId`（L669），子 agent 读 `rule_snapshot`/`file_cache` 天然落到子 session 的空 KKV。实施时 grep `sessionKkv` 确认无按 `workplaceScopeSessionId` 路由的例外路径。

**QA（auto）**：Core 单测——子 agent 写文件落到子 session scope；父 session 工作区在子 agent 运行前后不变；子 agent 能读到自己刚写的文件。

### Step 4 — phase-core-notify — blocking: no — qa: auto

**验证 VFS 变更通知机制不变**：子会话的 `STEP_COMMITTED` / `RUN_FINISHED` 的 `vfsMutated` 标志照常通知父会话。本步**不改代码**，只补测试确认通知口径不变。

核对点：
- 子 agent 产生 VFS 变更后，父会话收到 `vfsMutated` 事件（与现状一致）。
- 父会话侧刷新的是父 session 自己的工作区（不读子 session 的内容）。

**QA（auto）**：Core 单测——子 agent VFS 变更后父会话收到 `vfsMutated` 标志。

### Step 5 — phase-desktop-ui — blocking: no — qa: manual_user

**desktop 工作区预览**（需先定方案 A/B，见待确认项）：
- `apps/desktop/renderer/state/nav-workspace.ts`：`WorkspaceScope` 枚举新增 `"subagent-session"`（或给 `subagent-conversation` 改映射到 `"session"`），`NAV_TO_WORKSPACE["subagent-conversation"]` 不再指向 `"chat"`；`WORKSPACE_TITLES` 补上新 scope 标题。
- 方案 A：`apps/desktop/renderer/providers/ShellNavProvider.tsx` + `apps/desktop/renderer/layout/ChatRail.tsx`——把 `subagentSessionId` 从 `ChatRail` 本地 state 提升到 `ShellNavProvider`，在子会话 view 下让全局 `sessionId` 指向子 session。需 grep `useShellNav()` 的所有消费点评估副作用。
- 方案 B：新增「subagent workspace scope」context，`ChatRail` 保持本地 state 不变，补 context 填充；`ExplorerPane` 在子会话 view 下优先读 context 里的子 `sessionId`。
- `apps/desktop/renderer/layout/ExplorerPane.tsx`：确认 `vfsScope(panelScope, projectId, sessionId)` 在子会话 view 下拿到子 `sessionId`；`workspaceMutatedMatchesNav`（`ShellNavProvider.tsx:157-165`）覆盖新 scope 的 `vfsMutated` 匹配。

核对点：
- 子会话 view 的工作区预览能看到子 agent 产出的文件。
- 子 agent 产生文件变更时预览刷新（通过 `vfsMutated`）。
- 主会话 view 的工作区预览不受影响（回主会话 view 后 `sessionId` 恢复指向父 session）。
- 其他读全局 `sessionId` 的组件（预览 tab、批量操作、agent config）不受副作用影响（方案 A 需重点验证）。

**QA（manual_user）**：desktop 手工——派子 agent 写文件，进子会话 view 看工作区预览；回主会话看主工作区不变。

### Step 6 — phase-mobile-ui — blocking: no — qa: manual_user

**本期不做（降级）**：mobile 端没有可复用的工作区预览组件（`ChatTabScreen` 只有 `ChatConversationPanel` + `ChatSessionListPanel`；`SubagentSessionScreen` 只有 `ChatTranscriptWebView` + `onOpenToolFile`），新建组件工作量过大（拉文件列表、订阅 `vfsMutated`、适配 mobile 布局），超出本期范围。v1 只隔离 Core 层 scope，UI 预览待 v2。

核对点（v1）：
- Core 层隔离已落地：子 agent 工作区独立、`vfsMutated` 通知机制保持。
- `onOpenToolFile` 走 `FileEditor scopeKind='session'` 行为不变，用户点工具卡片里的文件仍能正常打开。
- mobile 用户在子会话浏览页看不到工作区预览（已知降级，v2 补）。

**QA（manual_user）**：mobile 手工——派子 agent 写文件，确认 Core 层隔离生效（可通过 desktop 端验证或日志确认）；mobile 浏览页点工具卡片文件能打开。

### Step 7 — phase-regression — blocking: yes — qa: auto

**回归测试**：跑 Core 全量单测 + apps 构建，确认无回归。重点关注：
- `agent-subagent` 迭代的既有用例（子会话创建、`task` 工具闭环、结果回流、递归上限、abort 级联）。
- 主会话工作区相关用例（不受 `workplaceScopeSessionId` 语义变更影响）。
- VFS / 工作区相关用例。

**QA（auto）**：`npm test -w @novel-master/core` 通过；`npm run build` 通过。

## 测试策略与用例

### 自动化（Core）

| 用例编号 | 模块 | 断言 |
|----------|------|------|
| T-SS-1 | session.service | `createSubSession` 后子 session 工作区为空（无文件、无 `rule_snapshot` / `file_cache`）；父 session 工作区不变；事务包裹正确（`reposFor(tx)` 路径） |
| T-SS-2 | agent-session.port | 子 session 的 `workplaceScopeSessionId === childSessionId`；主 session 的 `workplaceScopeSessionId === self` |
| T-SS-3 | run-agent-turn | `runChildAgent` 装配的 VFS 指向 `childSessionId`（非 `parentSessionId`）。用 mock-based 方式：mock `runtime.sessionVfs` 检查入参是 `childSessionId`；构造 `ChatAgentSession` 后断言第三位 `workplaceScopeSessionId === childSessionId`。`vfs` 是闭包内局部变量，无法直接断言，改从 mock 入参或 session 对象字段间接验证 |
| T-SS-4 | agent-runner | 子 agent 写文件落到子 session scope；父 session 工作区在子 agent 运行前后不变（行为级断言，已覆盖 T-SS-3 的意图） |
| T-SS-5 | agent-runner | 子 agent 能 read/glob/grep 到自己刚写的文件 |
| T-SS-6 | notify | 子 agent VFS 变更后父会话收到 `vfsMutated` 标志（机制不变） |
| T-SS-7 | regression | `agent-subagent` 既有用例（子会话创建、`task` 闭环、回流、递归上限、abort 级联）全部通过 |
| T-SS-8 | run-agent-turn（嵌套） | 三层嵌套场景：父→子→孙 agent，孙 agent 的工作区独立于子和父（`runChildAgent` 递归装配天然成立，每层都指向自身）。补这个用例显式验证嵌套一致性 |

> T-SS-3 与 T-SS-4 的关系：T-SS-3 是装配层断言（mock 入参/session 字段），T-SS-4 是行为层断言（写文件落点）。两者互补，T-SS-4 已覆盖 T-SS-3 的核心意图，T-SS-3 作为更早失败的快速检查保留。

### 手工（apps）

| 用例编号 | 端 | 场景 |
|----------|----|------|
| T-UI-1 | desktop | 派子 agent 写文件 → 进子会话 view → 工作区预览看到该文件；回主会话 → 主工作区不变 |
| T-UI-2 | desktop | 子 agent 运行中产生文件变更 → 子会话 view 工作区预览刷新 |
| T-UI-3 | desktop | 三层嵌套：派子 agent 再派孙 agent → 孙 agent 写文件 → 进子会话 view 看子工作区、进孙会话 view 看孙工作区，三者互不污染 |
| T-UI-4 | 双端 | 子会话结束后再次进入 → 工作区内容仍在（保留） |

> mobile 端 UI 预览用例本期不做（v2 待定）。mobile 用户可通过 desktop 端验证 Core 隔离效果，或通过日志确认子 agent 工作区独立。

## 风险与回滚方案

### 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| `workplaceScopeSessionId` 语义变更有遗漏读点 | 工作区读写落到错误 scope | Step 2 全局 grep 所有读点；回归测试覆盖主会话 + 子会话工作区路径 |
| `initializeEmptySessionWorkspace` 新方法的空结构不完整 | 子会话工作区初始化异常（例如缺某个 domain 起点导致后续读取报错） | T-SS-1 断言空工作区结构完整（`rule_snapshot` / `file_cache` domain 可读且为空）；对照 `initializeSessionWorkspace` 的 KKV 初始化部分，确认新方法覆盖必要结构 |
| 常驻前缀（KKV）读取在 `workplaceScopeSessionId` 改动后路由异常 | 子 agent 读到错误的 KKV scope | 当前 `sessionKkv.get(sessionId, ...)` 按 `sessionId` 路由，`toolCtx.sessionId` 已是 `childSessionId`，天然落到子 session 空 KKV。实施时 grep `sessionKkv` 确认无按 `workplaceScopeSessionId` 路由的例外路径 |
| desktop 工作区预览的 `subagentSessionId` 流转设计冲突（方案 A/B） | 预览展示错误 scope 的内容，或反转 P2-11 决策引入副作用 | Step 5 先评估方案 A 副作用（grep `useShellNav()` 消费点），若副作用大改走方案 B；T-UI-1 断言预览内容 |
| mobile 工作区预览降级（v2 待定） | mobile 用户在子会话浏览页看不到工作区预览 | 降级决策已记录；Core 隔离仍生效，用户可通过 desktop 或日志确认；`onOpenToolFile` 仍可正常打开文件 |
| 子会话工作区保留导致孤儿数据累积 | 长期使用后 VFS 膨胀 | 默认保留（用户决策）；如评估不合理可在后续迭代引入清理策略（本迭代不做） |
| 子会话嵌套（孙 agent）递归一致性 | 嵌套场景下工作区隔离失效 | `runChildAgent` 递归装配天然成立（每层都指向自身 `sessionId`）；T-SS-8 + T-UI-3 显式验证三层嵌套 |
| `createSubSession` 事务包裹改动影响调用点 | 事务行为变化导致调用方异常 | `createSubSession` 的调用点（`run-agent-turn.ts:678-680` 的 `createChildSession`）不受影响（返回值仍是 `ChatSession`）；核对其他调用点（如有）

### 回滚方案

改动集中在 Core 层（新建 1 个方法 + 修改 3 个文件）+ desktop UI（3-4 个文件，视方案而定）；mobile 本期不改。回滚策略：

1. **Core 回滚**：`createSubSession` 移除事务包裹与 `initializeEmptySessionWorkspace` 调用（改回纯 insert）；删除新建的 `initializeEmptySessionWorkspace` 方法；`workplaceScopeSessionId` 子 session 改回指向 `parentSessionId`（构造第三位传回 `parentSessionId`）；`runChildAgent` 的 VFS 改回 `parentSessionId`。回滚后行为等同于 `agent-subagent` 迭代的状态（子会话复用父工作区）。
2. **desktop UI 回滚**：`nav-workspace.ts` 子会话 view 改回映射 `"chat"`；`ShellNavProvider`/context/`ChatRail`/`ExplorerPane` 的改动还原（方案 A 还原全局 nav，方案 B 移除新 context）。回滚后 UI 行为等同于现状。
3. **数据兼容**：本次不涉及数据库 schema 变更，回滚不需要数据迁移。已创建的子 session 空 scope 在回滚后成为孤儿（无害，不读不写）。

### 待确认项

| 项 | 说明 |
|----|------|
| 子会话结束后工作区是否保留 | 默认保留（用户决策基于常理推断）。若评估认为孤儿数据累积是问题，可在后续迭代引入清理策略（如子会话删除时清 scope，或定期清理）。本迭代按保留处理。 |
| desktop `subagentSessionId` 流转方案（A 提升到 nav / B 新增 context） | **需主代理拍板**。方案 A 反转 P2-11「避免污染全局 nav」决策，需评估对其他读全局 `sessionId` 组件（预览 tab、批量操作、agent config）的副作用；方案 B 对全局 nav 零侵入但多一层 context。实施前先 grep `useShellNav()` 消费点评估方案 A 副作用，再定。 |
| mobile 工作区预览 v2 范围 | 本期降级，v2 需评估新建组件的完整方案（拉文件列表 API、`vfsMutated` 订阅、mobile 布局），建议作为独立迭代。 |
| `initializeEmptySessionWorkspace` 是否要复用 `initializeSessionWorkspace` 的选项模式 | 推荐新建独立函数（职责清晰），但也可给 `initializeSessionWorkspace` 加 `empty: true` 选项跳过 `replaceVfsSubtree`/`copyScope`。实施时按团队偏好定。 |
