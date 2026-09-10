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
 ├─ 事件管线：delta/step/finished/failed/child-created 全消费（sid 固定，无重订阅）
 ├─ 流式缓冲：32ms ingress 合并 + 64ms apply（吸收 useSessionBatch）
 ├─ 消息管线：tail 加载/分页/step 级 reload/view cache 写入（吸收 useChatTabMessages；
 │   作用域守卫结构性消失——结果只可能落回自己家）
 ├─ 注入：单一 partial 注入实现（吸收 useChatStreamResumeInject + 子会话屏内联版）
 ├─ 指标：吸收 stream-metrics-store 语义（成为单元字段，store 退役）
 ├─ 子会话链接：pendingChildren（吸收 subagentChildSessionsByParent）
 └─ webview 订阅：attachWebview(handle)/detach——多句柄注册表，
     「最后 attach 的可见句柄」收流式推送，控制类消息全句柄广播
```

屏幕侧：

- `ChatTabProvider` 终态只剩装配与路由：从 manager 取当前 sessionId 的单元投影（订阅模式沿用 `subscribe + useEffect + sync()` 先例，仓库无 useSyncExternalStore 先例，不引入新范式），把 webview 句柄 attach/detach 进单元；
- `SubagentSessionScreen` 删除自己的第二套装配（abort/batch/stream/内联注入），改为订阅同一 manager 的单元——**partial 注入只剩一份实现**（PRD 结构验收）；
- `ChatComposer.executeRun` 改调 manager.startRun（契约不变：onUserMessageAppended/onSettled/失败明确拒绝）。

### 发起与门禁（吸收 AgentRunManager）

`manager.startRun(sessionId, projectId, content, options)`：门禁 = `units.has(active run) || abortRegistry.has(sessionId)`（封受理→register 空窗，即 `starting` 态）；受理同步 increment refcount；fire-and-forget + finally 兜底；收尾 runId 所有权校验。UI 乐观置位（beginUiRun）保留在 composer 侧，保护窗随单元化缩短为「starting 投影即时可见」——探针/恢复窗口整体退役（单元从未死过，无需重建；兜底校准探针保留一个最小版：registry.has 轮询收尾，防 core 事件丢失）。

### 持久化（core 新表 session_run_state）

选型：**新表**（PRD 定性「会话数据而非可丢缓存」；session_kkv 有 fork/copy 不复制、truncate-tail 清域、TEXT 单 value 等语义雷区，探索报告已逐条列出）。

- 表：`session_run_state(session_id PK, project_id, run_id, status(starting|running), started_at_ms, text_chars, thinking_chars, partial_text, partial_thinking, pending_children_json, updated_at_ms)`；
- schema 走 `NOVEL_MASTER_SCHEMA_STATEMENTS` 幂等 DDL + **SCHEMA_BOOT_VERSION 12→13**（存量库走慢路径建表；规则 #10：必须 bump + 重建 core dist）；
- 仓储/服务/导出照抄 session-kkv 全链形态（`SqlTemplateParser` + UPSERT 单行单 key——天然原子，不进事务、不做 CoordinatedWrite，规避 tdbc 嵌套事务铁律）；
- 写通：单元内 coalescer（参照 sse-chunk-emitter 三态 append/flush/dispose），**250ms 合并 + step 边界立即刷**；partial 全量覆盖写，护栏：单次载荷 > 1MB 时降频到 1s（防写放大）；
- 水合：manager 构造时异步全表扫 `status IN (starting,running)` 行 → 逐个建 `interrupted` 态单元（partial 只读展示 + 指标恢复 + 子会话链接恢复），完成后置 `hydrated=true`；水合完成前 UI 查投影得 null（会话呈现为无 run——水合是单表小扫描，窗口可忽略）；**run 正常收尾时删行**（上次生成指标留在内存 + 写一行轻量终态快照 `settled_snapshot`（仅 metrics，无 partial），供重启后「上次生成」跨重启可见）。

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
  runtime/{novel-master-context.tsx,types.ts,create-mobile-runtime.ts}  # 装配替换
  screens/tabs/chat-tab/ChatTabProvider.tsx                     # 瘦身：只装配与路由
  screens/tabs/chat-tab/（六个 hook 文件退役删除）
  screens/tabs/ChatSessionListPanel 或等价                        # 停止入口
  screens/stack/SubagentSessionScreen.tsx                       # 双装配删除，改订阅
  components/chat/{ChatComposer.tsx,ChatConversationPanel.tsx}  # 发起 API/订阅接线
  components/chat/ChatTranscriptWebView.tsx                     # 哑引擎保留（props 来源换投影）
apps/mobile/jest.config.js                                      # + /session-run-state 子路径映射
apps/mobile/__tests__/（见测试策略）
```

## 变更点清单

| # | 文件/模块 | 变更 |
|---|---|---|
| 1 | core session-run-state 全链 + bootstrap | 新表/仓储/服务/导出/版本 bump |
| 2 | session-stream-unit-manager.service.ts | 新建，吸收 AgentRunManager（原文件删除，API 面向后兼容别名过渡一个 commit 后移除——不，用户拍板不留双轨：直接替换，调用方同 commit 改完） |
| 3 | session-stream-unit.ts | 新建，吸收六个 hook + metrics store + pending 映射 |
| 4 | novel-master-context/types/create-mobile-runtime | 装配点替换 + 水合时机 |
| 5 | ChatTabProvider | 拆运行态，改投影订阅 + attach/detach |
| 6 | SubagentSessionScreen | 删第二套装配 |
| 7 | ChatComposer/ChatConversationPanel | startRun 指向 manager、props 投影化 |
| 8 | 会话列表 | 停止入口 |
| 9 | 六个 hook 文件 + agent-run-manager.service.ts + stream-metrics-store.ts | 删除 |
| 10 | 测试矩阵 | 见测试策略（改写/新增/微调/门禁） |

## 详细实现步骤

- Step 1 — phase-core-runstate — blocking: yes — qa: auto：core 侧 session_run_state 全链（schema + bootstrap bump 13 + 仓储/服务/barrel + jest 子路径映射 + 重建 dist）；单测：UPSERT 原子覆盖、按状态扫描、删行、终态快照读写、旧库升级慢路径建表。
- Step 2 — phase-unit-core — blocking: yes — qa: auto：SessionStreamUnitManager + Unit 状态机（吸收 Manager：门禁/refcount/entries/三桥/通知/保活/dispose 契约原样迁移，文件改名 + 单元字段扩展）；单测：T-P1/P2/P3/P9 全套平移 + 单元生命周期（idle→starting→running→settled、宽限期销毁、LRU 上限 8）。
- Step 3 — phase-unit-pipeline — blocking: yes — qa: auto：单元事件管线（delta/step/finished/failed/child-created）+ 32/64ms 缓冲 + 单一注入实现 + 指标字段化 + pendingChildren；单测：T-R 系列改写为单元级（切走后事件仍消费、重进注入一次、step 重置注入标记）、T-M 平移、T-SUB 链接语义。
- Step 4 — phase-unit-messages — blocking: yes — qa: auto：单元消息管线（tail/分页/step 级 reload/view cache 写入——后台收尾会话照常刷缓存）；单测：T-X 等价断言（单元消息只含本会话行）、后台 FINISHED 后重进即最新（消息丢失回归）、subagent 长任务期间消息可见（force 快照路径平移到单元侧驱动）。
- Step 5 — phase-persist-writethrough — blocking: yes — qa: auto：写通 coalescer + 水合 + interrupted 终态；单测：节流合并/step 边界刷/大载荷降频、水合建 interrupted 单元（partial/指标/链接恢复）、正常收尾删行 + 终态快照、fork/copy 无运行态、置位/压缩不影响。
- Step 6 — phase-screen-subscribe — blocking: yes — qa: auto：ChatTabProvider 瘦身 + ChatConversationPanel/ChatComposer/SubagentSessionScreen 接线 + webview attach 注册表（多句柄：最后 attach 收流式、控制消息广播）+ 会话列表停止入口；单测：Provider 级集成（chat-tab-screen 平移）、双屏句柄分发、停止入口调用 manager.stopRun、T-REPAINT/T-SUB-CARD 微调后全绿。
- Step 7 — phase-legacy-teardown — blocking: yes — qa: auto：删除六个 hook + agent-run-manager.service.ts + stream-metrics-store.ts + 探针/恢复窗口/保护窗；改写守护：T-P7 静态清单更新（文件改名）、**新增静态守卫：ChatTabProvider.tsx 不含 uiRunning/activeRunId/streamingText 等运行态标识**（PRD 结构验收）；全套件回归。
- Step 8 — phase-device-validation — blocking: no — qa: manual_user：真机验收 PRD 全部 GWT 清单（并行压测七条 + 单会话回归 + 杀进程水合）。

## 测试策略

四层既有格局不变（纯逻辑 → 单元 → 编排 → 渲染面）。门禁（不动或微调后必须绿）：`chat-tab-screen.integration`、`chat-composer.integration`（T-CR4 自愈不动）、`chat-transcript-webview`（T-REPAINT/T-SUB-CARD/性能红线）、`agent-finished-notification`、`agent-activity`（T-P7 改清单）、view-cache。改写为单元级：`use-chat-stream-resume`（T-R 系列）、`use-agent-run-lifecycle`、`use-chat-stream-runtime`（harness 演化）、`subagent-run-probe`（最小校准版）、`chat-tab-messages-scope`（T-X 等价）、`flush-run-ui`。新增：单元本体、写通/水合、Provider 无运行态静态守卫、停止入口、跨项目等价。运行约束：NODE_ENV=test、官方 typecheck 脚本、worktree 先重建 dist（#31/#38）。

### 测试用例（新 T 系列，均映射 Step）

- T-U1 — blocking: yes — 单元生命周期与宽限/LRU（Step 2）
- T-U2 — blocking: yes — 切走后事件仍消费：后台会话 delta/step/收尾全落地（Step 3）
- T-U3 — blocking: yes — 重进注入恰好一次；step 重置注入标记（Step 3）
- T-U4 — blocking: yes — 指标语义五条（新 run 重置/回填不重置/冻结/切会话换源/连续历时）（Step 3）
- T-U5 — blocking: yes — 单元消息隔离 + 后台收尾缓存刷新（消息丢失回归）（Step 4）
- T-U6 — blocking: yes — subagent 期间任务卡/消息可见（Step 4）
- T-U7 — blocking: yes — 写通节流/边界刷/降频；水合 interrupted（partial+指标+链接）（Step 5）
- T-U8 — blocking: yes — fork/copy 无运行态；置位/压缩不清运行态（Step 5）
- T-U9 — blocking: yes — 双屏 webview 句柄分发 + 会话列表停止（Step 6）
- T-U10 — blocking: yes — ChatTabProvider 无运行态静态守卫（Step 7）
- T-U11 — blocking: no — manual_user：PRD GWT 全清单（Step 8）

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
