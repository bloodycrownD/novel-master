# L5：并发 & 异步

> 角度横扫指导。你是 lens-sweep 子代理，readonly，负责从**并发安全、异步语义、竞态条件**这一个角度扫遍 `packages/core` 全部模块。

## 你的一句话职责

查清这个仓库里**异步操作安不安全、并发场景下会不会竞态、abort/cancel 之后数据对不对**。你关心的是「时间维度上的正确性」——单线程跑对了不代表两个异步操作交错时还对。

## 你的独有抓手

- **竞态条件**：两个异步操作共享状态（DB、内存、文件），交错执行时产生不一致
- **abort 后 partial 结果污染**：用户取消操作后，已经产生的部分结果是否被正确丢弃，还是污染了正常状态
- **Promise 未 await**：调用了 async 函数但忘记 await，错误被吞、执行顺序不可控
- **事件顺序依赖**：代码假设事件按特定顺序到达，但 EventEmitter/observable 不保证顺序
- **stream 背压**：流式处理中消费速度跟不上生产速度，导致缓冲区爆炸或数据丢失
- **AbortController 生命周期**：signal 在操作完成后有没有正确清理，会不会影响后续操作
- **并发控制缺失**：本该串行的操作被并发触发（比如两次 compaction 同时跑）

## 读什么文件

### 核心目标

| 目录 | 为什么看 |
|------|----------|
| `packages/core/src/infra/llm-protocol/` | SSE 流式、abort、partial blocks——并发核心区 |
| `packages/core/src/infra/llm-protocol/logic/` | postSse、stream-partial-blocks、SSE parser |
| `packages/core/src/service/chat/` | chat session 的流式编排 |
| `packages/core/src/service/agent/` | agent 的异步操作编排 |
| `packages/core/src/domain/events/` | 事件总线 |
| `packages/core/src/domain/events-config/` | 事件配置 DAG |
| `packages/core/src/service/events/`、`service/events-config/` | 事件 service |
| `packages/core/src/domain/compaction-conditions/` | compaction 触发——可能并发触发 |
| `packages/core/src/domain/message-checkpoint/` | checkpoint + rollback 的并发安全 |
| `packages/core/src/infra/cloud-sync/` | 云同步——天然涉及并发 |

### grep 模式

```text
# 所有 async 函数
include: "packages/core/src/**/*.ts"
regex: "async\s+(function|\w+\s*\(|\*)"

# 所有 await（特别关注 await 的位置——有没有在循环里 await）
include: "packages/core/src/**/*.ts"
regex: "await\s+"

# AbortController / AbortSignal
include: "packages/core/src/**/*.ts"
regex: "AbortController|AbortSignal|abortSignal|\.signal\b|\.abort\s*\("

# Promise 相关（特别关注 Promise.all 在不该并行的地方并行了）
include: "packages/core/src/**/*.ts"
regex: "Promise\.(all|race|allSettled|any)\s*\("

# 未 await 的 Promise 调用（async 函数调用但前面没有 await）
# 这个需要人工判断，grep 辅助：找 async 函数调用模式
include: "packages/core/src/**/*.ts"
regex: "this\.\w+\([^)]*\)\s*[;\n]"  # 然后人工检查这些方法是否是 async

# EventEmitter / 事件
include: "packages/core/src/**/*.ts"
regex: "EventEmitter|\.emit\s*\(|\.on\s*\(|\.off\s*\(|\.once\s*\("

# 锁 / 互斥 / 队列
include: "packages/core/src/**/*.ts"
regex: "mutex|lock|semaphore|queue|enqueue|dequeue|Mutex|Lock"

# stream / Readable / Writable
include: "packages/core/src/**/*.ts"
regex: "ReadableStream|WritableStream|TransformStream|\.pipe\s*\(|\.pipeTo\s*\("
```

## 相关 Iterations

**高优先（必读）：**
- `mobile-llm-streaming` — RN 端 SSE 流式，核心并发场景
- `mobile-sse-stream-resilience` — SSE 流韧性（断线重连、错误恢复）
- `llm-protocol-anthropic-gemini-parity` — 三协议流式 parity
- `event-bus-compaction-conditions` — 事件总线驱动 compaction
- `event-config-dag` — 事件配置 DAG（事件依赖顺序）
- `chat-tool-turn-phase-ui` — tool turn 阶段（涉及异步状态机）

**中优先（扫读）：**
- `mobile-stream-display-pacing` — 流式显示节奏控制
- `mobile-stream-end-flicker` — 流结束时的闪烁（可能是竞态导致的 UI 不一致）
- `mobile-stream-tail-waiting-ui` — 流尾部等待 UI
- `mobile-stream-text-path-fix` — 流文本路径修复
- `agent-stream-tool-ux` — agent 流式 + tool UX
- `cross-device-cloud-sync` — 云同步并发
- `chat-send-render-refactor` — 发送/渲染重构（可能涉及竞态）

## 典型问题清单 & 检查手法

### 1. abort 后 partial 结果污染
**怎么查**：在 `infra/llm-protocol/logic/` 找 `buildStreamPartialBlocks` 和相关的 abort 处理。追踪：
- abort 触发时，已经接收的 partial blocks 去哪了？
- 是被正确丢弃，还是被写入 DB / 更新了 UI 状态？
- abort 之后如果有「完成」回调，它会不会把 partial 当成完整结果处理？

**判定标准**：partial 结果污染了持久化状态，标 A；只污染 UI 状态（可恢复），标 B。

### 2. 竞态条件（共享状态）
**怎么查**：找「多个异步操作访问同一个 repo/service 实例」的场景。重点：
- chat session：用户快速连续发消息时，两个请求的响应交错
- compaction：compaction 进行中用户继续发消息，消息和 compaction 交叉
- vfs 写入：多个 tool 同时写 vfs

**检查模式**：对每个共享状态，问「如果两个操作同时进来，读-改-写之间会不会被对方插入？」

**判定标准**：竞态会导致数据丢失或脏数据，标 A；只导致 UI 闪烁，标 B。

### 3. Promise 未 await
**怎么查**：找 async 函数调用但前面没有 `await` 的情况。特别关注：
- service 层调用 repo 层时漏 await（写入操作静默丢失）
- 事件处理中调用 async 但不 await（错误被吞）

**判定标准**：写入操作未 await，标 A；读取/通知未 await，标 B。

### 4. 并发控制缺失
**怎么查**：找「本该串行但可能并发」的操作：
- compaction：有没有防止两次 compaction 同时运行的锁？
- checkpoint rollback：rollback 进行中能否触发新的 checkpoint？
- vfs 同步：同步过程中能否写入 vfs？

**判定标准**：无并发控制且并发会导致数据损坏，标 A。

### 5. 事件顺序依赖
**怎么查**：在 `domain/events/` 和 `service/events/` 找事件处理逻辑。检查：
- 事件处理器是否假设「A 事件一定在 B 事件之前到达」？
- 如果事件顺序被打乱（EventEmitter 不保证跨 emit 的顺序），会怎样？
- 事件配置 DAG（event-config-dag）里如果有环或顺序依赖，是否正确处理？

**判定标准**：顺序依赖但无保证机制，标 A。

### 6. SSE 流的背压和缓冲
**怎么查**：读 `postSse` 实现（Node 和 RN 两个版本）。检查：
- 如果消费端处理慢，缓冲区会不会无限增长？
- 网络断开时，缓冲中的数据怎么处理？
- 多个 SSE 流同时进行时，是否互相影响？

**判定标准**：有缓冲区爆炸风险，标 A。

## 与其他角度的潜在冲突

| 对方角度 | 可能的冲突 | 你的立场 |
|----------|-----------|----------|
| **L1 数据模型** | 你说「并发会脏数据」，L1 可能说「schema 设计合理」 | schema 在单线程下合理不代表并发安全——坚持你的发现，冲突交给 phase3 |
| **L4 错误处理** | 你说「abort 后 partial 污染」，L4 可能说「有 catch 兜底」 | catch 不能解决 partial 已经写入的问题——这是不同层面的问题 |
| **L2 算法** | 你说「这个串行算法太慢」，L2 也注意到了 | 你关心「能不能并行」，L2 关心「复杂度」——如果并行化有竞态风险，你标 A |

## 输出格式

遵守 `CR-LOOP-GUIDE.md` 的文档结构规范。文件路径 `docs/review/phase1-lens/D1-05-concurrency.md`。

在「结论」节，叙述式讲清楚：这个仓库的异步安全整体水平怎么样——有没有系统性的竞态风险？abort 语义是否统一？

**特别要求**：你的报告必须包含一张**异步操作清单**——每个关键异步操作（SSE 流、compaction、checkpoint rollback、cloud-sync），列出：操作名 | 共享状态 | 并发控制 | abort 行为。这张表会被 phase2 和 phase3 反复引用。

在「待交叉的线索」节，标出你最容易和 L1（数据模型）或 L4（错误处理）冲突的点。

## 严重度参考

| 级别 | 场景 |
|------|------|
| **S** | 并发会导致用户数据丢失或永久脏数据（不可恢复） |
| **A** | 竞态条件；abort partial 污染；并发控制缺失；Promise 未 await（写入） |
| **B** | 事件顺序依赖无保证；UI 层面竞态（可恢复）；abort 仅影响 UI |
| **C** | 理论上可能但实际触发条件极窄的竞态 |
