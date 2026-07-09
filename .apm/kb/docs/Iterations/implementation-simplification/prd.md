---
date: 2026-07-05
dependency:
  - Iterations/codebase-audit-remediation/prd.md
  - Iterations/core-architecture-style/prd.md
  - Iterations/chat-workspace-agent-sync/bugs/agent-run-lifecycle-unify/prd.md
  - Iterations/core-explore-remediation/features/chat-user-vfs-turn/prd.md
  - Iterations/saved-model-identity/prd.md
  - Iterations/vfs-tool-error-diagnostics/prd.md
  - Iterations/events-config-validation/prd.md
---

# 实现路径简化（费力实现整改）PRD

## 背景

2026-07 全库探索（10 子代理）识别出一类共性技术债：**业务能力本可在更少跳转内完成，却因多轮迭代在 Core ↔ Mobile / Desktop / CLI 边界叠出多条并行路径、多个内存/ref/Map 中间态，以及分散的递减/刷新点**。功能正确、局部也 DRY，但维护者改一处常需同步 3–6 个文件，且易出现双端行为漂移。

典型表现包括：

| 热点 | 简述 |
|------|------|
| Agent 运行态 | `uiRunning`、`activeRunId`、`agentActive` refcount 三信号；递减分散 4+ 处 |
| Runner 装配 | `runAgentTurn`、`run-agent.handler`、CLI `commands` 三轨重复装配 `createAgentRunner` |
| User VFS | `executeOp` → pending 队列 → `flush` → 末条 user 删除/重挂重排 |
| Mobile ChatTab | 10+ hooks 聚合；`ChatConversationPanel` 接收 70+ props；`agentRunning` 多源消费 |
| 模型身份命名 | UUID 迁移后 `applicationModelId`、`vendorModelId`（表单字段装 UUID）等旧名残留 |
| Desktop IPC | Mobile 一行 `runtime.xxx()` 对应 Desktop 6 跳 invoke + ~100 个同质 client 封装 |

部分复杂度属**平台约束**（Electron 沙箱、RN 流式性能缓冲），本迭代**不追求消灭全部间接层**，而是：

1. 收敛**可合并的历史叠层**；
2. 对**必须保留的间接层**给出分层契约与验收，避免继续膨胀；
3. 与已有迭代**分工明确**，不重复已立项或已合并的整改。

**与 sibling 迭代关系**：

- `agent-run-lifecycle-unify`：已统一三信号**行为语义**（runId、终止体感、stream tail）；本迭代在其之上推进**结构收敛**（递减单点、消费方单源）。
- `chat-user-vfs-turn`：已加固 execute 回滚与 flush 事务；本迭代承接其**显式排除**的 trailing user reorder 编排简化。
- `codebase-audit-remediation`：ChatTab **行数**拆分、agent-run 薄提取、CI 等；本迭代补充 **props 贯通与状态源统一**，并接管 Runner 三轨中 CLI 未收敛部分。
- `core-architecture-style`：quality-backlog **模块内**单源（prompt wire、tool fs 分类等）；本迭代聚焦**跨模块/跨端编排**，不重复其条目。
- `saved-model-identity`、`vfs-tool-error-diagnostics`、`events-config-validation`：分别承担模型数据模型、VFS 错误主战场、EventsConfig DAG 单源；本迭代仅补**命名清债、链路边界文档、验收关闭**。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 降低主路径维护成本 | 维护者修改「Agent 跑一轮」「User VFS 发送前入账」「ChatTab 新增一项对话能力」时，**无需同时改 4+ 个无关模块** 即可完成（以 SPEC 接线图为验收依据） |
| 收敛 Runner 装配 | `createAgentRunner` 装配逻辑**单点定义**；CLI / 事件轨 / 对话轨差异仅通过**显式选项**表达；三轨 magic number（如默认 max steps）**单源** |
| 简化 User VFS 编排 | 在**产品行为不变**前提下，trailing user reorder 与 flush 合并为**可读的单一编排入口**；双端保存 baseline 语义一致（承接 vfs-tool-error-diagnostics 验收） |
| 收口 ChatTab 组合层 | `ChatConversationPanel` 对外 props **≤40**（或等价：对话子树由单一 Provider/Controller 供给）；`agentRunning` 类语义**单一消费契约** documented |
| 清理模型身份命名债 | 表单与公开 API 中**不再用 `vendorModelId` 表示 saved model UUID**；`applicationModelId` 作指针语义在 domain 层清零 |
| 收敛错误与 IPC 表面 | VFS/Tool 错误「LLM / 用户 / IPC」分层**文档化且单测覆盖无缺口**；Desktop IPC 同质 `formatError` **单点**；client/register-handlers 样板**可度量下降**（见验收） |
| 消除跨端重复工具 | `formatCharCount`、`deriveRegexGroupId`、流式指标文案构建等**单点实现**，Mobile/Desktop 无字节级副本 |
| 零用户可见回归 | 全量 `npm test`（core fast + desktop + mobile 相关套件）绿；Chat / VFS / Agent 主流程手工 smoke 与整改前一致 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| **Agent / 工作区用户** | 多轮对话、工作区保存、终止、回滚、流式展示——行为与现网一致，不因结构简化引入新卡顿或双端差异 |
| **Mobile 维护者** | 改批量删、流式横条、会话抽屉、VFS 返回栈时，不必穿透 70+ props 与 10+ hooks 胶水层 |
| **Desktop 维护者** | 新增 IPC 能力时不复制第 N 份 `formatError`；理解哪些 hop 为安全约束、哪些为可合并样板 |
| **CLI 用户** | `nm agent run/continue` 与 App **parity**（含 User VFS flush、模型解析），不再维护独立旁路 |
| **贡献者** | 阅读「Agent 是否在跑」「错误如何展示」时有**单一文档化契约**，而非接线矩阵 |

## 范围

### 包含范围

**A. Runner 装配三轨收敛（P0）**

1. 抽取共享装配工厂，对话轨（`runAgentTurn`）、事件轨（`run-agent` action）、CLI 轨共用。
2. CLI `run`/`continue` **迁入**与 App 相同的高层 turn 管线（或显式标注并测试 parity 差异为零）。
3. 默认步数等 magic number **单源**；新增 runner 依赖时编译期强制单点更新。

**B. User VFS 编排简化（P0）**

4. 在 `chat-user-vfs-turn` 已加固的 execute/flush 之上，简化 `flushPendingUserVfsTurnsWithTrailingUserReorder`：**产品行为不变**（仍防 U-U-A、仍双行 UA、仍 checkpoint），编排可读、可单测。
5. 双端保存 baseline 与错误展示：**关闭** `vfs-tool-error-diagnostics` 剩余验收缺口（含 Desktop 保存失败路径）。

**C. Agent 运行态结构收敛（P0）**

6. 在 `agent-run-lifecycle-unify` 行为验收前提下：`agentActive` 递减**单点或幂等契约可证明**；`ChatTabScreen` 内 `agentRunning` **统一消费源**（区分 `uiStreaming` vs `agentBusy` 时须显式命名并文档化）。
7. Mobile/Desktop `useAgentRunLifecycle`、`agent-run.service` 镜像逻辑 **抽共享**（承接 codebase-audit 未完全收口部分）。

**D. Mobile ChatTab 组合层（P0）**

8. 引入 `ChatTabProvider` 或等价 `useChatTabController`，**消减** `ChatTabScreen → ChatConversationPanel` props drilling。
9. 删除已确认无引用的重复 hook（如 `useChatTabScrollSnapshot` 类死代码）。
10. Overlay / Header 导航态：**减少 effect 镜像**（Header 直接订阅对话 scope 或等价方案）。

**E. 模型身份命名清债（P1）**

11. 在 `saved-model-identity` 数据模型已落地前提下：重命名误导字段（`AgentEditorFormInput.vendorModelId` → `savedModelId` 等）；`resolveApplicationModelId*` 等与 UUID 现实一致的命名；Desktop 模型 pin 反查与 Mobile 对齐（避免 N+1 IPC 轮询）。
12. **不重复** migration、displayName 规则、多预设产品行为。

**F. 错误链路与跨端工具（P1）**

13. 文档化并验收 VFS/Tool 错误四层分工（LLM `content`、用户 Toast、工具卡 `summary`、IPC payload）；补 Core `formatVfsErrorForUser` 等单测缺口。
14. `formatCharCount`、`deriveRegexGroupId`、流式指标文案构建迁入 **Core 或共享包**；删除 hook 内联副本。

**G. Desktop IPC 表面收敛（P2）**

15. **不追求** Renderer 直连 Core（违反沙箱）；目标为：统一 `formatError`、评估 client/register-handlers **代码生成或映射表**以降低同质封装；删除或实现废弃通道 `nm:event-bus`；`agent-event-types` 与 core 事件常量**单源或构建时同步**。
16. `forward-event-bus` **仅负责推送**；run 生命周期副作用迁回 agent-run 编排（与结构收敛一致）。

**H. 委托 sibling 迭代的跟踪项（本 PRD 验收「关闭」而非重写）**

17. `events-config-validation`：DAG 单源、depth 校验——以该 PRD 验收为准，本迭代仅确认合并后无回归。
18. `core-architecture-style` 残余模块债：本迭代不重复 prompt/tool/regex 条目；合并后 grep 验收无回退。

### 不包含范围

- 全量消灭 Electron IPC 多跳（安全模型决定）
- Mobile 流式 32ms/64ms/RAF 缓冲整体拆除（性能专项，除非证明无收益）
- `saved-model-identity` 表结构 / migration / 云同步协议变更
- EventsConfig UI 新增 `endDepth` 编辑、schema v3
- SavedModelSettings / EventsConfig 的 **schema 契约**变更（仅允许文档化与轻量共享层）
- MCP / 插件系统实现
- 全量 inline style、domain repository 一次性迁 infra
- `codebase-audit-remediation` 中 **thinking signature**、**PR CI（M3）** 的实现——若尚未完成，仍由该 PRD 负责；本 PRD 不重复定义其验收条文
- 新用户可见功能

## 核心需求

1. **单点装配**：Agent Runner 的创建与依赖注入只有**一个逻辑源**；CLI、事件触发、聊天发送三条入口差异通过**类型安全的选项**表达，禁止第三份复制粘贴装配块。
2. **可读的 VFS 发送编排**：用户在工作区编辑后发送消息，transcript 入账顺序与 checkpoint 锚点与现网一致，但维护者可在**单一编排函数**（或等价 SPEC 图）中理解全流程，无需跨 5 个模块追踪 Map 传递。
3. **运行态单源消费**：聊天界面对于「是否禁用输入」「是否显示流式横条」「是否允许批量操作」「消息 reload 是否合并」四类决策，有**文档化的信号映射**；禁止同屏混用未命名的布尔/ref。
4. **ChatTab 可局部演进**：新增或修改对话区能力时，改动面限制在**对话子树模块**内；`ChatTabScreen` 行数与 `ChatConversationPanel` props 满足量化上限。
5. **命名与身份一致**：代码层名称与 `saved-model-identity` 数据语义一致；维护者不再依赖「`vendorModelId` 实际装 UUID」类隐性知识。
6. **错误与 IPC 可追踪**：任一用户可见 VFS 失败、任一 LLM `tool_result` 错误、任一 Desktop IPC 错误响应，均可追溯到**同一套分层规则**；无第 N 份独立 unwrap 链。
7. **跨端无重复工具函数**：字符数、token 缩写、流式指标行等展示逻辑**一处实现**；三端仅传参差异。

## 验收标准

### A. Runner 装配

| ID | Given | When | Then |
|----|-------|------|------|
| R1 | 仓库源码 | 统计独立完整的 `createAgentRunner({...})` 手写装配块 | 仅 **1 处**逻辑源（工厂/函数）；其余入口调用该源 |
| R2 | CLI `nm agent run` 与 Mobile 聊天发送 | **同一 session**，且 definition **均来自 `resolveAgentForProject`（项目当前 Agent 配置）**；各跑一轮含 tool 的对话 | transcript 顺序、User VFS pending 行为一致；CLI 无「绕过 flush/reorder」旁路 |
| R2-CLI | CLI `nm agent run`/`continue` 带 `--agent-config` / `--agent-id` / `--prompt-path` | 经 `RunAgentTurnOptions.definitionOverride` 注入 definition，**跳过** `resolveAgentForProject` | transcript 顺序、User VFS pending 行为与同等 `definitionOverride` 调用 `runAgentTurn` 一致；`--save` 写 registry 后行为不变 |
| R2-cont | CLI `nm agent continue` | 按 SPEC「CLI continue 语义表」各场景对照 App | 表内「一致」行通过；**documented exception** 行（`allowAssistantContinue` + `maxStepsOverride: 1`）行为稳定且单测覆盖 |
| R3 | 修改默认 max steps 常量 | 仅改单点定义 | CLI、事件轨、对话轨默认值同步；相关单测绿 |

### B. User VFS 编排

| ID | Given | When | Then |
|----|-------|------|------|
| V1 | 工作区有 pending；用户空续跑 | flush 完成 | 无 U-U-A；末条 user 相对 assistant 顺序与现网基线一致 |
| V2 | flush 任一步失败 | 检查 DB | 无「仅有 action 无 ack」或 pending 与 transcript 长期不一致（与 chat-user-vfs-turn 验收对齐） |
| V3 | Mobile / Desktop 各保存同一文件（无并发写入） | 对比 | 均无 `REPLACE_NOT_FOUND` 误报（`vfs-tool-error-diagnostics` PRD 验收 1–7 关闭） |

### C. Agent 运行态

| ID | Given | When | Then |
|----|-------|------|------|
| L1 | `agent-run-lifecycle-unify` 全部验收 | 回归本迭代 | 原 U1–U8（或当前 spec 表）仍通过 |
| L2 | `ChatTabScreen` 源码 | 审查 `agentRunning` / `uiRunning` / `agentActive` 消费 | 符合 SPEC 发布的**信号映射表**；无未文档化的混用 |
| L3 | Run FINISHED 后 | `ChatComposer` finally 与 stream runtime 均触发 | `agentActive` 不双减；`use-chat-stream-runtime` / composer 集成测绿 |

### D. ChatTab 组合层

| ID | Given | When | Then |
|----|-------|------|------|
| C1 | 合并后 | 统计 `ChatConversationPanel` props 数量 | **≤40**（或 SPEC 定义的等价指标：`ChatTabContextValue` 字段 **≤50**） |
| C2 | Mobile 聊天主流程 | 列表 → 对话 → 流式 → 批量删 → 工作区编辑 → 返回 | 与整改前行为一致；`chat-tab-screen` 集成测 / e2e 无新增失败 |
| C3 | 仓库 | 搜索 `useChatTabScrollSnapshot` | 无引用则文件已删除或合并 |

### E. 模型身份命名

| ID | Given | When | Then |
|----|-------|------|------|
| M1 | Agent 编辑器表单类型 | 审查字段名 | 表示 saved model UUID 的字段名为 `savedModelId`（或等价），**非** `vendorModelId` |
| M2 | `packages/core/src/domain` | 搜索 `applicationModelId` 作持久化指针注释 | 0 处误导性注释；公开函数名与 UUID 语义一致 |
| M3 | Desktop 打开已 pin 模型的 Agent 编辑 | 加载表单 | 无「按 provider 轮询 saved list」的 N+1 IPC；与 Mobile `getSavedById` 行为一致 |

### F. 错误与跨端工具

| ID | Given | When | Then |
|----|-------|------|------|
| E1 | Core 测试 | `npm test` provider/vfs/tool 相关 | `formatVfsErrorForUser` 有单测；`format-tool-output.test.ts` 无回归 |
| E2 | 仓库 | `formatCharCount` / `deriveRegexGroupId` 定义处 | **单点**；Mobile/Desktop hook 无内联副本 |
| E3 | Desktop `src/main/ipc/handlers` | 统计独立 `formatError` 实现 | **≤1** 处生产实现（测试 mock 除外） |

### G. Desktop IPC（P2）

| ID | Given | When | Then |
|----|-------|------|------|
| I1 | 仓库 | 搜索 `nm:event-bus` | 已删除或完整实现；无死通道 |
| I2 | `renderer/ipc/client.ts` + `register-handlers.ts` | 行数或生成器 | 较基线下降 **≥30%** 样板，或 SPEC 记录生成方案 |
| I3 | `forward-event-bus.ts` | 审查职责 | 不含 run refcount 登记；该逻辑位于 agent-run 编排 |

### H. Sibling 关闭确认

| ID | Given | When | Then |
|----|-------|------|------|
| S1 | `events-config-validation` 合并 | 跑 events 相关测试 | 该 PRD 验收全绿 |
| S2 | 全仓 | `npm run test:fast` + desktop test | 绿 |

## 约束与依赖

- **前置依赖**：`agent-run-lifecycle-unify` 行为验收应先于或与本迭代 C 类工作捆绑回归；`chat-user-vfs-turn` 事务加固应先于 VFS 编排简化。
- **并行依赖**：`saved-model-identity`、`vfs-tool-error-diagnostics` 可与本迭代并行，但 E/M 类验收以其实际合并为准。
- **破坏性变更**：允许重命名内部字段与模块路径；**禁止**无 migration 的 DB 指针语义变更。
- **发版**：含 Core 行为变更时需三端同版本验证；CLI 收敛需同步发版说明。
- **文档**：本迭代 SPEC 须产出接线图（Agent 运行态、VFS flush、Runner 装配、错误分层、IPC hop 必要性），PRD 不展开技术细节。

## 非功能需求（业务/体验）

- 整改过程**小步 PR**，每 PR 可独立 `npm test` 绿。
- 任何 refactor PR 不得降低流式首字延迟或明显加重 ChatTab 打开耗时（手工对比基线）。
- 维护者新增能力的默认路径应是「改单点」，而非「复制第三轨」。

## 风险与待确认项

| 风险 | 缓解 |
|------|------|
| ChatTab Context 引入新回归 | 先抽 Controller 再减 props；保留集成测 |
| CLI 收敛暴露历史旁路差异 | 先写 parity 测试再迁入口 |
| User VFS reorder 简化触及 checkpoint 锚点 | 与 chat-user-vfs-turn spec 联合评审；单测覆盖删/挂 user 边界 |
| IPC 代码生成引入类型漂移 | 以 `ipc-types.ts` 为唯一 channel 源；生成物纳入 CI |
| 与 codebase-audit M3（PR CI）重叠 | M3 仍归 audit PRD；本迭代 S2 不替代 CI workflow |
| `agent-run-lifecycle-unify` 未完全合并 | C 类验收以 main 实际状态为准；必要时拆 PR 顺序 |

## 里程碑（建议）

| 阶段 | 内容 | 预估 |
|------|------|------|
| **M1** | Runner 三轨收敛 + CLI parity（A） | 2–3 PR |
| **M2** | User VFS 编排简化 + vfs-tool 验收关闭（B） | 1–2 PR |
| **M3** | Agent 运行态结构 + ChatTab 组合层（C、D） | 2–4 PR |
| **M4** | 命名清债 + 错误/跨端工具（E、F） | 1–2 PR |
| **M5** | Desktop IPC 表面收敛（G）+ sibling 关闭确认（H） | 1–2 PR |

**建议顺序**：M1 → M2 → M3 → M4 → M5；M4 可与 M3 尾端并行。每里程碑独立满足对应验收表。
