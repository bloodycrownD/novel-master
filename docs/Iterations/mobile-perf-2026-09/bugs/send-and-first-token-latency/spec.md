# SPEC：发送卡顿 / 首字延迟（本轮改动 + 验收 + 待验证）

- 日期：2026-09-30
- 关联 PRD：`./prd.md`（现象与三路探索结论）
- 原则：本轮只做**语义等价的数据访问瘦身**与**线程归属修正**，不改任何业务
  判定；每项都留回归锁（把实现改回去必须红）。

## A. 已实施改动

### A1 `backfillMissingBaselines` 全量扫描改头投影（② 主源）

- `packages/core/src/domain/message-checkpoint/logic/backfill-baseline-checkpoints.ts`
  - `backfillBaselineCheckpoints`：`messageRepo.listBySession(sessionId)` →
    `listMessageHeadersBySession(sessionId)`（只用 id 与顺序，**不解压正文**）。
  - `createBaselineCheckpointBackfillOperation.detect()` 的全量回退分支同款替换。
- 语义等价：两个方法都按 seq 升序返回**含 hidden** 的全集，差异只在是否解压
  正文列。
- 回归锁（`test/message-checkpoint/backfill-cursor.test.ts`）：观测面从
  `spyListBySession` 改为 `spyFullSessionReads`——`callCount()` 数头投影全量读
  （= 全量扫描是否发生，短路仍须为 0），新增 `contentCallCount()` 数
  `listBySession`（**全量扫描路径上必须恒为 0**，否则「每轮发送前等几秒」回归）。

### A2 每 step 的会话读改 SQL 层滤 hidden（③B）

- `packages/core/src/service/agent/impl/chat-agent-session.ts`：`list()` 由
  「全量拉回 + JS filter」改为 `listBySession(sessionId, { includeHidden: false })`。
- 语义等价（返回集合完全一致）；收益：压缩/置位后的会话里 hidden 常占多数，
  原先每 step 都要把它们解压一遍。

### A3 非 gemini 协议不再每 step 白读全会话（③B）

- `packages/core/src/service/agent/impl/agent-runner.ts`：`listAllSessionMessages`
  （**含 hidden** 的全量读，只为 gemini 的 function-call 名字回查）改为仅在
  `protocol === "gemini"` 时取。
- 依据：该值只被 `gemini.adapter` 透传给 `gemini-content-mapper`，openai /
  anthropic 适配器不消费。

### A4 原生分词计数切出 NativeModules 队列（③A）

- `packages/tokenizer-driver-rn/android/src/main/java/com/novelmaster/tokenizer/TokenizerModule.kt`：
  `countPrompt` 的计数体移入模块自有的**单线程 daemon executor**（`nm-tokenizer`），
  Promise 在 executor 线程 resolve（与 `LlmSseModule` 既有做法一致）。
- 动机：`@ReactMethod` 默认在 RN 的 NativeModules 队列上内联执行，冷词表整串
  计数（glm.json 8.2MB，真机 3~5s）会把同队列上的其它原生调用（含 `sseConnect`
  派发）一起堵住。JS 侧本就 await Promise，换线程对调用方透明。
- 单线程而非线程池：`TokenizerEngine` 的词表 LruCache 与 DJL 会话串行使用最稳，
  并发计数只会互相抢内存。

### A5 run 被受理即可停止：abort 注册前移（④B）

- `packages/core/src/service/agent/logic/run-agent-turn.ts`
  - 原 `runAgentTurn` 的实现体改名 `runAgentTurnWithController`（多收一个
    `internalController` 参数），内部不再自建/自注册 controller。
  - 新 `runAgentTurn` = 建 controller + caller signal 桥接 + **入口即
    `abortRegistry.register`** + `try { 调用实现体 } finally { 幂等反注册 }`。
  - 内层 finally 的反注册保留（顺序不变）；入口 finally 是覆盖「前奏抛错、内层
    try 尚未进入」的幂等兜底——否则陈旧 controller 会让 `has()` 永久为真、
    锁死该会话后续发送门禁。
- 行为口径：前奏期间的停止**不再被丢弃**；run 走到 runner 的 `loop_start` 检查点
  即取消收尾（RUN_STARTED / RUN_FINISHED 事件链完整、UI 正常落定）。用户消息在
  append 阶段已落库则保留（与流式中途停止一致，undo_send 可回收）。
- 与既有语义的关系：`abortRegistry.has()` 的「在途」口径从此涵盖前奏，与
  mobile 发送门禁 / `run-finish-calibration-probe` 的用法一致（更准确）。
- 回归锁（`test/service/agent/run-agent-turn-abort-registry.test.ts` T-ABORT-EARLY）：
  Proxy 卡住 backfill → 断言 `has===true` → `abort()` → 释放 → 断言
  `stopReason==="cancelled"`、**模型请求 0 次**、用户消息保留、run 结束后
  `has===false`。牙齿已验（临时注释掉注册行 → 本用例与 T-A4 双红）。

## B. 验收

| 项 | 命令 | 期望 |
|----|------|------|
| core 定向 | `npx tsx --test --experimental-test-module-mocks --tsconfig tsconfig.test.json test/message-checkpoint/backfill-cursor.test.ts test/message-checkpoint/rollback-backfill-baseline.test.ts test/message-checkpoint/rollback-backfill-baseline-op.test.ts test/agent/agent-session.test.ts` | 25/25 绿（含新的 `contentCallCount()==0` 回归锁） |
| core 定向 | 同上再加 `test/agent/agent-runner*.test.ts` | 40/40 绿 |
| mobile 全量 | `npx jest --maxWorkers=2` | 1605/1605 绿 |
| desktop 全量 | `npm test -- "--test-concurrency=2" "test/**/*.test.ts" "test/**/*.test.tsx" "test/**/*.test.js"` | 581/581 绿（满负载不降并发会偶发挂 `blob-binary-normalization-service` 的 cr-05，隔离绿；见 RULE） |
| Kotlin | 编译由 gradle 出包覆盖（本机不出包，随下次真机包验证） | assembleDebug 通过 |

## C. 待验证（真机读数，需用户在场配合安装）

1. **② 落库延迟**：dev 包 logcat 过滤 `[nm-timing]`，对比长会话（数百条）与
   新建空会话的「点发送 → 用户消息上屏」间隔；预期长会话不再有秒级空档。
   可加临时打点：`backfillMissingBaselines` 进出 + `messages.append` 进出。
2. **③ 首字延迟（mock 分辨）**：起仓库自带 mock ——
   `node scripts/mock-openai-server.mjs --port 8787` → `adb reverse tcp:8787 tcp:8787`
   → 应用内新增服务商 Base URL `http://127.0.0.1:8787/v1` → 拉模型选 `mock-fast`。
   判读：
   - `[novel-master/llm-sse] →`（JS 已调 sseConnect）与 mock 服务端日志收到请求的
     时间差秒级 ⇒ 我方前奏/队列（A4 应显著改善）；
   - `RUN_STARTED` → mock 收到请求秒级 ⇒ 每 step 前奏（A2/A3 应改善）；
   - mock 快而真 API 慢 ⇒ 判给 provider/网络（OkHttp 池无预热、服务端思考）。
   - 对照：同会话第 1 次 vs 第 2 次发送（第 2 次起 api 占用锚命中，零计数）；
     glm（原生家族）vs gpt-4o（JS tiktoken）模型。
3. **① 会话加载卡顿**：候选未收敛，需读数定位（本轮未改）。观测点：
   `startPreciseUpgrade` 起止 + family + 是否 native；`tokenChunkCache.seedFromKkv` /
   `advanceGeneration` 序列化耗时与载荷行数；`assembleWorkplaceDisplay` 耗时；
   维护循环是否在跑（KKV 完成标记）。A/B：分别关掉 (a) 后台精确升级、
   (b) 两个 `seedFromKkv`、(c) 维护循环，逐项对比首次进会话耗时。
   候选处置方向（未拍板）：升级轮改为「空闲窗口跑」；KKV 整表 persist 按代/大小
   限额或延后；维护循环增加「用户正在交互」避让。

## D. 明确排除（勿重复排查）

- append 本体、`MAX(seq)`、prompt token 失效、tail reload（31 行单查询）、
  op-sqlite 16ms 量子让步、压缩评估（`preferEstimate` 档零驱动计数）、
  `$filetree` 每步重渲（回合快照）、`tool_stream` 参数（全仓仅注释）、
  空闲看门狗（已退役）、usage 回锚写（fire-and-forget）。
