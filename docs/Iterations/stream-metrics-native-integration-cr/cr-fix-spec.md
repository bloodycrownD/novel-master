# CR Fix Spec: integration/stream-metrics-native 集成分支评审修复说明书

## 元信息

- repo：novel-master（worktree：`.worktree/i-stream-metrics-native`；branch：`integration/stream-metrics-native`）
- base_sha：`0e4c2251`
- head_sha：`7a63a779`（CR 基线）→ 修复完成后 HEAD：`7b7e1175`
- prd_path（④=stream-metrics-tokens，⑤=llm-stream-timeout，⑥=llm-stream-native）：
  - `docs/Iterations/llm-stream-native/prd.md`（⑥）
  - `docs/Iterations/mobile-perf-2026-09/features/stream-metrics-tokens/prd.md`（④）
  - `docs/Iterations/mobile-perf-2026-09/features/llm-stream-timeout/prd.md`（⑤）
- spec_path：
  - `docs/Iterations/llm-stream-native/spec.md`（⑥）
  - `docs/Iterations/mobile-perf-2026-09/features/stream-metrics-tokens/spec.md`（④）
  - `docs/Iterations/mobile-perf-2026-09/features/llm-stream-timeout/spec.md`（⑤）
- review_round：2
- dag_version：2
- 状态：**已执行**（code-dev-loop 于 2026-09-26 执行完毕，代码面 dev-ready；剩余「需用户确认」项见文末「执行记录」）

> 本文件由 code-review-loop（round 1 的 7 个 scope 评审 + round 2 delta 小修）产出，仅登记修复方案与验收要求，不含实现代码改动；round 2 新增 `native-sse/docs-1`、`full/F-2`、`core-metrics/B-4` 三条，并完成勘误与补注。

## Must-fix（按 P0 → P1 → P2）

> 本轮统计（round 2 delta 后）：P0 0 条；P1 9 条；P2 33 条（含由 Open questions Q6 升级的 `native-sse/shim-1`、Q12 升级的 `core-metrics/B-4`，以及 round 2 新增的 `native-sse/docs-1`（＝`spec/K-5`，同一件事不另计）与 `full/F-2`）。

**P0**

本轮 P0 为空。

**P1**

### core-metrics/B-1 [P1] 滑窗速率未按时刻去重 → 瞬时可读速率爆表

- 维度：core-metrics
- 文件：`packages/core/src/domain/format/sliding-token-rate.ts:53-59`、`:105-118`
- 问题：`sample()` 只按 tokens 变化记样本，同一毫秒内多条 delta 生成同 `tMs` 多样本；窗口首样本=批首 → `elapsed` 仅几毫秒 → 速率 = 整批增量÷几毫秒（可读数千~上万 t/s）。
- 改法：`sample()` 中若末样本 `tMs === nowMs` 则就地替换（同刻只留最终累计值），不 push；空窗后单批样本在窗口内只剩 1 条，既有「首=末→0 / 样本不足→null」自然兜住。
- 验收·测试：`packages/core/test/domain/format/sliding-token-rate.test.ts` 增「同毫秒 3 条样本 + 5ms 后读」用例，断言不是「批增量÷5ms」形态（期望 0 或 null），第二时刻样本到达后恢复；mobile 同 tick 多 delta 交叉断言。
- 来源：review-scope-core-metrics / round 1

### mobile-metrics/B-1（= core-metrics/B-2，同一条，用此 id）[P1] run 无速率时不清理 KKV → 重启显示上一轮陈旧速率

- 维度：mobile-metrics
- 文件：`apps/mobile/src/services/session-stream-unit-manager.service.ts:1372-1387`（settle 分支）、`:1679-1701`（persistFinalRateQuietly）、`:629-634`（水合读回）
- 问题：settle 时 `rateTokensPerSecond == null`（单样本/零输出）既不写也不删 KKV；水合只按 sessionId 读 → 把上一轮速率拼到本轮 settled「上次生成」上，等于凭空造数，违背 spec「缺值即省略速率段」。
- 改法：null 时 fire-and-forget `delete(sessionId, SESSION_KKV_DOMAIN_STREAM_METRICS, STREAM_METRICS_FINAL_RATE_KEY)`（吞错口径同 set）；加固可选：`StreamFinalRateSnapshot` 增 `runId`，水合与 settled 行 runId 比对不一致当缺值（顺带覆盖收尾即被杀进程的竞态窗口）。
- 验收·测试：新增用例——长流跑完（KKV 有值）后跑一次零 token run 收尾，断言 KKV 键已删；用同 KKV 起新 manager 水合，断言 `getSettledProjection().rateTokensPerSecond === null` 且文案不含 `t/s`。
- 来源：review-scope-mobile-metrics / round 1（与 review-scope-core-metrics 同源）

### core-metrics/B-3 [P1·合并门] SCHEMA_BOOT_VERSION 顺延纪律

- 维度：core-metrics（合并纪律）
- 文件：`packages/core/src/bootstrap/novel-master-bootstrap.ts:97-105`（现值 16）
- 问题：feat/message-content-compression 的 cc79fbbe 也把 BOOT_VERSION 提到 16；后合者不顺延会让走过对方 v16 慢路径的存量库走快路径、新 ALIGN 永不执行（真机 no such column，v9/v10 两次同型事故）。
- 改法：写成合并门步骤——合并 main 前以主干现值核对；后合者顺延 +1 并同步版本常量上方注释；本分支若先合则无改动。
- 验收·测试：合并后主干版本号严格大于两分支各自落地值；测试断言引用常量（A14 已不写死）。
- 来源：review-scope-core-metrics / round 1

### desktop-metrics/data-1 [P1] usage 节流吞掉收尾终值 → desktop 冻结值不是真值（AC-1/T-M8 在 desktop 不成立）

- 维度：desktop-metrics
- 文件：`apps/desktop/renderer/hooks/useAgentStream.ts:191-205`（usage 250ms 尾随节流）、`:223-231`（RUN_FINISHED）、`:232-239`（RUN_FAILED）、`:243-249`（仅 effect 清理时冲刷）；`apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:143-153`（冻结分支）
- 问题：RUN_FINISHED 同步翻 `uiRunning=false` → 冻结分支先跑、节流定时器后跑 → 定时器把真值写进已清空的 acc 且不回写 lastRun；openai 单步 run 冻结显示 heuristic 估值、anthropic/gemini 丢最后 ≤250ms 增量；mobile 因无节流不受影响（双端不同构）。
- 改法（二选一）：① RUN_FINISHED/RUN_FAILED 两分支在调 `cb.onRunFinished/onRunFailed` **之前**插入 `flushUsageNote();`；② 更彻底：撤掉 usage 节流——`noteUsage` 只改 ref 不 `setState`（无渲染收益，且与 mobile「事件即归账」对齐）。
- 验收·测试：desktop 用例断言 openai 单步 run 收尾后 `completionTokens`=usage 真值且 `tokenSource==='usage'`；anthropic/gemini 最后增量不丢。
- 来源：review-scope-desktop-metrics / round 1

### mobile-render/B-1 [P1] 纯文本降级尾块丢 pre-wrap（`.rich` 摘错对象 → 换行全部折叠）

- 维度：mobile-render
- 文件：`apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts:330`、`:334-337`、`:476`、`:171-174`；`apps/mobile/src/web/shared/rich-content-styles.ts:73`
- 问题：`appendEscapedDelta` 摘的是传入的**尾块容器**的 `.rich`，而 `.rich` 实际挂在 `.bubble-body/.thinking-body` 上 → 块级模式下 body 的 `.rich` 摘不掉，`white-space: normal` 继承给尾块容器，降级为纯文本的尾块换行/缩进全塌；`applyStreamBlockCommit` 的 `textContent=tailText` 降级分支同病。属本 diff 引入的行为回归。
- 改法：纯文本尾块改加标记类（如 `stream-tail-plain`），CSS 单源补 `.stream-active-tail.stream-tail-plain{white-space:pre-wrap}`；HTML 分支成功后移除该标记；**不要**摘 body 的 `.rich`（会连带降级已提交块）；`applyStreamBlockCommit` 无 tailHtml 分支同改，并把 `state.stream.textHtml/thinkingHtml` 置空（防回退路径重放旧尾块）。
- 验收·测试：源码契约断言（纯文本路径须出现 pre-wrap 标记、不得只对尾块容器摘 rich）+ 手动核对：rich 流中先出 1 段触发提交、再出 >12k 无空行块，确认换行缩进不折叠。
- 来源：review-scope-mobile-render / round 1

### spec/A-1 [P1·文档] Step 7/8 报告与终版语义不自洽、AC-4 收敛窗口低报 3 倍

- 维度：spec（文档一致性）
- 文件：`docs/Iterations/llm-stream-native/step7-pool-restore-report.md:10,79,83,109,169-175`；`step8-e2e-report.md:50,111`；`prd.md:30,37`；`CHANGELOG.md:11,19`
- 问题：两份报告的 a2/a3/b2 与 AC-4 建立在已退役的「读超时 30s×重试=90~93s 有界收敛」之上；终版 readTimeout 恒禁用、watchdog 退役，唯一兜底 callTimeout 600s/次，首字黑洞可重试（maxRetries: 2 → 3 次尝试）→ 新最坏窗口 ≈ 3×600s+退避 ≈ 30 分钟；CHANGELOG 写「10 分钟」低报 3 倍。
- 改法（二选一，须落盘）：(a) 用终版构建重跑 mock-dead 与「杀服务器再发」两组，把真实收敛窗口写回报告 + AC-4；(b) 保留初版实验作历史留档（报告头加「初版语义记录，终版见 spec §2 实施修正记录」）+ ⑥ spec §7 明确「首字黑洞自动上限 = 3×600s，产品拍板以手动终止为快速路径」+ CHANGELOG 口径改「单次 10 分钟，自动重试后极端可达约半小时」或等义表述。
- 验收·测试：报告/spec 中不再出现「读超时 30s 兜底 / 90s 收敛」作为现状结论；CHANGELOG 口径与实现一致。
- 来源：review-scope-spec / round 1

### spec/A-2 [P1·文档] ⑤ PRD/spec 整份停在旧 idle 语义

- 维度：spec（文档一致性）
- 文件：`docs/Iterations/mobile-perf-2026-09/features/llm-stream-timeout/spec.md:30-36,41-46,48-54,80,92,102,111-113,118,143-148`；`prd.md:25-27,34-36,41`
- 问题：仍写「XHR 流式永久不复用（无条件 close）」「watchdog 保留 30s idle 安全网」「T-D1/T-D3 断言 idle 与无条件 close」；终版是条件化 close + watchdog 退役留原语与导出。
- 改法：spec 头部加「终版语义修订（2026-09-26，见 ⑥ spec §2 实施修正记录 + `docs/apm/RULE.md:84-85`）」段并逐条替换（close→条件化、watchdog→退役留档、T-D1/T-D2 降原语级且注明无接入方、T-D3→条件化断言且主覆盖迁 T-N3、Step 1/已知限制/Context 同步）；prd AC-2 与已知限制改「无固定空闲界；死流由手动终止」。
- 验收·测试：⑤ 文档与 `llm-sse-transport.ts:322-327`、`LlmSseModule.kt:70-80,137-140` 表述一致，不再有「30s idle 生效」描述。
- 来源：review-scope-spec / round 1

### spec/K-1 [P1·交付] ④ 的用户向 CHANGELOG 条目缺失

- 维度：spec（交付/CHANGELOG）
- 文件：`CHANGELOG.md:7-24`（Unreleased）
- 问题：Unreleased 10 条全部属 ⑤/⑥/两补充功能；④ 分支 8 提交不含 CHANGELOG，而 ④（指标条改 token + 实时速率）是用户可感知展示变更（RULE 记有「CHANGELOG 缺条目只能强推重打 tag」前科）。
- 改法：在「### 变更」补一条，例如：「**指标条改用 token 与实时速率**（双端）：会话指标条从「正文/思考各 N 字 · 全程平均字/秒」改为「输出 N t · M t/s」——token 数优先取服务端真实用量（缺失时按字符估算并在真值到达后校正跳正），速率改为最近数秒窗口实时值（暂停回落、恢复回升）；中断后重进会话计数不再清零」；按 novel-master-changelog skill 校对清单过一遍（无内部术语）。
- 验收·测试：Unreleased 含该条且与 ⑥ 条目无重复分类。
- 来源：review-scope-spec / round 1

### spec/K-2 [P1·交付] scripts/mock-openai-server.mjs 未提交改动 + 头注释与实现矛盾（合并前必须处置）

- 维度：spec（交付/仓库卫生）
- 文件：`scripts/mock-openai-server.mjs:19-22`（头注释）vs `:321-334`（JSDoc + shouldEmitTaskCall 实现）
- 问题：①+113 行（task 触发能力）只在工作区、HEAD 无它，而 7a63a779 子会话指标条 e2e 依赖它；②头注释写「历史里还没有 tool 结果」（历史扫描口径），实现与 JSDoc 是「只看最后一条消息」，行为不等价（同会话二次派活）。
- 改法：头注释改成与实现一致口径（「末条消息含『派活』即下发一条 task 工具调用；父会话拿到 tool 结果后的复问、子会话自身请求均不触发」）；去留表态：随本分支交付则提交（建议附新提交），不交付则 `git checkout --` 还原并在交接注明 e2e 复现步骤缺失。
- 验收·测试：`git status` 该文件干净且注释与实现一致。
- 来源：review-scope-spec / round 1

**P2 · B 类·正确性与契约**

### core-metrics/B-4 [P2] `slidingTokenRate` 未来样本（`tMs > nowMs`，时钟回拨/校正跳变）照常计入

- 维度：B
- 文件：`packages/core/src/domain/format/sliding-token-rate.ts`（窗口计算处，约 `:105-118`）
- 问题：对「部分未来样本」会照常计入增量，窗口口径被污染（engine 侧时钟回拨时可见）。
- 改法：窗口计算时排除 `tMs > nowMs` 的样本（或入口丢弃），保持既有「全未来样本 → null」语义的推广形式。
- 验收·测试：`packages/core/test/domain/format/sliding-token-rate.test.ts` 增「nowMs 回拨到样本时刻之前」用例，断言未来样本不计入、恢复后正常。
- 来源：review-full / round 1（原 Open Q12 升级为 must-fix）

### core-transport/B-1 [P2] XHR settle 后仍投递迟到数据

- 维度：core-transport
- 文件：`packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts:512-516`、`:525-531`
- 问题：超时/中止 settle 之后，`xhr.onprogress`/`xhr.onload` 没有 settled 守卫，迟到的进度或完成回调仍会投递 chunk，破坏「settle 即终态」契约。
- 改法：`xhr.onprogress`/`xhr.onload` 顶部加 `if (settled) return;`。
- 验收·测试：`packages/core/test/infra/llm-protocol/llm-stream-timeout.test.ts` 增「超时后手打 onload 投递新数据」用例，断言超时后无 chunk 且 promise 保持超时错误；补「有数据→idle 分级后迟到回调不顶替」姊妹断言。
- 来源：review-scope-core-transport / round 1

### native-sse/shim-1 [P2] 非流式取消语义未定（Open Q6 升级，二选一）

- 维度：native-sse / mobile
- 文件：`apps/mobile/src/services/llm-native-fetch-shim.ts:124-171`
- 问题：非流式路径不读 `init.signal`，用户取消后请求不能快速收敛到 AbortError，只能等 native 调用自然结束。
- 改法（二选一）：最小改法——读 `init.signal`，已 aborted/abort 到达即 AbortError reject，native 侧后台自结并在注释登记「连接不真断」限缩；彻底改法——给 native `request` 补 abort 面（须改 spec §2 API，属契约扩展）。建议取最小改法。
- 验收·测试：新增 shim 用例——`signal` 已 aborted 与请求途中 abort 两种时序均以 AbortError reject，Fast-fail 不等 native 返回；文档注明连接不真断。
- 来源：review-scope-native-sse / round 1（Open questions Q6）

### native-sse/kotlin-1 [P2] Kotlin 合批/终结竞态（流尾丢批、批乱序）

- 维度：native-sse
- 文件：`packages/llm-sse-native/android/src/main/java/com/novelmaster/llmsse/LlmSseModule.kt:369-384`（flushPending）、`:386-389`（finishStream）
- 问题：`flushPending` 的「闸门检查 + emitChunk」与 `finishStream` 的 remove + emitDone 不在同一锁内，并发下同 requestId 事件可能乱序，流尾批可能被丢弃或落在 Done 之后。
- 改法：把「闸门检查 + emitChunk」一并放进 `synchronized(state)`，`finishStream` 同锁内完成 `streams.remove` + `emitDone`（或抽统一 emitUnderLock 出口），保证同 requestId 事件串行、Done 恒为最后。
- 验收·测试：补并发竞争用例（flushPending 与 finishStream 同时对同一 requestId 生效），硬断言：Done 之后不得再收到任何 chunk；Done 之前最后一批（≤100ms 窗口）不得丢失；同一 requestId 事件严格串行。
- 来源：review-scope-native-sse / round 1

### native-sse/shim-3 [P2] `json()` 同步抛

- 维度：native-sse / mobile
- 文件：`apps/mobile/src/services/llm-native-fetch-shim.ts:78`
- 问题：`json()` 实现同步抛错（JSON.parse 直接执行），与 fetch Response 契约不符，调用方按 Promise reject 处理会捕不到。
- 改法：改为 `json: async () => JSON.parse(bodyText)`。
- 验收·测试：新增用例——非法 body 时 `json()` 返回 rejected Promise 而非同步 throw。
- 来源：review-scope-native-sse / round 1

### native-sse/js-1 [P2] requestId 计数器跨 JS 重载复位撞 id（热重载后首次请求报 duplicate requestId）

- 维度：native-sse
- 文件：`packages/llm-sse-native/src/transport.ts:61`、`:136`
- 问题：requestId 计数器在模块重载后从零开始，与 native 侧仍存活的旧 id 冲突，报 duplicate requestId。
- 改法：id 加一次性实例前缀（`Math.random().toString(36).slice(2,8)`）。
- 验收·测试：新增用例——模拟模块重载（两份实例）后 id 空间不相交，无 duplicate。
- 来源：review-scope-native-sse / round 1

### mobile-render/B-2 [P2] 缺 webview 能力协商（旧 dist 静默丢弃 streamBlockCommit → 流中只剩尾块）

- 维度：mobile-render
- 文件：`apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:79`（硬编码开关）、`:1199-1208`（ready 未消费 version）；`ChatTranscriptBridge.ts:169-182`；webview `apps/mobile/src/web/chat-transcript/webview/runtime/boot/boot-transcript.ts:22`
- 问题：RN 侧按硬编码开关发 `streamBlockCommit`，旧 dist 不支持时静默丢弃，流中只剩尾块；boot 已上报的 version 未被消费。
- 改法：ready 上报能力/版本（如 `version:'m4'` 或 `capabilities:['streamBlockCommit']`），RN 侧据此决定启用（未声明则 `takeStreamBlockSplits` 恒返回 []、`streamDelta.html` 退回全量），`STREAM_BLOCK_RENDER_ENABLED` 降为默认值+运行时覆盖。
- 验收·测试：新增 RN 用例（ready 无能力标记 → 只发全量 streamDelta），修正现有「v1 向后兼容」断言措辞。
- 来源：review-scope-mobile-render / round 1

### mobile-render/B-3 [P2] 两条推流路径累积点不对称（accum 顺序可与线上倒置并被块提交固化）

- 维度：mobile-render
- 文件：`apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:666-684`（queueStreamDelta 立即 +=）vs `:686-701` + `:626-632`（queueStreamBatch 只在 RAF 内累加）
- 问题：delta 在入队时立即累加、batch 在 RAF 内累加，同一 RAF 内先 batch 后 delta 时累积顺序与线上顺序倒置，并被块提交固化。
- 改法：累积单点化——把 `streamTextAccumRef/streamThinkingAccumRef` 更新移到 `queueStreamBatch`（与 delta 对称），RAF 内只做切分与发送，删重复累加。
- 验收·测试：新增「同一 RAF 内先 batch 再 delta」用例，断言 commit 的 text/tailText 与线上顺序一致。
- 来源：review-scope-mobile-render / round 1

### mobile-render/B-4 [P2] 空队列占坑 RAF 饿死 batch 一帧（既有缺陷，落在焦点区）

- 维度：mobile-render
- 文件：`apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:557-568`、`:610-620`、`:807-818`
- 问题：flush 入口在队列为空时也会占一个 RAF，导致本可同帧发出的 batch 被推迟一帧，在分片在途时更明显。
- 改法：两个 flush 入口补空队列早退（不占 RAF）。
- 验收·测试：新增用例（分片在途 + 仅 batch 非空 → 末片后 streamBatch 已发出）。
- 来源：review-scope-mobile-render / round 1

### desktop-metrics/sampling-2 [P2] 采样器 reset 走 running 边沿而非 run 身份

- 维度：desktop-metrics
- 文件：`apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:134-155`
- 问题：采样器仅在 `uiRunning` 边沿 reset，同一会话连续 run 或身份切换时样本可能混入上一轮。
- 改法：把 run 身份（runId 或 `${sessionId}:${runId}`）传入 hook，值变化即 reset（mobile `begin()` 先例）；退一步至少在收尾 `freeze()` 后补一次 reset。顺带 nit：`useRef<TokenRateSampler>(createTokenRateSampler())` 改惰性初始化。
- 验收·测试：新增用例——同会话第二次 run（runId 变化）不参与上一轮样本；连续 run 重置后首读为 null/0 而非上一轮残留。
- 来源：review-scope-desktop-metrics / round 1

**P2 · C 类·质量/DRY/死代码**

### core-transport/C-1 [P2] 两处注释仍描述已退役的空闲 deadline

- 维度：core-transport
- 文件：`packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts:513`、`:643-644`
- 问题：注释仍写空闲 deadline 语义，与终版「readTimeout 禁用、watchdog 退役」不符，误导后续维护。
- 改法：改为「更新观测打点（lastActivityAt / processedLength）」。
- 验收·测试：全文检索不再有描述空闲 deadline 生效的注释；相关注释与代码行为一致。
- 来源：review-scope-core-transport / round 1

### core-metrics/C-1 [P2] 新增域常量未并入联合类型

- 维度：core-metrics
- 文件：`packages/core/src/domain/session-kkv/model/session-kkv-domains.ts:33`（常量定义）、`:59-64`（联合类型）
- 问题：新增 `SESSION_KKV_DOMAIN_STREAM_METRICS` 常量未并入 `SessionKkvDomain` 联合类型。补充说明：常量定义在 `session-kkv-domains.ts:33`，联合类型在 `:59-64`；该联合末尾带 `| (string & {})`，因此补成员**无类型层强制收益**，本条定位为「常量与联合成员同现」的登记/一致性动作。
- 改法：`SessionKkvDomain` 联合补 `| typeof SESSION_KKV_DOMAIN_STREAM_METRICS`（登记性修改，不改行为）。
- 验收·测试：`SessionKkvDomain` 联合中出现该常量；`npm run typecheck`（core 包 tsc）通过。
- 来源：review-scope-core-metrics / round 1

### core-metrics/C-2 [P2] `formatStreamElapsed` 三份同逻辑实现 + 千分位重复

- 维度：core-metrics
- 文件：`packages/core/src/domain/format/format-stream-metrics-line.ts:22-27`、`:49`；`packages/core/src/domain/format/format-char-count.ts:3`（千分位·core 内两处之一）；`apps/mobile/src/hooks/useAgentStreamMetrics.ts:39`；`apps/desktop/renderer/hooks/useAgentStreamMetrics.ts:86`
- 问题：「三份 `formatStreamElapsed`」成立（core 私有 + mobile hook + desktop hook）；「千分位重复」实为 **core 内两处**（`format-char-count.ts:3` 与 `format-stream-metrics-line.ts:49`），非跨端。口径仍容易漂移。
- 改法：core 公开该函数并让文案件复用，双端删本地副本（或其测试改从 core 引），core 内两处千分位抽一处共用。
- 执行提示：本条与 `mobile-metrics/C-3` 同动 `apps/mobile/src/hooks/useAgentStreamMetrics.ts`，须合并为一次修改，避免指令冲突。
- 验收·测试：两端 hook 无本地 elapsed 实现；core 补边界用例（<60s 一位小数、≥60s 取整）。
- 来源：review-scope-core-metrics / round 1

### core-metrics/C-3 [P2] `"usage"|"heuristic"` 字面量四处各写一份

- 维度：core-metrics
- 文件：`packages/core/src/domain/session-run-state.ts:16`、`packages/core/src/domain/session-stream-unit.ts:162`、双端 `useAgentStreamMetrics` 各一处
- 问题：tokenSource 联合类型四处重复声明，新增来源时容易漏改。
- 改法：core 导出中立类型（或复用 `SessionRunStateTokenSource`），各处改 alias。
- 验收·测试：全文无独立的 `"usage"|"heuristic"` 字面量联合；typecheck 通过且既有用例全绿。
- 来源：review-scope-core-metrics / round 1

### mobile-metrics/C-1 [P2] 消费型单元未接 `onGraceExpired`

- 维度：mobile-metrics
- 文件：`apps/mobile/src/services/session-stream-unit-manager.service.ts:1240-1254`（adoptConsumptiveUnit），先例 `:1086`
- 问题：消费型单元构造时未传 `onGraceExpired`，宽限过期后单元残留，`snapshot(childId)` 仍可读。
- 改法：构造参数补 `settledGraceMs` + `onGraceExpired: expired => this.handleGraceExpired(sessionId, expired)`。已核安全：`handleGraceExpired`（`:1511-1517`）只 removeUnit+notifyChanged、不动 refcount。
- 验收·测试：消费型 run 收尾后推进宽限，断言 `snapshot(childId)===null`、settled 投影仍在、`isMobileAgentActive()` 不变。
- 来源：review-scope-mobile-metrics / round 1

### mobile-metrics/C-2 [P2] settled 投影装配两分支重复

- 维度：mobile-metrics
- 文件：`apps/mobile/src/services/session-stream-unit-manager.service.ts:1339-1357` 与 `:1368-1387`
- 问题：settled 投影装配逻辑在两个分支重复实现，易出现一侧改动另一侧漂移。
- 改法：抽 `private buildSettledProjection(unit, snap)` 单点。
- 验收·测试：无行为变化、既有用例全绿。
- 来源：review-scope-mobile-metrics / round 1

### mobile-metrics/C-3 [P2] 旧 hook 死导出（仅测试用）

- 维度：mobile-metrics
- 文件：`apps/mobile/src/hooks/useAgentStreamMetrics.ts:11`、`:38-44`
- 问题：旧 hook 已无生产调用方，只为测试保留导出，属死代码。
- 改法：删导出与对应两个用例（保留 `buildChatStreamMetricsLine`/`toAgentStreamMetricsView`/类型）。
- 验收·测试：删除后全仓检索无引用报错，mobile jest 全绿。
- 来源：review-scope-mobile-metrics / round 1

### mobile-metrics/C-4 [P2] 子会话「已中断」双标识重复

- 维度：mobile-metrics
- 文件：`apps/mobile/src/screens/stack/SubagentSessionScreen.tsx:264-272` 与 `ChatStreamMetricsBar.tsx:27-29`（经 `ChatStreamMetricsBarLive.tsx:82`）
- 问题：中断态在屏级横幅与指标条各显示一次「已中断」，用户看到重复文案。
- 改法：留一——屏级横幅只在指标条不可见时渲染，或改文案（如「生成被中断，仅显示已落库内容」）。
- 验收·测试：渲染用例断言「已中断」出现 1 次。
- 来源：review-scope-mobile-metrics / round 1

### mobile-render/C-1 [P2] `.stream-active-tail` 无样式致块边界 5px 塌陷

- 维度：mobile-render
- 文件：`apps/mobile/src/web/chat-transcript/webview/runtime/stream/stream.ts:84-97` + `apps/mobile/src/web/shared/rich-content-styles.ts:74-76`
- 问题：`.stream-active-tail` 未定义块间距样式，首块与后续块之间塌陷约 5px。
- 改法：CSS 单源补 `${s} > .stream-active-tail:not(:first-child) > p:first-child { margin-top: 0.35em; }`（思考体同款）。
- 验收·测试：CSS 契约断言 + 手动核对无跳动。
- 来源：review-scope-mobile-render / round 1

### mobile-render/C-orch-1 [P2] 同 split 内 N 个 commit 重复携带同值 tailHtml/tailText

- 维度：mobile-render
- 文件：`apps/mobile/src/components/chat/ChatTranscriptWebView.tsx:536-555` + `ChatTranscriptBridge.ts:169-182`
- 问题：一次 flush 内每个 commit 都携带同一份 tailHtml/tailText，bridge 载荷冗余，逐帧开销放大。
- 改法：尾块载荷改为仅每 kind 每次切分的**最后一个** commit 携带（`tailHtml?/tailText?` 可选，中间不带）；webview 缺载荷时保持现状。
- 验收·测试：RN 用例断言一次 flush 内仅最后一个 commit 带 tailText。
- 来源：review-scope-mobile-render / round 1

### native-sse/shim-2 [P2] dev logging 对 body=null 的成功非流式响应误报「streaming may fail on RN」

- 维度：native-sse / core（跨包，需协调）
- 文件：`apps/mobile/src/services/llm-native-fetch-shim.ts:47-58` × `packages/core/src/infra/llm-protocol/logic/debug-fetch.ts:145`、`:160-165`
- 问题：body 为 null 的成功非流式响应被 logging 判为疑似流式失败，输出误导性告警。
- 改法：core 侧收窄告警判据，或 shim 暴露可识别标记供 logging 跳过。
- 验收·测试：新增 debug-fetch 用例——body=null 的成功非流式响应不产生该告警；真实流式异常仍告警。
- 来源：review-scope-native-sse / round 1

### full/F-2 [P2·清洁项] 同一 diff 内中文模块头 + 英文函数 JSDoc 混排

- 维度：F
- 文件：`apps/mobile/src/runtime/setup-llm-fetch.ts:26-29`
- 问题：本 diff 把模块头整段改写为中文，但同文件被改动的 `ensureLlmFetchConfigured` 的 JSDoc 仍是英文（"Registers native SSE transport + non-streaming fetch shim once per process."），属本 diff 新引入的混排（core 存量英文模块头不算问题）。
- 改法：译为中文一句（例：「每进程注册一次：native SSE transport + 非流式 fetch shim。」）。
- 验收·测试：该文件注释全中文；无行为变化。
- 来源：review-full / round 1

**P2 · C-orch·单点化/清单对齐**

### core-transport/C-orch-1（= native-sse/S2）[P2] 整调用预算未单点下发（nativeTimeouts 死通道；600s 四处硬编码）

- 维度：core-transport / native-sse（编排）
- 文件：`packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts:80-91`（port opts）、`:412-417`（runNative）；`packages/llm-sse-native/src/transport.ts:139-141`；`src/types.ts:93`
- 问题：600s 整调用预算在 core `SSE_WHOLE_CALL_TIMEOUT_MS`、wrapper `LLM_SSE_DEFAULT_CALL_TIMEOUT_MS`、Kotlin `DEFAULT_CALL_TIMEOUT_MS`、shim `LLM_NATIVE_FETCH_CALL_TIMEOUT_MS` 四处硬编码，`nativeTimeouts` 通道未真正下发，口径无法单点调整。
- 改法：port opts 增 `wholeCallTimeoutMs?`，runNative 传 `SSE_WHOLE_CALL_TIMEOUT_MS`，wrapper 以之覆盖 `timeouts.callMs`（缺省保留 Kotlin 默认作后备）。
- 验收·测试：core 假 transport 断言 `opts.wholeCallTimeoutMs === 600_000`（补进 `llm-sse-transport-port.test.ts`）；包内 mock bridge 断言 sseConnect 第 6 参等于该值。
- 来源：review-scope-core-transport / round 1（= review-scope-native-sse S2）

### native-sse/deps-1 + mobile-metrics/Q5 [P2] 构建清单未对齐新包

- 维度：native-sse / mobile-metrics（编排/CI）
- 文件：`.github/workflows/android-nightly.yml:53`（gradle cache key）、`:64`（workspace build 列表）缺 `packages/llm-sse-native`；`apps/mobile/package.json`（`test: jest`，**无 pretest 钩子、无 pre 链**）
- 问题：nightly 缓存与构建清单未包含新包、mobile 侧缺 pre 链，干净检出下测试/CI 会解析失败或缓存错配。mobile 侧的实质是「干净检出下 jest 的包映射指向被 gitignore 的 dist，解析失败」——不是既有 pretest 漏构建，而是需要新增/调整 pre 链。
- 改法：nightly 两处按 `release.yml:79`/`:93` 逐字对齐；mobile 侧**新增/调整 pre 链（`pretest` 或 `test` 前置构建该包）**，清单与 `prestart` 对齐。
- 验收·测试：nightly 的 cache key/build 清单与 release.yml 一致；干净检出跑 `npm test -w @novel-master/mobile` 前 pre 链能产出该包 dist。
- 来源：review-scope-native-sse + review-scope-mobile-metrics / round 1

**P2 · G 类·测试**

### core-metrics/G-1 [P2] T-M10 只覆盖 usage 上调方向

- 维度：core-metrics
- 文件：`packages/core/test/domain/format/sliding-token-rate.test.ts:95-196`
- 问题：现有 T-M10 只断言 usage 上调（估值→真值）路径，下调方向（真值低于累计估值）缺覆盖，翻转瞬间与 freeze 回退行为可能出错。
- 改法：补下调用例——900→600 翻转瞬间 null、同源增长期速率非负且从真值起算、单样本时 freeze 回落到翻转前末值。
- 验收·测试：上述三条断言在测试文件内落地且全绿。
- 来源：review-scope-core-metrics / round 1（G 类）

### mobile-metrics/G-1 [P2] accum-perf 测试 metrics 与扩展后类型不符

- 维度：mobile-metrics
- 文件：`apps/mobile/__tests__/session-stream-unit-accum-perf.test.ts:170`
- 问题：测试构造的 metrics 缺少扩展后的 `completionTokens`/`tokenSource` 字段，与类型不符（可能被 as 断言掩盖）。
- 改法：补 `completionTokens: 0, tokenSource: 'heuristic'`。
- 验收·测试：该测试文件 typecheck/jest 全绿，无 as 绕过。
- 来源：review-scope-mobile-metrics / round 1（G 类）

### mobile-metrics/G-2 [P2] 子会话指标条（7a63a779）零测试护栏

- 维度：mobile-metrics
- 文件：`apps/mobile/src/screens/stack/SubagentSessionScreen.tsx:276-279`
- 问题：子会话指标条渲染无任何测试，后续改动无护栏。
- 改法：按 `chat-stream-metrics-bar-live.test.tsx` 模式加轻量屏幕用例（断言活跃期「生成中」、终态「上次生成 · … · N t/s」；C-4 的「已中断」计数断言放这里）。
- 验收·测试：新增用例通过且覆盖活跃/终态/中断三态。
- 来源：review-scope-mobile-metrics / round 1（G 类）

### mobile-render/G-1 [P2] 测试缺口/脆断言

- 维度：mobile-render
- 文件：`apps/mobile/__tests__/stream-block-split.test.ts:233-237`；`chat-transcript-stream-block.test.ts:85`
- 问题：`stream-block-split.test.ts:233-237` 断言名与实际不符；`chat-transcript-stream-block.test.ts:85` 用整源 `not.toContain('mermaid')` 这类脆断言；另有两条行为缺口无覆盖。
- 改法：`stream-block-split.test.ts` 改名或补真实终态行断言；`chat-transcript-stream-block.test.ts` 改按函数切片断言；补两条 RN 用例（回滚后重推不得把上一轮文本当已完成块、块提交后继续推 delta 时 delta html 不含已提交块）。
- 验收·测试：上述改名/切片/新增用例全部落地并通过。
- 来源：review-scope-mobile-render / round 1（G 类）

### desktop-metrics/test-1 [P2] desktop hook 状态机零覆盖

- 维度：desktop-metrics
- 文件：`apps/desktop/test/use-agent-stream-metrics.test.ts:1-88`
- 问题：desktop hook 状态机（冻结、usage 回写、重启采样）无覆盖。
- 改法：用 `react-alias-hook.mjs`/`react-test-renderer` 写小宿主组件用例（收尾后速率=末值不衰减；noteUsage 后 completionTokens/source 正确且后续 delta 不回写；新 run 不参与上一轮样本）；并补一条 heuristic 公式断言（防 core 改口径静默漂）。
- 验收·测试：上述 4 类用例全部落地并通过。
- 来源：review-scope-desktop-metrics / round 1（G 类）

**P2 · K/A 类·文档同步（写入 fix-spec 步骤，下游执行）**

### spec/K-3（= mobile-metrics/A-1）[P2] ④ spec 三句语义补注 + 自相矛盾修正

- 维度：spec（文档/④）
- 文件：`docs/Iterations/mobile-perf-2026-09/features/stream-metrics-tokens/spec.md:47`、`:55`、`:58-59`、`:124`
- 问题：三句语义（采样器封装、t/s 取整口径、usage 后不回写 heuristic）在 spec 中缺失或自相矛盾——`:55` 写「否则 1 位小数」与 T-M8 例文 `:124`「45 t/s」矛盾。
- 改法：① 补「采样器共用封装（core `createTokenRateSampler` 单例工厂，双端消费）」；② 补「t/s 整数值不带尾随 .0」并修正 `:55` 与 T-M8 例文的矛盾；③ 补「usage 到达后 heuristic 不再回写」并写明多 step 后果（见 Open questions Q7）。
- 验收·测试：spec 内三处语义齐备且无互斥表述；T-M8 例文与取整口径一致。
- 来源：review-scope-spec + review-scope-mobile-metrics / round 1

### spec/K-4 [P2] 其它文档口径漂移

- 维度：spec（文档/⑥ 等）
- 文件：`docs/Iterations/llm-stream-native/spec.md:79`（「三分支共用同一 watchdog」→ settle 守卫上移公共层 + watchdog 已退役）、`spec.md:103`（streamBlockCommit 载荷补全为 `{kind, html?, text, tailHtml?, tailText}`）、`decision.md:35`（读超时 30s → client 级读超时恒禁用 + callTimeout 600s）、`docs/Iterations/iterations.yaml:172-175`（⑤ 写「仅 idle 30s 看门狗」「四分支 dev-ready 未 merge」）、`:182-188`（postJson/读超时/撤 close 条件表述）
- 问题：多处文档仍描述旧 watchdog/idle 语义与旧载荷结构，与实现漂移；另 spec §6 关于「终态/历史 12k 全量降级」的描述与实现不符（webview 历史/snapshot 路径无 12k 判定，终态行仍 rich）。
- 改法：按上述逐处改口径；spec §6 两条路：修正文案，或在 e2e 记录中注明实现差异。
- 验收·测试：相关句子与代码一致；不再出现 watchdog/idle 生效表述；载荷说明与 bridge 实际字段一致。
- 来源：review-scope-spec / round 1

### native-sse/docs-1（= spec/K-5，同一件事）[P2] 退役语义文档/注释残留（native 包 + core 传输层）

- 维度：F + K
- 文件：
  - `packages/llm-sse-native/README.md:20`（「超时默认：读 30s、callTimeout 600s」）、`README.md:3`（「64KB」口径，与 D8 一并登记为字符口径）
  - `packages/llm-sse-native/src/types.ts:38-41`（`LLM_SSE_DEFAULT_READ_TIMEOUT_MS` 注释「与 Kotlin 侧一致」）、`:92`（`nativeTimeouts.readMs` 注释「不传用 native 默认 30s/600s」）
  - `packages/llm-sse-native/test/transport.test.ts:180`（`// 未覆盖 → native 用默认 30s`）
  - `packages/llm-sse-native/android/src/main/java/com/novelmaster/llmsse/LlmSseModule.kt:70-74`（「流中空闲检测改在 headers 到达后经 source.timeout() 挂载」，`sseConnect` 里并无此代码）、`:264`（同句）、`:405`（读超时文案注释）
  - `packages/core/src/infra/llm-protocol/logic/llm-sse-transport.ts:429-431`（「固定文案会把 30s 读超时误标…」）
- 问题：终版语义是「流式无任何空闲超时，唯一自动兜底 callTimeout 600s」（产品拍板），Kotlin client 级读超时恒禁用，`readTimeoutMs` 只落进一条不可能产生的 SocketTimeoutException 文案；上述 8 处仍宣称 30s 读超时存在，且彼此口径不一致（review-full 新发现 F-1 → 本条覆盖）。
- 改法：README/types/测试注释统一改为「读超时已退役（恒禁用）；callTimeout 600s 为唯一自动兜底；`readMs` 仅保留接口兼容与错误文案位」；`readMs` 可以标 `@deprecated`；Kotlin 的 `source.timeout()` 注释删除；core `llm-sse-transport.ts:429-431` 改为「无流式空闲界；SocketTimeoutException 仅存防御性文案路径」。**与既有条目 `core-transport/C-1` 的边界**：C-1 只负责 `llm-sse-transport.ts:513`、`:643-644` 两处操作点注释，本条负责其余 8 处，执行时互不重叠。
- 验收·测试：`git grep -n "读超时\|read timeout" packages/llm-sse-native packages/core/src/infra/llm-protocol` 不再出现「30s 生效」类现状表述；`npm run typecheck -w @novel-master/llm-sse-native` 通过（仅注释改动）。
- 来源：review-full / round 1（含 scope-native-sse 的 docs-1 与 spec 节点的 K-5）

### spec/K-6 [P2] 未跟踪构建产物勿入库（合并前卫生）

- 维度：spec（交付/仓库卫生）
- 文件：`apps/mobile/android/app/src/main/assets/index.android.bundle`、`apps/mobile/android/app/src/main/res/drawable-{mdpi,xhdpi,xxhdpi,xxxhdpi}/`、`res/raw/keep.xml`（均未被 `.gitignore` 覆盖）
- 问题：构建产物处于未跟踪状态且未被忽略，合并时容易误入库。
- 改法：提交清单排除；顺带评估补 `.gitignore` 条目。
- 验收·测试：`git status` 不再列出这些产物；确需入库时另行说明。
- 来源：review-scope-spec / round 1

## Spec deviations

处置类型：① 已由 must-fix 步骤闭合；② 按现状收窄（用户确认，通常为文档补注即闭合）；③ 原待拍板，现已按建议倾向收窄确认。处置字段中的「已确认」均为 2026-09-26 用户指令「收敛剩下的问题」下的收窄落定（默认口径可回退，回退即改文档/代码并在本文件登记）。

**当前状态：无 open 项**（D1/D2/D3/D11 由 must-fix 步骤闭合；D4/D5/D6/D7/D8/D9/D10 按现状收窄确认；D12 无需处置）。

### D1 ⑥ spec §3「native 分支 callTimeout 传 SSE_WHOLE_CALL_TIMEOUT_MS」未按字面实现

- 处置：① 已由 `core-transport/C-orch-1`（P2）闭合。
- 说明：port opts 增 `wholeCallTimeoutMs?` 并单点下发后，实现与 spec 字面一致。

### D2 ⑤ spec/prd 仍要求无条件 close + 30s idle

- 处置：① 已由 `spec/A-2`（P1）修文档闭合。

### D3 ⑥ prd AC-4 + step7/step8 报告基于初版读超时配置

- 处置：① 已由 `spec/A-1`（P1）处置。
- 说明：已取 (b) 历史留档 + 终版修订（2026-09-26 确认）；step7/step8/stop-button-fix 文首留档注 + ⑥ spec §7 收敛上限（600s × ≤3 ≈ 30 分钟）+ CHANGELOG 口径均已落。
- 说明（补）：同类漂移还含 native 包 README/types → 由 `native-sse/docs-1` 处置。

### D4 ⑥ prd AC-3（非流式死亡收敛）未实测，T-N4 单测代偿

- 处置：③ 已按建议倾向收窄确认（2026-09-26）：接受 T-N4 单测代偿；证据等级已在 `step8-e2e-report.md` 登记（未专项实测），真机实测归入合并后 manual_user，不作合并门。

### D5 ⑥ spec T-N1/T-N8 的 native 合批事件率观测无打点（仅间接证据）

- 处置：③ 已按建议倾向收窄确认（2026-09-26）：接受间接证据，观测局限已在 `step8-e2e-report.md` 的「合批事件率观察口径」写明（精确打点属后续按需单开）。

### D6 ⑥ spec Step 1 的 mattermost PoC 改静态源码核验（decision.md:6 自述）

- 处置：③ 已按建议倾向收窄确认（2026-09-26）：接受静态源码核验替代模拟器 PoC；方式变更与三项否决证据已在 `decision.md:6` 自述、`iterations.yaml` 已改口径；⑥ spec §1 保留 PoC 原始要求措辞不改（作为评估门定义，实际执行方式以 decision.md 为准）。

### D7 ⑥ spec Step 6「双端手查」仅移动端证据

- 处置：② 按现状收窄（**已确认 2026-09-26**）；文档注记已落 ⑥ spec:154（「改造面仅移动端，桌面端不在改造面」）。

### D8 native-sse/S1 合批阈值 spec 写 64KB、实现是 64K 字符（LlmSseModule.kt:59、:350，中文≈192KB 字节）

- 处置：③ 已按建议倾向收窄确认（2026-09-26）：采「登记字符口径」路线——⑥ `spec.md:58` + `packages/llm-sse-native/README.md:3` + `LlmSseModule.kt:57` 均已按「64K 字符（UTF-16）≈192KB 字节」登记；**不**改为按字节实现。

### D9 native-sse/S3 事件枚举 `kind:"http"` Kotlin 从不发射（JS 侧据 status 归纳）

- 处置：② 按现状收窄（**已确认 2026-09-26**）；文档注记已落 ⑥ spec:62（`kind:"http"` 由 JS 侧据 Headers status 归纳）。

### D10 desktop-metrics/D2 spec §3「desktop 子会话面板天然覆盖」措辞过强（仅活跃期覆盖）

- 处置：② 按现状收窄（**已确认 2026-09-26**）；文档注记已落 ④ spec:66（「仅活跃 run 期覆盖」）。

### D11 mobile-metrics/D-1/D-2/D-3（三句语义）

- 处置：① 已由 `spec/K-3`（P2）闭合。
- **2026-09-26 推翻注记**：D-1（「usage 后 heuristic 不回写」）在本迭代被推翻——`stream-metrics-native` ① 改为「usage 基线 + 增量偏移」（spec 第 3 节「usage 基线 + 增量偏移」），原「真值后不再回写」的门删除；D-2/D-3 无变化。历史处置记录保留原意，不追溯修改。

### D12 core-metrics 无偏离；mobile-render 无 open deviation（Q1/Q2 属待拍板/文案）

- 处置：无需处置，登记备查。

## Open questions / 待拍板

> 以下 14 条均不是 must-fix 条目；其中 Q6 已升级为 P2 must-fix（`native-sse/shim-1`）、Q12 已升级为 P2 must-fix（`core-metrics/B-4`），均以对应条目为修复出口。
>
> **2026-09-26 收敛确认（用户指令「收敛剩下的问题」）**：Q1 走 (b) 历史留档 + 改文案；Q2/Q3/Q5 接受现状并在报告/文档登记证据等级；Q4 采「保留初版记录 + 终版修订段」并已执行；Q6 取最小改法（已实现）；Q7–Q11 维持现状（语义/后果已写入各 spec 或在报告中登记）；Q13 已按 `capabilities` 数组落地；Q14 各项按建议处理（Q2 分支已简化、Q3 已加注释、okhttp 版本与 iOS 面维持现状登记）。本文件自此无 open 待拍板项。

### Q1 终版首字黑洞自动收敛上限 ≈3×600s≈30 分钟 vs CHANGELOG 写 10 分钟

- 建议倾向：走 `spec/A-1` 的 (b)——只改文案，保留「手停为快速路径、自动兜底约 30 分钟」，同时把 CHANGELOG 改为「单次 10 分钟，自动重试后极端可达约半小时」；收紧预算（不重试/仅首次尝试/降预算）会改变产品行为且需重测，建议单开后续迭代。

### Q2 Step 1 评估门（mattermost PoC）被静态核验替代

- 建议倾向：接受静态核验（decision.md 已自述方式变更），在 spec 注明评估方式与局限；如需真 PoC，另开任务，不阻塞本轮。

### Q3 T-N8 事件率精确值无打点

- 建议倾向：接受间接证据 + spec 注明观测局限（为一次验收加诊断打点成本高、收益低）；若后续要长期监控事件率，再单独立项。

### Q4 文档修订策略：就地改口径 vs 保留初版记录 + 头部历史注记 + 终版修订段

- 建议倾向：保留初版记录 + 头部历史注记 + 终版修订段（不抹历史，便于追溯两次语义），与 `spec/A-1` 的 (b) 保持一致。

### Q5 AC-3（非流式死亡收敛）未实测

- 建议倾向：接受 T-N4 单测代偿，spec 注明证据等级；真机实测列入合并后 manual_user，不作为合并门。

### Q6 非流式取消语义（`native-sse/shim-1`）

- 建议倾向：取最小改法——shim 读 `init.signal`，已 aborted/abort 到达即 AbortError reject，native 侧后台自结并登记「连接不真断」限缩；不改 native API（避免 spec §2 契约扩展）。该条已写入 P2 must-fix。

### Q7 usage 后 heuristic 不回写导致多 step 流中数字僵住（速率段可能消失、跨 step 长窗平均）

- 建议倾向：接受现状 + 在 ④ spec 写明后果（多 step 下数字在 step 间可能停留、速率段可能消失）；改「usage 基线 + 增量偏移」需重新设计采样与落库，超出本轮修复面。
- **2026-09-26 推翻注记**：本迭代已推翻该收窄，由 `stream-metrics-native` ① 修复（用户拍板「usage 基线 + 增量偏移 + 校正点重 seed 采样窗」）——`apps/mobile/src/services/session-stream-unit.ts` 与 `apps/desktop/renderer/hooks/useAgentStreamMetrics.ts` 删掉「真值后不再回写」的门、引入基线字段，`packages/core/src/domain/format/sliding-token-rate.ts` 增加「窗口折叠后首个新样本重 seed」。上文「超出本轮修复面」的判断作废，历史记录保留。

### Q8 块独立渲染与整文渲染的结构差异（无管道数据行的表格、被空行切开的有序列表 start）

- 建议倾向：接受视觉近似，用注释 + 单测固化差异；给切分器补上下文成本高，且终态仍是整文渲染。

### Q9 t/s 口径两套并存（统计页仍 1 位小数 + desktop 用 tok/s）

- 建议倾向：本轮维持，统一留待后续一致性迭代；可在 `spec/K-4` 顺带登记为待办。

### Q10 desktop 不写 stream_metrics KKV（双端持久化不对称）

- 建议倾向：本轮接受现状并在 spec 注明不对称；补 desktop 写入路径属功能扩展，单开迭代。

### Q11 同会话第二次子 run 的 RUN_STARTED 被静默丢弃（当前不可达）

- 建议倾向：仅加日志/注释说明当前不可达，保持现状；替换语义属行为扩展，等真实需求出现再做。

### Q12 `slidingTokenRate` 对「部分未来样本」（时钟回拨）会照常计入（已升级为 `core-metrics/B-4`）

- 处置：已升级为 P2 must-fix（`core-metrics/B-4`），以该条为修复出口，本条不再另立步骤。
- 建议倾向：显式裁掉未来样本（`tMs > nowMs` 丢弃），并补时钟回拨用例；成本极低，可防速率算歪。

### Q13 块级渲染能力协商（mobile-render/B-2）的协议形态

- 建议倾向：`capabilities:['streamBlockCommit']` 数组（可扩展、语义明确），`version` 仅作辅助信息；与 B-2 实施一并落地。

### Q14 其它未知/未定

- 建议倾向（逐项）：
  - `core-transport` Q2：`if (!usedRegisteredTransport)` 恒真——直接简化掉死分支，留断言防回退。
  - `core-transport` Q3：`AgentStreamRegistry.get` 无生产调用方——保留导出（测试已在用），加注释标注内部/测试用途，不删。
  - `desktop`：切会话残留「上次生成」为 pre-existing——记为已知问题，不阻塞本轮。
  - `native-sse` Q3：build.gradle okhttp 无显式版本——建议显式锁版本并与 release 对齐。
  - `native-sse` Q4：`nativeTimeouts.readMs` 扩展位——标 deprecated 而非删除，避免接口面破坏。
  - `mobile-metrics`：同会话第二次子 run 见 Q11；断言强度按 G 类条目补齐。

## 已豁免（用户确认不修）

（暂无。本轮无用户已确认豁免的条目；后续若拍板不修，移入本节并注明日期与理由。）

## 合并后 QA（manual_user）

- 真机验收 ⑥ T-N9 的剩余部分：AC-1/AC-2 长文与高速体验请用户亲测（12000 token 全程无冻结、10 万字长文不掉帧、块级渲染视觉近似可接受）。
- ④ 的 manual_user：真机查看指标条 token 数/实时速率/中断后不清零、断网重连后的显示。
- 子会话指标条真机可见性（含「已中断」重复文案修复后）。

## K 节建议（下游执行时闭合）

- 合并前逐项：mock 改动处置（`spec/K-2`）、未跟踪构建产物排除（`spec/K-6`）、SCHEMA_BOOT_VERSION 顺延核对（`core-metrics/B-3`）、CHANGELOG ④ 条目（`spec/K-1`）。
- 建议一次 lint/format 过场与 `npm run build --workspaces`（本 skill 不跑，由下游执行）。

## 执行记录（code-dev-loop，2026-09-26）

- **dag_version 3 / wave**：wave-1 八个 impl 节点并行（core 格式层、core 传输层、原生管包、mobile 指标链、mobile 渲染、desktop、mobile shim 装配、文档交付面）→ 主代理按节点分组统一提交（避免并发写 index.lock）→ wave-2 统一构建（workspaces + webview）→ wave-3 四路 verify → wave-4 三个 readonly cr-func → 尾项 fix + 合并式 verify/cr-func delta 复核。
- **提交**：`682142df`(core 格式) `32a092cb`(core 传输) `1813768b`(原生包) `ac33eb8d`(mobile 指标) `c86c0567`(mobile 渲染) `5b6223df`(shim/装配) `4fb63172`(desktop) `dd4b2a25`(mock 入库) `aa55b8e2`(文档/交付面) `7b7e1175`(cr-func 尾项) → HEAD `7b7e1175`。
- **默认口径（用户未逐条拍板，按本文件建议执行，可回退）**：`spec/A-1` 走 (b) 历史留档 + CHANGELOG「单次 10 分钟，自动重试后极端约半小时」；`native-sse/shim-1` 取最小改法（AbortError 快速收敛，连接不真断）；`mobile-render/B-2` 能力协商用 `capabilities` 数组；`D8` 采「登记 64K 字符口径」。
- **验证**：core 定向 113 例 + 全量嵌套面抽跑全绿、typecheck 干净；llm-sse-native 包 25 例 + tsc + eslint 全绿；mobile 定向 23 套件 283 例（cr-func 复跑 27 套件 319 例）+ tsc 全绿；desktop 14 例全绿、renderer tsc 349（基线 351，净减 2 无新增）；**Kotlin `:novel-master_llm-sse-native:compileDebugKotlin` BUILD SUCCESSFUL**（产物物证 `build/tmp/kotlin-classes/debug/.../LlmSseModule.class` 16:12）。
- **cr-func 结论**：cr-func-core-native / cr-func-mobile / cr-func-desktop-docs 均 **func-ready: yes**；cr-func-delta **func-ready: yes**。
- **需用户确认（不阻塞代码面）**：`D4`（AC-3 非流式死亡收敛未实测，T-N4 代偿）、`D5`（T-N8 事件率无打点，仅间接证据）、`D6`（Step 1 mattermost PoC 改静态核验）、`D7`/`D9`/`D10`（文档收窄注记已落，待确认）、`D8`（取登记路线）。
- **残留风险（已登记，不阻塞；含后续收敛更新）**：① Kotlin：`compileDebugKotlin` 已 BUILD SUCCESSFUL（1308 包出包也再次编译通过），但并发语义仍无自动化护栏（Kotlin 单测基建未引入）；② ~~runId 加固未做~~ **已于 `de36ccad` 实现并在模拟器实测**（旧格式值兼容显示 + 新格式带 runId 且与 settled 行一致 + 无速率时删键）；③ mobile 全量 jest 在本机有两条环境性基线红（CRLF 的 T-MF3、helpers 被当套件收），非本 diff 引入；④ 真机手动项见「合并后 QA」与下方验收记录；⑤ 合并门 `core-metrics/B-3`（BOOT_VERSION 顺延）仍需在合并时核对主干现值。

## 验收记录（模拟器 emulator-5554，包 1308，2026-09-26）

包：`app-debug.apk` versionCode=**1308** / 1.5.24-dev（内嵌 bundle `useDevSupport=false` + webview native 资产；短路径 junction `D:\nm7` 出包，绕开 CMake 260 字符上限；`MainApplication.kt` 临时改动已还原）。mock：`scripts/mock-openai-server.mjs` + `adb reverse tcp:8787`；库在验收后已还原（SHA-256 与备份一致）。

| 项 | 结果 | 证据 |
|---|---|---|
| 旧格式（无 runId）冻结速率跨版本兼容 | ✅ | 会话 `ce138bb5` 显示「上次生成 · 111s · 输出 12,048 t · 50.5 t/s」（库内该行确为旧格式，无 runId） |
| 新 run 实时指标（token + 速率、无 0 字停摆） | ✅ | 连拍逐字转写：`生成中 · 1.0s · 输出 0 t` → `3.1s · 0 t` → `5.1s · 67 t · 88.1 t/s` → `11.5s · 563 t · 95.9 t/s` → 终态 `50.4s · 12,000 t · 85.2 t/s`；run_state settled/12000/usage 与 KKV **新格式（带 runId，且与 settled 行一致）** |
| 重启后冻结速率仍在（KKV 水合 + runId 校验） | ✅ | force-stop + 重启后同会话仍显示 `50.4s · 12,000 t · 85.2 t/s` |
| 无速率 run → KKV 键被删（B-1） | ✅ | 单 chunk 响应后：库内该会话 `session_kkv_entry` **行已消失**；重启后文案为「上次生成 · 2.8s · 输出 8 t」**不带 t/s** |
| 子会话指标条 | ✅（终态）/ ⚠️（活跃态未抢到） | 子会话页显示 `上次生成 · 3.0s · 输出 400 t · 78.1 t/s`；活跃态因 dump 陈旧 + 卡片滚动边界未捕获（受限于取证手段，非功能问题） |
| 「已中断」单标识 | ✅ | 子会话流中强杀应用后，父会话页 `已中断` 徽标**恰好 1 次**；重启后子会话页无任何标识（子会话 run 不落库的既有行为，0 次≠重复） |
| 停止键 | ✅ | 长流中点停止：服务端日志「响应流关闭（未自然结束，第 225 步）」，文案转终态「上次生成 · 6.8s · 输出 261 t · 82.8 t/s」，发送键恢复 |

**验收副产物（观察项，已登记不阻塞）**：① 流式中 uiautomator dump 返回陈旧层级（`could not get idle state`）→ 流中取证改用截图；② 「极小响应→无速率」须**单 chunk** 才稳定触发（2 chunk 会形成两样本算出速率）；③ **多步 run（tool 调用+后续文本）终态无速率段**——~~正是 Q7/`D11` 已登记的「usage 后 heuristic 不回写」后果，非新问题~~ → **本迭代已推翻该收窄，由 `stream-metrics-native` ① 修复**（usage 基线 + 增量偏移 + 窗口折叠重 seed；验收由 mobile/desktop 的多步 run 用例守住）；④ 长流实时 token 计数显著低于 usage 真值（`1,370 t`@22s vs 12,000 t 终值）——heuristic 中文低估 + 终值校正跳正，属 ④ 设计行为（已由 `stream-metrics-native` ② 的 js-tiktoken 尾窗估算进一步收敛）；⑤ 上下文用量显示重启前后不一致（`~0% · 214/128K` → `~3% · 3.6K/128K`），疑似估算口径/水合重算差异，**新观察，建议后续单查** → **本迭代已由 `context-usage-caliber-unify` ③ A 组闭合**（API `prompt_tokens` 落 session KKV，重启后同口径）。

**真机（DSLDU20407006179）**：截至本次记录，设备处前台活跃使用中（`mCurrentFocus=com.novelmaster/MainActivity`），未安装 1308、未做任何操作；真机验收需用户约定设备空闲窗口后进行（安装需屏幕唤醒+确认弹窗）。
