# CR Fix Spec: branch-full-cr-2026-09

> 本文档为 branch-full-cr-2026-09 全量 CR（review_round 1）的修复规格。只登记修复项与待拍板事项，不含实现代码。must-fix 条目来自四路 scope review（core / mobile-services / mobile-ui / webview），实施前须逐条核对「文件」小节给出的定位（行号为 review 时快照，实施时以函数名/符号检索为准）。

## 元信息

- repo：/home/bloodycrown/Dev/novel-master/.worktree/agent-run-parallel-and-notify
- 分支：feat/agent-run-parallel-and-notify（137 commit，含四轮迭代）
- base_sha：1b8f0c01
- head_sha：cb7dd03d
- review_round：2（round 1 四路 scope；round 2 review-full 增补）
- dag_version：3
- 状态：fix-spec-ready（已确认，2026-09-15 用户拍板开工）
- 业务文档（只读参考）：
  - docs/Iterations/session-stream-unit-2026-09/prd.md
  - docs/Iterations/session-stream-unit-2026-09/spec.md
  - docs/Iterations/session-stream-unit-2026-09/bugs/run-fail-composer-lock/prd.md
  - docs/Iterations/session-stream-unit-2026-09/bugs/run-fail-composer-lock/spec.md
  - docs/Iterations/init-busy-yield-2026-09/prd.md
  - docs/Iterations/init-busy-yield-2026-09/spec.md
  - docs/Iterations/resident-keepalive-notification-2026-09/prd.md
  - docs/Iterations/resident-keepalive-notification-2026-09/spec.md

## Must-fix

> 按 P0 → P1 → P2 排序。每条含 id / 严重度 / 维度 / 文件 / 问题 / 改法 / 验收 / 来源。

### 【P0】web/C-orch-1 分片在途时 appendTailRows / prependPage / streamCommit 未纳入推迟机制，末片整体替换丢增量行

- id：web/C-orch-1
- 严重度：P0
- 维度：web（RN↔webview 时序正确性）
- 文件：
  - apps/mobile/src/components/chat/ChatTranscriptWebView.tsx（sendAppendTailRows 约 L752 起、commitStreamTail 约 L784 起、sendPrependPage 约 L968 起；参照物：inFlightSnapshotGenerationRef L364、deferredStreamFlushRef L366）
  - 受害点：apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts（applySnapshot L155 起，末片整体替换为无条件覆盖）
- 问题：分片段间存在 `await yieldFn()` 跨帧窗口。窗口内 messages effect 走到 `uiRunning && grew` 的非 tool 分支会直发 `appendTailRows`、`prependedOlder` 分支直发 `prependPage`、流结束直发 `streamCommit`——三个通道的 post 会插进分片序列中间。web 侧先按 concat 渲染增量行，随后末片 `applySnapshot` 用旧闭包快照整体替换，增量行被抹掉。RN 侧此时 `prevMessageCountRef` 已推进、`lastStreamCommitIdsRef` 命中 skip 不补发，缺口就此留存。可达场景：needsFullSnapshot force 在流式中开启分片 + 跨帧窗口内下一条非 tool 消息落库。
- 改法：按 T-S3 同款机制扩展——在 postToWeb 层或上述三个发送函数入口检查 `inFlightSnapshotGenerationRef.current != null`：是则把该消息入 deferred 队列并保持顺序；快照末片 post 之后，与 deferredStreamFlushRef 对应的补发段一起按原序 post。
- 改法细化（review-full/r2 增补，实施时须一并遵守）：
  1. **重挂作废边界**：deferred 队列须对齐 `sendSessionSnapshotNow` finally 段对 `deferredStreamFlushRef` 的同款处理——webReady=false（重挂）时队列一并丢弃，由恢复注入链负责重推；
  2. **原序机制**：T-S3 现状是布尔标记 + segments 留队，appendTailRows 等一次性动作入队后两者分属两个容器、相对顺序无机制保证——建议统一为单一 deferred action 队列（流式 flush 尝试入占位 action），补发段遍历单队列；
  3. **覆盖面说明**：`commitSyntheticAssistantRow`（中断合成行，约 L896）内部复用 `commitStreamTail` 走 streamCommit 通道——改法落在 commitStreamTail 入口或 postToWeb 层时该第四入口天然被覆盖，勿按字面「三个发送函数」漏判。
- 验收：jest 两例——①分片在途时非 tool 消息落库，appendTailRows 的 post 晚于末片，且末片基线已含增量行；②web 侧分片收集中途收到 appendTailRows，末片应用后 `state.rows` 仍含增量行。
- 来源：review-scope-webview/r1

### 【P1】svc/B-1 resident 常驻链路缺 iOS 平台门禁

- id：svc/B-1
- 严重度：P1
- 维度：mobile-services（平台门禁一致性）
- 文件：apps/mobile/src/services/agent-finished-notification.ts（setKeepAliveResidentEnabled L126-129、reconcileKeepAlive L137-191）
- 问题：常驻开关的唯一驱动入口没有 `Platform.OS` 守卫。iOS 上打开开关或冷启动 boot 挂点会真实走 displayNotification 展示「novel master · 空闲」常驻通知——与 resident-keepalive spec「iOS 零影响」的声明直接违背。完成通知、标签链路都已有门禁，唯独常驻链路漏了。
- 改法：setKeepAliveResidentEnabled 函数开头加非 Android 早退（resident 保持 false），模块单点收口。
- 验收：补 iOS 用例（Platform.OS='ios' 时 setKeepAliveResidentEnabled(true) 零 display、零 stop），T-K 系列既有用例不回归。
- 来源：review-scope-mobile-services/r1
- 备注：本条同时是 open spec_deviation（见「Spec deviations」②），修复后转 fixed。

### 【P1】ui/B-1 中断现场合成行提交时机隐式依赖「ready 后必有 unitView 变化」，常见时序下中断 partial 不渲染

- id：ui/B-1
- 严重度：P1
- 维度：mobile-ui（中断现场渲染正确性）
- 文件：
  - apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx（中断 effect）
  - apps/mobile/src/screens/stack/SubagentSessionScreen.tsx（同构 effect）
  - apps/mobile/src/services/session-stream-unit.ts（attachWebview 对 interrupted 不通知、performTailReload 内容未变不通知）
- 问题：webReady=false 时 commitSyntheticAssistantRow 返回 false 且不置去重 key，effect 只靠 unitView 引用变化重跑。而重进 interrupted 会话的常态时序是 tail 先于 webview ready 到达——此后 effect 不再重跑，partial 永不提交，中断现场缺失。
- 改法：二选一（建议与 ui/C-1 一并处理，抽公共 hook 时落位）：
  1. 把 webview ready 世代纳入中断 effect 依赖（SubagentSessionScreen 已有局部 webviewReadyEpoch；ChatConversationPanel 需 ctx 暴露 ready 信号）；
  2. attachWebview 对 interrupted 且 partial 非空的场景触发一次 notifyChanged。
- 验收：integration 两例——「进入 interrupted 会话、tail 加载先于 webview ready，合成行仍出现」+「重进不重复提交」。
- 来源：review-scope-mobile-ui/r1

### 【P1】ui/G-1 T-K10 屏幕侧断言缺失：消息通知开关回调与权限行零测试

- id：ui/G-1
- 严重度：P1
- 维度：mobile-ui（blocking 测试债）
- 文件：
  - apps/mobile/src/screens/stack/ChatConfigScreen.tsx
  - apps/mobile/__tests__/chat-config-screen-switch.test.tsx
- 问题：resident-keepalive spec T-K10（blocking）要求屏幕侧断言。该测试文件就是 ChatConfigScreen 的渲染测试基建（本轮迭代还改过它补 mock），但消息通知开关回调、权限行三态、防重入、平台门禁全部没有断言。
- 改法：补用例三组——
  1. 开关开且 persist 成功 → setKeepAliveResidentEnabled(true) 被调且不回滚；关 → 开附带 ensureAgentNotificationPermission；
  2. 权限行 authorized / denied / checking 三态文案；denied 点击走 requestAgentNotificationPermissionManually 并按回执更新；checking 防重入；
  3. iOS 权限行不渲染。
- 验收：上述用例全绿；与 T-K 系列服务层用例互补，覆盖 T-K10 的屏幕侧要求。
- 来源：review-scope-mobile-ui/r1

### 【P1】core/B-2 run 成功但回复为空时尾部锁死（与 run-fail-composer-lock 同构）

- id：core/B-2
- 严重度：P1
- 维度：core + A（run-fail-composer-lock PRD「已知限制」未覆盖的场景，用户拍板修复）
- 文件：packages/core/src/service/agent/impl/agent-runner.ts（成功路径 `hasMeaningfulAssistantBlocks` 条件分支，约 L578；参照 a57daa0a 引入的失败落消息机制与 assistantAppendedInRun 标志）
- 问题：model 请求成功返回但 result.blocks 为空或不含 meaningful 内容时，run 以 FINISHED 正常结束且不落 assistant 消息——尾部停在 user，`lastMessageIsPlainUserText` 恒真，双端 composer 输入框锁死，与已修复的 run 失败场景同构但 run 未失败（BASE 即有，非本 diff 引入；review-scope-core open_questions ① 提请，用户拍板顺手修）。
- 改法：成功路径 `hasMeaningfulAssistantBlocks` 为 false 的分支落一条 assistant 占位消息（现有 text 块，文案如「（本次生成无内容输出）」，不带 usage/raw），随后照常走 FINISHED；复用/对齐 assistantAppendedInRun 幂等口径；persistMessages=false 豁免同款。
- 验收：core 测试补例——成功但空 blocks → 断言 assistant 占位消息落库 + FINISHED 照发 + 尾部解锁推导（lastMessageIsPlainUserText false）；abort/正常成功路径不回归。
- 来源：review-scope-core open_questions ① / 用户拍板 2026-09-15

### 【P1】web/B-1 单片应用新代次时未作废在途旧代次收集器

- id：web/B-1
- 严重度：P1
- 维度：web（快照协议鲁棒性）
- 文件：apps/mobile/src/web/chat-transcript/webview/runtime/render/snapshot.ts（handleSnapshotPayload 单片分支，约 L74-90）
- 问题：acc=gen5 在途收集时，若 gen6 以单片形态直接应用，pendingChunkAcc 不清理；随后 gen5 末片到达会照常拼装并 applySnapshot 旧快照，代次回退。当前 RN 实现不可达，但这是协议鲁棒性缺口，改动极小。
- 改法：单片分支应用时（generation > appliedSnapshotGeneration），若 pendingChunkAcc 存在且本次 generation >= acc.generation，同步作废该收集器。
- 验收：snapshot-chunk 补例——acc=gen5(2/3) → gen6 单片 → gen5 末片到达，断言无第二次 applySnapshot、代次不回退。
- 来源：review-scope-webview/r1

### 【P2】core/K-1 run-agent-turn.ts 调试打点残留

- id：core/K-1
- 严重度：P2
- 维度：core（代码卫生，三端共用链路）
- 文件：packages/core/src/service/agent/logic/run-agent-turn.ts（declare const __DEV__ / timingDevBackfillStart / 三处裸 console.log [nm-timing]，adb7d2be 带入 core）
- 问题：调试打点留在 core 共用链路，桌面/web 端一并生效。
- 改法：init-busy-yield Step 10 真机验收完成后删除（验收前勿删——打点双证可能依赖）；或收编为可注入 timing hook。
- 验收：grep `__DEV__` 归零 + core 全量测试绿。
- 来源：review-scope-core/r1

### 【P2】svc/B-2 novel-master-context bootstrap cancelled 分支不清理已构造 Manager

- id：svc/B-2
- 严重度：P2
- 维度：mobile-services（资源泄漏）
- 文件：apps/mobile/src/runtime/novel-master-context.tsx（bootstrap effect，cancelled 检查约 L182；对齐参照：bootToken>0 分支 L157-163）
- 问题：Manager 在 cancelled 检查之前已构造。cancelled 分支直接 return，不 dispose Manager——通知事件、AppState 订阅残留，数据库连接未关。bootToken>0 分支已有 dispose + closeMobileConnection 的先例。
- 改法：cancelled return 前补 dispose + closeMobileConnection，对齐 bootToken>0 分支。
- 验收：typecheck 通过 + 代码走查；可选补 bootToken 快速双跳测试。
- 来源：review-scope-mobile-services/r1

### 【P2】svc/C-1 水合读取口腔径分叉：interruptedSessionIds() / getSettledProjection() 无 hydrated 守卫

- id：svc/C-1
- 严重度：P2
- 维度：mobile-services（声明一致性）
- 文件：apps/mobile/src/services/session-stream-unit-manager.service.ts（interruptedSessionIds() / getSettledProjection() 读取口；hydratedValue L340、markHydrated L473 为参照）
- 问题：水合分片期间这两个读取口会读到渐进增长的集合——徽标、指标条分批跳变，与「水合完成前投影 null」的 spec 声明不一致。
- 改法：推荐在两个读取口首行加 `!hydratedValue` 返回空值（与 snapshot 恒 null 语义对齐）；次选保持现状但加注释声明渐进可用并知会消费方。
- 验收：T-X1 补「markHydrated 前 interruptedSessionIds 为空集」断言。
- 来源：review-scope-mobile-services/r1

### 【P2】ui/C-1 中断现场 effect 主屏/子会话屏双写同构

- id：ui/C-1
- 严重度：P2
- 维度：mobile-ui（重复代码）
- 文件：
  - apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx
  - apps/mobile/src/screens/stack/SubagentSessionScreen.tsx
- 问题：两处中断现场 effect 约 25 行同构，且同带 ui/B-1 的缺陷（双份修复、双份漏）。
- 改法：抽公共 hook useInterruptedPartialCommit(unitView, webRef, readySignal)，两处消费。
- 验收：现有 webview 直测全绿 + ui/B-1 新用例全绿。
- 来源：review-scope-mobile-ui/r1

### 【P2】ui/J-1 generatingBadge 缺 marginRight: 4，与 interruptedBadge 不一致

- id：ui/J-1
- 严重度：P2
- 维度：mobile-ui（样式一致性）
- 文件：apps/mobile/src/screens/tabs/chat-tab/ChatSessionListPanel.tsx（generatingBadge 样式约 L408；参照 interruptedBadge 约 L414 已含 marginRight: 4）
- 问题：generatingBadge 没有 marginRight: 4，「生成中 + 当前」两个徽标贴死，与 interruptedBadge 的间距处理不一致。
- 改法：generatingBadge 补 `marginRight: 4`。
- 验收：真机走查徽标间距。
- 来源：review-scope-mobile-ui/r1

### 【P2】web/C-1 notePrependHeightDelta 的「占位零变化」前提仅 win.start=0 成立，start>0 时 EWMA 样本被上占位差值污染

- id：web/C-1
- 严重度：P2
- 维度：web（滚动估算精度）
- 文件：apps/mobile/src/web/chat-transcript/webview/runtime/render/row-windowing.ts（notePrependHeightDelta L320 起；snapshot.ts L391 为调用点）
- 问题：方法假设 prepend 前后上占位高度不变，但该前提仅在 win.start=0（占位从有到无）时成立。start>0 时 EWMA 样本被上占位差值污染，avgSlotPx 拉偏。
- 改法：二选一——传入 prepend 前后上占位高度差并在采样时扣除；或仅 start===0 时采样并修正注释说明前提。
- 验收：row-window 补 start>0 的 prepend 用例，断言 avgSlotPx 不被拉偏。
- 来源：review-scope-webview/r1

### 【P2】full/K-1 run-timing.ts 调试残留 refresh-trigger 注释

- id：full/K-1
- 严重度：P2
- 维度：K（调试残留收尾）
- 文件：apps/mobile/src/debug/run-timing.ts（L44-45）
- 问题：`// refresh-trigger 1789305097` / `// refresh-trigger-2 1789305385` 两行是 reload 忙期排查时为触发 fast refresh 留下的无语义标记（adb7d2be 随文件引入），四个 scope 评审均未抓到。
- 改法：删除两行注释，文件其余不动。
- 验收：`grep -rn "refresh-trigger" apps/mobile/src` 归零。
- 来源：review-full/r2

### 【P2】full/F-1 session-stream-unit.ts 模块头注释与实现矛盾（startedAtMs 置位时机）

- id：full/F-1
- 严重度：P2
- 维度：F（注释与实现一致性）
- 文件：apps/mobile/src/services/session-stream-unit.ts（L22 模块头注释；对照 begin() L296-308 与 RUN_STARTED 注释 L312-314）
- 问题：头注释仍写「startedAtMs 于 RUN_STARTED 回填时置位」，实现是 begin() 受理即置、RUN_STARTED 不重置——函数级注释已声明新语义，唯独头注释未同步，同文件内自相矛盾。
- 改法：L22 改为「startedAtMs 于 begin() 受理时置位（重进连续计时）」；与 Spec deviations ③ 的收窄确认一并对齐（用户确认③后此条即其落地动作）。
- 验收：注释走查与实现一致。
- 来源：review-full/r2

## Spec deviations

1. **BOOT_VERSION 撞号**：session-stream-unit spec 写 12→13，实现为 13→14。spec 撰写时 main 尚为 v12，之后 main 发了 v13，撞号后顺延。**用户已确认按实现收窄（13→14，2026-09-15）**。
2. **svc/B-1 兼容声明违背（open）**：iOS 平台门禁缺失，违背 resident-keepalive spec「iOS 零影响」声明。随 must-fix svc/B-1 修复后转 fixed。
3. **startedAtMs 置位时机**：spec 写 RUN_STARTED 回填，实现为 begin() 受理即置。**用户已确认按实现收窄（2026-09-15）**；头注释同步修正由 must-fix full/F-1 承担。

## Open questions / 待拍板

1. **「成功但空回复」尾部锁死**：run 成功但 blocks 空 / 不 meaningful 时，尾部锁死行为与 run-fail-composer-lock 同构但并未失败。BASE 即有，非本 diff 引入。是否另立 bug 追踪？
2. **孤儿 starting 行**：RUN_STARTED 未达且 throw 时，持久层残留 starting 行，重启水合后成空 interrupted 徽标。是否在 finally 兜底清理？
3. **onSettled 极端时序防御**：是否需要为 onSettled 的极端时序补防御？
4. **分片凑不齐无主动检测**：分片丢失时现按「等 force 重传」语义处理，无主动检测。是否维持？
5. **prepend 有限扩展 vs 拉到 0**：prepend 只做有限扩展，是否需要拉到 0 的兜底？
6. **EWMA fallback 120px 首测偏差**：首测用 120px fallback 的偏差需真机观察确认影响。
7. **分片拼接显式全等断言**：分片拼装是否补显式全等断言（当前靠协议顺序保证）？
8. **agentRunning 全局态→本会话态的 legacy MessageList 行为变化**：需真机复核 legacy MessageList 在该语义切换后的行为。

## 已豁免

（空——本轮 review_round 1 无豁免项。）

## 合并后 QA（manual_user）

1. ui/J-1 徽标间距走查（「生成中 + 当前」两徽标不再贴死）。
2. Open questions ⑤ 相关真机观察：prepend 有限扩展的上拉体验。
3. Open questions ⑥ 相关真机观察：EWMA fallback 120px 首测偏差的实际影响。

## K 节建议

1. core/K-1 已列入 must-fix（P2），按「init-busy-yield Step 10 真机验收完成后删除」的时机处理，验收前勿删。
2. CHANGELOG.md 待补本分支四轮迭代的条目（并入 main 前完成）。

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | yes（待用户确认；Spec deviations ①③ 需拍板收窄） |
| fix_spec_path | docs/Iterations/branch-full-cr-2026-09/cr-fix-spec.md |
| dag_version / review_round | 3 / 2 |
| P0 / P1 / P2（已写入 fix-spec） | 1 / 5 / 7 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | open：无（①③用户已确认收窄 2026-09-15；②随 svc/B-1 修复转 fixed） |
| C-orch | ✅（web/C-orch-1 为 P0 主项；svc/C-1、ui/C-1 相关） |
| C 类合并后 QA | 徽标间距走查、prepend/EWMA 真机观察（见「合并后 QA」节） |
| 评审轮次明细 | round 1：四路 scope 并行（core / mobile-services / mobile-ui / webview）+ spec-fix 落盘；round 2：review-full 全维终检 + trivial 增补（full/K-1、full/F-1、web/C-orch-1 细化，主代理直执） |
