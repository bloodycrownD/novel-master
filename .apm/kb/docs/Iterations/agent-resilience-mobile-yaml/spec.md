# agent-resilience-mobile-yaml 技术规格（SPEC）

> PRD：`.apm/kb/docs/Iterations/agent-resilience-mobile-yaml/prd.md`  
> 代码基线：`packages/core/src/service/agent/impl/agent-runner.ts`、`packages/core/src/service/provider/impl/model-request.service.ts`、`packages/core/src/infra/llm-protocol/impl/*.adapter.ts`、`packages/core/src/service/chat/impl/message.service.ts`、`apps/mobile/src/components/chat/ChatComposer.tsx`、`apps/mobile/src/services/agent-run.service.ts`、`apps/mobile/src/screens/stack/EventsConfigScreen.tsx`、`apps/mobile/src/components/agent/AgentEditorForm.tsx`

## 设计目标

1. 在不做大规模重构前提下，补齐 Agent 运行稳定性护栏（取消、重试、背压、循环检测）。
2. 降低长会话在 Core/Mobile 的内存与时延风险（分页读取替代全量拉取）。
3. 完成 mobile 侧交互与配置迁移能力补齐（运行中终止按钮、恢复型空执行、Agent/Events YAML 导入导出）。

## 总体方案

### 1) 运行中断（Manual Cancel）

- 现状：
  - `AgentRunner.run()` 未接收取消信号（`packages/core/src/service/agent/agent.port.ts`）。
  - `ModelRequestService.request()` 与 adapter `chat()` 未接收 `AbortSignal`（`packages/core/src/service/provider/model-request.port.ts`、`.../model-request.service.ts`）。
  - `ChatComposer` 运行中按钮仅显示 loading，不可触发中断（`apps/mobile/src/components/chat/ChatComposer.tsx`）。
- 方案：
  - 在 `AgentRunOptions`、`ModelRequestOptions`、`LlmChatRequest` 增加 `signal?: AbortSignal`。
  - `DefaultAgentRunner` 在 step 循环和关键 await 点检查取消状态，命中后以受控 stop reason 结束（新增 `cancelled`）。
  - `llm-sse-transport` 已支持 `signal`，将其贯通到 openai/anthropic streaming 与非 streaming fetch。
  - mobile 在 `ChatComposer` 维护当前 run 的 `AbortController`：运行中点击按钮触发 `abort()`。

### 2) 空执行规则（恢复型继续）

- 现状：
  - `runAgentTurn()` 强制 `trimmed !== ''`，否则报“消息不能为空”（`apps/mobile/src/services/agent-run.service.ts`）。
  - `ChatComposer.send()` 输入为空直接 return，发送按钮在运行态之外也被 `!hasModel || running` 控制，不含“最后一条是 user”的分支。
- 方案：
  - 新增 `runAgentTurn(..., options)` 里的 `allowResumeWithoutInput` 语义。
  - 当输入为空时读取当前 session 最后一条消息：
    - 若最后一条 `role === 'user'`：允许继续 run，但不 append 空消息；
    - 否则保持拦截。
  - `ChatComposer` 增加 `canResumeWithoutInput` 状态（由当前消息尾部判断），控制发送按钮是否可用。

### 3) LLM 重试 + 指数退避（可配置）

- 现状：
  - `DefaultModelRequestService.request()` 直接 `adapter.chat()`，无重试（`packages/core/src/service/provider/impl/model-request.service.ts`）。
  - `ProviderError` 只有 `HTTP_ERROR` 等粗粒度，不区分 retryable（`packages/core/src/errors/provider-errors.ts`）。
- 方案：
  - 新增 `ModelRetryPolicy`（例如：`maxRetries`、`baseDelayMs`、`maxDelayMs`、`jitter`）。
  - 新增 `ModelRetryPolicyService`（KKV 存储，模块名如 `nm-model-retry`），支持全局配置与读取。
  - 在 `DefaultModelRequestService.request()` 包装 `adapter.chat()`：
    - 可重试条件：429、5xx、网络错误/连接中断、`HTTP_ERROR` 且状态命中策略；
    - 指数退避 + jitter；
    - 对 `AbortError`/显式取消立即退出，不进入重试。
  - mobile 后续可在“模型设置”附近增加重试配置入口（本期至少完成 Core 可配置能力）。

### 4) Streaming 背压治理

- 现状：
  - stream delta 通过 `SimpleEventBus.publish()` 同步分发（`packages/core/src/infra/events/simple-event-bus.ts`）。
  - `ChatComposer` 对每个 delta 执行 `setState(prev + delta)`（`apps/mobile/src/components/chat/ChatComposer.tsx`），慢端可能频繁重渲染。
- 方案：
  - 在 mobile 侧增加 stream buffer 聚合器（按时间片/字符阈值 flush 到 UI），避免每个 token 触发一次 setState。
  - Core 保持同步 event bus，不引入异步总线，减少架构变更；背压主要在消费端实现。
  - 为 stream 缓冲加上最大缓冲阈值与降级策略（超阈值时合并 chunk 或短暂丢弃 thinking-delta）。

### 5) 消息分页

- 现状：
  - `MessageService`/`MessageRepository` 仅有 `listBySession(sessionId)` 全量查询（`packages/core/src/service/chat/message.port.ts`、`.../sqlite-message.repository.ts`）。
  - mobile 列表、prompt 构建、regex channel 全部依赖全量加载（`apps/mobile/src/services/regex-apply-channel.ts`、`session-prompt-input.service.ts`、`ChatTabScreen.tsx`）。
- 方案：
  - 新增仓储与服务接口：
    - `listBySessionPage(sessionId, {limit, cursor?})`
    - `listBySessionTail(sessionId, {limit})`（聊天首屏优先）
  - SQLite 侧新增对应 SQL（按 `seq` 倒序取再反转，或基于 `seq < cursor` 分页）。
  - mobile `MessageList` 首屏先取 tail 页，上拉加载更旧消息。
  - prompt/render 链路本期继续允许全量（避免改动过大），分页能力先落在“展示层”；后续可增“LLM 上下文窗口策略”。

### 6) Doom loop 跨轮检测

- 现状：
  - `assertNoDoomLoopInBlocks(result.blocks)` 只看“当前 assistant 消息内” tool_use（`packages/core/src/domain/agent/logic/doom-loop.ts`、`agent-runner.ts`）。
- 方案：
  - 增加跨轮工具调用轨迹窗口（例如最近 N 次 tool_use 签名）。
  - 在 `AgentRunner` 每轮结束后更新轨迹，并检测模式：
    - 同签名连续重复（保留现逻辑）；
    - 双签名交替（A-B-A-B）；
    - 可配置窗口长度与阈值。
  - 命中时抛 `DOOM_LOOP`（沿用现有错误体系）。

### 7) Mobile YAML 导入/导出（Agent + Events）

- 现状：
  - Agent 编辑与 Events 编辑仅支持 UI 修改/保存，不支持 YAML 导入导出（`AgentEditorForm.tsx`、`EventsConfigScreen.tsx`）。
  - 项目已有 ZIP 导入导出工具链可复用文件选择与权限流程（`apps/mobile/src/services/vfs-zip.service.ts`）。
- 方案：
  - 增加两类 service：
    - `agent-yaml.service.ts`：`exportAgentYaml(agentId)` / `importAgentYaml(yamlText, mode)`；
    - `events-yaml.service.ts`：`exportEventsYaml()` / `importEventsYaml(yamlText)`。
  - Core 侧复用 schema 做 decode/validate，确保 YAML 导入后仍走同一验证路径（agent definition + events schema）。
  - UI：
    - `AgentEditorForm` 增加“导入 YAML / 导出 YAML”操作；
    - `EventsConfigScreen` 增加“导入 YAML / 导出 YAML”操作；
    - 导入前确认覆盖行为，导入失败给出具体错误信息。

## 最终项目结构

```text
packages/core/src/
  domain/agent/
    model/agent-run-result.ts                   # + stopReason: 'cancelled'
  service/agent/
    agent.port.ts                               # + signal
    impl/agent-runner.ts                        # 取消检查 + 跨轮 doom loop
  service/provider/
    model-request.port.ts                       # + signal
    impl/model-request.service.ts               # 重试与指数退避
    model-retry-policy.port.ts                  # 新增（重试策略读取）
    create-model-retry-policy-service.ts        # 新增（factory）
    impl/model-retry-policy.service.ts          # 新增（KKV 持久化实现）
  infra/llm-protocol/
    ports/adapter.port.ts                       # + signal
    impl/openai.adapter.ts                      # 透传 signal
    impl/anthropic.adapter.ts                   # 透传 signal
    impl/gemini.adapter.ts                      # 透传 signal
  service/chat/
    message.port.ts                             # + page/tail 查询接口
    impl/message.service.ts                     # + page/tail 实现
  domain/chat/repositories/
    message.port.ts                             # + page/tail 仓储接口
    impl/sqlite-message.repository.ts           # + 分页 SQL

apps/mobile/src/
  components/chat/ChatComposer.tsx              # 终止 icon + 恢复型空执行按钮规则
  services/agent-run.service.ts                 # 空执行恢复逻辑 + abort signal
  screens/tabs/ChatTabScreen.tsx                # 运行控制与分页加载接线
  services/stream-buffer.service.ts             # 新增：stream 聚合与背压
  services/agent-yaml.service.ts                # 新增
  services/events-yaml.service.ts               # 新增
  components/agent/AgentEditorForm.tsx          # YAML 导入/导出 UI
  screens/stack/EventsConfigScreen.tsx          # YAML 导入/导出 UI
```

## 变更点清单

1. **运行取消链路**：`AgentRunner` -> `ModelRequestService` -> `adapter.chat` 全链路支持 `AbortSignal`。
2. **运行状态机**：`AgentRunResult.stopReason` 增加 `cancelled`（domain 类型：`domain/agent/model/agent-run-result.ts`）。
3. **空执行恢复**：`runAgentTurn` 支持“最后一条是 user 且输入为空”的继续执行。
4. **按钮交互**：`ChatComposer` 运行中发送按钮切换终止 icon，并可点击终止当前 run。
5. **重试策略**：新增可配置重试策略存储与 `request()` 内 retry/backoff 包装。
6. **stream 背压**：mobile 端 stream delta 聚合后再落 UI state。
7. **消息分页接口**：Core message service/repository 增加 page/tail 查询。
8. **会话渲染分页化**：`ChatTabScreen` + `MessageList` 支持上拉加载历史。
9. **跨轮 doom loop**：在 runner 内引入工具调用历史窗口检测。
10. **YAML 导入导出**：Agent 与 Events 两处 UI + service 落地。

## 兼容性与迁移说明

- 对外接口影响：
  - `AgentRunResult.stopReason` 联合类型新增 `cancelled`（需要更新依赖方 switch 分支）。
  - `MessageService` 与 `MessageRepository` 扩展分页方法；原 `listBySession` 保留，确保兼容。
- 数据迁移：
  - 本期仅增查询能力，不改表结构；分页基于现有 `seq` 字段。
- 行为兼容：
  - 原“输入为空不可发送”规则改为条件放开（仅末条 user）。
  - 重试默认值需保守（例如 2 次），避免放大延迟。

## 详细实现步骤

### 阶段 1：Core 运行稳定性基础

1. 扩展 `AgentRunOptions` / `ModelRequestOptions` / `LlmChatRequest` 的 `signal` 字段。
2. 在 `model-request.service.ts` 引入 retry/backoff 执行器（先内联，再抽 service）。
3. adapter 透传 signal；`llm-sse-transport` 调用处接入 signal。
4. `AgentRunner` 增加取消检查与 `cancelled` stop reason。

### 阶段 2：Mobile 交互与恢复路径

1. `ChatComposer` 增加终止按钮态（icon）与点击中断。
2. `runAgentTurn` 支持空输入恢复分支（last user）。
3. `ChatTabScreen` 注入最后一条消息语义与运行控制联动。
4. 添加 stream buffer 聚合器并替换直连 `setStreaming*`。

### 阶段 3：消息分页与跨轮循环检测

1. Core 增加分页仓储/服务接口与 SQL。
2. mobile 首屏 tail 加载 + load more。
3. `doom-loop.ts` 扩展跨轮模式检测，并在 `agent-runner.ts` 接线。

### 阶段 4：YAML 导入导出

1. 实现 Agent/Events YAML service（序列化、解析、校验、错误映射）。
2. 在 `AgentEditorForm` 与 `EventsConfigScreen` 增加导入导出按钮与确认流。
3. 覆盖导入失败、覆盖确认、导出成功提示路径。

## 测试策略

### 单元测试（Core）

- `model-request.service`：
  - 429/5xx/网络错误重试成功；
  - 超过重试上限失败；
  - `AbortSignal` 触发后不继续重试。
- `agent-runner`：
  - 运行中取消返回 `cancelled`；
  - 跨轮 ABAB 模式触发 doom loop；
  - 原有同轮连续重复检测不回归。
- `sqlite-message.repository`：
  - tail/page 查询顺序与 cursor 正确；
  - 与 `listBySession` 结果一致性校验。

### 集成测试（Mobile）

- 运行中发送按钮切换为终止 icon，点击后本次 run 停止。
- 输入为空 + 最后一条为 user：按钮可点且不追加空消息。
- 输入为空 + 最后一条非 user：按钮禁用或点击无效（按 UI 设计）。
- 弱网流式场景下连续 delta 不导致明显卡顿/异常内存增长。
- Agent YAML 与 Events YAML 导入导出成功与错误分支。

## 风险与回滚方案

- **风险：重试导致响应变慢**  
  - 缓解：默认低重试次数 + 最大延迟上限；可配置关闭。
  - 回滚：将重试策略设为 `maxRetries=0`。

- **风险：取消时状态不一致（UI 已停、后台仍写消息）**  
  - 缓解：Runner 内取消检查前置到每轮关键节点；append 前后都检查。
  - 回滚：临时只允许“下一轮前取消”，禁用“轮中取消”。

- **风险：分页改造影响现有展示逻辑**  
  - 缓解：保留 `listBySession`，先在 chat timeline 使用分页，其余路径逐步迁移。
  - 回滚：切回全量加载开关。

- **风险：YAML 导入破坏配置**  
  - 缓解：导入前校验 + 覆盖确认 + 失败不落库。
  - 回滚：保留“恢复默认”与重新导入流程。

---

请先确认这份 SPEC。确认后再进入编码实现阶段。  
