---
date: 2026-11-09
---

# 流式投影根修 技术规格（SPEC）

## 0. 需求来源、证据与口径

### 0.1 需求来源

用户 2026-11-09 口述（非标准 PRD，`requirement_path` = 用户口述）：

> 根修流式投影，不再打 C/A/B 补丁。流式中的 assistant message 就是消息列表里的最后一条，带 `status: streaming | finished`；snapshot 带完整流式消息（content/thinking/tool 状态）和 `streamId + seq`；delta 带 `streamId + seq`，Web 只应用连续 seq，gap 时接受 snapshot；status 与文本分离，收尾只改 status、不重置文本；可见性恢复就是一次普通 snapshot，不再用 restore 清流；最终 assistant message 与流式消息同一 id，原地转 finished，不重复 append；同批做 nm style / either / log / i18n 清理。

### 0.2 本轮读取的证据

本 spec 依据以下证据包与代码（只读；**本轮未运行 jest / tsc / eslint / build-webview / 真机**）：

| 证据 | 关键结论 |
|---|---|
| `docs/Iterations/chat-streaming-projection/cache/native.md` | `uiRunning/toolInvoking/streamGenerating` 三 prop 同源（`ChatConversationPanel.tsx:216-218`）；`streamingText/streamingThinking` 生产零调用方；正常收尾无 `streamCommit` 生产者；`generating` 只有 true 没有 false；settle 不广播 reset-stream；`streamRow` 与最终 DB 行从不共享 id |
| `docs/Iterations/chat-streaming-projection/cache/web.md` | `state.stream` 与 `state.rows` 是两套数据面；`StreamTail` 是 `RowList` 尾部固定兄弟节点；`applySnapshot` 在 `intent !== 'preserve'` 时清 `state.stream`；`payload.generating` 只能置 true；窗口化/菜单/toolUseId 反查都绕开 stream 行 |
| `docs/Iterations/chat-streaming-projection/cache/gates.md` | jest 基线 257 suites / 2167 tests，当前 2 红（CR3 P0-1/P0-2）；nm style 投影层已有 DEAD/TEST_ONLY 基线；prettier 本机 CRLF 假红；either 在 mobile 不可 import；log 守卫 E6 未落地；i18n 只有 core 是真门禁 |
| `docs/Iterations/chat-streaming-projection/cache/history.md` | 10-05 `coveredWhileForeground` 只解决误重挂；当前工作树的 `restore` 补偿是未提交新增；`state.stream` 的尾巴生命周期与 `stream-display-rewrite` 的「禁止 tail 与 DB 行同时显示同一段文字」不变量；会话切换靠 key 重挂 |
| `docs/Iterations/chat-webview-unify/cr3-fix-spec.md` | P1-1（restore 清正文）、P1-2（0ms defer flaky）、P2-11（ghost 探针提交卫生）是本轮前置；P0-1/P0-2 必须先修绿 |

关键代码证据（行号为当前工作树，HEAD `27534b0f2` + 未提交改动）：

- 宿主：`apps/mobile/src/components/chat/ChatConversationWebView.tsx:165-175,296-297,481-500,502-511,686-726,774,819,885-943,1001-1035,1141-1156,1340-1371,1556-1558,1614-1695`
- Web runtime：`apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts:89-180,204-306,371-444`；`runtime/stream/stream.ts:19-23,159-176,462-466,485-558,560-658`；`runtime/state/state.ts:68-74,97-128`；`ui/render/RowList.tsx:23-80`；`ui/stream/StreamTail.tsx:39-61,111-183`；`runtime/render/row-windowing.ts:52-68,282-321`
- 桥：`apps/mobile/src/components/chat/ChatTranscriptBridge.ts:56-76,94-97,107-197`；`ChatConversationBridge.ts:58,125-136,156-195,238-267`
- 单元：`apps/mobile/src/services/session-stream-unit.ts:198-239,479-503,672-698,756-779,852-885,1168-1215,1226-1253`；`session-stream-unit-manager.service.ts:452-523,846-848,938-966,1449-1457,1788-1820`
- 接线：`apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx:125-126,206-237`；`ChatTabProvider.tsx:245-266,293-322,328-333`；`apps/mobile/src/screens/stack/SubagentSessionScreen.tsx:354-371`；`useInterruptedPartialCommit.ts:40-76`
- core：`packages/core/src/service/chat/impl/message.service.ts:204-220`（每条消息 `randomUUID()`，没有预分配 id）；`packages/core/src/service/agent/impl/agent-runner.ts:724-761,917-930,1101-1110`；`packages/core/src/domain/events/model/event-types.ts:14,58-64`
- 测试：`apps/mobile/__tests__/chat-conversation-webview.test.tsx:660-771,1089-1330,1531-1773`

### 0.3 现状根因（一句话）

流式正文活在 `state.stream`（Web 独立投影），落库消息活在 `state.rows`；两者只在「step 边界的 `reset-stream`」和「非 preserve 快照清 stream」两个偶然时刻对齐。于是：run 收尾只发 `streamToolInvoking{active:false}`（不动正文），最终行落地走 `preserve` 快照（不清 stream），尾巴只能等下一次 step/restore 才消失——这就是 ghost 与 CR3 P1-1 的共同根因（`native.md` §8.1、`web.md` §0/§8）。

---

## 1. 设计目标

### 1.1 目标

1. **单一数据面**：流式中的 assistant message 就是消息列表（`state.rows`）的最后一条；不存在 `state.stream` 第二套正文。
2. **status 与文本分离**：流式行带 `status: 'streaming' | 'finished'`；收尾只翻转 status 与补 `messageId`，不重置 `text/thinking`，不卸载正文 DOM。
3. **快照是唯一真源**：任何一次 `sessionSnapshot` 都携带「截至 `streamId + seq` 的完整流式消息」；Web 收到即原子替换 `rows + checkpoint`。
4. **delta 是增量优化**：delta 带 `streamId + seq`，Web 只应用 `seq === appliedSeq + 1`；重复/过期丢弃，gap 触发 `streamResync` 并等待普通 snapshot。
5. **同一行身份**：流式行从出现到 finished 到 DB 接管，Web 行 `id` 始终是 `streamId`；DB 消息 id 只作为 `messageId` 供菜单/回滚/分叉使用，不重复 append。
6. **可见性恢复 = 普通 snapshot**：`coveredWhileForeground` 只决定「重挂 vs 补一次普通 snapshot」，不再用 `restore` 清流，也不再有 `streamActive` defer 链。
7. **同批清理**：删除死通道/死 API，补 log 守卫，either 审计归零，i18n 文案收口到 core catalog 经 `init` 下发。

### 1.2 不变量（实现与测试都以此为准）

| 编号 | 不变量 |
|---|---|
| I1 | `state.rows` 里最多一条 `status === 'streaming'` 的 assistant 行，且它必须是最后一条 |
| I2 | `state.stream` 不存在；流式正文、思考、tool 状态全部从最后一条流式行派生 |
| I3 | 任意 snapshot 的 `rows` 是完整基线；`stream.seq` 是「本快照已包含到的最后内容序号」 |
| I4 | delta 只在前一条 seq 之上生效；`seq <= applied` 幂等丢弃，`seq > applied + 1` 不应用并请求 resync |
| I5 | `streamId` 在一条 assistant 行的一生内不变；DB 接管只补 `messageId`，不换 `id`、不新增行 |
| I6 | 收尾只改 status；`text/thinking` 只能保持或增长，不允许被 status 消息截短 |
| I7 | 可见性恢复不携带「清流」语义；`restore` 只影响滚动 |
| I8 | 旧 webview 资源（ready 版本 `t1` 或未声明 `streamProjection`）不得进入新协议：立即判失败态，不静默白屏 |

### 1.3 非目标

- 不改 core 的消息 id 生成（`message.service.ts:207` 仍是 `randomUUID()`）；「同一 id」在**投影层**实现，见 §3.3。
- 不做会话切换的 SPA 化；会话切换仍是 `key={chatScrollKey}` 重挂（`ChatConversationPanel.tsx:206-213`、`history.md` §3.4）。
- 不改 `streamBlockCommit` 的块级渲染语义（append-only 增量岛保留），只改它归属的行与 seq。
- 不做 mobile 自有中文文案的全量 i18n（`gates.md` §8.2 G6 明确不在范围）；只收口 webview 转录渲染层文案。
- 不引入 android/ios 以外的分发通道；webview 资源仍随 APK 同包。

---

## 2. 总体方案

### 2.1 数据模型：一行到底

#### 2.1.1 流式行（wire 与 Web 同形）

```ts
type TranscriptRowStatus = 'streaming' | 'finished';

type TranscriptMessageRow = {
  kind: 'message';
  /** 行身份：流式行 = streamId；历史行 = DB message id。 */
  id: string;
  /** DB message id：流式期间缺省，DB 接管后补齐。菜单/回滚/分叉/置位只用它。 */
  messageId?: string;
  role: 'user' | 'assistant';
  hidden: boolean;
  /** 流式起源的行恒有 status；纯历史行没有该字段。 */
  status?: TranscriptRowStatus;
  text: string;
  thinking: string;
  textHtml?: string;
  thinkingHtml?: string;
  tools?: readonly TranscriptToolView[];
  attachments?: readonly TranscriptAttachmentView[];
};
```

- 流式行由宿主 `buildStreamingTranscriptRow()` 生成，`id = streamId`，`status = streaming | finished`。
- DB 接管时由 `applyStreamRowIds()` 把对应 DB 行的 `id` 改写成 `streamId`、补 `messageId = <db id>`、`status = 'finished'`。历史消息不受影响。
- Web 渲染层的 `MessageRow` 类型同步加 `status/messageId`（`apps/mobile/src/web/chat-transcript/webview/runtime/state/state.ts:48-61`）。

#### 2.1.2 单元侧流式记录

`SessionStreamUnit` 内部维护（不暴露原始结构，只暴露投影）：

```ts
/** 进程级单元序号：同一毫秒建两个 unit 也不会撞 streamId。 */
let streamUnitEpoch = 0;

type StreamStepRecord = {
  // 'st:<sessionId>:<unitEpoch>:<ordinal>'；unitEpoch 在单元构造时 ++streamUnitEpoch
  streamId: string;
  status: 'streaming' | 'finished';
  text: string;                     // 物化后的完整正文（冻结后不再变）
  thinking: string;
  tools: readonly TranscriptToolView[];
  messageId: string | null;        // DB 接管后 = 落库 assistant.id
};
```

- `ordinal` 每进入一个新的 assistant step 自增；`assistant` phase 的 `STEP_COMMITTED` 翻转当前记录为 finished，并开下一条 empty streaming 记录。`unitEpoch` 用模块级单调计数器（不是 `startedAtMs`）：同一毫秒内的重启/秒败重试也不会得到相同的 `streamId`；进程重启后 Web 文档也是新基线，跨进程复用 id 无影响。
- 当前 streaming 记录的投影正文/思考取 `materializePartialText()/materializePartialThinking()`（与 writethrough 同源）；冻结时把这两个值抄进 `StreamStepRecord.text/thinking`，之后只读冻结值（`resetPartial` 不会把它清空）。
- `tool_results` phase 的 `STEP_COMMITTED` 只 flush + 清 partial，不轮转 stream（否则会给 tool 执行期凭空造一条 assistant 行）。
- `streamRows` 投影规则（数组，**生成式**，每项一条流式行）：
  ```ts
  streamRows = [
    ...finishedStreams
      .filter(s => s.messageId == null && !s.isEmpty())
      .slice(-32)                    // 旧→新，最多最近 32 条
      .map(toProjection),
    ...(currentStream != null ? [toProjection(currentStream)] : []),
  ];
  // interrupted 单元例外：仅 [interruptedProjection]（partial 非空且未 dismissed），不拼 current
  ```
  1. `finished && messageId == null` 且非空（text/thinking/tools 任一非空）的记录按**旧→新**在前（**step 提交到 DB reload 落地之间，上一轮 finished 行必须继续出现在快照里，否则新 step 的快照会把上一行冲掉**）；最多最近 32 条；
  2. 当前 `streaming` 记录永远在**最后**（I1）；没有则省略；
  3. interrupted 水合单元且 partial 非空、且未被 `clearStreamProjection` 标记 dismissed → 唯一一条 `{streamId: 'st:<sessionId>:interrupted:<settledAtMs>', status:'finished', text:partialText, thinking:partialThinking, tools:[], messageId:null}`；
  4. 其余 → 空数组。
- 宿主 status 翻转直接取 `streamRows` 的最后一条（`streamingRows[streamingRows.length-1]`），不再单独造 `streamingMessage` 字段（P2-3）。
- 投影类型 `SessionStreamMessageProjection`（定义在 `session-stream-unit.ts`）与桥类型 `TranscriptStreamingMessage`（定义在 `ChatTranscriptBridge.ts`）**结构同形但分属两层**：service 不 import component，宿主侧 `buildStreamingRows()` 做结构化映射。`streamRows` 与 `streamRowIds` 都进视图（copy-on-write：内容变化才换新数组/Map，与 `pendingChildrenByTitle` 同款引用稳定契约，`session-stream-unit.ts:219-226`）。

#### 2.1.3 id 一致性的实现边界

core 每条落库消息都生成新 UUID（`message.service.ts:204-220`），宿主无法预知。因此「同一 id」定义为**行身份 id 不变**：

- Web 行 `id = streamId`，从出现到 finished 到 DB 接管都不变；
- DB 行接管时只把 `messageId` 补进来；
- Web 菜单/回滚/分叉/置位发上游时用 `row.messageId ?? row.id`（`menu.ts:235-251`、`menu.ts:182-190`、`rows-click.ts:26-32`）。

DB 接管匹配算法（unit 内，`applyMessages` 之后）：

1. `handleStepCommitted(runId, 'assistant')` 把当前流记录冻结并压入 `pendingAdoptions`，同时记录当时的消息面快照；
2. 随后的 force tail reload 返回新消息面；取 `previous` 中不存在的**新增 assistant** 消息（按 seq 升序）；
3. 与 `pendingAdoptions` 按顺序一一配对，写入 `record.messageId` 与 `streamRowIds: Map<dbMessageId, streamId>`；
4. 新增 assistant 多于 pending（失败路径的 `[生成失败] …` 行）时，多余行不配对，保持 DB id；
5. 新增 assistant 少于 pending（reload 合流/丢行）时，剩余记录保持 `messageId = null`，宿主记 `warn` 并让该行继续以 `streamId` 呈现（下一次快照仍完整）。
6. `streamRowIds` 有界（200 条，超出丢最旧），并在单元被替换时迁移给新单元（`takeWebviewHandles` 同款时机）；单元出表时交接给 idle 视图，见 §5.3。

### 2.2 协议（对话桥 v2 信封 + ready `t2`）

**信封版本不动**：`CONVERSATION_BRIDGE_V = 2`（`ChatConversationBridge.ts:58`），web runtime 仍只认内部 v1（`state.ts:6`，`host-downtranslate.ts` 继续做 v2→v1）。**ready 版本标识从 `t1` 升到 `t2`**，并新增能力位 `streamProjection`（`transcript-capabilities.ts:14,27-32`）。

#### 2.2.1 ready

```ts
{ type:'ready', payload:{
  version: 't2',
  capabilities: ['streamBlockCommit', 'streamProjection'],
  readyState: string,
} }
```

宿主判定（`ChatConversationWebView.tsx:1204-1221` 改造）：

- `v !== 2` → 沿用现状：`stale-ready`，不置 `webReady`（纪律 B）。
- `version !== 't2'` 或 capabilities 不含 `streamProjection` → **立即 `setReadyFailed(true)`**（已知不兼容的 dist，不再等 8s），并打 `bootTimingLog('incompatible transcript dist (ready t1/no streamProjection)')`。
- 两者都满足才置 `webReady`。理由：资源随 APK 同包，t1 只可能来自陈旧的 `webview-dist`/手工安装包；静默白屏比错误页更难查（`ChatConversationWebView.tsx:24-26` 纪律 B 的延伸）。

#### 2.2.2 `sessionSnapshot`（唯一全量真源）

```ts
type ConversationSnapshotPayload = {
  sessionKey: string;
  rows: readonly TranscriptRow[];       // 本片行；流式行只在 stream chunk
  hasMore: boolean;
  generation: number;
  chunkIndex: number;
  chunkTotal: number;
  scrollIntent?: TranscriptScrollIntent;      // 仅末片
  restoreScroll?: TranscriptRestoreScroll;    // 仅末片且 restore
  /** 流式检查点：任一 occurrence 均可携带，最后到达者为准；只在承载该 id 行的片携带（本片 rows 无该 id 时省略）。 */
  stream?: {
    id: string;
    seq: number;
    status: 'streaming' | 'finished';
  };
};
```

- **删除 `generating` 字段**（`native.md` §2.2、`web.md` §2.3 的 R-8 根治）：生成中姿态由流式行的 `status` 表达。
- 有流式行时，`chunkTotal = DB 分片数 + 流式片数`；**额外片只装流式行（可多条：finished-未接管 + 当前 streaming），DB 行不进该片**，并按与 DB 行相同的 256KB 字节预算单独分桶（`snapshot-chunk-bounds.ts:17,29` 的 50 行/256KB 规则扩展到流式行；超预算拆成多个额外片）。末片携带 `stream` 与 `scrollIntent/restoreScroll`；`rows` 是「本片流式行」，不是永远只有一条。**`stream` 只挂在 `rows` 含该 id 的片**；快照开始无流、片间起新流时，本次快照不携带新流的 checkpoint（新流由下一次翻转/普通快照建立 checkpoint），不允许把 cp 挂到不含该行的 DB 片。
- 无流式行时退回现有分片语义（末片带滚动字段）。
- 分片代次/乱序/丢片规则不变（`snapshot.ts:89-180`）。

#### 2.2.3 `streamDelta`（合并原 delta/batch 两条通道）

```ts
type StreamDeltaPayload = {
  streamId: string;
  /** 1 起连续；本条应用后 Web 的 appliedSeq 应等于 seq。 */
  seq: number;
  segments: readonly {kind: 'text' | 'thinking'; delta: string}[];
  /**
   * **全量正文 HTML**（richText 时）：committed 块 + 活跃尾块，永远覆盖到本 seq 的完整文本。
   * row.textHtml / 快照 seed / finished 行重建都用它；不是尾块。
   */
  textHtml?: string;
  thinkingHtml?: string;
  /** 活跃尾块 HTML（块级增量 DOM 专用；非块级/块模式未激活时忽略）。 */
  tailHtml?: string;
  thinkingTailHtml?: string;
  /** 完整 tool 数组快照（仅 tool 状态变化时携带；无变化省略）。 */
  tools?: readonly TranscriptToolView[];
};
```

- `streamId` 必须等于 Web 当前 checkpoint 的 id，否则不应用、请求 resync。
- `seq` 由**宿主组件**在最终 `postToWeb` 时分配（wire 层唯一序号源），不沿用 unit 的 apply 节拍——这样 unit 的 32/64ms 合流、宿主 rAF 合流都不会制造 seq 空洞。
- `segments` 的顺序就是正文/思考的追加顺序；允许 `segments: []` + `tools`（仅 tool 状态变化的一拍），此时也占一个 seq。`textHtml/thinkingHtml` 是**全量**（含已提交块 + 活跃尾块）；`tailHtml/thinkingTailHtml` 才是块级增量 DOM 的活跃尾块 HTML（非块级/未激活时忽略）。
- 删除 `streamBatch` 消息类型（Web 端 `applyStreamBatch` 合并进 `applyStreamDelta`）。宿主句柄不再分 `pushStreamDelta`/`pushStreamBatch`。

#### 2.2.4 `streamBlockCommit`（保留，seq 只做对账）

```ts
type StreamBlockCommitPayload = {
  streamId: string;
  /** 本块提交所对应的 delta seq（不推进 checkpoint；DOM 幂等操作）。 */
  seq: number;
  /** 块身份：`<streamId>:<kind>:<commitOrdinal>`；Web 用已应用集合去重。 */
  blockKey: string;
  kind: 'text' | 'thinking';
  html?: string;
  text: string;
  tailHtml?: string;
  tailText?: string;
};
```

- Web 只在 `streamId` 匹配且 `seq <= appliedSeq` 时应用（内容权威在 delta；块提交只做「已完成块 append + 尾块重置」的 DOM 操作）。这样块提交消息丢失不会制造 gap，snapshot 也能兜底。

#### 2.2.5 `streamStatus`（收尾只改 status）

```ts
type StreamStatusPayload = {
  streamId: string;
  status: 'finished';
  messageId?: string;
  /** DB 接管/收尾时的完整终态行（id 必须等于 streamId，status=finished）；收尾/接管必带，仅防御场景（行已被快照收走）可缺省。 */
  row?: TranscriptRow;
};
```

- 宿主在 `streamingRows` 最后一条的 status 翻为 finished 时发送；`messageId` 与 `row` 在 DB 接管后补发一次（旧 step 的迟到 status 也允许发，Web 按 `data-id` 定位旧行）。
- Web 合并规则（I6）：`text/thinking` 只取「更长」的一份；`tools/attachments` 可覆盖；`textHtml/thinkingHtml` **不单独覆盖**——只有当 `text/thinking` 采用 incoming 时，才连同对应的 `textHtml/thinkingHtml` 成对采用；incoming 更短时保留本地 `text + textHtml`（与 §3.6 的成对规则一致，防 reconcile 按短 html 洗短 body）；`status`/`messageId` 直接写；不触发正文 DOM 卸载。
- 删除 `streamToolInvoking`。

#### 2.2.6 `streamReset`

```ts
type StreamResetPayload = {
  streamIds?: readonly string[];
  /** 宿主分配的快照代次：Web 用它作废在途旧快照，防 reset 后被旧末片整体替换复活。 */
  generation: number;
};
```

- 仅消息操作（rollback/fork）经 `manager.requestStreamReset` 广播（`session-stream-unit-manager.service.ts:846-848`、`useChatTabController.ts:40-44`），以及宿主收掉未被 DB 接管的合成 partial 时使用；`streamIds` 只给出**投影可见（尚未 DB 接管）**的行 id（streaming/finished 均可）；已接管行（`messageId != null`）不进列表，由 `streamRowIds` 映射/快照继续呈现。缺省 = 删除当前最后一条 streaming 行。
- **rollback/fork 必须同时清 unit 投影**：`requestStreamReset` 先调 `unit.clearStreamProjection()`（清 currentStream/finishedStreams/pendingAdoptions/partial），拿到被清掉的**投影可见** streamId 列表后再广播 `{streamIds}`（列表为空时跳过 `streamReset`、只发 force snapshot），并由 manager 立即发一次 `force-snapshot`（清空后的投影）。否则 reloadMessages 后的普通快照会把 `streamRows` 规则 2/3 的 finished partial 又加回来，回滚看起来无效（P0-4）。
- 不再承担 step 边界的清尾职责。

#### 2.2.7 上行 `streamResync`

```ts
{ type:'streamResync', payload:{streamId: string; expectedSeq: number} }
```

- Web 在 gap/未知 streamId/行不存在时发送；宿主收到后 `sendSessionSnapshotNow('preserve')`（普通快照）。
- 加入 `TranscriptToHostMessage` 与 `handleUpstream` 的 switch（`ChatConversationWebView.tsx:1390-1443`）。

#### 2.2.8 `init` 增加 labels

```ts
type TranscriptLabels = {
  generating: string;     // label.transcript.generating
  thinking: string;       // label.transcript.thinking_header
  empty: string;          // label.transcript.empty
  loadOlder: string;      // label.transcript.load_older
};
// init.payload.labels?: TranscriptLabels
```

- 宿主用 `coreT(...)` 生成（`apps/mobile/src/i18n/core.ts:10-13`），web 存 `state.labels`，缺省保留当前中文常量。
- 不做 webview 运行时 locale 切换；未来切换只需重发 init/flags。

### 2.3 时序（关键路径）

#### 2.3.1 run 开始 / 第一个 delta

1. `startRun` → unit `begin()` → `startStream()`（ordinal 0，空 streaming 记录）→ `notifyChanged`。
2. Provider 更新 `unitView` → Panel 把 `streamingRows` 传给宿主；宿主发现新 `streamId` → 发 `sessionSnapshot('preserve')`（只有流式行也发，覆盖空会话 `wait-empty` 例外）。
3. Web `applySnapshot`：`state.rows = [streamingRow]`、`checkpoint = {id, seq:0, status:'streaming'}`，渲染 waiting-first。
4. 后续 delta：unit 64ms apply → `pushStream` → 宿主 rAF 合并 → `seq=1` 的 `streamDelta`；Web 校验连续后追加正文并递增 checkpoint。

#### 2.3.2 assistant step 提交（不重置文本）

1. core append assistant 行并 publish `STEP_COMMITTED{phase:'assistant'}`（`agent-runner.ts:724-761`）。
2. manager `onStepCommitted` 把 phase 传给 unit；unit 先 `flushStreamBuffers()`，再把当前记录冻结成 finished（保存完整 text/thinking/tools），`resetPartial()`，然后 `startNextStream()`（ordinal+1，空 streaming）并立即 `kickTailReloadQuietly()`。
3. `notifyChanged` → Panel 更新 `streamingRows`（旧记录 finished 或新记录 streaming）。
4. 宿主 effect：
   - 旧 id 状态翻 finished：先 `flushPendingStreamNow()`（把 rAF 队列的尾 delta 全部按 seq 发完），再 `finishStream(id)` 发**带全量 row** 的 `streamStatus{streamId, status:'finished', row}`。**文本保持**。
   - 新 id 出现：发 `sessionSnapshot('preserve')` 添加新的空流式行（同时把上一轮的 DB 行按映射带入）。
5. force tail reload 落地 → unit 把新增 assistant 与 `pendingAdoptions` 配对 → `streamRowIds` 写入 → `notifyChanged`。
6. `planMessagesUpdate` 命中 `stream-adopted`（§2.3.6）→ 宿主对**每一条**配对到的 DB 行构建终态 `row`，逐条发 `streamStatus{streamId, status:'finished', messageId, row}`；Web 原地替换内容（同 id），不 append、不重挂正文。

#### 2.3.3 run 收尾（FINISHED/FAILED）

1. `unit.settle(status)`：先 `flushStreamBuffers()`；当前 streaming 记录非空则冻结为 finished，空则丢弃；`kickTailReloadQuietly()`（`session-stream-unit.ts:479-503` 的新版）。
2. `notifyChanged` → Panel：`streamingRows` 的最后一条变 finished（不再有新的空 streaming 记录），或数组为空（当前记录为空且无历史 finished 待呈现）。
3. 宿主：
   - finished：flush 后 `finishStream` 发 `streamStatus`（**必带全量 row**；已拿到 `messageId` 时一并带）。
   - null：发 `sessionSnapshot('preserve')` 收掉之前可能已渲染的空流式行（空会话 run 立即结束的边角）。
   - **异常收尾兜底（P2-3）**：若投影在单元未 settle 时直接变空（终态事件丢失 / `dispose` 的防御路径），而上一拍是**非空 streaming 且未被接管**，宿主不得静默留行——`previous.id === streamIdRef.current` 时 `finishStream(previous.id)`（保正文，等 DB 行接管）；无法确认内容时 `resetStream([previous.id])`；id 不是当前流时发一次 preserve 快照对账。
4. 不再发 `streamToolInvoking{active:false}`；`generating` 字段不存在。收尾后的「生成中」消失完全由 status 驱动。

#### 2.3.4 可见性恢复

| hidden 时 app 态 | hidden 期间改画推送 | 恢复动作 |
|---|---|---|
| `active`（栈内被盖） | `> 0` | **普通 snapshot**：`sendSessionSnapshotNow('preserve')`（不再 `restore`，不清流） |
| `active` | `0` | 无动作（画面没有改画推送，不存在陈旧） |
| `background`/`inactive`/未知 | `> 0` | 脏重挂：`webReady=false` + `repaintEpoch+1` + `forceSnapshotOnReadyRef=true`（现状保留） |
| 非 active | `0` | 无动作（重挂收益为零；保持现状） |

- `coveredWhileForeground` 只决定「重挂 vs snapshot」；`pushesWhileHidden` 只决定「是否有必要」。
- **计数器口径修正（P2-14）**：`statePushSinceResumeRef` 现在只在恢复可见时清零（host:1352-1354），统计的是「上次恢复以来」，不是 hidden 期间；hidden:true 到达时必须先清零（`visibilityHiddenAppStateRef` 同拍），之后到 visible 的计数才是真正的 `pushesWhileHidden`。否则可见期间的推送会让「hidden 期间零推送」分支永不可达。
- 恢复后的 snapshot 携带流式行及其 status；finished 的 run 自然不再显示「生成中」，不需要 restore 清 `state.stream`。

#### 2.3.5 delta gap / 乱序 / 重放

Web `stream-checkpoint.ts`（新纯模块）判定：

```ts
type StreamCheckpoint = {id: string; seq: number; status: 'streaming' | 'finished'};

function decideStreamDelta(
  cp: StreamCheckpoint | null,
  streamId: string,
  seq: number,
): 'apply' | 'ignore' | 'resync' {
  if (cp == null) return 'resync';
  // 跨流 seq 不可比：旧流在新快照后到达、或新流在旧快照后到达，都交给普通快照对账
  if (cp.id !== streamId) return 'resync';
  if (cp.status === 'finished') return 'ignore';
  if (seq <= cp.seq) return 'ignore';          // 重复/过期
  if (seq === cp.seq + 1) return 'apply';
  return 'resync';                             // gap：不应用，等快照
}
```

- `requestResync(streamId, expectedSeq)`：`state.resyncPending === streamId` 直接 return；`state.resyncSentAt != null && performance.now() - state.resyncSentAt < 100` 也直接 return；否则 `post('streamResync', {streamId, expectedSeq})`，置 `state.resyncPending = streamId; state.resyncSentAt = performance.now()`。snapshot 到达后清 `resyncPending`，但**保留 `resyncSentAt`** 用于 100ms 限流（否则 snapshot 清空后 100ms 内的第二次 gap 会重复发）。
- `resync`：调用 `requestResync`；在 snapshot 到达前对同一 streamId 的 delta 继续忽略（`resyncPending === streamId` 直接 return，不重复请求），避免半截应用。
- snapshot 到达：`checkpoint = mergeCheckpoint(local, payload.stream)`；但若同一 id 的本地 `seq` **严格大于** incoming 原始 seq（快照更旧），走 §3.4.2 的 rewind 分支——保留本地行内容与本地 seq，不取 max、不回落到 incoming 较小 seq；`resyncPending` 清空。
- **gap 恢复必须重绘 streaming body**：snapshot 带来 `seq > 本地 appliedSeq` 的 streaming 行时，`applySnapshot` 之后用 `row.text/thinking/textHtml/thinkingHtml` 一次性重写 `.bubble-body/.thinking-body`（`reseedStreamingRow`），并复位 Web 块级/升级态、把该 streamId 置入 `fullReplaceOnly`；仅改 `state.rows` 不够——`StreamBodyHost.shouldComponentUpdate=false`（`StreamTail.tsx:39-42`）会让漏掉的 delta 永久缺失（P0-2）。
- 重放/幂等：`seq <= cp.seq` 一律丢弃；`streamStatus` 幂等；`streamBlockCommit` 用 `blockKey` 去重（`appliedBlockKeys`，见 §3.5），同一 blockKey 只 append 一次，重复投递不产生重复 DOM。

#### 2.3.6 DB 接管不重复 append

`planMessagesUpdate` 增加输入 `streamRowIds: ReadonlyMap<string, string>`，新增分支：

```ts
type MessagesUpdatePlan = ... | {
  kind: 'stream-adopted';
  adopted: readonly {streamId: string; messageId: string}[];
};
```

- 条件：`grew` 且新增消息中存在命中 `streamRowIds` 的 assistant：
  - 新增消息**全部**命中映射 → `stream-adopted`，携带命中对；
  - 混合新增（还有用户消息/tool_results）→ `force-snapshot`（全量快照会把映射行与普通行一起对账，天然避免重复；不能走 append，因为映射行的 id 已在 rows 中）。
- 宿主收到 `stream-adopted` 后**不发** `appendTailRows`/`sessionSnapshot`；对 `plan.adopted` 的**每一条**命中发 `streamStatus{streamId, status:'finished', messageId, row}`（逐条补 DB id；一次 messages 更新命中 2 条就发 2 条）。混合新增走 force-snapshot，snapshot 的流式片/映射行负责对账。
- 非流式新增（用户消息、tool_results-only）仍走现有 `append`/`force-snapshot`。
- 已删除 `committedIds`/`skip-committed`/`consume-committed`（`chat-conversation-update-plan.ts:122-159` 的 streamCommit 遗产）。

### 2.4 组件职责重划

| 层 | 职责 |
|---|---|
| core | 落库消息（UUID/seq 不变）、`STEP_COMMITTED`、`STREAM_TOOL_USE` 事件 |
| `SessionStreamUnit` | 唯一流式状态机：streamId/seq 之外的正文、thinking、tools、step 轮转、DB 接管映射、interrupted 投影 |
| `SessionStreamUnitManager` | 事件路由、tool-use 订阅、消息面/idle 交接、`streamRowIds` 生命周期、force-snapshot 广播 |
| `ChatConversationWebView` | wire 序号唯一分配者、快照构建（含流式行）、status 翻转、普通快照、rAF 合流 |
| web runtime | `state.rows` 唯一投影、checkpoint 校验、原子 applySnapshot、增量 DOM、滚动 |
| web UI | 行列表按 `rows` 渲染；流式行只是最后一行的一种 `status`，不额外挂兄弟节点 |

---

## 3. Web runtime 设计细节

> 本节是 §5 变更点的行为规格，代码位置在 §5.4 逐文件列出。

### 3.1 删除 `state.stream`

`apps/mobile/src/web/chat-transcript/webview/runtime/state/state.ts`：

- 删除 `StreamState` 类型与 `state.stream` 字段（`:68-74,122-128`）。
- 新增：

```ts
type StreamCheckpoint = {
  id: string;
  seq: number;
  status: 'streaming' | 'finished';
};
type TranscriptState = {
  ...
  /** 当前/最近一条流式行的检查点；null = 没有流式行。 */
  streamCheckpoint: StreamCheckpoint | null;
  /** gap 等待中的 streamId；snapshot 到达后清空。 */
  resyncPending: string | null;
  /** 上一次 requestResync 发出的时间（performance.now）；同一 streamId 100ms 限流，snapshot 后保留。 */
  resyncSentAt: number | null;
  /** 连续异常快照计数；正常快照/不变量通过后清零，连续 3 次停止自动 resync。 */
  snapshotResyncAnomalyCount: number;
  /** 连续异常退避截止（performance.now）；null = 不在退避。 */
  snapshotResyncBackoffUntil: number | null;
  labels: TranscriptLabels;
  /** 快照 seed/gap 恢复后的 streamId：只接受全量 textHtml，忽略 tailHtml/块提交。 */
  fullReplaceOnly: string | null;
  /** 当前 stream 已应用的块 key 集合（重复投递幂等）。 */
  appliedBlockKeys: Set<string>;
  /** 该 streamId 已用富文本 html reseed 过（richText 从关到开时强制重播一次）。 */
  lastStreamHtmlStreamId: string | null;
  /** richText 从开→关时，需要把该 streaming 行的 body 重写为纯文本的 id（P2-3）；仅 !flags.richText 时消费，消费后清空，richText 再开时清空。 */
  plainReseedStreamId: string | null;
  ...
};
```

- 删除死状态 `ready`（`:98,117`，只写不读，`web.md` R-13）；唯一写点 `runtime/boot/boot-transcript.ts:45` 的 `state.ready = true` 同批删除（C17）。
- `MessageRow` 加 `status/messageId`（§2.1.1）。

### 3.2 流式行即最后一行（RowList）

`ui/render/RowList.tsx:23-80`：

- 删除 `hasStream` 与 `<StreamTail key="stream-tail" />` 兄弟节点（`:24-30,73`）。
- `total = state.rows.length`（流式行天然计入；空态 `total === 0`）。
- 窗口/占位/测量全部按 `state.rows.length`，不再有「尾行不计入 total」的双口径；**但贴底时流式行仍在测量窗口内，不能宣称测量陷阱自然消失——按 C19 把流式行排除出 avgSlotPx**。
- 每个 `row.kind === 'message'` 交给 `MessageRow`；流式行由 `MessageRow` 内部按 `row.status != null` 分派到 `StreamingMessageRow` 壳。
- **流式行钉住（块级 DOM 不被窗口卸载）**：
  - 若最后一行 `status === 'streaming'` 且 `win.end === total`，它已在窗口循环里，正常渲染；
  - 若 `win.end < total`（用户上滚，流式行在窗口外），在**下占位之后**单独渲染该行，**必须与窗口循环同一组件类型 `<MessageRow key={row.id} row={row}/>`**（不能直接 `<StreamingMessageRow>`；否则 Preact 按 type 不同卸载重建，body 岛丢失），并把下占位高度改成 `total - win.end - 1` 行（`getRowWindowSpacerHeights` 加 `pinnedTail: boolean` 参数）——流式行的真实高度由 DOM 自己贡献，不被估算重复计算；
  - `measureRowWindow` 仍以「上占位底缘 → 下占位顶缘」为测量区间（`row-windowing.ts:290-306`），窗口外钉住的行在下占位之后，天然不计入 `count = win.end - win.start`，平均槽高不被放大；
  - finished 行不钉（内容静态，窗口外可卸载，重挂时从行数据重建）。

### 3.3 `StreamTail` → `StreamingMessageRow`（同 id、同 DOM 岛屿）

删除 `ui/stream/StreamTail.tsx`，新增 `ui/stream/StreamingMessageRow.tsx`：

- 外层 ``<div className={`row message ${row.hidden ? 'hidden' : ''} stream`} data-id={row.id} data-stream-id={row.id} data-streaming={row.status==='streaming' ? '1' : undefined} data-stream-status={row.status} id={row.status==='streaming' ? 'stream-tail' : undefined}>``。
  - `hidden` 类必须保留：adopted DB 行会永久带 `status:'finished'` 一直走新组件，hidden assistant 行仍要有 `.row.hidden .bubble{opacity:.45}` 的可见提示。
  - `StreamingMessageRow` 的 bubble/正文渲染必须复用 `AssistantBubbleInner` 的等价面（bubble 类、`thinking-body-divided`、`data-text-shell`、内层组件），不能另起一套。外层行类必须含 `assistant`（或把 CSS 选择器扩为 `.row.assistant, .row.stream`，保证 `bubble--fill-width` 生效）；thinking 段复用共享 `ThinkingSection`（标题经 `title` prop 传入），不手搭第二套 section；`data-text-shell` 条件与普通行一致。
  - `#stream-tail` **只挂当前 streaming 行**：runtime 增量路径（`stream.ts:494,580`、`stream-markdown.ts:140`）继续按 id 找目标；finished 行不再占用该 id，避免多 step 后出现重复 id。
  - finished 行的正文校正走 `[data-id="<streamId>"]` / `[data-stream-id]` 查询（`reconcileFinishedStreamingRow`），不依赖 `#stream-tail`。
  - `data-id` 让窗口测量（`row-windowing.ts:314-321`）与行数一致；行在窗口内时计数自然包含它。
  - `data-streaming` / `data-stream-status` 供 e2e 与测试断言。
- 相位判定改为 `getStreamingPhase(row)`（新签名，**在 `row.text/thinking/tools` 变异之前求值**）：
  - `status !== 'streaming'` → `'finished'`（不渲染生成中条）；
  - `status === 'streaming'` 且 `text/thinking/tools` 全空 → `'waiting-first'`：只渲染 row + 生成中点/文案，**不渲染 `.bubble`**（与旧视觉等价）；
  - 其余 → `'streaming-content'`：渲染 bubble；**无论正文是否为空都挂稳定 `.bubble-body` 壳**，`thinking` 有内容时挂 `.thinking-body`，tools 渲染在 text host 之后。这样 `ensureStreamTextBody` 永远命中 Preact 已挂的 body，不会命令式 `appendChild` 出第二个 body（P1-7）。
- 首包建壳规则：`appendStreamDelta` 在 waiting-first/无 `.bubble` 时先物化显示态 + `renderRows()` 建完整壳（bubble + 空 `.bubble-body`），再做后续增量；不允许在 Preact 壳之外用 `ensureStreamTextBody` 先 append。
- 折叠键（P1-6）：
  - streaming 行：thinking section `data-thinking-key="stream:thinking"`、`expanded={true}`（runtime `getStreamThinkingBody` 按它找目标）；tool group 键 `stream:tools:<streamId>`；
  - finished 行：thinkingKey 与 toolGroupKey 都用 `'msg:' + row.id`，分别读 `state.thinkingExpanded/toolGroupExpanded`；窗口卸载重建后展开态保持，且不同 finished 行互不影响。
- 正文/思考 body 仍用 `StreamBodyHost`（`StreamTail.tsx:39-61`）：
  - `shouldComponentUpdate === false` 保护 runtime 增量 DOM；
  - 首次 mount 从 `row.textHtml/text`、`row.thinkingHtml/thinking` 播种（**完整文本/全量 HTML**，不是尾块），所以窗口外卸载后重建不丢内容；
  - `status` 从 streaming 翻 finished 时组件不 remount（同 key = `row.id`），只重渲壳（bar 消失、菜单行出现、折叠键从 stream:* 切到 msg:*）。
  - richText 开→关：`StreamingMessageRow` 看到 `state.plainReseedStreamId === row.id` 时把 body 重置为 `row.text` 纯文本（`sCU=false` 的 body 需要显式写一次），**写入后清空 `state.plainReseedStreamId`**；只在该行 `status === 'streaming'` 且 `!state.flags.richText` 时消费；richText 再开时该字段为空，后续壳重渲不会把全量 html 洗成纯文本。
- 菜单行：`status === 'finished' && messageId != null` 且 `!state.flags.menuDisabled` 时渲染与 `MessageRow` 相同的 `message-menu-row`；streaming 期间与「finished 但尚未 DB 接管」都不渲染（没有 DB id 的菜单动作没有落点；宿主侧 `openMessageMenu` 也有 `uiRunning` 守卫，`ChatConversationWebView.tsx:1300-1313`）。
- `status === 'finished'` 的行仍可被后续 snapshot 更新（DB 工具结果/富文本替换），因为同 id → Preact 复用壳；正文由 runtime 的 `updateStreamBubble` 等价路径一次性校正到 `row.textHtml/text`（见 §3.5）。
- 350ms 轻量升级（`stream-markdown.ts`）与块级 `streamBlockRender` 按 `streamId` 归属；新 streamId 到来时复位（§3.5）。

### 3.4 `applySnapshot`：原子替换 rows + checkpoint

#### 3.4.1 主流程

```ts
export function applySnapshot(payload: SnapshotPayload): void {
  const intent = payload.scrollIntent || 'stick';
  const checkpoint = payload.stream ?? null;
  const scroller = document.getElementById('scroller');
  const wasNearBottom = state.nearBottom;
  const prevOffsetFromBottom = scroller ? offsetFromBottom(scroller) : 0;
  const sessionChanged = !!payload.sessionKey && payload.sessionKey !== state.sessionKey;
  const prevCheckpointId = state.streamCheckpoint?.id;

  // 1) 组装 nextRows + nextCheckpoint（纯函数，便于单测）
  const {rows, checkpoint: nextCheckpoint} = mergeSnapshotRows(
    state.rows,
    state.streamCheckpoint,
    payload.rows || [],
    checkpoint,
  );
  const localAppliedSeq =
    state.streamCheckpoint?.id === nextCheckpoint?.id
      ? state.streamCheckpoint?.seq ?? -1
      : -1;

  // 2) 原子提交：同一同步块内完成，中间不渲染
  state.sessionKey = payload.sessionKey || state.sessionKey;
  state.rows = rows;
  state.streamCheckpoint = nextCheckpoint;
  state.resyncPending = null;
  state.hasMore = !!payload.hasMore;
  state.loadOlderArmed = true;

  // 3) 流式块状态换主：id 变化 → 复位；同 id 但快照带来了更新内容 →
  //    进入 fullReplaceOnly（后续 delta 用全量 textHtml，忽略 tailHtml/块提交）
  const idChanged = prevCheckpointId !== nextCheckpoint?.id;
  const streamingRow = findStreamingRow(rows, nextCheckpoint?.id);
  const richJustEnabled =
    nextCheckpoint?.status === 'streaming' &&
    streamingRow != null &&
    state.flags.richText &&
    !!streamingRow.textHtml &&
    state.lastStreamHtmlStreamId !== nextCheckpoint.id;
  const needsReseed =
    nextCheckpoint?.status === 'streaming' &&
    streamingRow != null &&
    (richJustEnabled ||
      (idChanged
        ? nextCheckpoint.seq > 0 || !!streamingRow.text || !!streamingRow.thinking || (streamingRow.tools?.length ?? 0) > 0
        : nextCheckpoint.seq > localAppliedSeq));
  if (idChanged) {
    clearStreamRichUpgrade();
    resetStreamBlockRenderState();
    state.fullReplaceOnly = null;
    state.appliedBlockKeys = new Set();
  }
  if (needsReseed) {
    state.fullReplaceOnly = nextCheckpoint.id;
    resetStreamBlockRenderState();
    clearStreamRichUpgrade();
  }

  resetRowWindowForSnapshot(state.rows.length, positioning(intent, ...));
  if (sessionChanged) closeContextMenu(false);

  requestAnimationFrame(() => {
    renderRows();
    scheduleMermaidScan();
    // 4) streaming 行 reseed（gap/remount/快照 seed）；finished 行仅签名变化时校正
    if (needsReseed && streamingRow) {
      reseedStreamingRow(streamingRow);
      state.lastStreamHtmlStreamId = nextCheckpoint.id;
    }
    reconcileFinishedStreamingRows();   // 内部按签名跳过未变行，不额外 renderRows
    scrollAfterRender(intent, ...);
  });
}
```

- **删除** `:240-248` 的 `state.stream` 重置；**删除** `:290-292` 的 `payload.generating` → `setStreamToolInvokingDom(true)`。
- `mergeSnapshotRows`（纯函数）用 `mergeCheckpoint`（§3.4.2/C20）：

```ts
function mergeSnapshotRows(localRows, localCp, incomingRows, incomingCp) {
  if (incomingCp == null) return {rows: incomingRows.slice(), checkpoint: null};
  // rewind 必须拿 incoming 的原始 seq 比较，不能先 merge（merge 同 id 取 max 会让 rewind 永假）
  const rewind =
    localCp != null &&
    localCp.id === incomingCp.id &&
    localCp.seq > incomingCp.seq;
  if (rewind) {
    const localRow =
      findRowById(localRows, localCp.id) ?? findRowById(incomingRows, localCp.id);
    if (localRow == null) return {rows: incomingRows.slice(), checkpoint: incomingCp};
    const rows = incomingRows.filter(r => r.id !== localCp.id);
    rows.push(localRow);
    const status =
      localCp.status === 'finished' || incomingCp.status === 'finished'
        ? 'finished'
        : 'streaming';
    return {rows, checkpoint: {...localCp, status}};
  }
  const hasLocalRow = findRowById(localRows, incomingCp.id) != null;
  const nextCp = hasLocalRow ? mergeCheckpoint(localCp, incomingCp) : incomingCp;
  return {rows: incomingRows.slice(), checkpoint: nextCp};
}
```

- `mergeCheckpoint(local, incoming)` 契约（C20）：`incoming == null` → null；`local == null` → incoming；`local.id !== incoming.id` → incoming（新流换主）；同 id → `{id, seq: Math.max(local.seq, incoming.seq), status: local.status === 'finished' || incoming.status === 'finished' ? 'finished' : 'streaming'}`（收尾不可逆）。**只在未命中 rewind 时调用**；rewind 分支保留本地 seq。
- **`reseedStreamingRow(row)`**：按 `data-id` 找行，目标取 `.bubble-body/.thinking-body` 自身（不是 `.stream-active-tail`），用 `row.textHtml/text`、`row.thinkingHtml/thinking` 一次性写入；清掉块级包装；无壳直接 return（壳已由本次 `renderRows` 建好，**不要**在 reseed 里再 `renderRows`）。这是 gap 恢复的唯一 DOM 写入口（P0-2）。
- **`reconcileFinishedStreamingRows()`**：只遍历 `status==='finished'` 的流式起源行，且只处理窗口内命中的 `[data-id]`；维护 `lastStreamRenderSignature: Map<id, {text,thinking,textHtml,thinkingHtml}>`，四个字符串全等直接跳过（长度相同但内容不同的情况也能识别）；无壳直接跳过，**不调用 renderRows**；**只写 `.bubble-body/.thinking-body` 自身，不得经 `streamRenderTarget`（块模式会返回 `.stream-active-tail`，把全量 html 写进尾容器会复制已提交块）**。任何快照（visibility/翻页/回滚）对未变历史行零写入（P1-14）。
- 不变量校验：`nextCheckpoint != null` 但 `rows` 中找不到同 id 的行 → 视为协议异常：`nextCheckpoint = null` 并 `requestResync(id, 0)`，交给下一次普通快照兜底。**但 `applySnapshot` 在同一同步块已清 `resyncPending`，不能在同步块里再 `requestResync`（否则宿主持续发异常快照会形成 快照→resync→快照 的全量分片循环）。改为 `queueMicrotask` 触发，并复用 §2.3.5 的 100ms 限流 + 连续异常退避（1s/5s，连续 3 次停止自动 resync，留日志/错误态）；计数与退避截止写 `state.snapshotResyncAnomalyCount` / `state.snapshotResyncBackoffUntil`（§3.1），正常快照不变量通过时清零，连续 3 次后停止自动 resync，下一次 visibility/force 快照不自动重试。**
- `applySnapshot` 仍然是「一次 renderRows、一次滚动副作用」；分片末片才调用（`snapshot.ts:89-180` 的收集器保留）。
- **实现说明（S12 accepted）**：异常重试实现用 `Promise.resolve().then(...)` + `setTimeout` 代替原生 `queueMicrotask`——目标 WebView（Chromium 58）没有 `queueMicrotask`，语义等价，不要求改回。
- **实现说明（S14 accepted）**：`mergeSnapshotRows`/`mergeRows` 实现为模块内私有纯函数，表驱动断言经 `handleSnapshotPayload` 间接覆盖；不要求为单测单独导出。

#### 3.4.2 为什么还需要 rewind 保护

单线程 + FIFO postMessage 下正常路径不会出现「snapshot 比本地旧」；但分片快照的片间 `yield` 与宿主 rAF 队列、webview 重建、以及旧代次分片可能制造时序窗口。保护规则只做一件事：**同 id 且本地 seq 更大时，绝不把已显示正文回退**。这也是 I3/I4 的实现保障。

### 3.5 增量路径（`stream.ts` 重写）

`runtime/stream/stream.ts` 保留块级增量岛，删除显示态全量累积：

- 删除 `streamDisplayParts` / `materializeStreamDisplay`（`:41-58`）与 `state.stream.text/thinking/textHtml/thinkingHtml` 读写。
- 新增 `applyStreamDelta(payload)`：
  1. `decideStreamDelta(state.streamCheckpoint, payload.streamId, payload.seq)`；
  2. `ignore` → return；`resync` → `requestResync(payload.streamId, state.streamCheckpoint?.seq ?? 0)` + return；**`requestResync` 内部负责 `post('streamResync', …)`、`state.resyncPending` 与 `resyncSentAt` 的 100ms 限流（§2.3.5），这里不要手写 post / resyncPending**；
  3. `apply` → **按 `payload.streamId` 找行（`findRowById`），并校验 `row.status === 'streaming'`**；找不到或非 streaming → `requestResync(payload.streamId, state.streamCheckpoint?.seq ?? 0)` + return（**不推进 checkpoint**；这是 §2.2.7 的「行不存在」触发条件，不能取「最后一条流式行」硬写；同样不手写 post / resyncPending）。**先求 `phase = getStreamingPhase(row)`（在 row.text/tools 变异前）**：
     - `row.text += textDelta` / `row.thinking += thinkingDelta`（行对象原地更新，不触发 renderRows）；
     - `row.textHtml = payload.textHtml ?? row.textHtml`（**全量 html**；plain 时清空，保持 `stream.ts:568-578` 的口径）；`row.thinkingHtml` 同理；
     - `row.tools = payload.tools ?? row.tools`（payload 带 tools 且内容变化时补一次 `renderRows()` 刷工具卡——工具卡在 body 岛外，`StreamBodyHost.shouldComponentUpdate=false` 保证正文不重建；segments 为空时也照此）；
     - **先建壳，且必须在任何 DOM 写入之前（与四态表互斥）**：
       - 若 `#stream-tail` 不存在 → `renderRows() + scheduleStickIfNearBottom()` 后 **return**（建壳一次；显示态已由 row.text 更新，不进入四态表；对齐 `stream.ts:580-596`）；
       - 若 `phase === 'waiting-first'` → `renderRows() + scheduleStickIfNearBottom()` 后 **return**（建壳一次；壳带稳定空 `.bubble-body`，不进入四态表）；
     - 然后才按**四态表（P0-3）**写 DOM：
       | 状态 | DOM 动作 |
       |---|---|
       | plain（`!state.flags.richText`） | **始终 `appendEscapedDelta(delta)` 增量**；禁止任何整段替换；忽略 `textHtml/tailHtml` |
       | rich + `fullReplaceOnly === streamId` | 用 `payload.textHtml/thinkingHtml`（全量）替换 `.bubble-body/.thinking-body`；`textHtml` 缺失时回落 `appendEscapedDelta(delta)`（不整段清空） |
       | rich + 块模式激活（`streamBlockRender.active` 且未被 fullReplaceOnly 标记） | 用 `payload.tailHtml/thinkingTailHtml` 走 `appendStreamDeltaIncremental`（`stream.ts:346-455`），目标 `.stream-active-tail`；tail 缺失按 `appendEscapedDelta(delta)`，**禁止回落全量 html**（会把已提交块复制进尾容器） |
       | rich + 块模式未激活 | 用全量 `textHtml` 替换 body；`textHtml` 缺失回落 `appendEscapedDelta(delta)` |
     - 更新 `state.streamCheckpoint = {id, seq, status:'streaming'}`；
     - `scheduleStickIfNearBottom()`。
- **`state.fullReplaceOnly`**：snapshot seed/gap 恢复后指向该 streamId，直到新 streamId/streamReset 清除；期间 `tailHtml` 与 `streamBlockCommit` 全部忽略，只接受全量 `textHtml`。这样快照之后的块状态与宿主不再错位（P0-2/P0-3）。
- **`appliedBlockKeys: Set<string>`**：`applyStreamBlockCommit` 先查 `payload.blockKey`，已存在直接 return；否则加入集合并 append。新 streamId/reset 时清空（P2-3）。
- `appendStreamDeltaIncremental` / `appendEscapedDelta` / `applyStreamBlockCommit` 的 DOM 逻辑保持；输入从 `state.stream.*` 换成「当前流式行 + 模块级 activeTail 文本」。块模式激活时**任何全量 html 都不得写进 `streamRenderTarget`（尾容器）**；`updateStreamBubble` 回退要么用 `getStreamActiveTailText + 尾块 html`，要么先 `resetStreamBlockRenderState()` 再整 body 全量重写（P1-4）。
- `getStreamActiveTailText(kind)`：
  - 块级模式 → `streamBlockRender.tailTextParts[kind].join('')`（保留）；
  - 非块级 → `currentStreamingRow().text/thinking`（替代 `state.stream`）。
- `streamHasContent()` / `getStreamingPhase(row)` / `shouldRenderStreamingRow(row)` 全部以行为真源（替代 `:159-176`）。
- `setStreamToolInvokingDom` 删除；新增 `applyStreamStatus(payload)`（§3.6）。
- `resetStreamBlockRenderState()` 保留，但在 `streamReset`、新 streamId、`applySnapshot` 换主时调用；**finished 时不调用**，避免清掉已提交块 DOM。

### 3.6 `streamStatus` / `streamReset`

`applyStreamStatus(payload)`：

```ts
const cp = state.streamCheckpoint;
const row = findRowById(payload.streamId);
if (row == null) {
  // 带权威终态（row/messageId）的缺失必须请求普通快照；纯 status 的迟到消息（行已被快照收走）才忽略
  if (payload.row != null || payload.messageId != null || cp == null || cp.id === payload.streamId) {
    requestResync(payload.streamId, cp?.seq ?? 0);
  }
  return;
}
if (payload.row != null) {
  const incoming = payload.row;
  // 校验身份：只接受同 id、message、finished 的终态行，防脏载荷改行身份
  if (incoming.kind === 'message' && incoming.id === payload.streamId && incoming.role === 'assistant' && incoming.status === 'finished') {
    const prevText = typeof row.text === 'string' ? row.text : '';
    const prevThinking = typeof row.thinking === 'string' ? row.thinking : '';
    const inText = typeof incoming.text === 'string' ? incoming.text : '';
    const inThinking = typeof incoming.thinking === 'string' ? incoming.thinking : '';
    const useIncomingText = inText.length >= prevText.length;
    const useIncomingThinking = inThinking.length >= prevThinking.length;
    // 只增不减：正文/思考连同对应 html 成对采用——incoming 更短时保留本地 text 与本地 html，
    // 避免 text 留长、html 换短，随后 reconcile 按短 html 洗短 body（P1-3）
    const text = useIncomingText ? inText : prevText;
    const thinking = useIncomingThinking ? inThinking : prevThinking;
    const textHtml = useIncomingText ? incoming.textHtml : row.textHtml;
    const thinkingHtml = useIncomingThinking ? incoming.thinkingHtml : row.thinkingHtml;
    Object.assign(row, {
      ...incoming,
      id: payload.streamId,
      text,
      thinking,
      textHtml,
      thinkingHtml,
      messageId: incoming.messageId ?? row.messageId,
    });
  }
}
row.status = 'finished';
if (payload.messageId != null) row.messageId = payload.messageId;
// 空行收尾（首字前失败/空 step，且尚未被 DB 接管）：直接移除，避免空 assistant 气泡
if (
  payload.messageId == null &&
  !row.text &&
  !row.thinking &&
  !(row.tools && row.tools.length > 0)
) {
  state.rows = state.rows.filter(r => r.id !== payload.streamId);
  if (cp?.id === payload.streamId) state.streamCheckpoint = null;
  renderRows();
  return;
}
// 只收掉「当前 checkpoint 就是这条」的情况；旧 step 的 status 不动机器，也不清当前流的升级 timer
if (cp?.id === payload.streamId) {
  state.streamCheckpoint = {id: payload.streamId, seq: cp.seq, status: 'finished'};
  clearStreamRichUpgrade();         // 只清当前流的 350ms 升级 timer；旧 step 的迟到 status 不能清掉新 step 的 timer
}
renderRows();                       // 壳重渲：bar 消失/菜单行出现；body host 不更新
reconcileFinishedStreamingRows();   // 签名未变则零写入；无壳跳过，不 renderRows
scheduleStickIfNearBottom();
```

- `reconcileFinishedStreamingRows()` 的写规则见 §3.4：签名未变跳过、无壳跳过、不额外 `renderRows`；只对窗口内 `[data-id]` 命中的 finished 行写 body。
- `applyStreamReset(payload)`：`streamIds != null` 时**严格按列表删除**（空数组 `[]` = 什么都不删，streaming/finished 均按 id 删）；仅 `streamIds === undefined` 才回落删除最后一条 `status === 'streaming'`。删除后若 checkpoint 指向被删行则清空；同时清 `fullReplaceOnly`/`appliedBlockKeys`、复位块级/升级态、`renderRows()`；**由 C23 的 `streamReset` 分支在 `applyStreamReset` 之前调用 `snapshot.ts` 新导出的 `invalidateSnapshotPipeline(payload.generation)` 作废在途分片**（bridge 同时 import snapshot 与 stream，避免 `stream.ts ↔ snapshot.ts` 循环依赖；`applyStreamReset` 本身不 import `snapshot.ts`）；分片收集器对**每个片（含末片）**都做代次判旧（`payload.generation < appliedSnapshotGeneration` 直接丢弃，不再只在 `acc == null` 时判），旧代次末片不会整体替换 rows；宿主随后的 force snapshot 用更大的 generation，不会误伤（P2-8）。补 `{streamIds:[]}` 与「reset 与分片同拍」用例。
- `resetStreamState(streamIds?: readonly string[])`（宿主侧辅助）：清 pending/seq/accum/committed/tools/`streamIdRef`、`streamBlockArmedRef=false`、`streamBlockCommitOrdinalRef=0`，并丢弃这些 id 的 pending segments；`resetStream()` 与 C9#9.5 的合成 partial 清理共用（P2-7）。

### 3.7 滚动

- 三意图语义不变（`snapshot.ts:204-285`）：`stick` 贴底、`restore` 按 `restoreScroll`、`preserve` 按渲染前 `offsetFromBottom`。
- 删除「`restore` 清流」后，可见性恢复统一用 `preserve`：贴底用户贴底（`wasNearBottom` 分支），上滚用户保持距底偏移，不跳底。
- 流式 delta 每次应用后 `scheduleStickIfNearBottom()`（现状 `stream.ts:624` 同款），非贴底用户零移动。
- status 翻 finished / bar 消失导致行高变化时，`applyStreamStatus` 末尾补一次 `scheduleStickIfNearBottom()`；贴底用户不露空档。
- 快照分片期间 `appendTailRows`/`prependPage` 仍由 Web 侧 `pendingChunkActions`（`snapshot.ts:74-78,183-199`）排队重放；流式行靠 checkpoint 保护，不再需要宿主侧 deferred 队列。

### 3.8 菜单 / 工具卡片

- `openContextMenuFromAnchor`（`menu.ts:235-251`）内部 `findMessageRow` 改为匹配 `row.id === id || row.messageId === id`；`state.menu.messageId` 存 `row.messageId ?? row.id`，菜单动作与 `data-message-id` 全部用 DB id。
- `rows-click.ts` 的 toolUseId 反查仍按 `row.id` 遍历 `state.rows`（流式行在 rows 里，工具结果可查）。
- streaming 行不渲染菜单按钮；finished 行渲染。宿主侧 `uiRunning` 守卫保留。

---

## 4. 最终项目结构

```
apps/mobile/
  src/components/chat/
    ChatConversationWebView.tsx                 [改] 宿主：wire seq / 快照 builder / status / 清理
    ChatTranscriptBridge.ts                     [改] 行类型 + 新下行/上行类型；删死面
    ChatConversationBridge.ts                   [改] 快照/下行联合类型；ready t2
    ChatTranscriptWebViewHandle.ts              [改] 3 方法句柄
    transcript-stream-projection.ts             [新] 纯投影：streaming 行 / row id 映射 / DB 接管行
    transcript-labels.ts                        [新] coreT → TranscriptLabels（可单测）
    message-blocks.ts                           [改] 删 stream 行分支
    chat-conversation-update-plan.ts            [改] stream-adopted；删 committed 三态
  src/services/
    session-stream-unit.ts                      [改] 流式 step 记录 / tools / 接管 / 去注入
    session-stream-unit-manager.service.ts      [改] tool-use 订阅 / streamRowIds 交接 / log
    session-stream-webview-adapter.ts           [改] pushStream / reset / force
  src/screens/
    tabs/chat-tab/ChatTabProvider.tsx           [改] 暴露 streamingRows / streamRowIds；去探针
    tabs/chat-tab/ChatConversationPanel.tsx     [改] 传 streamingRows / streamRowIds；去 hook
    tabs/chat-tab/useInterruptedPartialCommit.ts [删]
    stack/SubagentSessionScreen.tsx             [改] 同上；去 hook
  src/services/chat-run-ghost-probe.ts          [删]（CR3 P2-11）
  src/web/chat-transcript/
    transcript-capabilities.ts                  [改] streamProjection / t2
    webview/main.ts                             [不改] ready 版本随常量自动变 t2；labels 走 init 下行
    webview/runtime/state/state.ts              [改] 删 stream/ready / 加 checkpoint/labels/fullReplaceOnly/appliedBlockKeys
    webview/runtime/boot/boot-transcript.ts     [改] 删 state.ready = true（P1-2）
    webview/runtime/bridge.ts                   [改] switch 重写
    webview/runtime/render/snapshot.ts          [改] 原子 rows+checkpoint；删 stream/commit/generating
    webview/runtime/render/row-windowing.ts     [改] total 含流式行；测量口径统一
    webview/runtime/stream/stream.ts            [改] 行派生增量 / status / 块提交
    webview/runtime/stream/stream-markdown.ts   [改] 按 streamId 复位
    webview/runtime/stream/stream-checkpoint.ts [新] 纯 seq 判定
    webview/runtime/menu/menu.ts                [改] messageId 解析
    webview/runtime/render/rows-click.ts        [改] 行 id 查找口径
    webview/ui/render/RowList.tsx               [改] 删 StreamTail 兄弟
    webview/ui/render/MessageRow.tsx            [改] status 分派 + messageId；删 showToolInvoking
    webview/ui/render/AssistantBubble.tsx       [改] 删 showToolInvoking/ToolInvokingBar 死分支
    webview/ui/stream/StreamingMessageRow.tsx   [新] 流式行壳 + StreamBodyHost
    webview/ui/stream/StreamTail.tsx            [删]
    webview/ui/render/ToolInvokingBar.tsx       [改] label prop（不 import state）
    webview/ui/labels.ts                        [新] 默认 labels 与类型（web 侧）
  README.md                                     [改] E2 allowlist：StreamTail→StreamingMessageRow
apps/mobile/__tests__/
    chat-conversation-webview.test.tsx          [改] 重写流式/可见性用例
    chat-transcript-snapshot-after-stream-commit.test.tsx [改] 删 commit 用例/ready t2
    subagent-session-screen-metrics.test.tsx    [改] 删 useInterruptedPartialCommit mock
    chat-transcript-stream-projection.test.tsx  [新] web harness
    transcript-stream-projection.test.ts        [新] 原生纯投影
    stream-checkpoint.test.ts                   [新] seq 判定
    session-stream-unit-*.test.ts               [改] step/tool/接管/去注入
    chat-conversation-update-plan.test.ts       [改] stream-adopted / 删 committed / prepend+adopted
    session-stream-webview-adapter.test.ts      [新] streamId 透传 / reset ids / force
    no-raw-console.test.ts                      [新] 本轮改动文件零裸 console
    raw-console-baseline.test.ts                [新] 全仓 18 文件/36 处（业务 16/30）基线不增长
    transcript-labels.test.ts                   [新] i18n 映射
    helpers/fake-transcript-dom.ts              [新] 最小 DOM harness（不用 jsdom）
test-utils/
    transcript-ready.ts                         [新] t2 + streamProjection 共享 ready fixture
apps/mobile/e2e/                              [deferred] 本轮未交付（详见 §9.3）
    pageobjects/chat-transcript.page.ts          [deferred] 流式行观测方法未落地
    specs/chat.streaming-projection.e2e.ts       [deferred] 流式 e2e 未落地
    scripts/mock-anthropic-provider.mjs          [deferred] 慢流/tool_use 开关未落地
packages/core/src/i18n/
    keys.ts / catalog/zh-CN.yaml / catalog/en-US.yaml / generated-catalog.ts [改] 4 个新 key
```

---

## 5. 文件级变更点

> 编号 C1…C34，Step 引用见 §8。

### 5.1 协议与类型

#### C1 `apps/mobile/src/components/chat/ChatTranscriptBridge.ts`

- `TranscriptRow`（`:56-76`）：`MessageRow` 加 `status?: 'streaming'|'finished'`、`messageId?: string`；`kind:'stream'` 分支**最终删除，但 Step 1 保留，Step 4 与 message-blocks 同批删**（P1-11）。
- `TranscriptStreamState`（`:94-97`）**Step 1 保留，Step 4 删**；`sessionSnapshot.stream` **字段名保留**，类型从旧的 `{text,thinking}` 换成 `{id, seq, status}`（`:115-116` 是旧形状，替换不是删除）。
- `HostToTranscriptMessage`（`:107-197`）：
  - `sessionSnapshot`：`stream` 改新 checkpoint 形状 `{id; seq; status}`；`generating` **Step 1 保留、Step 4 删**（旧宿主仍发送，提前删会让宿主 typecheck 红）；
  - `streamBatch`、`streamCommit`、`streamToolInvoking` **Step 1 保留、Step 4/5 与生产者同批删**；
  - `streamDelta` 改为 §2.2.3 形状；
  - `streamBlockCommit` 加 `streamId/seq/blockKey`；
  - 新增 `streamStatus`；
  - `streamReset` 载荷 `{streamIds?: readonly string[]; generation: number}`；
  - `init` 加 `labels?: TranscriptLabels`。
- `TranscriptToHostMessage`（`:208-269`）：新增 `streamResync`。
- 删除死导出 `encodeHostToTranscript`、`encodeTranscriptToHost`、`decodeHostToTranscript`、`parseScrollSnapshotFromHost`（`:274-319`；全仓零生产消费者，实测 `findstr` 仅定义处）。
- 新增 `TranscriptLabels` 类型与 `TranscriptStreamingMessage` 类型（宿主 props / 行投影的桥层形状）。
- **分步删除（P1-11）**：Step 1 只加新类型/新字段，`streamBatch/streamCommit/streamToolInvoking/generating` 等旧变体保留；Step 4/5 在宿主/Web 生产者切到新消息的同批删除，避免 Step 1 的宿主 typecheck 红。

#### C2 `apps/mobile/src/components/chat/ChatConversationBridge.ts`

- `ConversationSnapshotPayload`（`:125-136`）：加 `stream`；`generating` **Step 1 保留、Step 4 删**（与宿主发送点同批）。
- `ConversationInitPayload`（`:113-122`）：加 `labels?: TranscriptLabels`（类型从 `ChatTranscriptBridge` 引入）。
- `ConversationHostMessage`（`:156-195`）与 C1 同步：`streamBatch`/`streamCommit`/`streamToolInvoking` 按 C1 的分步策略（Step 1 保留、Step 4/5 同批删），加 `streamStatus`，改 `streamDelta/streamReset`。
- `CONVERSATION_BRIDGE_V` 保持 `2`（`:58`）；`CONVERSATION_READY_VERSION` 自动跟着 `TRANSCRIPT_READY_VERSION` 变 `'t2'`（`:65`）。
- `ConversationUpstreamEnvelope`/`handleUpstream` 新增 `streamResync`（宽松 decoder 不校验 v，天然放行）。
- `decodeConversationUpstream`（`:238-267`）保持宽松；`stale-ready` 只判 `v !== 2`；`version/capabilities` 在 `handleReady` 判（C7）。

#### C3 `apps/mobile/src/web/chat-transcript/transcript-capabilities.ts`

- 新增 `TRANSCRIPT_CAPABILITY_STREAM_PROJECTION = 'streamProjection'`（`:14` 旁）。
- `TRANSCRIPT_READY_VERSION` 改 `'t2'`（`:27`）。
- `TRANSCRIPT_CAPABILITIES` 追加新能力（`:30-32`）。

### 5.2 原生 unit / manager

#### C4 `apps/mobile/src/services/session-stream-unit.ts`

- 新增内部 `StreamStepRecord` 与 `currentStream/finishedStreams/pendingAdoptions/streamRowIds/streamOrdinal`。
- `begin()`（`:403-420`）：`startStream()`、`interruptedPartialDismissed=false`；`hydrateFromRunState()`（`:525-556`）后构造 interrupted 记录（不 startStream）。
- `handleStepCommitted(runId, phase)`（`:756-779`）：
  - 先 `flushStreamBuffers()`；
  - `assistant`：冻结当前记录（非空入 `finishedStreams/pendingAdoptions`）→ `resetPartial()` → `startStream()`；
  - `tool_results`：只 `resetPartial()`；
  - **删除** `broadcastControlMessage({type:'reset-stream'})`；
  - 保留 `kickTailReloadQuietly()`。
- `settle(status)`（`:479-503`）：flush 后冻结非空当前记录，空记录丢弃；其余状态机不变。
- 新增 `ingestToolUse(runId, {id,name,input})`：guard `running + runId`；按 `toolUseId` 去重，push `{toolUseId,name,input,status:'pending'}`；**立即向可见句柄推 `{type:'stream-batch', streamId: 当前记录.streamId, segments: [], tools: 当前tools}`**（tools-only delta 的唯一生产者；`applyStreamSegments` 在 segments 为空时早退，不能依赖它），再 `onProjectionChanged`（P1-1）。
- 新增 `clearStreamProjection(): readonly string[]`：清 currentStream/finishedStreams/pendingAdoptions、`resetPartial()`、置 `interruptedPartialDismissed`，返回被清掉的 streamId 列表；**已接管的 `streamRowIds` 保留**（DB 行仍可映射）。
- `SessionStreamUnitControlMessage` 的 `reset-stream` 变体改 `{type:'reset-stream'; streamIds: readonly string[]}`；`force-snapshot` 不变。
- 新增 `getStreamRowIds()` / `inheritStreamRowIds(map)`；map 采用 copy-on-write（内容变化才换新引用）。
- `snapshot()`（`:672-698`）新增 `streamRows`（`readonly SessionStreamMessageProjection[]`）、`streamRowIds` 字段；`partialText/partialThinking` 保留（writethrough 依赖，`manager:1796-1820`）。**`streamRows`/`streamRowIds` 必须 copy-on-write**：内容未变时 `snapshot()` 返回同一数组/Map 引用（内部 `streamRowsValue`/`streamRowIdsValue` 只在内容变化时换新），否则 Provider 每次 64ms `setUnitView` 都会打穿 C8 缓存与宿主 memo（T-SP32）。
- `applyMessages()`（`:1081-1099`）：在消息面变化后执行 §2.1.3 的接管匹配。
- **删除** `injectedValue`、`tryInjectPartialInto`（`:1226-1253`）、`attachWebview` 的注入调用（`:852-858`）、`detachWebview` 的 `injectedValue=false`（`:877-885`）、`SessionStreamUnitStreamPayload` 的 `stream-delta` 变体；`stream-batch` 变体改为 `{type:'stream-batch', streamId: string, segments: readonly StreamWireChunk[], tools?: readonly TranscriptToolView[]}`——`streamId` 由 `applyStreamSegments`/`ingestToolUse` 在推送时从当前 `StreamStepRecord` 取（`flushStreamBuffers` 在 step 轮转前同步执行，保证不跨 step；P0-5）。
- 类型清理：`SessionStreamUnitOptions` / `SessionStreamMessageStore` / `SessionStreamUnitActiveStatus` / `SessionStreamUnitSettledStatus` / `SessionStreamUnitTokenSource` 若仅本文件使用则撤 `export`（gates.md §4.3 的 DEAD 基线）；`SessionStreamUnitStatus` 保留（`SessionStreamUnitView.status` 的声明面）。
- log：5 处裸 `console`（`:442,563,915,1020,1263`）→ `createLogger('chat.stream-unit')`（C31）。

#### C5 `apps/mobile/src/services/session-stream-unit-manager.service.ts`

- 订阅 `EVENT_AGENT_STREAM_TOOL_USE`（`event-types.ts:14,58-64`；当前 manager 未订阅，`452-523`）→ `unit.ingestToolUse(...)`；生效后 `appendWritethroughSnapshot` 不必每次（tool 状态不是持久字段），只 `notifyChanged`。
- `onStepCommitted`（`:1449-1457`）把 `payload.phase` 传给 unit。
- `readMessagesSnapshot`（`:938-966`）与 `IdleMessageView` 增加 `streamRowIds`；`removeUnit`（`:1755-1771`）把单元的 `streamRowIds` 交接给 idle 视图。若有单元且投影消息非空，返回 `snap.streamRowIds`；回落 idle 时返回 idle 的 map。**`IdleMessageViewEntry` 加 `streamRowIds` 后，所有 `idleMessageViews.set` 写入点（hydrate 命中/未命中、`loadIdleOlder` 空/非空、`applyIdleMessages`、tail refresh）都必须保留/合并已有 `streamRowIds`，不能只 set `{messages, hasMoreMessages}`；否则单元出表后任意一次 tail/older 刷新都会丢 map，已接管的 assistant 行回退 DB id → remount/闪动（P1-3）。**
- `startRun` 替换吸收旧单元时（`:1168-1191`）把 `takeWebviewHandles` 同批调用 `inheritStreamRowIds(old.getStreamRowIds())`。
- `requestStreamReset`（`:846-848`）改写（P0-4）：
  1. `const removed = unit.clearStreamProjection()`（含 interrupted partial 清除）；
  2. `unit.broadcastControlMessage({type:'reset-stream', streamIds: removed})`；
  3. `this.notifyChanged()`；**`setTimeout(0)` 后再 `unit.requestForceSnapshot()`**——force-snapshot 经 adapter 同步调宿主 `sendSessionSnapshotNow`，它起手读 `messages/streamingRowsRef` 的 render 闭包（host:764-772）；必须等 Provider 的 `setUnitView` 提交后的下一拍再发，否则「清空后的快照」仍带旧 partial（P1-7）。若单元已移除则跳过；
  4. 若单元 `status === 'interrupted'`，best-effort `runStateStore.settle(...)` 清掉持久 partial，避免进程重启后水合鬼影（`SessionRunStateStore` 只有 upsert/settle，`manager:283,1844-1855`）。
- log：10 处裸 `console`（`:714,1249,1397,1603,1697,1706,1828,1857,1961,1986`）→ `createLogger('chat.stream-manager')`（C31）。
- 删除 `chat-run-ghost-probe` import 与打点（C33）。

#### C6 `apps/mobile/src/services/session-stream-webview-adapter.ts`

- `onStreamPayload`（`:27-34`）：`stream-batch` → `web.pushStream({streamId: typed.streamId, segments: typed.segments, tools: typed.tools})`；`streamId` 原样透传，**禁止**在适配器用「宿主当前 id」猜；删除 `stream-delta` 分支（P0-5）。
- `onControlMessage`（`:35-42`）：`reset-stream` → `web.resetStream(typed.streamIds)`；`force-snapshot` → `web.forceSnapshot()`。
- 载荷收窄用显式类型判定（不用 `as` 双重断言；当前两处 `as` 在 `:28,36`）。新增测试（T-SP21）。

#### C7 `apps/mobile/src/components/chat/ChatTranscriptWebViewHandle.ts`

方法面从 7 → 3（`:21-46`）：

```ts
type ChatTranscriptWebViewHandle = {
  pushStream: (payload: {
    streamId: string;
    segments: readonly StreamWireChunk[];
    tools?: readonly TranscriptToolView[];
  }) => void;
  resetStream: (streamIds?: readonly string[]) => void;
  forceSnapshot: () => void;
};
```

- `finishStream` 不进出口句柄：status 翻转由 `streamingRows` prop 的 effect 驱动，宿主内部函数即可（避免又一次假公开）。
- 删除 `tryCommitStreamTail`、`commitAbortOverlaySnapshot`、`commitSyntheticAssistantRow`（全仓零生产消费者，`native.md` §0.2/§3.1）。
- 所有调用方（`session-stream-webview-adapter`、`ChatTabProvider`、`SubagentSessionScreen`、`useInterruptedPartialCommit`）同步。

### 5.3 原生宿主与屏幕

#### C8 `apps/mobile/src/components/chat/transcript-stream-projection.ts`（新）

纯函数（keep-public + 表驱动测试）：

```ts
// TranscriptStreamingMessage 定义在 ChatTranscriptBridge.ts（C1）；本文件只 import type。

/** unitView → 宿主 props（interrupted/finished 规则见 §2.1.2）。 */
export function buildStreamingRows(unitView: SessionStreamUnitView | null): readonly TranscriptStreamingMessage[];

/** 把 DB 行改写成流式行身份（id=streamId，messageId=db id，status=finished）。 */
export function applyStreamRowIds(
  rows: readonly TranscriptRow[],
  streamRowIds: ReadonlyMap<string, string>,
): TranscriptRow[];

/** 流式行 wire 形状（快照最后一片 / streamStatus.row）。text/thinking 可覆盖（宿主累加器更新更及时）；textHtml/thinkingHtml 用覆盖后的全量文本计算。 */
export function buildStreamingTranscriptRow(
  message: TranscriptStreamingMessage,
  richText: boolean,
  textOverride?: {text: string; thinking: string},
): TranscriptRow;
```

- `buildStreamingTranscriptRow` 的 html 用 `prepareStreamTailHtml(全量text, richText)`；`text` 与 `textHtml` **都是全量**，不是尾块（P0-1）。
- `buildStreamingRows` 对空记录返回 `[]`（避免 empty finished 行）。
- **引用稳定契约（P1-5）**：`buildStreamingRows` 内部按「输入 `unitView.streamRows` 数组引用 + 每项的 `text/thinking/tools` 引用」做模块级缓存；相同输入返回**同一个输出数组**，内容变化才换新数组。`unitView.streamRows` 本身是 copy-on-write（只在内容变化时换引用），因此 metric/usage tick 不会打穿宿主 memo。
- 文件头写明「不 import 宿主组件；纯投影」。

#### C9 `apps/mobile/src/components/chat/ChatConversationWebView.tsx`

这是最大改动面，逐块：

1. **props**（`:162-210`）：
   - 删 `streamingText?`、`streamingThinking?`（`:165-166`）、`toolInvoking?`（`:175`）；
   - 加 `streamingRows?: readonly TranscriptStreamingMessage[]`（copy-on-write 数组，最后一条是当前 streaming 行；前一两条可能是 finished-未接管行）、`streamRowIds?: ReadonlyMap<string, string>`；
   - 保留 `uiRunning`（菜单禁用/planner）。
2. **memo 比较器**（`:221-246`）：删三个旧字段；加 `streamingRows` 引用比较（数组 copy-on-write，text 每拍变才换引用）与 `streamRowIds` 引用比较；保留 keep-local 注记。
3. **派生**（`:296-302`）：删 `streamGenerating` 与 dev 日志；`uiRunning` 仍 `?? agentRunning`。
4. **refs**（`:351-381`）：
   - 删 `prevStreamText/ThinkingRef`、`pendingStreamDeltaSegmentsRef`、`pendingStreamSegmentsRef`（合并为单一 `pendingWireSegmentsRef`）、`streamActiveRef`、`lastStreamCommitIdsRef`；
   - 保留/新增 `streamTextAccumRef/streamThinkingAccumRef`（HTML 生成）、`streamCommitted*PartsRef`、`streamCommitted*HtmlPartsRef`（已提交块的 html 缓存，P2-10）、`streamToolsRef/streamToolsDirtyRef`、`streamWireSeqRef`、`streamIdRef`、`lastStreamIdRef`、`pendingWireSegmentsRef`、`streamRafRef`、`streamBlockArmedRef`、`streamBlockCommitOrdinalRef`（blockKey 序号）、`activeSnapshotGenerationRef`（唯一消费者是 `sendSessionSnapshotNow` 的分片中止检查）、`resyncSentAtRef: Map<string, number>`（streamResync 宿主 100ms 限流）；`deferredSnapshotActionsRef`/`postOrDeferSnapshotPaint`/`enqueueDeferredStreamFlush` 宿主侧全部删除；
   - 新增 `streamingRowsRef`（每次渲染写当前 prop）。**`sendSessionSnapshotNow` 只读 ref，不把 `streamingRows` 放进依赖数组**；否则数组每 64ms 换引用，依赖它的 effect 会被反复触发发快照。
   - 允许宿主因 `streamingRows` 的 text 每 64ms 重渲（ref 需要刷新），但所有 effect 依赖只列最后一行的 `id/status/messageId`（或由这些派生的稳定值），不列 text/thinking 对象。
5. **删除函数**：`clearLocalStreamBuffers`（`:433-446`）、`syncStreamToolInvoking`（`:502-511`）、`postOrDeferSnapshotPaint`/`enqueueDeferredStreamFlush`（`:481-500`；append/prepend 改直发 `postToWeb`，Web 的 `pendingChunkActions` 保序）、`flushPendingStreamDeltas`/`flushPendingStreamBatch`/`queueStreamDelta`/`queueStreamBatch`（`:589-726`）合并为一个 `flushPendingStream()` + `pushStream()`、`sendSessionSnapshot` 的 defer 分支（`:897-943`）、`flushPendingSnapshot`（`:885-895`）、`commitStreamTail`/`tryCommitStreamTail`/`commitAbortOverlaySnapshot`/`commitSyntheticAssistantRow`（`:1001-1135`）、`resetStreamTail`（`:1141-1156`）改为 `resetStream()`；`takeStreamBlockSplits`/`postStreamBlockSplits` 保留，但 `takeStreamBlockSplits` 开头加 `if (!streamBlockArmedRef.current) return []`，输入改从行/累加器取；每次切出完成块时把 `prepareStreamTailHtml(block, true)` 同时 push 进 `streamCommitted*HtmlPartsRef`（与源片段一一对应，P2-10）。
6. **新增函数**：
   - `pushStream({streamId, segments, tools})`：header 校验 `webReady`（`STREAM_PROJECTION_ENABLED=false` 时也早退）；若 `streamId !== streamIdRef.current` → `beginStream(streamId)`；**在入队同一拍把 `segments` 的 text/thinking 追加进 `streamTextAccumRef/streamThinkingAccumRef`（空 segment 跳过；`beginStream` 已用当前行文本播种，之后的 delta 必须自己累加，不能只入队）**；把 segments 入 `pendingWireSegmentsRef`（带 streamId）；`tools` 有值即 `streamToolsRef=tools; streamToolsDirtyRef=true`；`scheduleStreamFlush()`（segments 与 tools 都为空则不排）。
   - `beginStream(streamId)`：**幂等**——`streamIdRef.current === streamId` 直接 return（避免 pushStream 已抢先建流后，effect 再重置累加器丢掉已入队的 delta；若此时 `streamWireSeqRef===0` 但已存在同 id 的旧行，记 warn 并强制快照，防旧 cp.seq 大于 0 导致新 delta 全 ignore）；否则 `flushPendingStreamNow()`（旧流收尾）→ `streamIdRef=lastStreamIdRef=streamId`；`streamWireSeqRef=0`；清 `streamCommitted*PartsRef`、`streamCommitted*HtmlPartsRef`、`streamToolsDirtyRef=false`、`streamBlockCommitOrdinalRef=0`；从 `streamingRowsRef.current` 里找同 id 行：`streamTextAccumRef=row?.text ?? ''`；thinking 同理；`streamToolsRef=row?.tools ?? []`；`streamBlockArmedRef=true`（新 step 重新允许块切分）；复位块级状态（Web 侧由 snapshot 换主复位）。
   - `flushPendingStreamNow()`：取消 rAF；若 segments 为空且 `streamToolsDirtyRef=false` 直接 return；**先 `takeStreamBlockSplits()`（armed 时；它把完成块移入 committed、accum 改成 activeTail）**，再按当前 `streamId` 取出 segments；`seq=++streamWireSeqRef`；**全量 html 用缓存拼接，避免每拍重 parse 已提交块（P2-10）**：`tailHtml = prepareStreamTailHtml(accum, richText)`、`fullTextHtml = committedHtml.join('') + (tailHtml ?? '')`（committedHtml 由 `takeStreamBlockSplits` 时 `prepareStreamTailHtml(block, true)` 后缓存；accum 为空不 parse；超限/空返回 undefined 时该段 html 为空，正文仍由 row.text 保底）；thinking 同理；`postToWeb({type:'streamDelta', payload:{streamId, seq, segments, textHtml: fullTextHtml, thinkingHtml: …, tailHtml, thinkingTailHtml, ...(toolsDirty ? {tools: streamToolsRef.current} : {})}})`；`streamToolsDirtyRef=false`；随后 `postStreamBlockSplits`（每个 commit 的 `blockKey = `${streamId}:${kind}:${++streamBlockCommitOrdinalRef.current}`，带 `streamId, seq`）。
   - `finishStream(streamId)`：先 `flushPendingStreamNow()`（保证尾 delta 的 seq 小于即将发出的 status）；从 `streamingRowsRef.current` 找到该 id 行（旧 step 的 finished-unadopted 行可能在其中）。**若该行不存在**：`streamId !== streamIdRef.current` → 直接 return（正常 adoption 已把旧行从 streamRows 剔除，终态行由 `messages` effect 的 `stream-adopted` 发送；不要用空 text/thinking 造终态 row）；`streamId === streamIdRef.current` → 用「committed + accum 全量」构建 row 并发送（当前流仍在，文本在累加器里，不能静默；这是 settle+adoption 同拍的确定性路径）。找到行时：`streamId === streamIdRef.current` 用「committed + accum 全量」，否则用该行冻结的 `text/thinking`，生成 `row = buildStreamingTranscriptRow(..., {text, thinking})`；`postToWeb({type:'streamStatus', payload:{streamId, status:'finished', row}})`。**必须带全量 row**，不能只发 status——否则 finished 行在 rich 模式会被洗成尾块（P0-1）。
   - `resetStream(streamIds?)`：`resetStreamState(streamIds)`（清 pending/seq/accum/committed/tools、丢弃这些 id 的 pending segments、`streamIdRef=null`）；`postToWeb({type:'streamReset', payload:{streamIds, generation: ++snapshotGenerationCounter}})`（新代次作废在途旧快照）。
7. **快照构建**（`:764-883`）：
   - 开头与流式片前各 `flushPendingStreamNow()`（见 §2.3.4 的重复文本防线）；
   - `generation = ++snapshotGenerationCounter` 并写 `activeSnapshotGenerationRef.current`；每片前校验「代次未变 + webReady」，finally 若仍是本代次则清空（`activeSnapshotGenerationRef` 的唯一消费者）；
   - DB 分片 rows 经 `applyStreamRowIds(rows, STREAM_PROJECTION_ENABLED ? streamRowIds : EMPTY_MAP)`；`sendAppendTailRows`/`sendPrependPage` 同样按开关后过一遍（历史行通常无映射，幂等）；开关关闭时 map 按空处理（P2-4）；
   - **开头捕获 `const streamRowsAtStart = streamingRowsRef.current`**：片间可能发生 DB 接管（`streamRows` 丢掉已接管行），丢掉的那一行在本次快照的 DB 消息里未必存在——用捕获快照保证「不丢行」；下一次快照再按映射对账。
   - 发流式片时按 id 合并「捕获行 + 当前 `streamingRowsRef.current`」（当前覆盖捕获、新 id 追加；顺序按捕获序 + 新 id），确保「快照开始后新 step 启动」也不丢新流式行。
   - `rows = merged.map(msg => buildStreamingTranscriptRow(msg, richText, {text: fullStreamTextFor(msg.id), thinking: fullStreamThinkingFor(msg.id)}))`：当前 streaming 行的 text/thinking 用宿主累加器覆盖——**块级模式下必须是 `streamCommitted*PartsRef.join('') + stream*AccumRef`**，否则快照只带活跃尾块、丢已提交块；`streamBlockArmedRef===false` 时仍按 `committed.join('') + accum` 计算（handleReady 的 seed 会清 committed、accum 置全文；mid-stream 快照 disarm 不清 committed，二者相加仍是全文）；其余行用捕获/当前冻结值。
   - `stream:{id: 最后一条.id, seq: (最后一条.id === streamIdRef.current ? streamWireSeqRef.current : 0), status: 最后一条.status}`；末片滚动字段。`seq` 必须是「该 streamId 自己的 seq」，不能跨流复用全局计数（否则新流 seq 1 会被旧流的较大 seq 判旧）。
   - **快照 seed 后的块状态（P0-3）**：若最后一条是 streaming 且有内容（text/thinking/tools 非空）→ 发完快照后 `streamBlockArmedRef=false`，宿主后续只发全量 `textHtml`；Web 端同快照置 `fullReplaceOnly=id`。若最后一条是空 streaming（新 step，seq 0）→ 保持/重新置 `streamBlockArmedRef=true`，允许块切分。两个端必须同一条规则，不能只在 `handleReady` disarm。
   - 无流式行时沿用当前分片（末片滚动字段）；
   - 删除 `generating`（`:774,819`）与末片后的 `syncStreamToolInvoking()`（`:842`）；
   - `onSnapshotComplete` 保留在末片 post 之后（`:847-859`）；宿主侧 deferred 队列已删，完成信号只会更早、不会更晚——回滚链 `snapshotCompleteSignal.consumeNext(1500)` 语义不变（`history.md` §4.5）；Web 侧的 `pendingChunkActions` 重放仍在 Web 内完成，不需要宿主参与；
   - 依赖数组固定为 `messages/hasMore/sessionKey/flags.richText/uiRunning/streamRowIds/transcriptListOptions/postToWeb/onSnapshotComplete`（`transcriptListOptions` 的 memo 输入含 `agentRunning/pendingSubagentSessions`，快照 builder 实际消费它，漏了会让 pendingSubagentSessions effect 的 `sendSessionSnapshotRef.current` 用旧 sessions 映射），**不含** `streamingRows` 数组（见第 4 条）。
8. **`sendSessionSnapshotNow` 的调用方**全部直发（删 `sendSessionSnapshot` 包装与 `force` 参数）：ready 开屏（`planOpenSnapshot` 的 `hasStreamingMessage = streamingRows.length > 0`）、messages 判路、richText、pendingSubagentSessions、visibility、`forceSnapshotNow`（`sendSessionSnapshotRef.current('preserve')`）。`sendSessionSnapshotRef` 保留，供 `handleUpstream` 的 `streamResync` 使用。
9. **effect 重写**：
   - 删 `streamingText/streamingThinking` 长度游标 effect（`:1666-1695`）；
   - 删 `toolInvoking` effect（`:1556-1558`）；
   - 新增 `streamingRows` effect（取最后一条 `current`；用 `lastStreamSnapshotRef = {id,status,messageId,isEmpty} | null` 记录上一拍；依赖 `streamingRows` 最后一行 id/status/messageId + `streamRowIds` 引用，**一次更新里可能同时发生「旧 id finished + 新 id streaming」**）：
     1. 若旧 id 存在且与当前 id 不同：先 `finishStream(oldId)`（flush + `streamStatus`，旧文本已在冻结记录里）；
     2. 若旧/当前同 id 且 `status` 由 streaming→finished：`finishStream(id)`；
     3. 若 `messageId` 由 null→非 null：**防御分支**——正常 adoption 会让该行从 `streamRows` 消失（规则 2 排除 messageId!=null），终态行由 `messages` effect 的 `stream-adopted` 发送；这里只在「记录尚未被剔除」的竞态下补一次 `streamStatus{row}`；
     4. 若当前 id 是新的（或从 null 变非 null）：`beginStream` + `sendSessionSnapshotNow('preserve')`（空会话也发）；
     5. 若 `non-null → null`（**先判定是否已接管**，P0-7）：
        - `isAdopted = [...streamRowIds.values()].includes(last.id)`；已接管 → 不动作（`streamStatus`/DB 行已代表；`messages` effect 的 `stream-adopted` 会补终态行），**不额外发全量快照**；
        - 未接管且 `isEmpty`（首字前结束/空 step 留下的空 streaming 行）→ `sendSessionSnapshotNow('preserve')` 收掉；
        - 未接管且 `status === 'finished'`（失败/移除时未被接管的合成 partial）→ **`resetStream([last.id])`** 移除（该函数内部 `resetStreamState([last.id])` 并带 `generation: ++snapshotGenerationCounter` 发 `streamReset`；不要手写只带 `streamIds` 的 payload，也不要传字符串），随后由 DB 错误行/会话快照接管；
     6. 写回 `lastStreamSnapshotRef`（`isEmpty = !text && !thinking && tools.length===0`）。
   - **effect 顺序**：`messages` effect 与 `streamingRows` effect 可能同拍；`stream-adopted` 先发终态行、streaming effect 靠 `streamRowIds` 判定跳过 reset；反之 streaming effect 先跳过 reset、messages effect 再发终态行。两种顺序都不能删最终行（T-SP6/T-SP28）。
   - `messages` 判路 effect（`:1614-1664`）：`planMessagesUpdate` 增加 `streamRowIds`；`stream-adopted` 分支不发 append/snapshot，而是对 `plan.adopted` 的**每一条**：用 `buildToolPairingContext(messages)` + `buildTranscriptRowsWithContext([该消息], ctx, listOptions)` + `enrichTranscriptRows` + `applyStreamRowIds` 构建终态行，`postToWeb({type:'streamStatus', payload:{streamId, status:'finished', messageId, row}})`（每条都补 `messageId`，保证菜单/回滚可用）。混合新增走 `force-snapshot`（C11）。
10. **`handleReady`**（`:1204-1221`）：通过 t2/capability 判定后，`seedStreamAccumulatorsFromCurrentMessage()`：
    - 取 `streamingRows` 最后一条，`streamIdRef = lastStreamIdRef = row.id`（让后续 effect 的 `beginStream` 幂等命中，不会重新武装块模式）、`streamTextAccumRef = row.text`、`streamThinkingAccumRef = row.thinking`、`streamCommitted*PartsRef = []`、`streamToolsRef = last?.tools ?? []`、`streamToolsDirtyRef = false`；
    - `streamBlockArmedRef = false`：新文档的正文由 snapshot 全量 seed，**后续 delta 走全量 `textHtml` 替换**，不再发块提交——否则块提交会把 snapshot 已有的完成块再 append 一次（重复 DOM）。下一个新 step 的 `beginStream` 重新置 true；
    - seq 不重置：后续 delta 从 snapshot 的 seq+1 继续。
11. **`handleUpstream`**（`:1373-1461`）：新增 `case 'streamResync'` → 同一 streamId 100ms 内只发一次（`resyncSentAtRef: Map<string, number>`；命中 `<100ms` 直接忽略，否则记录 `performance.now()` 并 `sendSessionSnapshotRef.current('preserve')`）。
12. **`handleVisibility`**（`:1340-1371`）：hidden:true 时在记录 `visibilityHiddenAppStateRef` 后**把 `statePushSinceResumeRef` 清零**（保证恢复时的计数只含 hidden 期间推送）；else-if 改为 `void sendSessionSnapshotNow('preserve')`；删除 `restore` 与相关注释；依赖数组保持 `sendSessionSnapshotNow`。
13. **`STATE_PAINTING_HOST_MESSAGES`**（`:133-144`）新集合：`sessionSnapshot/prependPage/appendTailRows/streamDelta/streamBlockCommit/streamStatus/streamReset/flagsUpdate`；删 `streamBatch`、`streamCommit`、`streamToolInvoking`。
14. **`init`**（`:749-761`）：加 `labels: buildTranscriptLabels(coreT)`（来自 `transcript-labels.ts`，`useMemo` 一次）；`transcriptOnly` 保留。
15. **本地回滚开关**：文件顶部 `const STREAM_PROJECTION_ENABLED = true;`；为 false 时 `streamingRows` 视为空、`streamRowIds` 按空 Map 处理（快照/append/prepend 不调 `applyStreamRowIds`，`planMessagesUpdate` 也收空 Map）、不订阅 status、不发任何流式消息（快照只发 DB 行，行 id 保持 DB id）。这是唯一回滚闸，不复活旧双数据面。

#### C10 `apps/mobile/src/components/chat/message-blocks.ts`

- 删除 `TranscriptStreamState` re-export（`:450-452`）与 `buildTranscriptRows` 的 `stream` 参数/`kind:'stream'` 分支（`:521-541`）。
- `transcriptRowFromItem`（`:455-497`）不写 `status/messageId`（由 `applyStreamRowIds` 后处理）。
- `selectTailTranscriptRows`/`buildTranscriptRowsWithContext` 签名不变（`:506-557`）。

#### C11 `apps/mobile/src/components/chat/chat-conversation-update-plan.ts`

- `OpenSnapshotInput`（`:17-22`）：加 `hasStreamingMessage: boolean`；`messageCount === 0 && !hasStreamingMessage` 才返回 `wait-empty`（run 在空会话启动时要发只含流式行的开屏快照）。`transcript_ready.rowCount` 用 `messageCount + (hasStreamingMessage ? 1 : 0)`。
- `MessagesUpdateInput`（`:67-75`）：删 `committedIds`，加 `streamRowIds: ReadonlyMap<string,string>`。
- `MessagesUpdatePlan`（`:77-90`）：删 `skip-committed`/`consume-committed`，加 `stream-adopted`。
- 删除 `:122-159` 的 committed 判定；`stream-adopted` 与 prepend 的优先级写死（P1-1/P1-4）：
  ```ts
  // 沿用上面的 grew / firstChanged（:122-123）；只改 prepend 的计数与尾部处理
  // 前插数量 = 旧首行在新列表中的下标；不能用 messages.length - prevCount（那是总增长）
  const prevFirstIndex =
    grew && firstChanged && prevFirstId != null
      ? messages.findIndex(m => m.id === prevFirstId)
      : -1;
  if (grew && firstChanged && prevFirstIndex < 0) {
    // 旧首行不在新列表：头尾都可能变，无法安全前插 → 全量对账
    return {kind:'force-snapshot'};
  }
  const prependedCount = prevFirstIndex >= 0 ? prevFirstIndex : 0;
  const tailAddedCount =
    grew && firstChanged ? messages.length - prevCount - prependedCount : 0;
  if (grew && firstChanged && tailAddedCount > 0) {
    // 前插 + 尾部新增同拍：prepend 页只能发头部，尾部会丢 → 全量对账
    // （尾部 adopted 只是其中一种；任何尾部新增都走这里）
    return {kind:'force-snapshot'};
  }
  if (grew && firstChanged) {
    return {
      kind:'prepend',
      prependedCount,
      event: {
        name:'prepend_detected',
        prependedCount,
        wasNearBottom: lastScroll.nearBottom,
        offsetYBefore: lastScroll.offsetY,
      },
    };
  }
  // 普通追加：added 只在非 prepend 路径按 prevCount 取尾部
  const added = grew ? messages.slice(prevCount) : [];
  const addedStream = added
    .map(m => ({messageId: m.id, streamId: streamRowIds.get(m.id)}))
    .filter(x => x.streamId != null);
  if (!firstChanged && grew && addedStream.length === added.length && addedStream.length > 0) {
    return {kind:'stream-adopted', adopted: addedStream};
  }
  if (!firstChanged && grew && addedStream.length > 0) {
    return {kind:'force-snapshot'};
  }
  ```
  - 纯 prepend（`grew && firstChanged` 且 `tailAddedCount === 0`）走 `prepend`，`prependedCount = prevFirstIndex`（旧首行下标）；**不能**把 `messages.slice(prevCount)` 当 prepend 的新增行。
  - 前插 + 尾部任何新增（含 adopted）→ `force-snapshot`；旧首行不在新列表也 → `force-snapshot`。
  - 补 planner 用例：纯 loadOlder 不返回 force-snapshot；prepend + 尾部 adopted 同拍返回 force-snapshot；prepend + 尾部普通新增也返回 force-snapshot；旧首行缺失返回 force-snapshot。
- 顺带清 P2-5 死防御（`!grew && sameLength` 同现、`previousMessages.length === messages.length` 恒真）——保留真实可达分支，测试补差分（CR3 P2-5）。

#### C12 `apps/mobile/src/screens/tabs/chat-tab/ChatTabProvider.tsx`

- 新增/传递 `streamingRows`（直接 `buildStreamingRows(unitView)`；引用稳定由函数内部输入缓存保证，不强制包 `useMemo`——S13）与 `streamRowIds`（**非空优先**：`unitView?.streamRowIds != null && unitView.streamRowIds.size > 0 ? unitView.streamRowIds : (messagesView?.streamRowIds ?? EMPTY_MAP)`，active 与 idle 两个来源；空 Map 不得遮蔽 idle 映射）到 context。
- `ChatTabContextValue` 增加两字段；`value` 的 `useMemo` 依赖数组同步加入 `streamingRows`、`streamRowIds`（漏加 = 消费者永远看不到新行）。
- 删除 `ghostProbe` import 与 `ghostStatusRef` 打点（`:51,244-266`；CR3 P2-11）。
- attach effect（`:293-322`）不变（ready 后 attach）；adapter 已改。

#### C13 `apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx`

- 删除 `useInterruptedPartialCommit` import 与调用（`:69,131-135`）。
- 传 `streamingRows={ctx.streamingRows}`、`streamRowIds={ctx.streamRowIds}`；删 `toolInvoking={unitActive}`（`:218`）。
- 删除 `ghostProbe` import 与打点（`:70,361-367`）。

#### C14 `apps/mobile/src/screens/stack/SubagentSessionScreen.tsx`

- 删除 `useInterruptedPartialCommit` import 与调用（`:48,172`）。
- `ChatConversationWebView` 传 `streamingRows`（`buildStreamingRows(unitView)`）与 `streamRowIds`（**非空优先**：`unitView?.streamRowIds != null && unitView.streamRowIds.size > 0 ? unitView.streamRowIds : (manager.readMessagesSnapshot(sessionId)?.streamRowIds ?? EMPTY_MAP)`）；删 `toolInvoking`（本屏原本未传，不用动）。
- `uiRunning={agentRunning}` 保留。

#### C15 `apps/mobile/src/screens/tabs/chat-tab/useInterruptedPartialCommit.ts`

- **整文件删除**；interrupted partial 由 C8 的 `buildStreamingRows` 走普通快照。同步删两处调用与模块头注释引用（`ChatConversationWebView.tsx:120`、`ChatTabProvider.tsx:147`）。

#### C16 `apps/mobile/src/services/chat-run-ghost-probe.ts`

- **整文件删除**；回退 3 个 tracked 文件的插桩 import（C5/C12/C13 已列），满足 CR3 P2-11 的提交卫生。

### 5.4 Web runtime

#### C17 `runtime/state/state.ts` + `runtime/boot/boot-transcript.ts`

- `state.ts`：见 §3.1；新增 `streamCheckpoint`、`resyncPending`、`labels`、`fullReplaceOnly: string | null`、`appliedBlockKeys: Set<string>`。
- `boot-transcript.ts:45` 的 `state.ready = true` **删除**（`ready` 字段的唯一写点；删字段后不删此赋值会 typecheck 红，P1-2）；`state` 若因此无其它使用则一并删 import（当前仅此一处用 `state`）。
- `state.ready` 定义（`:98`）/初始化（`:117`）同步删除。

#### C18 `runtime/render/snapshot.ts`

- `SnapshotPayload`（`:30-41`）：删 `generating`，加 `stream`。
- `handleSnapshotPayload`（`:89-180`）：`SnapshotChunkAccumulator` 删 `generating`、加 `stream`（每片 last-wins）；末片 `assembled` 带 `stream`；**每个片（含末片）先做 `payload.generation < appliedSnapshotGeneration` 判旧并丢弃**（不再只在 `acc == null` 时判），旧代次末片不会整体替换 rows；其余乱序/重复片规则不变。
- **新增导出 `invalidateSnapshotPipeline(generation: number)`**：`pendingChunkAcc = null; pendingChunkActions = []; appliedSnapshotGeneration = Math.max(appliedSnapshotGeneration, generation)`；由 C23 `bridge.ts` 的 `streamReset` 分支调用（在 `applyStreamReset` 之前）；`applyStreamReset` 不 import `snapshot.ts`，避免循环依赖。
- `applySnapshot`（`:204-306`）：按 §3.4 重写；删 `:240-248`、`:290-292`；新增 `reseedStreamingRow`、`reconcileFinishedStreamingRows`（签名跳过/无壳跳过/不 renderRows）。
- 删除 `promoteStreamTailToRow`（`:354-365`，名不副实）与 `applyStreamCommit`/`applyStreamCommitNow`（`:371-444`，`streamCommit` 消息已删）。
- `applyAppendTailRowsNow`（`:324-349`）：若 `state.rows` 最后一条是 streaming 行，则新行插到它**之前**（I1）；`retargetRowWindowFromBottom` 不变。
- `applyPrependPageNow`（`:460-495`）：头部插入不影响尾部；保留。
- `pendingChunkActions`（`:74-78`）只保留 `appendTail`/`prependPage`；删 `streamCommit` 分支。

#### C19 `runtime/render/row-windowing.ts`

- `getRowWindowRange`/`getRowWindowSpacerHeights`（`:52-68`）的 `total` 现在天然含流式行；`getRowWindowSpacerHeights(total, pinnedTail)` 在流式行被钉在窗口外时把下占位按 `total - win.end - 1` 计算（见 §3.2）。
- `measureRowWindow`（`:280-312`）：窗口内行数 `win.end - win.start` 与测量区间（上占位底缘 → 下占位顶缘）一致；**贴底（`win.end === total`）且最后一行是 streaming 时，RowList 不渲染下占位，测量下缘会落到不断长高的流式行；此时必须把测量上界收到流式行之前：测量下缘取 `streamingRow.offsetTop`（不是最后一个 `[data-id]` 的 `offsetTop+offsetHeight`），`count = win.end - win.start - 1`，`measuredPx = streamingRow.offsetTop - 上占位底缘`；或显式底缘 spacer。只减 count 不减 measuredPx 会把流式行高度留在分子、分母少 1，估算反而偏大**；窗口外钉住的流式行在下占位之后，不进入测量，也不会放大平均槽高。
- 流式行不再因为窗口滚动被卸载（钉住），块级已完成块的 DOM 不丢；finished 行可以卸载，重挂时 `StreamingMessageRow` 用行内完整 `text/thinking/textHtml` 重建（风险 R2）。

#### C20 `runtime/stream/stream-checkpoint.ts`（新）

- `decideStreamDelta`（§2.3.5）。
- `mergeCheckpoint(local: StreamCheckpoint | null, incoming: StreamCheckpoint | null): StreamCheckpoint | null`：`incoming == null` → null；`local == null` → incoming；异 id → incoming；同 id → `{id, seq: Math.max(local.seq, incoming.seq), status: local.status === 'finished' || incoming.status === 'finished' ? 'finished' : 'streaming'}`。
- keep-public + `stream-checkpoint.test.ts` 表驱动（含 mergeCheckpoint 四象限）。

#### C21 `runtime/stream/stream.ts`

- 按 §3.5 重写：删 `state.stream` 读写/`streamDisplayParts`；新增 `applyStreamDelta`；改 `getStreamActiveTailText`、`streamHasContent`、相位函数；删 `setStreamToolInvokingDom`；新增 `applyStreamStatus`/`applyStreamReset`。
- 所有原 `state.stream.text/thinking/textHtml/thinkingHtml/toolInvoking` 读写（`appendStreamDeltaCore` 的 `text +=`/`textHtml =`、`appendStreamDeltaIncremental`、`syncStreamBodiesFromState`、`updateStreamBubble`、`streamThinkingHtml`、`streamHasContent`）统一改为 `currentStreamingRow()`（= `state.rows[state.rows.length-1]` 且 `status==='streaming'`，否则 null）；`assistantBubbleExtraClasses` 的入参形状不变。按 id 定位已 finished 的行用 `findRowById`（`state.rows` 遍历）。
- **块模式写入边界（P1-4）**：`syncStreamBodiesFromState`/`updateStreamBubble` 在 `streamBlockRender.active` 时只能写 `streamRenderTarget`（`.stream-active-tail`）的**尾块范围**文本/html（`getStreamActiveTailText` + `tailTextParts`）；全量 `row.textHtml` 只能写 body 自身，且写前必须先 `resetStreamBlockRenderState()`。任何「把全量 html 写进尾容器」都会复制已提交块。
- `applyStreamBlockCommit`（`:485-558`）：**不把 `tailHtml` 写回 `row.textHtml`**（delta 已写全量；块提交只做 DOM append 与尾块重置）；`streamBlockRender.tailTextParts` 保留；检查顺序固定为：`payload.streamId === state.streamCheckpoint?.id` → `checkpoint.status === 'streaming'` → `payload.seq <= state.streamCheckpoint.seq` → `payload.blockKey` 不在 `state.appliedBlockKeys` → `fullReplaceOnly !== streamId`；任一不满足直接 return。finished 后的迟到 commit 不得触发 `renderRows` 回退（P2-2）。
- `applyStreamReset` 见 §3.6（streamIds 列表、清 fullReplaceOnly/appliedBlockKeys）；**不直接 import `snapshot.ts`**；由 C23 `bridge.ts` 的 `streamReset` 分支在它之前调用 `invalidateSnapshotPipeline(payload.generation)`（C18），不要直接写 `pendingChunkAcc/pendingChunkActions/appliedSnapshotGeneration`（它们是 snapshot.ts 私有）。
- `resetStreamBlockRenderState`（`:65-71`）：删 `streamDisplayParts` 复位；其余保留。
- 文件头注释更新：禁止 Preact 化增量岛、tool 条单路径继续有效。

#### C22 `runtime/stream/stream-markdown.ts`

- `paintStreamRichKind`（`:100-136`）**不写回 `row.textHtml`**（delta 已携带全量 html；写入尾块 HTML 会把 full 截成 tail）；无当前 streaming 行直接 return；`bubble.className` 用该行的 `textHtml/text/thinking`，不再读 `state.stream.*`。`updateStreamBubble` 的回退使用 `row.textHtml`（全量），不依赖这次写入。
- `clearStreamRichUpgrade` 时机：`streamReset`、新 streamId、`applySnapshot` 换主、status 翻 finished；不改 350ms 升级算法。
- `flushStreamRichUpgrade` 找不到 `#stream-tail` 时自然 no-op；finished 后定时器不再产生写入。

#### C23 `runtime/bridge.ts`

- switch（`:41-143`）：
  - `sessionSnapshot` → `handleSnapshotPayload`；
  - `streamDelta` → `applyStreamDelta`；
  - `streamBlockCommit` → `applyStreamBlockCommit`；
  - `streamStatus` → `applyStreamStatus`；
  - `streamReset` → `clearStreamRichUpgrade` + `resetStreamBlockRenderState` + `invalidateSnapshotPipeline(payload.generation)`（C18）+ `applyStreamReset`；
  - **删** `streamBatch`、`streamToolInvoking`、`streamCommit`；
  - `init`（`:46-54`）加 `state.labels = p.labels ?? DEFAULT_LABELS`；`transcriptOnly` 保留给 CSS；
  - `flagsUpdate`（`:107-126`）richText 关→开时清 `state.lastStreamHtmlStreamId = null`（下一次快照强制 reseed streaming body，P2-7），**同时清 `state.plainReseedStreamId = null`**；**开→关时不能只清 `lastStreamHtmlStreamId`**：置 `state.plainReseedStreamId = currentStreamingRow()?.id ?? null` 并 `renderRows()`，让 `StreamingMessageRow` 把 body 重写为 `row.text` 纯文本（消费后清空，仅 `!flags.richText` 时消费）；否则 plain 四态 `appendEscapedDelta` 会把转义文本追加进仍是 markdown HTML 的 body（P2-3）。
  - 删 `stickIfNearBottom` 死分支（宿主类型已无生产者）。
- `visibilitychange` 上报不变（`:35-39`）。

#### C24 `ui/render/RowList.tsx`

- 按 §3.2 重写；删除 `StreamTail` import/节点、`hasStream`、空态双口径。
- 流式行钉住：`win.end < total && lastRow.status === 'streaming'` 时在下占位之后追加 `<MessageRow key={row.id} row={row}/>`（**与窗口循环同一组件类型**，否则 Preact 按 type 卸载重建、body 岛丢失），并把下占位传给 `getRowWindowSpacerHeights(total, true)`；否则正常走窗口循环。
- 加载更早按钮与占位顺序不变。

#### C25 `ui/render/MessageRow.tsx`

- `MessageRow({row})` 内：`if (row.status != null) return <StreamingMessageRow row={row} />`。
- 普通行菜单入口 `openContextMenuFromAnchor(row.id, ...)`（`:27-33`）；`StreamingMessageRow` 内部用 `row.messageId ?? row.id`（C28）。
- 普通行不写 `status/messageId`。

#### C26 `ui/stream/StreamingMessageRow.tsx`（新）

- 按 §3.3 实现；`StreamBodyHost` 从旧 `StreamTail.tsx:39-61` 迁入本文件（或抽到 `StreamBodyHost.tsx`，二选一，不保留两份）。
- 结构：外层 row → bubble → thinking section（有则）→ **稳定 text host（`streaming-content` 时即使正文为空也挂 `.bubble-body`）** → tools（`ToolGroup`）→ `ToolInvokingBar`（仅 streaming，`label` 由本组件传入，C29）。
- waiting-first：只渲染 row + 生成中指示，不渲染 `.bubble`；首个 delta 由 `renderRows` 建完整壳（§3.3）。
- 折叠键：streaming 用 `stream:thinking`/`stream:tools:<streamId>`；finished 用 `'msg:'+row.id`，读 `state.thinkingExpanded/toolGroupExpanded`（P1-6）。thinking/tool 区**始终用同一组件类型**（`ThinkingSection`/`ToolGroup`），status 只改 props（key/expanded/菜单），不换组件类型（P2-6）；`ThinkingSection` 增加可选 `title`（流式行传 `state.labels.thinking`），不得在 `StreamingMessageRow` 里手搭第二套 thinking section。外层行类含 `assistant`（或 CSS 同步扩选择器），保证 `.bubble--fill-width` 对流式起源行生效。
- `id="stream-tail"` 只挂在 streaming 行；finished 行用 `data-stream-id` 定位，`data-streaming` 移除。
- 菜单行仅 `finished && messageId != null` 渲染；`aria-label` 文案沿用现有 `消息操作`（E 桶，不迁 i18n）。
- 更新 `apps/mobile/README.md` E2 allowlist：`StreamTail` → `StreamingMessageRow`（`ToolInvokingBar` 改为 label prop，不再进 allowlist）。

#### C27 `ui/stream/StreamTail.tsx`

- **删除**（内容迁 C26）。

#### C28 `runtime/menu/menu.ts` + `runtime/render/rows-click.ts`

- `findMessageRow`（`menu.ts:83-91`）：`row.id === messageId || row.messageId === messageId`。
- `openContextMenuFromAnchor`（`menu.ts:235-251`）：`state.menu.messageId = row.messageId ?? row.id`；`post('openMessageMenu', {messageId: state.menu.messageId, ...})`。
- `menu-action` 分支（`menu.ts:182-190`、`rows-click.ts:26-32`）不改（`data-message-id` 已是 DB id）。
- `rows-click` 的 toolUseId 反查按 `row.id`（流式行 id 在 rows 中，能命中）。

#### C29 `ui/render/ToolInvokingBar.tsx` + `ui/render/AssistantBubble.tsx`

- `ToolInvokingBar({label}: {label: string})`：**不导入 state**（保持 E2 allowlist 不变）；`StreamingMessageRow` 传 `state.labels.generating`。
- `AssistantBubble.tsx`：删除 `showToolInvoking` prop、`hasInvoking` 变量、`ToolInvokingBar` import 与 `:76-77` 调用（`MessageRow.tsx:113` 恒传 `false`，该分支已是死代码；C29 改必填 label 后不删会直接 TS2741）。同步删 `MessageRow` 的 `showToolInvoking={false}` 传参。
- `StreamingMessageRow` 的 waiting-first 文案从 `state.labels.generating`、thinking 标题从 `state.labels.thinking` 读。

#### C30 `ui/labels.ts`（新）

- `DEFAULT_LABELS`（当前中文常量，老宿主/缺省兜底）。
- `resolveLabels(payload)`（校验字符串，非法回退默认）。

### 5.5 构建 / 测试 / 文档

#### C31 log 收口

- C4/C5 的 `createLogger` scope：`chat.stream-unit`、`chat.stream-manager`。
- 新增 `apps/mobile/__tests__/no-raw-console.test.ts`：只扫本轮改动文件，零裸 console；
- 新增 `apps/mobile/__tests__/raw-console-baseline.test.ts`：扫 `apps/mobile/src/**`（排除 `src/web/**`），按文件记录既有基线（原 20 文件/51 处；收口后 **18 文件/36 处，业务 16/30**），计数只允许下降；与 `logger-normalization/spec.md:502` E6 的「全仓仅 log-sink」偏差见 §7.3。
- `src/web/.../main.ts:67` 与 `ToolGroup.tsx:40` 的裸 console 保留（E6 扫描面排除 `src/web/**`），文件内加注释说明「web bundle 无 logger 依赖，装配失败诊断唯一出口」。

#### C32 i18n

- `packages/core/src/i18n/keys.ts`：
  - `LABEL_KEY_DOMAINS` 增加 `"transcript"`（`keys.ts:41-52` 当前 9 域无 transcript；`catalog.ts:45` 会 throw，`catalog.test.ts:18-19` 顶层 parse 会直接红）；同步「9 域」注释改「10 域」；
  - `LABEL_MESSAGE_KEYS` 加 4 个 key：
    - `label.transcript.generating` = 生成中
    - `label.transcript.thinking_header` = 思考过程
    - `label.transcript.empty` = 暂无消息
    - `label.transcript.load_older` = 加载更早消息
- `catalog/zh-CN.yaml` 必填；`catalog/en-US.yaml` 同步英文。
- 跑 `node packages/core/scripts/gen-i18n-catalog.mjs` 重新生成 `generated-catalog.ts`；`catalog.test.ts` / `parse-core-catalog.test.ts` 必须绿（域表校验是 blocking）。
- 新增 `apps/mobile/src/components/chat/transcript-labels.ts`：`buildTranscriptLabels(t: (m: MessageLike) => string): TranscriptLabels`（4 个 `label.transcript.*`，locale 固定 zh-CN），供 `ChatConversationWebView` 随 `init` 下发；纯函数可单测（T-SP22）。
- Web `RowList`/`StreamingMessageRow` 读 `state.labels`；`ToolInvokingBar` 由 `StreamingMessageRow` 传 `label` prop（自身不导入 state）。
- 不把 mobile 自有中文（`已中断`/`子会话暂无消息`/`停止子会话`、`对话页加载失败`）纳入本轮（G6）。

#### C33 测试

见 §9。

#### C34 文档 / 迭代记录

- 本 spec 落盘。
- 实施完成后在 `docs/Iterations/chat-streaming-projection/` 下补交付报告（含 nm style 报告表、T 结果、e2e 记录）；不改实现代码以外的其它迭代文档。

---

## 6. 兼容与迁移

### 6.1 host + web 同包

- `apps/mobile/package.json` 的 `preandroid` / `preios` / `pretest` / `e2e:build-apk` 都会先跑 `build:webview(:native)`（`package.json:14,25,28-30`），产物拷到 `android/app/src/main/assets/webview/chat-transcript` 与 `ios/.../WebViewDist/chat-transcript`（`native.md` §6.4）。
- 因此 RN 侧代码与 web `app.js` 随同一个 APK 发布，**没有服务端下发 web 资源的通道**；协议可以整体切换，不需要双协议并行。

### 6.2 ready v2 + t2 + 能力位

- 信封仍 `v === 2`（`ChatConversationBridge.ts:58`）；ready 的 `version` 升 `t2`；能力位加 `streamProjection`。
- 宿主判定顺序：
  1. `v !== 2` → `stale-ready`（现状，不置 webReady）；
  2. `version !== 't2'` 或缺少 `streamProjection` → 立即错误态；
  3. 通过 → `webReadyRef = true`，`streamBlockCapableRef` 与新的 `streamProjectionCapableRef`（若需要）一起置位。
- 为什么不用 capability 做「旧协议回退」：旧 web 只认旧消息形状；保留双协议等于保留两套投影与两套 bug 面，违背根修目标。旧 dist 直接 fail-fast，比静默白屏可诊断（纪律 B）。

### 6.3 旧 webview 资源

- **旧 dist**（t1 / 无 `streamProjection`）：宿主立即渲染 `chat-conversation-ready-error`（`ChatConversationWebView.tsx:1787-1802`），文案沿用「对话页加载失败 / 点重载恢复」。用户点重载仍是同一旧 dist，仍失败——这是构建错误，必须重装正确 APK；日志 `incompatible transcript dist` 可定位。
- **旧宿主 + 新 dist**（只可能出现在手工拼包）：**不支持且旧宿主无检测手段**——旧 `handleReady` 只读 capabilities、不校验 version（`ChatConversationWebView.tsx:1204-1221`），会接受新 dist 的 v2/t2 ready，然后继续发旧形状 `streamBatch`/`streamDelta{kind,delta,html}`；新 web 删了 `streamBatch`，`streamDelta` 缺 `streamId/segments`，正文不会流式显示（只在 step 边界快照补文本），属于「半认」而非 fail-fast。新 web 侧可加形状探测（`streamDelta` 缺 `streamId/segments` 时上行 `incompatible` 诊断），但**不能**把旧宿主变 fail-fast；发布纪律是 host+web 必须同包（§6.1）。
- **构建侧守卫**：`webview-asset-guard.test.ts` 继续守四包资产清单；**必须新增源面断言并落在该文件**（当前无版本/能力断言）：`transcript-capabilities.ts` 的 `TRANSCRIPT_READY_VERSION === 't2'` 且能力清单含 `streamProjection`（T-SP20）；Step 9 的 `--silent webview-asset-guard` 执行。
- **CI**：`pretest` 会重建 webview，jest 里 web 测试走 mock/harness，不依赖本地 dist；真机/e2e 必须 `e2e:build-apk`（`gates.md` §3.1）。

### 6.4 持久层

- `session_run_state` 只存 `partialText/partialThinking/metrics/pendingChildren`（`manager:1796-1820`），本轮不改 schema；新增的 `streamRowIds` 是内存态，不落盘。
- 冷启动水合：interrupted 单元用 partial 构造 finished 流式行（状态 `finished`、无 `messageId`），直到新 run 替换、用户 rollback/fork、或 LRU 淘汰；rollback/fork 的 `requestStreamReset` 会 `clearStreamProjection()` 并 best-effort `runStateStore.settle` 清持久 partial，避免重启后水合鬼影（P0-4）。
- 旧版本 APK 读新数据不受影响（没有新增列/字段）。

### 6.5 回滚路径

- **代码回滚**：`git revert` 本迭代合并提交；host 与 web 同包，回滚后 ready 恢复 `t1`，旧协议全链一致。无数据迁移、无 KKV 键变更。
- **紧急开关**：`STREAM_PROJECTION_ENABLED = false`（C9 第 15 条）→ 宿主把 `streamingRows` 与 `streamRowIds` 都按空处理，不发流式行/流式消息，只按 DB 消息发快照（行 id 保持 DB id）。表现为「文本在 step/收尾后才出现」，但不会 ghost、不会崩溃。开关只影响本轮新增代码，不复活 `state.stream`；false 分支只做 Step 13 真机手动验收（jest 默认只跑 true，spec 明确记录）。
- **webview 资源回滚**：`npm run build:webview:native` 重新生成并提交对应 APK；禁止只回滚 RN 侧或只回滚 dist（ready t1/t2 不匹配会被 fail-fast 挡住）。
- **回滚验收**：`npm run test -w @novel-master/mobile -- --silent chat-conversation-webview` + 全量 jest + 真机冷启动/发送/切后台 3 条冒烟。

---

## 7. nm style / either / log / i18n 清理

### 7.1 nm style

#### 7.1.1 规则（`.agents/skills/nm-code-style/SKILL.md:10-92,106-138,241-250`）

- private 方法内联；签名/调用/错误构造一行；单行转手 wrapper 删除。
- 死代码沿调用链删到底；假公开先撤 `export`，测试/allowlist 不算消费者。
- 通用工具进 `core/common`，文件名按类别；不为抽象而抽象。
- 改完跑 `check-style` 相关脚本并循环 ≥2 轮；未处理的 DEAD/FAKE_PUBLIC/TEST_ONLY/INLINE_CANDIDATE 必须列报告表。

#### 7.1.2 逐文件清理点

| 文件 | 清理点 | 规则 | 验收命令 |
|---|---|---|---|
| `ChatConversationWebView.tsx` | 删 13 组死 ref/函数/effect（C9）；`chatConversationWebViewPropsEqual` 保留 keep-local 注记；新 handler 签名保持一行 | 死代码删到底；keep-local 有理由 | `check-inline.mjs apps/mobile/src/components/chat/ChatConversationWebView.tsx`、`check-signatures.mjs --changed`、`find-fake-exports.mjs <file> --strict` |
| `ChatTranscriptBridge.ts` | 删 4 个零消费编码器（`:274-319`）、`TranscriptStreamState`、`kind:'stream'` | 假公开撤 export / 删死面 | `find-fake-exports.mjs apps/mobile/src/components/chat/ChatTranscriptBridge.ts --strict` |
| `message-blocks.ts` | 删 `buildTranscriptRows` stream 参数与 re-export | 死通道删到底 | `check-signatures.mjs apps/mobile/src/components/chat/message-blocks.ts` |
| `chat-conversation-update-plan.ts` | 删 committed 三态与 P2-5 死防御；`planOpenSnapshot/planMessagesUpdate` 保留 keep-public 注记 | 纯决策面独立测试 | `check-signatures.mjs <file>`、`find-fake-exports.mjs <file> --strict` |
| `transcript-stream-projection.ts`（新） | 整文件 0 签名发现、0 DEAD/TEST_ONLY；导出仅 C8 五函数 + 类型 | 新模块整文件 0 | `check-signatures.mjs <file>`、`find-fake-exports.mjs <file> --strict`、`check-inline.mjs <file>` |
| `session-stream-unit.ts` | 删 `injectedValue/tryInjectPartialInto/stream-delta`；内部类型撤 export（DEAD 6 项中可撤的）；`SessionStreamUnitView` 新字段有消费 | 死代码/假公开 | `find-fake-exports.mjs <file> --strict`（既有基线见 §7.1.3）、`check-methods.mjs <file>` |
| `session-stream-unit-manager.service.ts` | 删 ghostProbe；tool-use 订阅内联；`readMessagesSnapshot` 只加字段 | 单行转手删除 | `find-fake-exports.mjs <file> --strict`、`check-methods.mjs <file>` |
| `session-stream-webview-adapter.ts` | 两处 `as` 收窄改显式判定；`stream-delta` 分支删；补测试（原 0 测试，`gates.md` §2.4） | 边界收窄要可测 | `find-fake-exports.mjs <file> --strict`、新增 adapter 测试 |
| `ChatTranscriptWebViewHandle.ts` | 7 → 3 方法；删 TEST_ONLY 触发方法 | 假公开撤 export | `find-fake-exports.mjs <file> --strict` |
| `useInterruptedPartialCommit.ts` | 整文件删除 | 死代码 | `git grep useInterruptedPartialCommit` 为空 |
| `chat-run-ghost-probe.ts` | 整文件删除；3 处 import 回退 | 提交卫生 | `git grep chat-run-ghost-probe` 为空 |
| `web/.../snapshot.ts` | 删 `promoteStreamTailToRow`/`applyStreamCommit*`/`streamCommit` 分支/`generating` | 死通道删到底 | `check-inline.mjs --changed`、`check-signatures.mjs --changed` |
| `web/.../stream.ts` | 删 `streamDisplayParts`/`setStreamToolInvokingDom`/`state.stream` 读写 | 单一数据面 | `check-signatures.mjs --changed` |
| `web/.../state.ts` | 删 `StreamState`/`stream`/`ready` | 死状态 | `find-fake-exports.mjs <file> --strict` |
| `ui/stream/StreamTail.tsx` | 删除（迁 `StreamingMessageRow`） | 死文件 | `git grep StreamTail` 只剩注释/测试迁移 |
| `ui/stream/StreamingMessageRow.tsx`（新） | 整文件 0；`StreamBodyHost` 单份 | 新模块 0 | `check-signatures.mjs <file>`、`check-inline.mjs <file>` |
| `ui/render/RowList.tsx` | 删 `hasStream`/兄弟 StreamTail/双口径 | 单一数据面 | `check-signatures.mjs --changed` |
| `ui/render/ToolInvokingBar.tsx` | 改 `label` prop（不 import state），不再硬编码 | 单源文案 / E2 纪律 | `check-signatures.mjs --changed` |
| `ui/render/AssistantBubble.tsx` | 删 `showToolInvoking`/`hasInvoking`/`ToolInvokingBar` 死分支 | 死代码删到底 | `check-signatures.mjs --changed`、`findstr ToolInvokingBar` 只剩 StreamingMessageRow |
| `runtime/boot/boot-transcript.ts` | 删 `state.ready = true`（唯一写点） | 死状态删到底 | `findstr /s /n "state.ready" apps/mobile/src` 为空 |
| `apps/mobile/README.md` | E2 allowlist `StreamTail`→`StreamingMessageRow` | 纪律与代码同步 | 人工核对 + review |
| 其余触碰文件 | 新增行不新增签名/inline 发现 | 新增行门禁 | `check-signatures.mjs --changed`、`check-inline.mjs --changed` |

#### 7.1.3 既有基线（不阻断本轮，必须列报告表）

`gates.md` §4.3 实测：

- `session-stream-unit.ts`：DEAD=6、TEST_ONLY=3；`check-signatures` 与 manager 合计 95 处（历史基线）；`check-methods` 两 service 文件为 0 处阻断（`snapshot/attachWebview/detachWebview` 跨类同名只作 AMBIGUOUS 信息项）。
- `session-stream-unit-manager.service.ts`：DEAD=7、TEST_ONLY=3。
- `stream-apply-buffer.ts` DEAD=1/INLINE=1；`stream-wire-queue.ts` INLINE=2；`stream-token-estimator.ts` DEAD=1/TEST_ONLY=1/INLINE=3；`chat-session-view-cache.ts` DEAD=1/TEST_ONLY=3/INLINE=1。
- 处理口径：本轮只要求「改动路径新增行 0 发现 + 新模块整文件 0」；既有 DEAD/TEST_ONLY 逐条列入交付报告，`nm-style: keep-public — 测试观测面/调参基线` 的写明理由（测试访问器：`isHydrated/hasActiveRun/unitCount/getWebviewCount/idleMessageViewsSize/settledProjectionsSize`）。不允许用 `check-style --all` 退出码当通过条件（它恒 exit 1，`gates.md` §4.4）。
- `check-methods` 的 `AMBIGUOUS_METHOD`（同名方法跨类）自本轮起为**信息项**，不参与退出码；同名方法全局引用 0 时仍判 `DEAD_METHOD`。`snapshot/attachWebview/detachWebview` 的跨文件同名是真实跨层调用，按文件分别跑得到可判定计数，不因聚合口径阻断。

#### 7.1.4 命令

```bash
# 分项、按新增行判定
node .agents/skills/nm-code-style/scripts/check-inline.mjs --changed
node .agents/skills/nm-code-style/scripts/check-signatures.mjs --changed
# 跨类同名方法（snapshot/attachWebview/detachWebview）按文件分别跑，取可判定计数；
# 两文件聚合时 AMBIGUOUS_METHOD 只作信息项（不阻断），见 §7.1.3。
node .agents/skills/nm-code-style/scripts/check-methods.mjs apps/mobile/src/services/session-stream-unit.ts
node .agents/skills/nm-code-style/scripts/check-methods.mjs apps/mobile/src/services/session-stream-unit-manager.service.ts
# 新模块整文件 0
node .agents/skills/nm-code-style/scripts/check-signatures.mjs apps/mobile/src/components/chat/transcript-stream-projection.ts
node .agents/skills/nm-code-style/scripts/find-fake-exports.mjs apps/mobile/src/components/chat/transcript-stream-projection.ts --strict
# 收尾记录（不看退出码）
node .agents/skills/nm-code-style/scripts/check-style.mjs --all
```

- **`--changed` 与 base 判定口径（P2-14）**：`--changed` 只覆盖未提交工作树（干净树扫描面 0，不可复现历史数字）；按 base 判定本迭代新增行改用 `--since <base>`（等价 `<base>...HEAD`）或 `--range main...HEAD`（两者都读 range 右端 blob，不读工作树）。历史记录：CR3 未提交时 `--changed` 曾报 22 处/7 文件，这些改动随 `fa9e3952b` 提交后不再计入；本轮 `--range main...HEAD` 与 `--since 27534b0f2` 实测均为 **0 处 / 39 文件**。不允许把未提交的其它轮改动算成本轮新增红。

### 7.2 either

- 规则：域逻辑/校验返回 `Result<T,E>`，只在边界 throw；不新造错误工厂；不丢 code（`nm-code-style/SKILL.md:41-47`）。
- 现状：mobile 生产代码 **零** `errors/either` import；`Result` 不在 core public 面（`gates.md` §6.3-6.4）。本迭代不引入跨包契约变更（不新增 core `errors` 子路径）。
- 逐文件结论：
  - `session-stream-unit.ts`：guard 返回 boolean（现状），不改成 Result；本轮新增 `ingestToolUse`/接管匹配同样返回 boolean。
  - `session-stream-unit-manager.service.ts`：fire-and-forget + 吞错（`kickTailReloadQuietly` 同款），无错误返回面。
  - `session-stream-webview-adapter.ts`：void 映射，无错误分支。
  - `transcript-stream-projection.ts` / `stream-checkpoint.ts`：纯函数返回数据/联合字面量，不是错误路径，不需要 Result。
- 验收：
  ```bash
  findstr /s /n /c:"errors/either" apps\mobile\src\*.ts apps\mobile\src\*.tsx   # 期望无输出
  findstr /s /n /c:"Result<" apps\mobile\src\services\session-stream*.ts apps\mobile\src\components\chat\*.ts
  # 仅允许 SessionStreamStartResult 这类业务命名；出现 errors/either 即失败
  ```

### 7.3 log

| 文件 | 现状 | 清理 |
|---|---|---|
| `session-stream-unit.ts` | 5 处裸 console（`:442,563,915,1020,1263`） | 模块级 `const log = createLogger('chat.stream-unit')`；`log.warn/error(message, {detail})`；detail 只放 id/status/err，不放正文 |
| `session-stream-unit-manager.service.ts` | 10 处（`:714,1249,1397,1603,1697,1706,1828,1857,1961,1986`） | `const log = createLogger('chat.stream-manager')` |
| `chat-run-ghost-probe.ts` | 已用 `createLogger('chat-ghost')` | 整文件删除（C16） |
| `ChatConversationWebView.tsx` | 0 | 新增代码不得引入 console |
| `web/.../main.ts` | 1 处 `console.error`（`:67`） | 保留；`src/web/**` 不在 E6 扫描面（`gates.md` §7.2），文件内注释 |
| `web/.../ToolGroup.tsx` | 1 处 `console.warn`（`:40`） | 保留（同上） |
| `web/.../runtime/render/snapshot.ts` | 1 处 `console.error` | 保留；web bundle 无 logger 依赖，是异常快照诊断的唯一出口（与 `main.ts`/`ToolGroup.tsx` 同类，E6 扫描面排除 `src/web/**`） |
| `debug/run-timing.ts` | `__DEV__` 门控 console | 保留；guard 白名单 |

- **守卫口径（P0-6，二段式）**（计数来自本轮 Node 递归统计：`apps/mobile/src` 下 `console.(log|info|warn|error|debug|trace)(` 共 21 文件/39 处，含 `src/web` 3 文件/3 处；排除后 **18 文件/36 处**，即白名单 2 文件/6 处 + 业务 16 文件/30 处）：
  1. `apps/mobile/__tests__/no-raw-console.test.ts` 只扫描**本轮改动文件**（C1/C4/C5/C6/C7/C8/C12/C13/C14/C31/C32 列出的 `.ts/.tsx`），断言零裸 `console.(log|info|warn|error|debug|trace)`；
  2. `apps/mobile/__tests__/raw-console-baseline.test.ts` 扫描 `apps/mobile/src/**`（排除 `src/web/**`），按文件记录既有基线：当前实测 **18 文件 / 36 处**（白名单 `debug/run-timing.ts` 5 处、`services/log-sink.mobile.ts` 1 处单独固定；业务 **16 文件 / 30 处**），断言「基线文件集合与每文件计数不增长」。基线表用显式常量列出业务文件及计数（`session-stream-unit`/`session-stream-unit-manager` 已清零，不保留条目 = 0；业务总预算 30），新增文件或计数上升即红。
- 与 `logger-normalization/spec.md:502` E6 的差异登记为显式偏差：E6 要求全仓命中恰好 `{services/log-sink.mobile.ts}`，但当前仓库实际有 18 文件/36 处既有裸 console（业务 16/30）；本轮不扩大清理范围，用「本轮改动文件零命中 + 全仓基线不增长」替代，避免 blocking 步骤一落地即红。
- 验收：`npm run test -w @novel-master/mobile -- --silent no-raw-console` 与 `... --silent raw-console-baseline`。

### 7.4 i18n

| 文件 | 清理点 |
|---|---|
| `packages/core/src/i18n/keys.ts` | `LABEL_KEY_DOMAINS` 加 `transcript`（10 域）；`LABEL_MESSAGE_KEYS` 加 4 个 `label.transcript.*` key |
| `packages/core/src/i18n/catalog/zh-CN.yaml` | 4 个中文值（全量必填） |
| `packages/core/src/i18n/catalog/en-US.yaml` | 4 个英文值 |
| `packages/core/src/i18n/generated-catalog.ts` | 由 `gen-i18n-catalog.mjs` 重新生成 |
| `apps/mobile/src/components/chat/transcript-labels.ts`（新） | `buildTranscriptLabels(coreT)`：4 个 key → 4 个字符串；纯函数可单测 |
| `ChatConversationWebView.tsx` | `labels: buildTranscriptLabels(coreT)` 随 `init.labels` 下发；不新增硬编码用户可见文案 |
| `web/.../ui/labels.ts` | 默认 labels + 校验回退 |
| `web/.../StreamingMessageRow.tsx` / `RowList.tsx` / `ToolInvokingBar.tsx` | 删「生成中/思考过程/暂无消息/加载更早消息」字面量，读 `state.labels` |
| mobile 自有文案 | 不在本轮（G6）：`已中断`/`子会话暂无消息`/`停止子会话`/`对话页加载失败` 保持现状 |

- key 规则：`^label\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$`（`i18n-normalization/spec.md:157-194`）。
- 验收：
  ```bash
  cd packages/core
  node scripts/gen-i18n-catalog.mjs
  node scripts/run-tests.mjs test/i18n/catalog.test.ts test/i18n/parse-core-catalog.test.ts
  ```
  另加 `npm run test -w @novel-master/mobile -- --silent transcript-labels`（T-SP22）。
- 不新增 `check-i18n.mjs`（全仓不存在，`gates.md` §8.2）；不以「mobile 无硬编码中文」为验收项。

### 7.5 命令汇总

```bash
# 1) 分项 nm style（新模块整文件 0 + 改动行 0）
node .agents/skills/nm-code-style/scripts/check-inline.mjs --changed
node .agents/skills/nm-code-style/scripts/check-signatures.mjs --changed
# 干净树 --changed 扫描面为 0；按 base 判定改用 --since <base> 或 --range main...HEAD
node .agents/skills/nm-code-style/scripts/check-signatures.mjs --since <base>
node .agents/skills/nm-code-style/scripts/check-methods.mjs apps/mobile/src/services/session-stream-unit.ts
node .agents/skills/nm-code-style/scripts/check-methods.mjs apps/mobile/src/services/session-stream-unit-manager.service.ts
node .agents/skills/nm-code-style/scripts/find-fake-exports.mjs apps/mobile/src/components/chat/transcript-stream-projection.ts --strict
node .agents/skills/nm-code-style/scripts/check-signatures.mjs apps/mobile/src/components/chat/transcript-stream-projection.ts
node .agents/skills/nm-code-style/scripts/check-style.mjs --all      # 仅记录

# 2) log
npm run test -w @novel-master/mobile -- --silent no-raw-console
npm run test -w @novel-master/mobile -- --silent raw-console-baseline

# 3) i18n
cd packages/core && node scripts/gen-i18n-catalog.mjs && node scripts/run-tests.mjs test/i18n/catalog.test.ts test/i18n/parse-core-catalog.test.ts

# 4) prettier（必须 --end-of-line auto，避免 CRLF 假红）
node node_modules/prettier/bin-prettier.js --end-of-line auto --config apps/mobile/.prettierrc.js --check <本次新增/改动文件...>

# 5) 编码门禁（新增中文文案/日志后）
npm run check:encoding
```

---

## 8. 详细实现步骤

> 每条 Step 都可独立验证；`blocking: yes` 是交付硬门槛，`qa: manual_user` 是合并后用户验收，不进自动门禁。

- Step 1 — phase-contract-freeze — blocking: yes — qa: auto：C1/C2/C3 类型面。冻结 `streamId + seq + status` 协议、`streamProjection` 能力位、ready `t2`；**只加新类型/新字段，不删旧变体**：`streamBatch/streamCommit/streamToolInvoking/generating/kind:'stream'/TranscriptStreamState` 全部保留到 Step 4 与生产者同批删（P1-11）。验收：`cd apps/mobile && npx tsc --noEmit -p src/web/tsconfig.json` + `npm run build -w @novel-master/mobile` 通过（含 C1/C2 所在 components/chat；旧变体未删，宿主仍可编译；P2-13）。
- Step 2 — phase-unit-projection — blocking: yes — qa: auto：C4/C5/C6/partial。unit 流式 step 记录（进程级唯一 streamId）、tool-use 订阅 + tools-only stream-batch、DB 接管映射、`streamRows` 投影、`clearStreamProjection`；删除注入链；`streamRowIds` 交接。验收：`npm run test -w @novel-master/mobile -- --silent session-stream-unit` + `--silent session-stream-webview-adapter`（T-SP15~T-SP17、T-SP21、T-SP32；T-SP1/T-SP33 在 Step 3/4 的 projection/planner 套件跑）。
- Step 3 — phase-native-snapshot — blocking: yes — qa: auto：C8/C9 快照段/C12/C13/C14 屏幕接线。`buildStreamingRows`（引用稳定）/`applyStreamRowIds`/`buildStreamingTranscriptRow`；快照最后一片携带完整流式行 + `stream`；空会话 run 也发；row id 映射；Provider/Panel/Subagent 传 `streamingRows/streamRowIds`。验收：`--silent transcript-stream-projection` + `--silent chat-conversation-webview` + `--silent chat-conversation-panel.integration` + `--silent chat-tab-screen.integration`（T-SP1、T-SP2、T-SP3、T-SP26、T-SP28、T-SP33）。
- Step 4 — phase-native-wire — blocking: yes — qa: auto：C9 wire 段/C7/C10/C11。宿主唯一 seq 分配、句柄 `pushStream/resetStream/forceSnapshot`（`finishStream` 走 prop effect，不进出口）；删 defer/commit/streamingText 与旧消息变体；`planMessagesUpdate` 加 `stream-adopted` 与 prepend+adopted 优先级；`message-blocks` 删 stream 分支。验收：`npm run typecheck -w @novel-master/mobile` + `chat-conversation-webview` + `chat-conversation-update-plan`（T-SP4、T-SP5、T-SP6、T-SP29、T-SP33）。
- Step 5 — phase-web-rows — blocking: yes — qa: auto：C17/C18/C20/C21/C23。删 `state.stream`/`ready`，加 checkpoint/fullReplaceOnly；`applySnapshot` 原子 rows+checkpoint、reseed、rewind；delta seq/gap/resync。验收（**明确文件，不用宽匹配 `chat-transcript`**）：`--silent chat-transcript-stream-projection`、`--silent stream-checkpoint`、`--silent chat-transcript-snapshot-chunk`、`--silent chat-transcript-snapshot-after-stream-commit`（T-SP7~T-SP10、T-SP23、T-SP30、T-SP31；`snapshot-bytes` 的 ready t2 fixture 迁移归 Step 9/11）。
- Step 6 — phase-web-render — blocking: yes — qa: auto：C19/C22/C24/C25/C26/C27/C28/C29/C30 + README。`StreamingMessageRow`、RowList 钉住、折叠键、status bar、滚动、块提交、菜单 messageId、labels。验收：web harness + `chat-transcript-row-window`、`chat-transcript-stream-block`、`chat-transcript-boot-script`、`chat-transcript-entry`、`chat-transcript-bridge`、`mermaid-webview`（T-SP11~T-SP14、T-SP23、T-SP24、T-SP25、T-SP30、T-SP31）。
- Step 7 — phase-visibility — blocking: yes — qa: auto：C9 visibility 段。普通 snapshot；删 restore 清流；`STATE_PAINTING_HOST_MESSAGES` 更新；covered/zero/dirty 四象限。验收：`chat-conversation-webview`（T-SP18）。
- Step 8 — phase-interrupted — blocking: yes — qa: auto：C8 interrupted 分支/C15。interrupted partial 走 finished 流式行；删 hook 与合成提交。验收：`chat-conversation-webview` + `session-stream-unit` + `--silent subagent-session-screen-metrics`（T-SP19）。
- Step 9 — phase-dist-guard — blocking: yes — qa: auto：C3/C9 ready 段。t2 + capability 判定；旧 dist 立即错误态；`build:webview` 门 B/C 通过。验收：ready 用例（T-SP20）、`--silent chat-transcript-snapshot-bytes`、`--silent chat-transcript-snapshot-complete-signal`、`--silent webview-asset-guard`、`npm run build:webview -w @novel-master/mobile`。
- Step 10 — phase-cleanup — blocking: yes — qa: auto：C16/C31/C32 + §7。删 ghost 探针、log 收口（本轮改动文件 + 全仓基线不增长）、i18n key/下发、nm style 删除与报告表、either 审计。验收：§7.5 全部命令 + `no-raw-console` + `raw-console-baseline` + catalog tests + `--silent chat-conversation-webview` 的 init.labels parity（T-SP22；T-SP21 是 Step 2 的 adapter 用例，Step 10 只跑 log 守卫）。
- Step 11 — phase-test-suite — blocking: yes — qa: auto：§9 全量。组件/web/unit/planner 全套 + 全量 jest + typecheck（build/web/e2e）+ prettier 新增不新增红。验收：§9.4 命令。
- Step 12 — phase-e2e — blocking: no — qa: manual_user：§9.3 的 e2e 与真机 QA（mid-run 切后台/返回、finished 返回、滚动、无重复行）。合并后用户执行。
- Step 13 — phase-rollout — blocking: no — qa: manual_user：release APK 冷启动、发送、切会话、回滚消息四条冒烟；`STREAM_PROJECTION_ENABLED=false` 的回滚演练（确认行 id 保持 DB id、无流式行、无 ghost）。

---

## 9. 测试策略与测试用例

### 9.1 测试层次

| 层 | 工具/文件 | 断言面 |
|---|---|---|
| 原生纯投影 | `transcript-stream-projection.test.ts` | `buildStreamingRows`/`applyStreamRowIds`/`buildStreamingTranscriptRow` 的输入输出表 |
| 原生 unit | `session-stream-unit-*.test.ts` | step 轮转、tool-use、DB 接管、去注入、settle/interrupted |
| 原生宿主 | `chat-conversation-webview.test.tsx` | `WebView.postMessage` 下行序列/载荷（不碰 web 内部 state） |
| planner | `chat-conversation-update-plan.test.ts` | 八态 + `stream-adopted` |
| web runtime | `chat-transcript-stream-projection.test.tsx`（isolateModules + 新 `helpers/fake-transcript-dom.ts`） | `state.rows`/`streamCheckpoint`/DOM/滚动 |
| seq 纯函数 | `stream-checkpoint.test.ts` | apply/ignore/resync/mergeCheckpoint 表 |
| 契约 | `code-copy.test.ts`、`mermaid-fullscreen.test.ts` | CR3 P0 前置保持绿 |
| log/i18n | `no-raw-console.test.ts`、`raw-console-baseline.test.ts`、`transcript-labels.test.ts` + core catalog tests | 守卫 |
| e2e | `chat.streaming-projection.e2e.ts` | DOM 流式行存在/同一 id/finished 后无重复 |

- **DOM harness 口径（P1-9/P1-13）**：仓库没有 jsdom / `jest-environment-jsdom`（实测 `Test-Path node_modules/jsdom` → False；`node_modules/jest-environment-jsdom` → False），不新增 jsdom 依赖。T-SP9/11/13/30 的断言面收敛为：
  - **组件身份/唯一性**：直接调用 `RowList()`/`StreamingMessageRow()` 返回 vnode，断言 `key/type/props.id`（同 key+同 type 视为不 remount；`#stream-tail` 在 vnode 层唯一）；
  - **runtime DOM 写入**：`helpers/fake-transcript-dom.ts` 只实现 runtime 实际用到的子集（`getElementById/querySelector/querySelectorAll/createElement/appendChild/insertAdjacentHTML/innerHTML/textContent/classList/setAttribute/firstChild/offsetTop/offsetHeight`），并用「body 写入调用计数 + 节点对象引用」验证 reseed 次数与节点身份；不要求 Preact 在假 DOM 里 render；
  - **文本口径**：plain 下 `body.textContent === row.text`；rich 下不与 markdown 源直接比较——用唯一明文 marker 计数或 `body.innerHTML === 期望 seed html`；finished 后 rich 断言 marker 出现次数为 1（不重复、不缺段）；
  - `row-window.test` 的 `FakeLayout` 扩展 `pinnedTail`（`__isMsgRowStub` 保持）。

- **ready fixture 迁移（P1-9）**：新增 `apps/mobile/test-utils/transcript-ready.ts`，导出 `makeTranscriptReadyPayload()`（`v:2, version:'t2', capabilities:['streamBlockCommit','streamProjection']`）与 `simulateTranscriptReady(root)`；下列文件改用共享 fixture：
  - `chat-conversation-webview.test.tsx:116,186`（`MODERN_CAPABILITIES` 加 `streamProjection`，version `t1`→`t2`）；
  - `chat-transcript-snapshot-bytes.test.tsx:296`（`version:'test'`→t2+能力）；
  - `chat-transcript-snapshot-complete-signal.test.tsx:145`（同上）；
  - `chat-transcript-snapshot-after-stream-commit.test.tsx:162-163`（`version:'test'` + 仅 streamBlockCommit → t2+能力）；
  - `chat-tab-screen.integration.test.tsx:657`（`u1`→t2+能力）；
  - `chat-conversation-bridge.test.ts:76` 的 `CONVERSATION_READY_VERSION === 't1'` 改 `'t2'`。

#### 9.1.1 既有套件处置表（P1-8）

| 套件 | Step | 处置 |
|---|---|---|
| `chat-conversation-bridge.test.ts:57-61,93` | 1/4 | 删 `streamBatch/streamCommit/streamToolInvoking` 键断言，加 `streamStatus`；14 键计数更新；ready version `t1`→`t2` |
| `chat-transcript-boot-script.test.ts:239-262,270,281,291-293,318-323,328-341` | 5/6 | 删 `case streamBatch`、`case streamCommit`；`stream.text/textHtml` 断言改 row；`className:"row stream"` 改 `row message stream`；`getElementById("stream-tail")` 改 `data-stream-status`；相位阶梯 `:247-248/:323-324` 换新三值；`:261-262` 的 `stream.textHtml/thinkingHtml` 与 `:292-293` 清空断言删；T-BR-CT-04（`:328-341`）整段删（`scheduleMermaidScan` 不在本文件，见 stream-block/mermaid 行） |
| `chat-transcript-entry.test.ts:80` | 6/9 | dist version `t1`→`t2` |
| `chat-transcript-row-window.test.ts:35,309` | 6 | `jest.mock` 从 `StreamTail` 改 `StreamingMessageRow`；`key==='stream-tail'` 断言改 `data-stream-status`/pinnedTail |
| `chat-transcript-snapshot-chunk.test.ts:21,31,118-165` | 5 | 删 `setStreamToolInvokingDom/generating`；改断言 `stream` checkpoint + reseed |
| `chat-transcript-snapshot-after-stream-commit.test.tsx:162-163,229,262,293` | 5/8 | ready `version:'test'`→共享 t2 fixture；删 `commitSyntheticAssistantRow/tryCommitStreamTail` 用例；改 interrupted `streamRows` 快照用例 |
| `chat-transcript-stream-block.test.ts:55-77,177-182,185,210,216,235-240` | 6 | 删 `case streamCommit/materializeStreamDisplay`；`:55-77` 的 `state.stream.textHtml=''`/`markStreamPlainTarget` 断言删；`:210` 的 `carriesTail` 断言删/改；`scheduleMermaidScan` 计数 5→3；加 `tailHtml`/`blockKey`/尾容器不写全量 |
| `subagent-session-screen-metrics.test.tsx:126-127` | 8 | 删除 `jest.mock('@/screens/tabs/chat-tab/useInterruptedPartialCommit')`（模块整文件删除，残留 mock 会让套件解析失败） |
| `chat-conversation-panel.integration.test.tsx:55,64,74,498-616` | 3 | mock ref 方法面 7→3；补 `streamingRows/streamRowIds` props；`:498-616` 的 `commitSyntheticAssistantRow` ready 后补交/去重/重挂重提整段删；`interruptedUnitView`（`:507-527`）补 `streamRows/streamRowIds` 字段 |
| `chat-tab-screen.integration.test.tsx:15,601-700,657` | 3/4 | 删 `CONVERSATION_CAPABILITY_COMPOSER_DOCK` import；T-R3 的 streamDelta 注入改走 `pushStream/streamStatus` 或删除注入用例；ready `u1`→t2+能力 |
| `chat-transcript-bridge.test.ts:1-9,32-33,49-50,65-66` | 4/6 | 删 `encodeHostToTranscript/encodeTranscriptToHost/decodeHostToTranscript/parseScrollSnapshotFromHost` round-trip 用例；保留 `scroll schema re-export` 运行时 parity，并保留 T-BR1/T-BR2：用 `declaredWireTypes()` 解析 `ChatTranscriptBridge.ts` 的 union 声明源做运行时清单对账（下行 12 条、上行含 `streamResync` 17 条），与 `Record<Union, true>` 的 tsc 穷尽一起构成**运行时 parity + 编译期穷尽双层守护**（S11）；不恢复已删的运行时编解码 round-trip，也不得把 T-BR1/T-BR2 视为“只靠 tsc”而删除 |
| `mermaid-webview.test.ts:176-179` | 6 | `scheduleMermaidScan` 断言点去掉 `applyStreamCommit` 两处（计数 5→3） |
| `chat-conversation-webview.test.tsx:236-237,683-771,1118-1229,1268-1329,1745-1772` | 4/7/8/11 | 逐条：`streamingText` props 用例删；`restore` 断言改 `preserve`；`pushStreamDelta/pushStreamBatch/tryCommitStreamTail` 用例改 `pushStream/streamStatus`；F（0ms defer）删并按 T-SP27 重写 |

### 9.2 测试用例（T-SP 系列）

> 每条给「变异证据」：故意改坏对应实现时该测试必须变红。

| ID | blocking | 层次 | 断言 | 变异证据 | Step |
|---|---|---|---|---|---|
| T-SP1 | yes | 纯投影 | `buildStreamingRows`：starting/running → 当前 streaming；step 提交后 finished-未接管与当前 streaming 同现；interrupted partial → finished 无 messageId；空记录 → 空数组；`applyStreamRowIds` 只改 assistant 行，id/messageId/status 正确；**同输入两次调用返回同一数组，内容变化才换引用** | 把 `status` 写成常量 streaming → interrupted 用例红；只返回最后一条 → 双行用例红；每次新建数组 → 引用稳定断言红 | 3 |
| T-SP2 | yes | 宿主 | ready 后首条快照：有流式行时 `chunkTotal = DB片 + 流式片`，流式片 `rows` 可含 1~N 条（finished-未接管 + 当前 streaming 同片/按 256KB 拆片），末片带 `stream={id,seq,status}`；空会话 run 也发快照；无流式行时不发空片；step 提交到 DB reload 之间，上一轮 finished-未接管行与当前 streaming 行**同时**出现在流式片 | 删掉流式片 → 空会话用例红；只带当前 streaming 行 → 上一行丢失断言红；不按字节拆 → 超限断言红 | 3 |
| T-SP3 | yes | 宿主 | 流式片行 `id=streamId`、`messageId` 缺省、`status=streaming`、text/thinking/tools 完整；richText 时 html 为全量文本；finished-未接管行 `status=finished` | 只带尾块 html → 断言红 | 3 |
| T-SP4 | yes | 宿主 | delta 连续：每条 `streamDelta` 带同一 `streamId`，seq 1,2,3…；rAF 合流不制造空洞；`streamBlockCommit.seq` 等于所属 delta seq | 在 rAF 里重置 seq → 连续性断言红 | 4 |
| T-SP5 | yes | 宿主 | status 翻转：`streamStatus` **必带全量终态 row**（多块 richText 下 `row.text` 含全部已提交块、`textHtml` 为全量）；不发 `streamReset`/`sessionSnapshot`/`streamToolInvoking`；文本不变 | 只发 `{status}` 不带 row → `row.text` 缺段断言红；改成发 restore 快照 → 断言红 | 4 |
| T-SP6 | yes | 宿主 + planner | DB 接管：新增 assistant 命中 `streamRowIds` → 不发 append/snapshot，发 `streamStatus{row}`；`planMessagesUpdate` 返回 `stream-adopted`；**一次更新命中 2 条 adopted → 两条 streamStatus 都带 row/messageId**；messages/streaming effect 两种顺序最终行都恰好一条且不消失；单 step settle + adoption 最终行仍存在 | 删 `stream-adopted` → 重复 append 断言红；只发最后一条 → 第一条 messageId 缺失断言红；无条件 reset → 最终行消失断言红 | 4 |
| T-SP7 | yes | web | `applySnapshot` 原子：`rows` 与 `streamCheckpoint` 同一同步块更新；中间无 `renderRows`；旧 `state.stream` 引用不存在；`mergeCheckpoint` 四象限 | 把 checkpoint 更新放到 rAF → 测试红；异 id 取 max seq → merge 断言红 | 5 |
| T-SP8 | yes | web | 乱序/旧快照：同 id 本地 seq 更大时不被回退；**delta(seq N+1) 先到、旧快照(seq N) 后到**时 checkpoint 保持 N+1、后续 delta N+2 仍连续；不同 id 以新快照为准；无 stream 的快照清 checkpoint 并移除流式行；内容未变的第二次快照 **body 写入次数 0**（允许 `applySnapshot` 的壳 `renderRows`，但 `reconcile` 不写 body） | 先 mergeCheckpoint 再判 rewind → 旧快照回退断言红；checkpoint 赋 incoming seq → delta N+2 被判 gap 断言红；reconcile 不查签名 → 二次写入计数断言红 | 5 |
| T-SP9 | yes | web | delta：`seq=applied+1` 应用；`seq<=applied` 丢弃；`seq>applied+1` 不应用且 post `streamResync`；snapshot 到达后 `resyncPending` 清空、`resyncSentAt` 保留；snapshot 后 gap 恢复 reseed：plain `body.textContent === row.text`，rich 用唯一 marker 计数（见 §9.1 口径） | 把 gap 当 apply → 文本半截断言红；只改 state 不 reseed → body 写入计数/文本断言红 | 5 |
| T-SP10 | yes | web | `streamBlockCommit`：`seq<=applied` 且 streaming 才应用、未知 streamId/已 finished 忽略；同一 `blockKey` 重复投递只 append 一次；块提交不推进 checkpoint；`fullReplaceOnly` 期间忽略；finished 后迟到 commit 与 350ms 升级 timer 零渲染 | 删 `blockKey` 去重 → 重复 DOM 断言红；不判 finished → 迟到 commit 触发 renderRows 断言红 | 5 |
| T-SP11 | yes | web | `StreamingMessageRow`：只有 streaming 行 vnode props 带 `id='stream-tail'`，finished/历史行只有 `data-id/data-stream-id`（vnode 层唯一）；streaming 有 bar，finished 无 bar；status 翻转 vnode key/type 不变（fake body 节点引用不变）；finished 后 plain 文本 === row.text、rich marker 计数 1（含多块），窗口卸载重建后仍不丢已提交块；finished 折叠键 `msg:<id>` 两行互不影响、重建后展开态保持；tools 先到 text 后到只有一个 `.bubble-body` | 在 finished 时换组件类型 → vnode type 断言红；finished 行也保留 id → 重复 id 断言红；只带尾块 html → 多块 marker 缺段断言红 | 6 |
| T-SP12 | yes | web | `applyStreamStatus` 文本只增不减；`row` 带更长文本时替换，带更短文本时**text 与 textHtml/thinkingHtml 成对保留本地**（finished 后 DOM 文本 === 保留的 row.text，rich 用明文 marker 计数）；`row.text` undefined 不判短；校验 row.id/role/status；tools 覆盖；messageId 不丢 | 直接 `row.text=` 赋值 → 截短断言红；只保 text 不保 html → DOM 变短断言红 | 6 |
| T-SP13 | yes | web | RowList：流式行计入 total/空态；无 `StreamTail` 兄弟；用户上滚到窗口外时流式行钉在下占位之后（vnode 仍在且与窗口循环同 `<MessageRow key={row.id}>` 类型）、下占位少算 1 行、`measureRowWindow` 槽高不被放大；窗口跨过流式行前后 fake body 节点引用不变、`#stream-tail` vnode 唯一 | 去掉钉住 → 流式行卸载断言红；下占位不减 1 → 槽高断言红；钉住分支换组件类型 → vnode type 断言红 | 6 |
| T-SP14 | yes | web | 滚动：streaming 增长贴底用户跟随；上滚用户距底偏移不变；finished bar 消失不跳底 | 去掉 `scheduleStickIfNearBottom` → 贴底断言红 | 6 |
| T-SP15 | yes | unit | assistant `STEP_COMMITTED`：冻结旧记录（文本保留）、开新 streamId、不发 reset-stream；tool_results 不轮转；**同毫秒建两个 unit 的 ordinal 0 id 不同（unitEpoch）** | 在 commit 里 `resetPartial` 后不冻结 → 文本丢失断言红；用 startedAtMs 造 id → 同 ms 断言红 | 2 |
| T-SP16 | yes | unit | tool-use 事件：`EVENT_AGENT_STREAM_TOOL_USE` → 当前记录 tools 追加 pending，按 toolUseId 去重；非 running/错 runId 忽略；**生效即向可见句柄推 `stream-batch{streamId, segments:[], tools}`**；宿主最终产生 `streamDelta{segments:[], tools}` | 不推 tools-only batch → 宿主无 delta 断言红 | 2 |
| T-SP17 | yes | unit | DB 接管：reload 后新增 assistant 一一配对；多余 assistant 不配对；`streamRowIds` 有界且迁移给新单元 | 把失败行也配对 → messageId 断言红 | 2 |
| T-SP18 | yes | 宿主 | 可见性：covered+pushes → `preserve` 快照、不重挂、无 `restore`、无 `streamReset`；pushes=0 无动作；dirty 仍重挂；**可见期间有推送 + hidden 期间零推送 + 恢复 → 无动作（hidden:true 已清零计数；0 推送不存在重挂分支，与四象限表一致）** | 改回 `restore` → 断言红；hidden 不清零 → zero-push 用例误判 pushes>0 断言红 | 7 |
| T-SP19 | yes | 宿主 + unit | interrupted：unitView partial → 快照含 finished 流式行；无 `commitSyntheticAssistantRow` 调用；新基线重新出现；**rollback/fork 调 `requestStreamReset` 后 `clearStreamProjection` 生效，force snapshot 不再含该 partial 行（含 interrupted）；reset 与分片快照同拍时旧末片被 generation 作废、行不复活** | 删 interrupted 投影 → 快照无行断言红；只广播 reset 不清 unit → 回滚后 partial 复活断言红；不 bump generation → 旧末片复活断言红 | 8 |
| T-SP20 | yes | 宿主 + 源面 | ready：v2+t2+streamProjection 接受；t1/缺能力立即错误态；`TRANSCRIPT_READY_VERSION==='t2'` 且能力清单含 streamProjection | 把版本判定删掉 → t1 用例红 | 9 |
| T-SP21 | yes | adapter | adapter 三映射（pushStream/reset/force）各一条；`stream-batch.streamId` **原样透传**（不猜宿主当前 id）；reset 带 `streamIds` 透传 | 给 adapter 加 stream-delta 分支 → 测试红；丢弃 streamId → 透传断言红 | 2 |
| T-SP22 | yes | i18n | `LABEL_KEY_DOMAINS` 含 `transcript` 且 `LABEL_MESSAGE_KEYS`/zh-CN/en-US catalog 含 4 key，`catalog.test`/`parse-core-catalog.test` 绿；`init.labels` 与 core catalog 4 key 一致；web 缺省回退默认；RowList/StreamingMessageRow/ToolInvokingBar 源文件不出现四个字面量（文件级扫描） | 不加域 → parseCoreCatalog throw 断言红；改 catalog 值 → parity 红 | 10 |
| T-SP23 | yes | web | 完整路径：mid-run snapshot（seq 5）→ 后续 delta 6/7 → 再 snapshot（seq 7）→ finished，文本不重复、不回退 | 让 snapshot 不 flush pending → 文本重复断言红 | 5/6 |
| T-SP24 | yes | web | finished resume：finished 后普通 snapshot 替换 rows，同 id 保留 DOM、bar 消失、无重复行 | 让 finished 快照换 id → 重复行断言红 | 6/7 |
| T-SP25 | yes | web | 最终消息不重复：DB 接管 snapshot 的 rows 中该 assistant 恰好一条；行数 = DB 可见行数（流式行不额外计数） | 同时保留流式行与 DB 行 → 行数断言红 | 6 |
| T-SP26 | yes | unit/宿主 | mid-run resume：web 重建（repaint/ready）→ snapshot 含完整流式行；不调用注入；后续 delta seq 从 snapshot seq+1 继续；rich 流重建后 `row.text` 完整 | 恢复注入路径 → 重复正文断言红；handleReady 不 disarm → 块重复断言红 | 2/3 |
| T-SP27 | yes | 宿主 | **新收尾链路终态确定性**：`streamingRows` new-id 同拍「旧 id finish + 新 id begin」时，无论「finish 先」还是「delta 先（预期一次 resync/快照）」两顺序，最终文本/行数不丢不重；同帧 begin+flush 的 seq 连续；删除旧 F（0ms defer）用例 | 任一顺序丢/重文本 → 终态断言红；finish 不带 row → 全量断言红 | 4/11 |
| T-SP28 | yes | 宿主/接线 | Panel/Provider/Subagent 把 `streamingRows/streamRowIds` 真正传到宿主（mock 组件 props 断言）；`useInterruptedPartialCommit` 不再被调用 | 漏传 props → 组件 props 断言红 | 3 |
| T-SP29 | yes | 宿主 | `streamResync` 宿主 100ms 限流：同 streamId 两条上游只发一次 `preserve` 快照；间隔 >100ms 再发一次 | 删限流 → 双快照断言红；永远限流 → 第二次不发断言红 | 4 |
| T-SP30 | yes | web | 快照 seed 后的块状态：richText 多段 + snapshot(seq>0) + 后续新块 + 收尾，body 中每个唯一 marker 恰好一次（`fullReplaceOnly` 生效）；空 streaming 新 step 仍可块切分 | 快照后继续用 tailHtml → 丢 seed 前缀断言红；全量 html 写进尾容器 → marker 重复断言红 | 5/6 |
| T-SP31 | yes | web | plain 路径：首包/连续 delta/tools-only 拍都只 `appendEscapedDelta` 增量，不整段替换；body 节点引用不变，`row.text` 与 body 文本一致；richText 中途从关到开后 streaming body 立即 reseed 全量 html；**richText 从开到关后 body 重播种为 `row.text` 纯文本，不混杂旧 markdown HTML** | 改成整段替换 → 节点引用/文本断言红；richText 开关不 reseed → body 无 html/混杂断言红 | 5/6 |
| T-SP32 | yes | unit | `snapshot()` 引用稳定：内容未变时 `streamRows`/`streamRowIds` 两次返回同一引用；text/tools/messageId 变化才换新引用；metric/usage tick 不换 | 每次新建数组/Map → 引用断言红 | 2 |
| T-SP33 | yes | 纯函数/宿主 | 回滚开关等价面（不切模块常量）：`applyStreamRowIds(rows, EMPTY_MAP)` 原样返回；`planMessagesUpdate` 收空 `streamRowIds` 时不会返回 `stream-adopted`（走原 append/snapshot）；`buildStreamingRows(null)` 空数组 | 空 map 仍改写 id → 行 id 断言红；空 map 仍 adopted → planner 断言红 | 3/4 |

> 说明：T-SP23~T-SP26 覆盖用户点名的 mid-run resume、finished resume、delta gap、snapshot/delta 乱序、最终消息不重复；滚动由 T-SP14 覆盖；旧 bundle 兼容由 T-SP20 覆盖；rich 多块收尾/重建由 T-SP5/T-SP11/T-SP30 覆盖。`T-SP1` 在 Step 3 落地；`T-SP33` 在 Step 3/4（projection + planner）；`T-SP21`（adapter 三映射）在 Step 2；log 守卫由 Step 10 的 `no-raw-console`/`raw-console-baseline` 独立覆盖。
>
> 测试口径（S10）：T-SP16 的宿主 `streamDelta{segments:[],tools}` 端到端、T-SP26 的 `seq = cp.seq + 1` 续接、T-SP28 的 props 内容断言（非 defined/instanceof 级）、T-SP30 的 marker 恰好一次、T-SP11 的 fake body 节点引用断言，均按原强度保留，由 P2-18 补测落地，不降级。

### 9.3 e2e 计划

> **本轮状态：deferred（文件未交付）**。`apps/mobile/e2e/pageobjects/chat-transcript.page.ts` 的 5 个观测方法、`e2e/scripts/mock-anthropic-provider.mjs` 的 `E2E_MOCK_STREAM_DELAY_MS`/`E2E_MOCK_STREAM_CHUNKS`/`E2E_MOCK_TOOL_USE` 三个开关与 `e2e/specs/chat.streaming-projection.e2e.ts` 均未落地（`git diff --name-status main...HEAD -- apps/mobile/e2e` 为空；`apps/mobile/e2e/specs` 只有既有 6 个 spec）。替代 QA：按 §12「真机 QA」人工覆盖「流式行存在且是最后一行 / finished 后 data-id 不变且无重复行 / tool step 状态 pending→completed / mid-run 切后台返回」；自动化 e2e 留作后续迭代，`manual_user` 不阻断合并（对应 P2-12）。

现状（`gates.md` §3）：6 个 spec 零 stream/visibility 断言；`chat-transcript.page.ts` 没有流式观测方法；mock provider 只回最小 SSE。计划：

1. **页面对象**（`apps/mobile/e2e/pageobjects/chat-transcript.page.ts`）新增：
   - `waitForStreamingRow(timeout=15000)` → `$('[data-streaming="1"]')`；
   - `getStreamingRowId()` → `getAttribute('data-id')`；
   - `waitForStreamingFinished()` → `$('[data-stream-status="finished"]')`；
   - `countRowsWithId(id)` → `$$(`[data-id="${id}"]`)`。
2. **mock provider**（`e2e/scripts/mock-anthropic-provider.mjs`）：支持 `E2E_MOCK_STREAM_DELAY_MS`（默认 150）与 `E2E_MOCK_STREAM_CHUNKS`（默认 6），按 SSE 逐块吐 text；**`E2E_MOCK_TOOL_USE=1` 必须带请求计数器：第一次 `POST /v1/messages`（Anthropic SSE；该 mock 只放行这个路由，其余 404）返回一个 `tool_use`（读 fixture 工作区里的固定文件），收到带 `tool_result` 的第二次请求后返回最终 text + `end_turn`；不能像现在这样每个请求都固定 `text_delta + end_turn`，否则 E3 要么没有 tool step，要么反复 tool_use 循环（P2-6）。**
3. **e2e 前置（P1-12，照 `e2e/README.md:18-31,128-147` 与 mock 脚本头注释）**：
   - **钉设备**：Appium/WDIO 用 `E2E_UDID=<serial>`；fixture 脚本（`inject-tool-turn-fixture.mjs` 的裸 `adb`）只认 `ANDROID_SERIAL`，所以跑 `mobile:e2e:fixture` 时必须同时导出 `ANDROID_SERIAL=<serial>`（或统一用 `ANDROID_SERIAL`），否则多设备时 DB 注入可能打到另一台（P2-5）；
   - `npm run mobile:e2e:prepare`（装 uiautomator2 驱动）；
   - `npm run mobile:e2e:fixture`（把 provider base_url 指到 `http://127.0.0.1:9753` 并注入/重置 fixture；脚本会 force-stop 应用，必须在 WDIO 之前跑）；
   - 单独终端启动 mock：`E2E_MOCK_STREAM_DELAY_MS=1000 E2E_MOCK_STREAM_CHUNKS=20 E2E_MOCK_TOOL_USE=1 node apps/mobile/e2e/scripts/mock-anthropic-provider.mjs`（**mock 不由 wdio 启动**；tool 用例才开 `E2E_MOCK_TOOL_USE`；1000×20 约 20s，必须大于 `sendComposerMessage` 的 settle 窗口）；
   - `adb reverse tcp:9753 tcp:9753`；debug 包另需 Metro（真实路径 `cd apps/mobile && npx react-native start`）+ `adb reverse tcp:8081 tcp:8081`；
   - `npm run mobile:e2e:build-apk`（先 `build:webview:native` 再 gradle）；真机安装需用户确认；`appium:noReset=true`，禁止卸载/清数据；
   - fixture spec 需 `E2E_RUN_FIXTURE_SPECS=1`；新 spec 自建/清理项目与会话，遵守 README 隔离模型。
4. **spec**（`e2e/specs/chat.streaming-projection.e2e.ts`）：
   - **观测时点（P1-13，已按实读 pageobject 修正）**：`sendComposerMessage` 内部先 `waitUntil` 行数增长、再 `waitForTranscriptSettled`（3×700ms，且每次 `countMessages()` 都 `openWebView()`），所以「发送后立即」在它返回时已经过了整个 settle 窗口；mock 400ms×8=3.2s 余量太薄。因此：① 给 page object 新增 `sendComposerMessageRaw`（只输入+点发送，不做 waitUntil/settle），e2e 用它发送后**立即** `waitForStreamingRow`；② mock 调成 `E2E_MOCK_STREAM_DELAY_MS=1000`、`E2E_MOCK_STREAM_CHUNKS=20`（总时长约 20s，远大于 settle 窗口），`waitForStreamingFinished` 超时设 30000；③ 在流式行出现时取 `countAtStreaming = countMessages()`，基线用 `getMessageIds().length`（page object 只数 user 行）交叉校验；`sendComposerMessage` 仍用于非流式基线用例。
   - T-SP-E1：流式行存在且是最后一行；`getStreamingRowId` 记为 A；`waitForStreamingFinished`；**等 `[data-id=A] .message-menu-btn` 出现（仅 finished && messageId != null，证明 DB 接管）**；断言 `data-id` 仍为 A、`countRowsWithId(A).length === 1`、bar 不存在、`countMessages() === countAtStreaming`（流式行原地变最终行，行数不增）。
   - T-SP-E2（manual）：run 进行中按 Home/切到工作区再回聊天 → 流式行仍在、id 不变、无重复；收尾后返回 → bar 消失。
   - T-SP-E3：tool step 下流式行与 tool 卡片共存，finish 后 tool 卡状态从 pending → completed（需要 mock tool_use）。
5. **为什么 e2e 不是自动 gate**：真机安装需用户确认、`noReset:true` 禁止卸载/清数据（AGENTS.md）、现有 e2e 无 in-flight 时序钩子（`gates.md` §3.2）；e2e 作为 `manual_user` 合并后验收。gap/乱序无法在真实 postMessage 上稳定制造，由 web harness（T-SP8~T-SP10）覆盖。

### 9.4 验收命令

```bash
# 1) 单套件（带预构建）
npm run test -w @novel-master/mobile -- --silent chat-conversation-webview
npm run test -w @novel-master/mobile -- --silent chat-conversation-update-plan
npm run test -w @novel-master/mobile -- --silent chat-conversation-panel.integration
npm run test -w @novel-master/mobile -- --silent chat-transcript-row-window
npm run test -w @novel-master/mobile -- --silent session-stream-webview-adapter
npm run test -w @novel-master/mobile -- --silent chat-transcript-stream-projection
npm run test -w @novel-master/mobile -- --silent transcript-stream-projection
npm run test -w @novel-master/mobile -- --silent stream-checkpoint
npm run test -w @novel-master/mobile -- --silent session-stream-unit
npm run test -w @novel-master/mobile -- --silent chat-transcript
npm run test -w @novel-master/mobile -- --silent chat-tab-screen.integration
npm run test -w @novel-master/mobile -- --silent subagent-session-screen-metrics
npm run test -w @novel-master/mobile -- --silent chat-transcript-snapshot-after-stream-commit
npm run test -w @novel-master/mobile -- --silent no-raw-console
npm run test -w @novel-master/mobile -- --silent raw-console-baseline
npm run test -w @novel-master/mobile -- --silent transcript-labels
# 2) 契约（CR3 P0 前置）
npm run test -w @novel-master/mobile -- --silent code-copy
npm run test -w @novel-master/mobile -- --silent mermaid-fullscreen
# 3) 全量（CI 同款）
cd apps/mobile
node ../../node_modules/jest/bin/jest.js --config jest.config.js --silent --maxWorkers=2
# 4) 三处 typecheck（build / src/web / e2e）
cd <repo root>
npm run typecheck -w @novel-master/mobile
# 5) webview 构建（门 A/B/C）
npm run build:webview -w @novel-master/mobile
npm run build:webview:native -w @novel-master/mobile
# 6) nm style / log / i18n / prettier / encoding
#   见 §7.5
# 7) e2e（可选，manual_user；需 debug APK + 真机确认；前置见 §9.3）
E2E_UDID=<serial> npm run mobile:e2e:prepare
E2E_UDID=<serial> npm run mobile:e2e:fixture
# 另开终端（E2E_MOCK_TOOL_USE=1 仅在 T-SP-E3 需要）：
# E2E_MOCK_STREAM_DELAY_MS=1000 E2E_MOCK_STREAM_CHUNKS=20 E2E_MOCK_TOOL_USE=1 node apps/mobile/e2e/scripts/mock-anthropic-provider.mjs
adb reverse tcp:9753 tcp:9753
npm run mobile:e2e:build-apk
E2E_UDID=<serial> E2E_RUN_FIXTURE_SPECS=1 npm run mobile:e2e -- --spec e2e/specs/chat.streaming-projection.e2e.ts
```

---

## 10. 风险与回滚方案

### 10.1 风险

| # | 风险 | 证据/成因 | 缓解 |
|---|---|---|---|
| R1 | DB id 接管配对错误：一个 step 新增多条 assistant 或 reload 合流 | core 每 step 一条 assistant（`agent-runner.ts:724-761`），失败路径额外 append `[生成失败]`（`:952-982`）；reload 可能合流 | 只配对 `pendingAdoptions` 数量；多余行不配对；失败行不配；不配时保留 streamId 行并 warn；T-SP17 |
| R2 | 流式行被窗口卸载后块级 DOM 丢失 | 块级已完成块只存在于 DOM（`web.md` R-5；`stream.ts:485-558`） | streaming 行钉在窗口外下占位之后（§3.2），流式期间不卸载；finished 行可卸载，重挂时用行内完整 text/textHtml 重建；T-SP13 |
| R3 | snapshot 与 delta 乱序/重复正文/漏 delta | 分片 yield + rAF 合流 + 旧代次；`StreamBodyHost.shouldUpdate=false` | 宿主在快照开始与流式片前 flush；Web checkpoint + rewind 保护；gap snapshot 后 `reseedStreamingRow` 重写 body（§3.4）；T-SP8/T-SP9/T-SP23 |
| R4 | 旧 dist 进入新协议导致白屏 | 资源随 APK 同包，但手工安装/陈旧 dist 可能 | ready `t2 + streamProjection` 严格判定，立即错误态；T-SP20 |
| R5 | 单元 30s 宽限销毁后 `streamRowIds` 丢失 → 行 id 回退触发 remount | `removeUnit` 只交接 messages（`manager:1755-1771`） | `streamRowIds` 一并交接 idle 视图（合并后 trim 到 200）；出表后新单元 `startRun`/`adoptConsumptiveUnit` 从 idle `inheritStreamRowIds`；消费侧按**非空优先**，空 Map 不遮蔽 idle 映射；冷启动无映射走 DB id（Web 文档重挂，无抖动） |
| R6 | 收尾截短文本 | `resetPartial` 在冻结前执行会清空 `streamRows` 的当前行文本 | 先冻结再 reset（T-SP15）；Web 端只增不减（T-SP12/T-SP18） |
| R7 | tool 状态不更新 | manager 当前未订阅 `EVENT_AGENT_STREAM_TOOL_USE`（`event-types.ts:14`；`manager:452-523`） | 新增订阅 + T-SP16；DB 接管时用 DB tools 覆盖 |
| R8 | 流式期间 CPU/桥流量：每个 delta 全量 html | P0-1 修正后 `textHtml` 为全文；`prepareTranscriptRichHtml` 对 12k 文本 markdown-it+sanitize，64ms 约 15 次/秒；**Web 侧：任何 mid-run 快照（visibility/pendingSubagents/richText/force）只要带来更新内容就置 `fullReplaceOnly`，此后整个 step 的每个 delta 都 `applyTrustedHtml(.bubble-body, 全量 html)`（64ms 约 15 次/秒、12k 文本），从块级增量岛退回全量重绘** | `streamCommitted*HtmlPartsRef` 缓存已提交块 html，每拍只 parse activeTail，`committedHtml.join('') + tail`；`fullReplaceOnly` 按 §3.5 保持到新 streamId/streamReset，宿主 seed 后 `streamBlockArmedRef=false` 直到下一个新 step（§3.5 快照 seed 规则），**本 step 内不可能恢复块模式**——这是已知成本，不写「首个 delta 后恢复」；缓解改为：mid-run 快照只在必要时发（visibility 有推送才发、pendingSubagents 合并）、快照后不重复发；要恢复块模式必须同时改宿主 armed 与 Web fullReplaceOnly 两处，不在本轮；R8 同时保留 props 引用/effect 频率缓解 |
| R9 | 失败/中断 partial 在宽限后消失 | settle 空记录丢弃；unit 出表后 idle 无合成行 | 明确行为：失败 partial 在 30s 内可见，之后由 DB 错误行接管；rollback/fork 主动清投影+持久 partial（P0-4）；真机 QA 确认可接受 |
| R10 | CR3 P0/P1 未修导致全量 jest 红 | 当前 2 failed / 2165 passed（`gates.md` §2.3） | 前置：先修 `code-copy`/`mermaid-fullscreen`；T-SP27 已改为新链路确定性断言（不再依赖已删的 0ms defer） |
| R11 | 探针文件提交不完整导致编译红 | CR3 P2-11 | 本轮直接删除探针与 3 处 import（C16），不保留 |
| R12 | i18n 新增 key 与 catalog 漂移 | `generated-catalog.ts` 由脚本生成 | 跑 `gen-i18n-catalog.mjs` + catalog tests（§7.4） |
| R13 | prettier 本机假红 | Windows CRLF，prettier 2.8.8 默认 lf（`gates.md` §5） | 只承诺新增文件不新增红，本地加 `--end-of-line auto` |

### 10.2 回滚方案

1. **开关回滚**（最快，不发版）：`STREAM_PROJECTION_ENABLED=false` → 宿主不发流式行/消息，只按 DB 消息发快照。验收：发送一条消息，文本在 step 结束出现、无 ghost、无崩溃。
2. **代码回滚**：revert 本迭代合并提交（host + web 同包）。无持久层迁移，旧协议 ready `t1` 与新/旧 dist 的匹配由构建链保证。
3. **资源回滚**：重新 `build:webview:native` 并提交 APK；禁止只换 dist 不换 RN 或反之（ready t1/t2 不匹配会被 fail-fast）。
4. **数据回滚**：`session_run_state` 无 schema 变化；`streamRowIds` 是内存态，重启即丢，天然回滚。
5. **回滚后验证**：T-SP20（版本门）、真机冷启动 + 发送 + 切后台 + 回滚消息四条冒烟；全量 jest 绿。

---

## 11. Step / T 映射矩阵

| Step | blocking | 覆盖 T |
|---|---|---|
| 1 phase-contract-freeze | yes | —（契约冻结；行为 T 在后续 Step） |
| 2 phase-unit-projection | yes | T-SP15、T-SP16、T-SP17、T-SP21（adapter）、T-SP26、T-SP32 |
| 3 phase-native-snapshot | yes | T-SP1、T-SP2、T-SP3、T-SP26、T-SP28、T-SP33 |
| 4 phase-native-wire | yes | T-SP4、T-SP5、T-SP6、T-SP27、T-SP29、T-SP33 |
| 5 phase-web-rows | yes | T-SP7、T-SP8、T-SP9、T-SP10、T-SP23、T-SP30、T-SP31 |
| 6 phase-web-render | yes | T-SP11、T-SP12、T-SP13、T-SP14、T-SP23、T-SP24、T-SP25、T-SP30、T-SP31 |
| 7 phase-visibility | yes | T-SP18、T-SP24 |
| 8 phase-interrupted | yes | T-SP19 |
| 9 phase-dist-guard | yes | T-SP20 |
| 10 phase-cleanup | yes | T-SP22 |
| 11 phase-test-suite | yes | T-SP27 + 全量回归 |
| 12 phase-e2e | no | T-SP-E1~E3（manual_user） |
| 13 phase-rollout | no | 真机冒烟 + 回滚演练（manual_user） |

---

## 12. 验收清单（交付时逐条勾）

- [ ] `state.stream` / `StreamState` / `StreamTail` / `streamBatch` / `streamCommit` / `streamToolInvoking` / `generating` / `streamingText` 全仓零生产引用（`git grep` 为空，测试除外）。
- [ ] 流式行是 `state.rows` 最后一条，`status` streaming→finished 原地翻转，DB 接管后 `id` 不变、`messageId` 补齐、无重复行。
- [ ] 任意 snapshot 携带 `stream {id, seq, status}`；delta 连续 seq 应用，gap 触发 `streamResync`。
- [ ] 可见性恢复只发普通 `preserve` 快照；dirty 仍重挂；pushes=0 无动作。
- [ ] 旧 dist（ready t1 / 无 streamProjection）立即错误态，不白屏。
- [ ] `session-stream-unit` 不再注入 partial；mid-run resume 由 snapshot 完成。
- [ ] log 守卫绿（本轮改动文件零裸 console + 全仓 18 文件/36 处（业务 16/30）基线不增长）；either 审计无新增；i18n 4 key + labels 下发；nm style 报告表完整（含 check-methods AMBIGUOUS 信息项口径说明）。
- [ ] 全量 jest（`--maxWorkers=2`）+ 三处 typecheck + `build:webview` 门 A/B/C + prettier 新增不新增红。
- [ ] e2e（`chat.streaming-projection.e2e.ts`）本轮 **deferred**（文件未交付，见 §9.3）；以真机 QA 替代，合并后 `manual_user` 验收。
- [ ] 真机 QA（manual_user）：mid-run 打开 FileEditor/工作区返回、finished 返回、滚动不跳、无重复行、tool step 正常。
- [ ] `STREAM_PROJECTION_ENABLED=false` 回滚演练：行 id 保持 DB id、无流式行、无 ghost。
