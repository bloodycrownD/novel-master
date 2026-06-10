# Mobile SSE 流式韧性修复 技术规格（SPEC）

> PRD：`.apm/kb/docs/Iterations/mobile-sse-stream-resilience/prd.md`  
> 代码基线：`packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts`、`packages/core/src/service/agent/impl/agent-runner.ts`、`packages/core/src/infra/events/simple-event-bus.ts`、`apps/mobile/src/screens/tabs/ChatTabScreen.tsx`、`apps/mobile/src/components/chat/ChatTranscriptWebView.tsx`、`apps/mobile/src/web/chat-transcript/main.ts`、`.apm/kb/docs/issues/mobile-webview-agent-stream-freeze.md`

## 设计目标

1. **修复 v1.0.2 传输层回归**：消除 `setTimeout(0)` 事件循环风暴、90s stall 误杀、pending 清空致空回复。
2. **RN XHR burst 平滑**：固定 32ms 节奏向下游 `onChunk` 输出，保证 JS 线程每 tick 可处理 UI 事件。
3. **数据完整性**：`onload` 同步 flush，不丢尾部；abort partial 仍由 adapter + `buildStreamPartialBlocks` 负责。
4. **零影响 Desktop/CLI**：仅 `postSseViaXhr` 变更；`postSseViaFetch` 不动。
5. **保留既有 UI 背压**：不回滚 bus 32ms、imperative ref、流式纯文本 tail、`tool_results` snapshot 等 v1.0.2 之前/同期正确优化。

## 总体方案

### 分层职责（参考 SillyTavern / OpenCode 原则）

```text
┌─────────────────────────────────────────────────────────────┐
│ 传输层（Core，本期改动）                                      │
│   postSseViaXhr: XHR onprogress → buffer → 32ms tick → onChunk │
│   postSseViaFetch: 不变（async read 自然让步）                │
├─────────────────────────────────────────────────────────────┤
│ 协议层（Core，Phase 2 改动）                                  │
│   *-sse-parser → LlmStreamEvent → wrapStreamForBus（异步派发）│
├─────────────────────────────────────────────────────────────┤
│ UI 消费层（Mobile，保留）                                     │
│   bus 32ms 合并 → pushStreamDelta / stream-buffer → WebView │
│   streamActiveRef / appendTailRows / tool_results snapshot   │
└─────────────────────────────────────────────────────────────┘
```

**不采用**：独立本地 server、Vercel AI SDK、SillyTavern smooth 打字机、OpenCode 流式 markdown。

### v1.0.2 问题机制（必须删除）

| 机制 | 问题 |
|------|------|
| `setTimeout(0)` + 4KB `emitPendingChunk` 链 | 大 burst 排数百 microtask，霸占 RN 事件循环 |
| `SSE_STALL_MS = 90_000` + 5s 检查 interval | extended thinking 误 abort → 空回复 |
| `onerror`/`onabort` 清空 `pendingText` | 已收未 drain 数据丢失 |
| `onload` → `drainAllPending` 异步链才 resolve | 与 abort 竞态；complete 延迟 |

### 新机制：固定节奏整流器（`SseChunkEmitter`）

```typescript
// packages/core/src/infra/llm-protocol/logic/sse-chunk-emitter.ts（新增）

const DEFAULT_TICK_MS = 32;

export interface SseChunkEmitter {
  /** 追加 XHR 新切片；不调用 onChunk。 */
  append(text: string): void;
  /** onload：停 tick，返回并清空 buffer，调用方同步 onChunk。 */
  flush(): string;
  /** onerror/onabort/signal：停 tick，丢弃未 emit buffer。 */
  dispose(): void;
}

export function createSseChunkEmitter(
  onChunk: (chunk: string) => void,
  options?: { tickMs?: number },
): SseChunkEmitter;
```

**tick 行为**：每 `tickMs`（默认 32）若 buffer 非空，取出**全部**内容一次 `onChunk`，清空 buffer。每 tick 最多一次 `onChunk`，不限制单次 chunk 大小（吞吐量不人为封顶，只平滑 burst 时间分布）。

**`postSseViaXhr` 集成**：

```text
onprogress → deliverNewText()
  → processedLength 推进
  → emitter.append(slice)    // 不 onChunk

onload → emitter.dispose() 的 tick 部分 + deliverNewText()
  → remaining = emitter.flush()
  → if (remaining) onChunk(remaining)   // 同步
  → status 检查 → resolveOnce()

onerror / onabort → emitter.dispose() → rejectOnce()
signal.abort → xhr.abort() → 走 onabort（partial 由上层 adapter 处理）
```

**明确删除**：`MAX_SSE_EMIT_BYTES`、`SSE_STALL_MS`、`pendingText`、`drainTimer`、`stallTimer`、`scheduleDrain`、`drainAllPending`、`lastProgressAt`。

## 现状与约束（代码探索）

| 模块 | 现状 | 本迭代 |
|------|------|--------|
| `llm-sse-transport.ts` | v1.0.2 `setTimeout(0)` drain + 90s stall | **重写 `postSseViaXhr` 内部** |
| `postSseViaFetch` | `await reader.read()` 直通 `onChunk` | **不改** |
| `shouldUseXhrForSse()` | RN 缓存判定 | **不改** |
| `openai/anthropic/gemini.adapter` | 均经 `postSse` | **不改**（自动受益 XHR 修复） |
| `agent-runner.ts` `wrapStreamForBus` | 同步 `bus.publish` | **Phase 2：STREAM_* 改 queueMicrotask** |
| `simple-event-bus.ts` | 同步 publish | **不变**；异步在 wrapStreamForBus 层 |
| `ChatTabScreen.tsx` | bus 32ms `setTimeout` 合并 | **保留** |
| `ChatTranscriptWebView.tsx` | imperative `pushStreamDelta`、`streamActiveRef` | **保留** |
| `main.ts` `appendStreamDelta` | 流式 `escapeHtml` 增量，richText 不 markdown | **保留** |
| Desktop `forward-event-bus.ts` | main → renderer IPC | **不涉及** |
| `mobile-webview-agent-stream-freeze.md` | 记载 v1.0.2 drain 为修复 | **更新**为 setInterval 整流 |

### 线程模型约束

- **Mobile**：core + UI 同 RN JS 线程；传输层整流减少 `onChunk` 频率；UI 层 bus 32ms 二次合并；**不足以用拆 server 解决**。
- **Desktop**：core 在 Electron main，renderer 经 IPC 收薄事件；fetch 路径无需传输整流。

## 最终项目结构

无新包。Core 新增 1 个小模块 + 测试扩展：

```text
packages/core/src/infra/llm-protocol/logic/
  llm-sse-transport.ts          # 修改：postSseViaXhr 使用 SseChunkEmitter
  sse-chunk-emitter.ts          # 新增：32ms 固定节奏整流器

packages/core/test/infra/llm-protocol/
  llm-sse-transport.test.ts     # 扩展：burst / flush / no-stall
  sse-chunk-emitter.test.ts     # 新增：emitter 单测（可选与 transport 合并）

.apm/kb/docs/issues/
  mobile-webview-agent-stream-freeze.md   # 更新传输层描述

.apm/kb/docs/Iterations/mobile-sse-stream-resilience/
  prd.md
  spec.md
```

**Phase 2（本期必做）**：

```text
packages/core/src/service/agent/impl/agent-runner.ts   # wrapStreamForBus 异步派发
packages/core/test/agent/agent-runner-stream-bus.test.ts  # 新增
```

## 变更点清单

### Core — Phase 1（必做）

#### 1. `sse-chunk-emitter.ts`（新增）

- `createSseChunkEmitter(onChunk, { tickMs?: number })`
- 启动时 `setInterval(tick, tickMs)`
- `append`：字符串拼接 buffer
- tick：`buffer` 非空 → `onChunk(buffer)` → `buffer = ""`
- `flush`：`clearInterval`；返回当前 buffer 并清零；**不**调用 onChunk（由调用方在 onload 统一 emit，避免 double）
- `dispose`：`clearInterval`；`buffer = ""`

**onload 调用顺序**（避免 double emit）：

```typescript
emitter.dispose();           // 停 interval
deliverNewText();            // 最后一段 append
const tail = emitter.flush(); // 取 buffer 不经过 tick
if (tail.length > 0) onChunk(tail);
resolveOnce(...);
```

或 `flush()` 内部停 interval 并返回 buffer；`dispose()` 仅丢弃。实现时二选一，测试覆盖不重复 emit。

#### 2. `llm-sse-transport.ts`（修改）

- `postSseViaXhr`：删除 v1.0.2 drain/stall 全套；接入 `createSseChunkEmitter`
- `deliverNewText`：`emitter.append(chunk)` only
- `onload`：同步 flush + resolve（**无** `drainAllPending`）
- `onerror`/`onabort`：`emitter.dispose()` + reject
- 函数签名、`postSse`、`postSseViaFetch`、`shouldUseXhrForSse` 导出：**不变**

#### 3. `mobile-webview-agent-stream-freeze.md`（更新）

- 「SSE 生产端」行：改为 `32ms setInterval` 整流；删除 stall / setTimeout(0) 描述
- 性能预算表：传输层「每 32ms 最多一次 onChunk」

### Core — Phase 2（本期必做）

#### 4. `wrapStreamForBus` 异步派发

在 `agent-runner.ts` 中，对 `EVENT_AGENT_STREAM_TEXT_DELTA` / `EVENT_AGENT_STREAM_THINKING_DELTA` / `EVENT_AGENT_STREAM_TOOL_USE` 的 `bus.publish`：

```typescript
queueMicrotask(() => bus.publish(...));
```

- `wrapStreamForBus` 内 `userOnStream` 回调与 bus 派发**同序**：先 schedule microtask publish，再同步调用 `userOnStream`（或二者均 microtask，保持一致）
- `STEP_COMMITTED` / `RUN_FINISHED` 等非 STREAM 事件**保持同步** publish（不在本函数内）
- Desktop main 进程收益小，但无害
- **不改为**全量 `AsyncEventBus`，避免影响非 stream 事件与测试面

### Mobile / Desktop — 无代码变更（Phase 1）

现有 UI 优化视为本迭代**依赖项**，验收时一并回归，但不改代码除非 Phase 2 发现仍不足。

## 详细实现步骤

### PR-1：整流器 + XHR 重写（必做）

| 步骤 | 内容 | 验证 |
|------|------|------|
| 1.1 | 新增 `sse-chunk-emitter.ts` + 单测 | `npm test -w @novel-master/core -- sse-chunk-emitter` |
| 1.2 | 重写 `postSseViaXhr` 接入 emitter | 编译通过 |
| 1.3 | 扩展 `llm-sse-transport.test.ts` | TRANS-02 回归 + 新用例 |
| 1.4 | 更新 issue 文档 | 人工审阅 |
| 1.5 | Android 手工验收 | 见测试策略 T-M1～T-M5 |

### PR-2：异步 stream bus（本期与 PR-1 同批交付）

| 步骤 | 内容 | 验证 |
|------|------|------|
| 2.1 | `wrapStreamForBus` 对 STREAM_* 使用 `queueMicrotask` | `agent-runner-stream-bus.test.ts` |
| 2.2 | Android 多轮 tool 全量回归 | 无退化 |

### 发布

- 版本 tag：`v1.0.3`（或下一 patch）
- Release workflow 自动构建；Mobile 用户需装新 APK 验证

## 测试策略

### 单元测试（Core）

| ID | 用例 | 文件 |
|----|------|------|
| U-01 | emitter：append 多次后 tick 合并为一次 onChunk | `sse-chunk-emitter.test.ts` |
| U-02 | emitter：flush 返回剩余并清零；dispose 后 tick 不再触发 | 同上 |
| U-03 | TRANS-02 回归：XHR 两次 onprogress 仍交付两段 | `llm-sse-transport.test.ts` |
| U-04 | **burst**：单次 onprogress 追加 100KB，`onChunk` 调用次数 << 字符次数；onload 后拼接等于原文 | `llm-sse-transport.test.ts` |
| U-05 | **onload 完整性**：仅 onload 一次灌入全文，onChunk 累计 === responseText 增量 | 同上 |
| U-06 | **无 stall**：Mock XHR 90s 无 onprogress 后不自动 abort（需 fake timer 或暴露 hook） | 同上 |
| U-07 | TRANS-01/03/03b/04、fetch body null 回归 | 已有 |
| U-08 | signal.abort → xhr.abort → ProviderError abort | 已有或补充 |

**U-06 实现提示**：`setShouldUseXhrForSseOverrideForTests(true)` + Mock XHR `send` 不触发 onprogress；`vi`/`mock.timers` 前进 120s；断言未 reject；若在 `onload` 手动 complete 则正常 resolve。

### 手工验收（Android）

| ID | 步骤 | 期望 |
|----|------|------|
| T-M1 | WebView 引擎，GLM-4.7 或等价，「write a file three times」×5 | 无挂死；`toolPhase` 正常消失；`RUN_FINISHED` |
| T-M2 | 长回答流式 | 正文非空；停止按钮全程可点 |
| T-M3 | 流式中点停止 | 有 partial 内容，非整段空 |
| T-M4 | extended thinking 模型（若有）长静默后继续 | 非空回复；无传输层 90s 中断 |
| T-M5 | richText 开/关 各 1 次 | 流式期纯文本；结束后 snapshot 正常 |

### Desktop / CLI 回归

| ID | 步骤 | 期望 |
|----|------|------|
| T-D1 | Desktop 流式对话 | 与改动前一致 |
| T-C1 | `npm test -w @novel-master/core` llm-protocol 相关 | 全绿 |

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 32ms 整流增加首字延迟（最多 ~32ms） | 可接受；与 UI bus 32ms 同量级 | 调低 `TICK_MS` 为 16（需再测 CPU） |
| onload flush 与 tick  double emit | 单测 U-04/U-05；明确 flush/dispose 语义 | 修 emitter 调用顺序 |
| Phase 2 microtask 导致事件乱序 | 仅 delta 异步；step/finished 保持同步 | 回退 `wrapStreamForBus` |
| 去掉 stall 后真网络挂死无传输层自愈 | 上层 `AbortSignal` + 用户停止；未来可在 agent 层加可选 idle timeout | 不在传输层恢复 stall |
| PR-1 后仍卡顿 | 先查 UI 是否回归 setState 路径；再启用 PR-2 | 分项回滚 |

**回滚顺序**：PR-2（若已合）→ `postSseViaXhr` 恢复 v1.0.1 直通 onChunk（无 drain）→ **不要**回滚到 v1.0.2 drain 版本。

## 兼容性说明

- **API**：`postSse` 签名不变；adapter 无改动。
- **行为**：仅 RN XHR 路径 `onChunk` 时间分布变化（更平滑、更低频）；最终解析结果一致。
- **Desktop/CLI**：`shouldUseXhrForSse() === false`，零差异。
- **与 `agent-resilience-mobile-yaml`**：该 spec 称「Core 保持同步 event bus」——Phase 1 遵守；Phase 2 仅 stream delta 异步，需在本 spec 确认后更新该迭代文档脚注。

## 实现检查清单

- [x] `sse-chunk-emitter.ts` 已实现并单测
- [x] `postSseViaXhr` 已删除 v1.0.2 drain/stall
- [x] `onload` 同步 flush + resolve
- [x] `llm-sse-transport.test.ts` U-04～U-08 通过
- [x] issue 文档已更新
- [ ] Android T-M1～T-M5 通过（待设备验收）
- [ ] Desktop T-D1 通过（待手工回归）
- [x] PR-2 异步 stream bus 已实现并单测
