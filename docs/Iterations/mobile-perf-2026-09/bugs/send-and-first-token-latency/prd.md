# PRD：发送卡顿 / 首字延迟 / 会话加载卡顿（mobile 三条实测反馈）

- 日期：2026-09-30
- 上报（用户原话）：
  1. 「有时候会话加载特别卡顿，之前没这种情况。就像冷加载分词表一样，因为我发现和上下文关系不大，即使 msg 很小只有几十条也会卡顿。还是说可能是因为历史数据原因？第一次给上下文计算写表 cache 导致的？」
  2. 「用户消息落库缓慢，会先在输入框等待几秒后才落到 msg」
  3. 「助手请求首次延迟非常大，不知道是 api 的问题，还是我们的 bug，可能需要用 mock 的 api 进行测试」
  4. （追加）「还有一个bug，发送期间无法终止，不知道是不是和23是一个原因导致的？」
- 迭代：`mobile-perf-2026-09`（承接既有 mobile 性能批次）

## 背景与探索结论（三路只读子代理取证，2026-09-30）

### ② 发送 → 消息可见（几秒）

**主源实锤：`runAgentTurn` 在 append 之前先跑 `backfillMissingBaselines`，而它的
「无空窗」短路几乎每轮都失败，回退全量扫描**：

- 短路要求「游标之后的新增段每条消息都有 checkpoint」，但纯文本 assistant 与
  tool_result 行**从源头就不会建点**（只有 user append 与「改了工作区」的
  assistant 建点）→ 上一轮结束后的新增段必然不全 → 回退全量。
- 全量扫描原先用 `messageRepo.listBySession`（**含 hidden** 的全会话正文，逐条
  zlib 解压 + JSON.parse），且在事务内、单连接 mutex 下、JS 线程上跑；大会话
  是秒级（代码自身注释即承认 700+ 条会话「秒级卡顿」）。
- 它在 append **之前**（`run-agent-turn.ts:321-325`），而输入框只在 append 成功
  回调里清空 → 体感「在输入框等几秒才落到 msg」。
- 次源：进入大会话后立即发送时，WebView transcript 的快照分片尚未 post 完，
  append 行被塞进 deferred 队列等末片（`ChatTranscriptWebView.tsx`）；token
  标签刷新链（`buildSessionPromptInput` + 后台精确计数）与快照抢 JS 线程。

### ③ 首字延迟（TTFT 大）

- **我方候选 A（最像）**：`TokenizerModule.countPrompt` 是 `@ReactMethod` 且
  **内联执行**（不切线程），WEB/SP 家族冷词表整串计数可达数秒（glm.json
  8.2MB）；RN 的 NativeModules 队列是同一条，llm-sse 的 `sseConnect` 派发要排队
  → 表现为「请求迟迟不发出」。触发面：无 API 占用锚的首次请求（新会话/换模型/
  回滚/置位/压缩后）+ 原生家族。
- **我方候选 B**：每 step 的串行前奏——`session.list()`（原先**含 hidden 全量解压**
  后在 JS 侧 filter）、`assembleWorkplaceDisplay`（规则快照 + file_cache 逐文件
  inflate）、第二次全量消息读 `listAllSessionMessages`（**只为 gemini 的
  function-call 名字回查**，其它协议白读）。
- 外部候选 D：OkHttp 池无预热（应用首请求付 DNS+TCP+TLS）、服务端思考阶段不发
  delta（首内容才计 TTFT）。
- 判读口径：`firstTokenMs` 从 `requestStartedAtMs` 起算，**不含**上述前奏 →
  体感 ≫ firstTokenMs 即我方前奏/队列；两者都大即 API/网络。

### ① 会话加载卡顿（与 msg 数无关）

- 候选 C1：打开会话触发的后台精确计数会**冷启动家族分词器**（原生 3~5s / JS
  建表 185~248ms），与消息条数无关、每进程首见一次；再叠加 C3 的 KKV 整表
  seed/persist（`tokenChunkCache` / `promptWholeCache` 每次本地计数都整行读 +
  `JSON.stringify` 整代回写）。
- 候选 C2：chip 每次刷新都重组装 workplace / file_cache。
- 候选 C5：runtime ready 3s 后常驻的后台维护循环（消息压缩搬运 / blob 归一）
  只避让 Agent 活跃，不避让「用户正在浏览」；存量未搬完时逐行同步压/解压，
  与 msg 数无关（符合「历史数据原因」的直觉）。
- 已排除：`listMessageHeadersBySession` 不在会话打开链上、`listBySessionTail`
  只取 41 行、维护任务稳态零成本（完成标记已置即返回）、file_cache `getMany`
  条数=规则快照文件数（几十）。

### ④ 发送期间无法终止（用户追问：是否与 ②③ 同源？）

**同源一半、另有独立缺陷一半**——两条成因各自成立，都已修：

- **成因 A（与 ③ 同源，流式期间的停止被延迟）**：用户点停止 → `AbortSignal` 传播
  到 SSE wrapper → 调原生 `sseAbort`。而 `sseAbort` 与内联执行的
  `TokenizerModule.countPrompt`（冷词表数秒）**共用同一条 NativeModules 队列**
  → 断流指令排在计数后面，流照旧在推 → 体感「按了停止没反应」。这与 ③ 是
  同一根因，A4 的线程归属修复一并解决。
- **成因 B（独立缺陷，前奏期间的停止被彻底丢弃）**：`runAgentTurn` 直到
  `runner.run` 之前才 `abortRegistry.register`（`run-agent-turn.ts` 原 620 行），
  中间隔着 backfill / resolve / append / capture / 技能预算**整段前奏**——期间
  `stopRun` 查不到 controller，**直接返回 false 把停止意图丢掉**（不是延迟，
  是丢），随后 run 照旧发请求。前奏越长（正是 ② 的病灶），这个窗口越宽。
  修法见 spec A5（注册前移）。

## 范围与拍板

- **本轮做**（低风险、语义等价、有回归锁）：② 的全量扫描改头投影（正文全量读
  归零）；③ 的三处白读（每 step 含 hidden 全量、非 gemini 协议的全量回查）；
  ③A 原生分词计数切到模块自己的线程（不再堵 NativeModules 队列，同时修掉 ④
  的成因 A）；④B abort 注册前移（停止意图不再被丢）。
- **本轮不做**（需真机读数定位，见 spec「待验证」）：① 的 KKV 整表 seed/persist
  与维护循环避让策略、② 的 WebView 快照 defer、③ 的 provider 侧因素、
  ④ 的「前奏期间停止 = 撤销本次发送（消息不落库、正文回填输入框）」这一可选口径
  （涉及产品语义，待用户拍板；当前实现是消息落库 + 生成取消，与流式中途停止一致）。
- **真机验证必须用户在场**（荣耀安装门），读数走 `[nm-timing]` + mock API 对照。
