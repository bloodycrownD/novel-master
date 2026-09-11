---
date: 2026-09-11
---

# 会话流式单元（真并发重构）技术规格（SPEC）

需求来源：`docs/Iterations/session-stream-unit-2026-09/prd.md`（用户已拍板：跨项目跨会话、持久化一步到位、直接替换不留灰度）。

## 设计目标

把「会话的 run」从屏幕单槽里解放出来，成为独立于 React 组件生命周期的对象；屏幕退化为纯订阅者。消灭的不是一个 bug，而是换绑缝隙这一整类 bug 的生成器（PRD 背景清单 S1-S12）。

硬性边界（来自 PRD 与用户拍板）：

- 单会话行为零回归（现有套件全绿是替换门禁）；
- 指标语义不可回退：新 run 重置、结束冻结「上次生成」、切会话只换数据源、重进运行中会话连续计时；
- 重建路径（恢复窗口/探针合成/重进注入/发起保护窗）随单元化退役，其守护测试改写为单元级等价断言；
- webview 哑引擎（ChatTranscriptWebView 及其快照/可见性重挂协议）保留，只改驱动侧；
- legacy MessageList（非 webview 引擎）与 desktop 不动。

## 总体方案

### 架构：SessionStreamUnitManager（React 树外）+ per-session Unit

以 AgentRunManager 为模板（它是仓库里唯一的「React 树外单元」先例，装配/dispose/桥/投影订阅契约全部现成）：

```
SessionStreamUnitManager（runtime 装配，retry 先 dispose）
 ├─ units: Map<sessionId, SessionStreamUnit>
 ├─ 全量事件订阅（8 个事件，先于任何 UI 建立——沿用「同步总线+订阅顺序」契约）
 ├─ run 态写通（节流）与重启水合（core session_run_state 服务）
 ├─ app 级职责（吸收自 AgentRunManager）：agentActive refcount、
 │   完成通知/保活起停、通知点按导航、备份/云同步门禁
 └─ 投影订阅 API：subscribe(listener) + snapshot(sessionId)（同构 subscribeEntries）

SessionStreamUnit（每 sessionId 至多一个；run 开始复用/创建，结束后宽限销毁）
 ├─ 状态机：idle → starting → running → settled(interrupted|finished|failed) → (宽限)销毁
  │   settled 态在持久层存为 status=settled 行（仅保留 metrics 字段：text_chars/thinking_chars/updated_at_ms，
  │   partial 字段清空），用于跨重启的「上次生成」读取；interrupted/finished/failed 在持久层统一
  │   以 status=settled 存储，区分方式由 runtime 内存状态机负责（持久层不区分终态子类型）
 ├─ 事件管线：delta/step/finished/failed/child-created 全消费（sid 固定，无重订阅）
 ├─ 流式缓冲：32ms ingress 合并 + 64ms apply（吸收 useSessionBatch）
 ├─ 消息管线：tail 加载/分页/step 级 reload/view cache 写入（吸收 useChatTabMessages 的纯数据管线部分；
  │   作用域守卫结构性消失——结果只可能落回自己家）
  │   ≤ 吸收边界 = 纯数据管线（tail/分页/step 级 reload/view cache 写入）；
  │   发送态推导（canResumeWithoutInput/lastMessageIsPlainUserText）、draftRestoreToken、
  │   DeviceEventEmitter 外部事件监听、hydrateFromSessionCache 等非运行态逻辑不进单元，
  │   留在瘦身后的 useChatTabMessages（或 ChatTabProvider 的非运行态部分）
 ├─ 注入：单一 partial 注入实现（吸收 useChatStreamResumeInject + 子会话屏内联版）
 ├─ 指标：吸收 stream-metrics-store 语义（成为单元字段，store 退役）
 ├─ 子会话链接：pendingChildren（吸收 subagentChildSessionsByParent）
 └─ webview 订阅：attachWebview(handle)/detach——多句柄注册表，
     「最后 attach 的可见句柄」收流式推送，控制类消息全句柄广播
```

屏幕侧：

- `ChatTabProvider` 终态只剩装配与路由：从 manager 取当前 sessionId 的单元投影（订阅模式沿用 `subscribe + useEffect + sync()` 先例，仓库无 useSyncExternalStore 先例，不引入新范式），把 webview 句柄 attach/detach 进单元；
- `SubagentSessionScreen` 删除自己的第二套装配（abort/batch/stream/内联注入），改为订阅同一 manager 的单元——**partial 注入只剩一份实现**（PRD 结构验收）；
- `ChatComposer.executeRun` 改调 manager.startRun（契约不变：onUserMessageAppended/onSettled/失败明确拒绝）；
- legacy MessageList 路径的流式投影来源同步换血：`ChatConversationPanel` 给 `MessageList` 传的 streamingText/streamingThinking props 改从当前会话的单元投影读取（与 webview 句柄同源、只是消费面不同），`MessageList` 组件本身不动（不违反「legacy 不动」边界——组件不动，props 来源换投影）。

### 发起与门禁（吸收 AgentRunManager）

`manager.startRun(sessionId, projectId, content, options)`：门禁 = `units.has(active run) || abortRegistry.has(sessionId)`（封受理→register 空窗，即 `starting` 态）。`active run` 只计 `starting|running` 状态的单元——`settled`（interrupted/finished/failed）与宽限期的单元不阻塞新 run；interrupted 单元在 startRun 时被替换/吸收：删旧单元建新单元（run_id 更新、状态机回到 starting，partial/注入标记重置，metrics 语义按「新 run 重置」处理），不产生双单元并存。其余与之前一致：受理同步 increment refcount；fire-and-forget + finally 兜底；收尾 runId 所有权校验。UI 乐观置位（beginUiRun）保留在 composer 侧，保护窗随单元化缩短为「starting 投影即时可见」——探针/恢复窗口整体退役（单元从未死过，无需重建；兜底校准探针保留一个最小版：registry.has 轮询收尾，防 core 事件丢失，落位为新文件 `apps/mobile/src/services/run-finish-calibration-probe.ts`——非 hook 的独立小模块，由 manager 装配启动，吸收原 use-run-resume-probe 的收尾校准方向并丢弃恢复方向）。

### 持久化（core 新表 session_run_state）

选型：**新表**（PRD 定性「会话数据而非可丢缓存」；session_kkv 有 fork/copy 不复制、truncate-tail 清域、TEXT 单 value 等语义雷区，探索报告已逐条列出）。

- 表：`session_run_state(session_id PK, project_id, run_id, status(starting|running|settled), started_at_ms, text_chars, thinking_chars, partial_text, partial_thinking, pending_children_json, updated_at_ms)`；
  - `settled` 行由正常收尾/中断/失败时 UPSERT 写入（覆盖 starting/running 行），partial_text/partial_thinking 清空、
    pending_children_json 清空，仅保留 text_chars/thinking_chars/updated_at_ms 等 metrics 字段；
  - interrupted 与 finished/failed 在持久层统一为 status=settled，区分方式由 runtime 内存状态机负责（持久层不区分终态子类型，只关心「是否还活着」）；
- schema 走 `NOVEL_MASTER_SCHEMA_STATEMENTS` 幂等 DDL + **SCHEMA_BOOT_VERSION 12→13**（存量库走慢路径建表；规则 #10：必须 bump + 重建 core dist）；
- 仓储/服务/导出照抄 session-kkv 全链形态（`SqlTemplateParser` + UPSERT 单行单 key——天然原子，不进事务、不做 CoordinatedWrite，规避 tdbc 嵌套事务铁律）；
- 写通：单元内 coalescer（参照 sse-chunk-emitter 三态 append/flush/dispose），**250ms 合并 + step 边界立即刷**；partial 全量覆盖写，护栏：单次载荷 > 1MB 时降频到 1s（防写放大）；
- coalescer dispose 时序：manager.dispose() 时对每个在途 coalescer 执行「立即 flush 一次后 dispose」（尽力落盘；flush 失败吞错——连接可能已关；不阻塞 dispose 本身）；interrupted 单元被 startRun 替换时，旧 coalescer 先 flush + dispose 再建新（防旧单元的在途写覆盖新 run 的行）；
- 删除联动清理（照 session_kkv 先例）：会话删除走 core `session.service.delete` → `deleteSessionTree`（在现有 `sessionKkv.clearSession(session.id)` 调用处）同事务补删该 session 的 `session_run_state` 行（递归子会话时逐层清理）；项目删除走 core `project.service.delete`（BFS 展开全部 sessions 后逐个 `sessionKkv.clearSession` 处）同事务级联清理其全部 sessions 的 run_state 行（表带 project_id 列，可按 projectId 一条 DELETE 等价实现）；mobile 端会话/项目删除 UI 最终都经这两个 core 服务入口，无需屏幕侧额外清理逻辑。不清理的话，孤儿 starting/running 行会在重启水合时生成幽灵 interrupted 单元（白占 LRU 8 槽位、pendingChildren 指向已删子会话）；
- 水合：manager 构造时异步全表扫 `status IN (starting,running)` 行 → 逐个建 `interrupted` 态单元（partial 只读展示 + 指标恢复 + 子会话链接恢复），完成后置 `hydrated=true`；其间同步扫 `status=settled` 行 → 回填内存中的 settled 投影（sessionId → metrics 快照），供水合完成后「上次生成」跨重启读取；水合完成前 UI 查投影得 null（会话呈现为无 run——水合是单表小扫描，窗口可忽略）；**run 正常收尾时 UPSERT 覆盖为 status=settled 行**（partial 字段清空、仅保留 metrics 字段），上次生成指标落在内存投影 + 持久层 settled 行双份，重启后由 settled 投影回填供「上次生成」读取。
- 读路径：`ChatStreamMetricsBarLive`（或等价消费方）从 manager 的 settled 投影读取「上次生成」指标——stream-metrics-store 退役后，指标条的数据源是 manager 的 settled 投影（含运行中单元的实时指标 + 已收尾单元的 settled 快照），不再依赖 store 单例。settled 投影为 **manager 级常驻 map**（sessionId → metrics 快照），独立于单元生命周期：不随单元宽限销毁或 LRU 淘汰清除（否则单元淘汰后「上次生成」断源），仅被同会话新 run 收尾时的 settled 写入覆盖，或随会话删除清理。
- 中断现场渲染：**首选新增轻量合成提交路径**（单元驱动、只读地提交 partial——把 interrupted 单元持有的 partial 组装为一条只读 assistant 终态行，经 webview 现有 commit 通道呈现）。不复用水合场景下的 `commitAbortOverlaySnapshot`：该函数读 webview 组件本地累积（streamTextAccumRef/streamThinkingAccumRef），且以 streamActiveRef 为前置（仅由 pushStreamDelta/pushStreamBatch 置真）——重启水合出来的 interrupted 单元两者皆空，直接调用必 return false。若实现时发现可低成本借用（如先经 pushStreamBatch 注入累积再 commit）再降级复用，但默认按新路径设计。中断徽标走 `agentRunning=false` + 新增 flags（如 `interrupted: true`）或复用既有视觉模式（如 abort 覆盖层）；只读 partial 不可续跑、不可编辑，与中止覆盖层共享「已是终态」的视觉语义（PRD 验收「已生成 partial 可读、状态为已中断」）。

### 后台停止入口

会话列表项操作组（`ChatSessionListPanel` 长按/swipe 菜单）加「停止生成」（仅该会话 run 活跃时出现），调 `manager.stopRun(sessionId)`（走单元的 abort 语义：retain/freeze 时序保留）。

## 最终项目结构

```
packages/core/src/
  bootstrap/session-run-state/session-run-state-schema.ts        # 新
  bootstrap/novel-master-bootstrap.ts                            # STATEMENTS + BOOT_VERSION 13
  domain/session-run-state/{model,repositories/impl}/           # 新（照 session-kkv 形态）
  service/session-run-state/{port,impl,create}.ts               # 新
  public/session-run-state.ts                                    # 新 barrel
apps/mobile/src/
  services/session-stream-unit-manager.service.ts               # 新（吸收 agent-run-manager.service.ts）
  services/session-stream-unit.ts                               # 新（单元本体：状态机/管线/注入/指标/链接）
  services/run-state-writethrough.ts                            # 新（coalescer，可并 unit 文件）
  services/run-finish-calibration-probe.ts                      # 新（最小校准探针：registry.has 轮询收尾，manager 装配）
  runtime/{novel-master-context.tsx,types.ts,create-mobile-runtime.ts}  # 装配替换
  screens/tabs/chat-tab/ChatTabProvider.tsx                     # 瘦身：只装配与路由
  screens/tabs/chat-tab/useChatTabMessages.ts（瘦身后保留）      # 非运行态部分：发送态推导/draftRestoreToken/外部事件监听
  screens/tabs/chat-tab/{useSessionStream,useSessionBatch,useSessionAbort,useChatStreamResumeInject}.ts  # 退役删除
  hooks/{useAgentRunLifecycle.ts,use-run-resume-probe.ts}       # 退役删除（探针最小版迁至 services/run-finish-calibration-probe.ts）
  screens/stack/useSubagentRunProbe.ts                          # 随子会话屏双装配退役
  screens/tabs/chat-tab/ChatSessionListPanel.tsx 或等价          # 停止入口
  screens/stack/SubagentSessionScreen.tsx                       # 双装配删除，改订阅
  components/chat/ChatComposer.tsx                              # 发起 API 改 manager.startRun
  screens/tabs/chat-tab/ChatConversationPanel.tsx               # 订阅接线（与 ChatTabProvider 同目录，勿按旧结构图找 components/chat）
  components/chat/ChatTranscriptWebView.tsx                     # 哑引擎保留（props 来源换投影）
apps/mobile/jest.config.js                                      # + /session-run-state 子路径映射
apps/mobile/__tests__/（见测试策略）
```

## 变更点清单

| # | 文件/模块 | 变更 |
|---|---|---|
| 1 | core session-run-state 全链 + bootstrap | 新表/仓储/服务/导出/版本 bump |
| 2 | session-stream-unit-manager.service.ts | 新建，吸收 AgentRunManager（原文件删除；用户拍板不留双轨：直接替换，调用方同 commit 改完，不留别名） |
| 3 | session-stream-unit.ts | 新建，吸收 useChatTabMessages 的纯数据管线（tail/分页/step reload/view cache）+ 六个 hook 的运行态（useSessionStream/useSessionBatch/useSessionAbort/useChatStreamResumeInject/useAgentRunLifecycle/use-run-resume-probe）+ metrics store + pending 映射；非运行态（发送态推导/draftRestoreToken/外部事件监听）不吸收 |
| 4 | novel-master-context/types/create-mobile-runtime | 装配点替换 + 水合时机 |
| 5 | ChatTabProvider | 拆运行态，改投影订阅 + attach/detach；非运行态（useChatTabMessages 的发送态推导/draftRestoreToken/DeviceEventEmitter 监听）留在瘦身后的 hook，这些是纯计算/事件监听、不订阅运行态，不违反「无运行态」静态守卫 |
| 6 | SubagentSessionScreen | 删第二套装配 |
| 7 | ChatComposer/ChatConversationPanel | startRun 指向 manager、props 投影化；legacy MessageList 的 streamingText/streamingThinking props 改从单元投影读取（组件本身不动） |
| 8 | 会话列表 | 停止入口 |
| 9 | 六个 hook 文件 + agent-run-manager.service.ts + stream-metrics-store.ts + screens/stack/useSubagentRunProbe.ts | 删除（逐一点名见下表）；useChatTabMessages.ts 瘦身后保留（非运行态部分）；最小校准探针迁至 services/run-finish-calibration-probe.ts |
| 10 | 测试矩阵 | 见测试策略（改写/新增/微调/门禁） |

### 退役与保留逐一点名（Step 7 删除清单的执行依据）

删除（含完整路径）：

| 文件 | 说明 |
|---|---|
| `apps/mobile/src/screens/tabs/chat-tab/useSessionStream.ts` | 流式运行态进单元 |
| `apps/mobile/src/screens/tabs/chat-tab/useSessionBatch.ts` | 32/64ms 缓冲进单元 |
| `apps/mobile/src/screens/tabs/chat-tab/useSessionAbort.ts` | abort 运行态进单元（abortRegistry 侧保留） |
| `apps/mobile/src/screens/tabs/chat-tab/useChatStreamResumeInject.ts` | 单一 partial 注入实现进单元 |
| `apps/mobile/src/hooks/useAgentRunLifecycle.ts` | run 生命周期投影进单元（ChatTabProvider 现用，运行态） |
| `apps/mobile/src/hooks/use-run-resume-probe.ts` | 探针 hook 退役；收尾校准方向迁入新文件 `apps/mobile/src/services/run-finish-calibration-probe.ts`（恢复方向随单元水合消失） |
| `apps/mobile/src/screens/stack/useSubagentRunProbe.ts` | 子会话屏第二套装配的一部分，随 SubagentSessionScreen 改订阅退役（其职责被单元水合 + 最小校准探针覆盖） |
| `apps/mobile/src/services/agent-run-manager.service.ts` | 吸收进 manager 后删除（不留别名双轨） |
| `apps/mobile/src/services/stream-metrics-store.ts` | 指标语义进单元字段 + settled 投影 |

瘦身保留：`apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts`（注意扩展名是 `.ts`）——非运行态部分（发送态推导/draftRestoreToken/DeviceEventEmitter 外部事件监听/hydrateFromSessionCache）。

不动（非运行态，勿误删）：`useChatTabScope.ts`、`useChatTabStream.ts`（仅含滚动缓存 helpers，与运行态无关）、`useChatTabMessageActions.ts`（UI 动作；其消费的运行态值均为参数传入，上游换源后无需改动）。

接线微调、不删除：`useChatTabController.ts` —— 它消费 `ctx.uiRunning`（现源自被删的 useSessionAbort）与 `ctx.resetStreamingDisplay`（现定义于被删的 useSessionStream），ctx 形状变化后须换数据源（uiRunning ← 单元投影、resetStreamingDisplay ← 单元等效方法），归入 Step 6 接线清单；typecheck 会强制暴露、修复方向唯一。

## 详细实现步骤

- Step 1 — phase-core-runstate — blocking: yes — qa: auto：core 侧 session_run_state 全链（schema + bootstrap bump 13 + 仓储/服务/barrel + jest 子路径映射 + 重建 dist + 删除联动：session.service.delete/project.service.delete 链路照 session_kkv 先例同事务清理 run_state 行）；单测：UPSERT 原子覆盖、按状态扫描（starting/running/settled 各过滤）、settled 行字段语义（partial 清空、metrics 保留）、旧库升级慢路径建表、删会话/删项目后对应 run_state 行不存在（含子会话与多会话项目级联）。
- Step 2 — phase-unit-core — blocking: yes — qa: auto：SessionStreamUnitManager + Unit 状态机（吸收 Manager：门禁/refcount/entries/三桥/通知/保活/dispose 契约原样迁移，文件改名 + 单元字段扩展）；单测：T-P1/P2/P3/P9 全套平移 + 单元生命周期（idle→starting→running→settled、宽限期销毁、LRU 上限 8）。
- Step 3 — phase-unit-pipeline — blocking: yes — qa: auto：单元事件管线（delta/step/finished/failed/child-created）+ 32/64ms 缓冲 + 单一注入实现 + 指标字段化 + pendingChildren；单测：T-R 系列改写为单元级（切走后事件仍消费、重进注入一次、step 重置注入标记）、T-M 平移、T-SUB 链接语义、T-U13 跨项目并行等价（两 project 会话并行，事件路由/投影/收尾互不串扰）。
- Step 4 — phase-unit-messages — blocking: yes — qa: auto：单元消息管线（tail/分页/step 级 reload/view cache 写入——后台收尾会话照常刷缓存）；单测：T-X 等价断言（单元消息只含本会话行）、后台 FINISHED 后重进即最新（消息丢失回归）、subagent 长任务期间消息可见（force 快照路径平移到单元侧驱动）。
- Step 5 — phase-persist-writethrough — blocking: yes — qa: auto：写通 coalescer + 水合 + interrupted 终态 + settled 收尾；单测：节流合并/step 边界刷/大载荷降频、水合建 interrupted 单元（partial/指标/链接恢复）、正常收尾覆盖写 status=settled（partial 清空、metrics 保留）+ 重启后 settled 投影回填「上次生成」、interrupted 单元上再发起 startRun 被替换/吸收（含旧 coalescer 先 flush+dispose 再建新）、manager.dispose() 在途 coalescer 尽力 flush（失败吞错不阻塞）、fork/copy 无运行态、置位/压缩不影响。
- Step 6 — phase-screen-subscribe — blocking: yes — qa: auto：ChatTabProvider 瘦身 + ChatConversationPanel/ChatComposer/SubagentSessionScreen/useChatTabController 接线（controller 的 uiRunning/resetStreamingDisplay 换单元投影源，见点名表「接线微调」行）+ webview attach 注册表（多句柄：最后 attach 收流式、控制消息广播）+ 会话列表停止入口；单测：Provider 级集成（chat-tab-screen 平移）、双屏句柄分发、停止入口调用 manager.stopRun、T-REPAINT/T-SUB-CARD 微调后全绿。
- Step 7 — phase-legacy-teardown — blocking: yes — qa: auto：按「退役与保留逐一点名」表删除六个 hook + useSubagentRunProbe + agent-run-manager.service.ts + stream-metrics-store.ts + 探针/恢复窗口/保护窗；useChatTabMessages.ts 瘦身保留非运行态；改写守护：T-P7 静态清单更新（文件改名）、**新增静态守卫：ChatTabProvider.tsx 不含 uiRunning/activeRunId/streamingText/streamingThinking/sessionAgentRunning/streamTailGenerating 等运行态标识（词表以实现时 ChatTabProvider 实际清空的运行态标识为准补全；发送态诸如 canResumeWithoutInput/lastMessageIsPlainUserText 是纯计算不涉及状态订阅，可留在瘦身后的 hook，不触发守卫——PRD 结构验收）**；全套件回归。
- Step 8 — phase-device-validation — blocking: no — qa: manual_user：真机验收 PRD 全部 GWT 清单（并行压测七条 + 单会话回归 + 杀进程水合）。

## 测试策略

四层既有格局不变（纯逻辑 → 单元 → 编排 → 渲染面）。门禁（不动或微调后必须绿）：`chat-tab-screen.integration`、`chat-composer.integration`（T-CR4 自愈不动）、`chat-transcript-webview`（T-REPAINT/T-SUB-CARD/性能红线）、`agent-finished-notification`、`agent-activity`（T-P7 改清单）、view-cache。改写为单元级：`use-chat-stream-resume`（T-R 系列）、`use-agent-run-lifecycle`、`use-chat-stream-runtime`（harness 演化）、`subagent-run-probe`（最小校准版，随探针迁至 run-finish-calibration-probe）、`chat-tab-messages-scope`（T-X 等价）、`flush-run-ui`。新增：单元本体、写通/水合、Provider 无运行态静态守卫、停止入口、跨项目并行等价（T-U13）。运行约束：NODE_ENV=test、官方 typecheck 脚本、worktree 先重建 dist（#31/#38）。

### 测试用例（新 T 系列，均映射 Step）

- T-U1 — blocking: yes — 单元生命周期与宽限/LRU（Step 2）
- T-U2 — blocking: yes — 切走后事件仍消费：后台会话 delta/step/收尾全落地（Step 3）
- T-U3 — blocking: yes — 重进注入恰好一次；step 重置注入标记（Step 3）
- T-U4 — blocking: yes — 指标语义五条（新 run 重置/回填不重置/冻结/切会话换源/连续历时）（Step 3）
- T-U5 — blocking: yes — 单元消息隔离 + 后台收尾缓存刷新（消息丢失回归）（Step 4）
- T-U6 — blocking: yes — subagent 期间任务卡/消息可见（Step 4）
- T-U7 — blocking: yes — 写通节流/边界刷/降频；水合建 interrupted（partial+指标+链接恢复）；中断现场渲染（partial 只读呈现 + 已中断徽标，走轻量合成提交路径——不复用依赖 webview 本地累积的 commitAbortOverlaySnapshot）；正常收尾 → 重启 → 指标条显示「上次生成」（settled 投影回填，且投影不随单元宽限销毁/LRU 淘汰清除）（Step 5）
- T-U8 — blocking: yes — fork/copy 无运行态；置位/压缩不清运行态（Step 5）
- T-U9 — blocking: yes — 双屏 webview 句柄分发 + 会话列表停止；多会话并行时逐个停止互不影响、全部停止后无残留（manager 无 active 单元、agentActive refcount 归零）（Step 6）
- T-U10 — blocking: yes — ChatTabProvider 无运行态静态守卫（守卫词表：uiRunning/activeRunId/streamingText/streamingThinking/sessionAgentRunning/streamTailGenerating，以实现时实际清空的标识为准补全；发送态纯计算不触发）（Step 7）
- T-U11 — blocking: no — manual_user：PRD GWT 全清单（Step 8）
- T-U12 — blocking: yes — 重启后同会话立即再发起：interrupted 单元被 startRun 替换/吸收，门禁不阻塞、无双单元并存，指标按新 run 重置（Step 5）
- T-U13 — blocking: yes — 跨项目并行等价：两个不同 project 的会话并行生成，事件路由/投影/收尾互不串扰（Step 3）

## 兼容性或迁移说明

- schema bump 13 对 desktop 存量库同样触发一次慢路径（幂等 DDL，无数据搬迁）——desktop 测试跑一轮确认；
- core 新子路径导出须重建 dist（mobile metro/jest 直连 dist 真文件）；
- Manager API 调用方（ChatComposer/通知点按/Provider 投影）在同一 commit 内完成替换，不留别名双轨；
- 回滚 = git revert 整个迭代分支（用户拍板，无灰度）。

## 风险与回滚方案

1. **消息管线进单元是最大改动面**（原 T-X/水合/分页逻辑全部搬家）——Step 4 单独成步、T-X 等价断言先行兜底；
2. T-P7 等静态守卫硬编码文件路径，删除旧文件会 ENOENT 崩测试——Step 7 内清单与删除同 commit；
3. 水合/写通是全新测试面——Step 5 独立 blocking，不与单元管线混步；
4. mountFull harness 与生产装配同步漂移风险——改写后 harness 直接消费真实 manager（不再是手工复刻装配）；
5. 回滚：revert 迭代分支即可（无数据不可逆变更：session_run_state 表保留无害，旧代码不读它）。
