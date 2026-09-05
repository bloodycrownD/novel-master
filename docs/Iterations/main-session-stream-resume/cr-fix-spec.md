# CR Fix Spec: main-session-stream-resume

## 元信息

- repo: `.woktree/stream-resume`（worktree，主仓库 `/home/bloodycrown/Dev/novel-master`）
- base_sha: `6c8a872`
- head_sha: `66de06f`
- prd_path: `docs/Iterations/main-session-stream-resume/prd.md`（只读参考）
- spec_path: `docs/Iterations/main-session-stream-resume/spec.md`（只读参考）
- review_round: 1（review-resume，diff 评审 6c8a872..66de06f）
- dag_version: 2
- 状态: draft

评审基线：4 个测试套件 30 例全绿 + `subagent-run-probe` 7 例不回归；正式口径 typecheck（`tsconfig.build.json`）通过；裸 `npx tsc --noEmit` 相对 main 净增 6 错、全在 `apps/mobile/__tests__/use-chat-stream-resume.test.ts`。结论「通过，无 P0/P1」，本 wave 范围为全部 must-fix（均 P2）。

## Must-fix（本 wave 全部 P2）

### resume/MF-1 [P2] 新测试文件裸 tsc 口径 6 处类型瑕疵

- 维度：类型正确性 / 测试基建
- 文件：`apps/mobile/__tests__/use-chat-stream-resume.test.ts`
- 问题：正式 typecheck 口径（`tsconfig.build.json`）不含 `__tests__` 目录，故 CI 不可见；但裸 `npx tsc --noEmit`（`tsconfig.json` include `__tests__`）相对 main 净增 6 处报错，全在本文件：
  - TS2556 ×2（约 L35/36）：`flushRunUi` / `flushAgentStepUi` 的 mock 包装写作 `(...args: unknown[]) => mockFlushRunUi(...args)`，把 `unknown[]` spread 进 `jest.fn(async () => undefined)`（无 rest 参数）的目标函数，spread 参数必须是元组类型或目标带 rest 参数。
  - TS18046 ×4（约 L129-161）：`const mockRuntime: unknown = {...}` 显式标注 `unknown`，后续 `mockRuntime.abortRegistry`（×2，L129/L137 一带）/ `mockRuntime.streamRegistry`（×2，L148/L161 一带）属性访问报「'mockRuntime' is of type 'unknown'」，目前靠两处 `as never`（L129/L148）绕过、另两处（L137/L161）在 `runtime.abortRegistry.has(...)` 调用链上裸露。
- 改法：
  - `mockFlushRunUi` / `mockFlushAgentStepUi` 包装写显式 rest 签名：给 jest.fn 目标声明 rest 参数（如 `jest.fn(async (..._args: unknown[]) => undefined)`），包装层 `(...args: unknown[]) => mock(...args)` 即满足 spread 约束；或按被 mock 的真实函数签名写元组类型。
  - `mockRuntime` 去掉 `: unknown` 标注，给出具体形状（直接推断，或对齐 runtime 端口形状后用 `satisfies` 校验）；随之移除 L129/L148 的 `as never`，L137/L161 的属性访问自然通过。
- 验收：裸 tsc 口径（`npx tsc --noEmit`）下本文件不再有任何 TS2556 / TS18046 报错（分支相对 main 的 6 处净增清零；裸 tsc 全仓在 main 上即有 367 处既有配置类报错，如 TS6307，不在本条范围）；正式口径 `npm run typecheck` 保持零报错。
- 来源：review-resume round 1

### resume/MF-2 [P2] 两处 effect 声明顺序约束仅靠代码排列维持，无显式约束注释无守护（ChatTabProvider L330 一带已有一段描述性注释，但未覆盖全部两条约束）

- 维度：时序约束 / 可维护性
- 文件：`apps/mobile/src/screens/tabs/chat-tab/useChatStreamResumeInject.ts`、`apps/mobile/src/screens/tabs/chat-tab/ChatTabProvider.tsx`
- 问题：两个硬性顺序约束目前只由代码的物理排列隐式保证，重排即静默失效（路径 A 二次重进不注入 / 路径 B 状态重建被清）：
  1. `useChatStreamResumeInject.ts` 内，复位 effect（依赖 `[chatSubview, sessionKey]`，清 `webviewReadyRef` / `streamInjectedRef`）须声明于注入 effect 之前。sessionKey 变化的同一 commit 里复位先清标记、注入 effect 后求值，看到的才是本 mount 的干净状态；若注入在前，会带着上一 mount 残留的 `webviewReady=true` 抢先注入、或 `streamInjectedRef=true` 直接 return。
  2. `ChatTabProvider.tsx` 内，reset effect（依赖 `[sessionId]`，调 `abort.resetForSessionChange` + `lifecycle.resetUiForSessionChange`）须声明于 `useRunResumeProbe` 接线之前。同 commit 内 reset 先清、探针恢复方向再按 `registry.has` 合成 `markRunStarted`；若探针在前，合成的 `uiRunning` 会被随后的 reset 清掉，路径 B 状态重建失效。
- 改法：在两个 effect 声明处各写一条显式中文注释，格式含「不得移到 XX 之后」+ 理由（同 commit 内先清后建 / 先复位后注入的时序依赖），现有 ChatTabProvider L330 一带已有类似注释可顺延补全至覆盖两条约束；可行则补守护测试（注：effect 执行顺序由声明顺序决定，直接断言排列较难，行为级守护可挂 T-R5「重进重注入」与 T-R1「切回状态重建」——顺序颠倒时这两例应红）。
- 验收：两条注释存在且各自写明「不得移到 XX 之后」及理由；（如补）守护测试绿。
- 来源：review-resume round 1

### resume/MF-3 [P2] T-R3 缺「先 snapshot 后 inject」顺序断言，现为代理条件

- 维度：测试覆盖与 spec 对齐
- 文件：`apps/mobile/__tests__/use-chat-stream-resume.test.ts`
- 问题：spec T-R3 明确要求「先 snapshot 后 inject 的顺序断言」（映射 Step 3），现有用例只断言了代理条件——`messagesLength=0`（messages 未加载）时不注入，并未证明加载完成后注入晚于 `sessionSnapshot`。
- 改法：在 `mountFull` 路径补一例——mock `ChatTranscriptBridge` 的 `postToWeb` 按序记录全部消息，断言第一条 `sessionSnapshot` 类消息的调用序号小于任何注入产生的 stream/delta 消息（即 snapshot 先行、注入 delta 其后）。**层级钉死**：`sessionSnapshot` 是真 `ChatTranscriptWebView` 经 bridge 的 `postToWeb` 发的，`mountInject` harness 用 mock handle 观测不到 snapshot——必须在集成级挂载（参考 `chat-tab-screen.integration.test.tsx` 的基建）mock `postToWeb`，勿在 harness 里自造 snapshot 通道（那会变成测 mock 自己）。
- 验收：新用例绿；人为反转顺序（如注入先于 snapshot）时用例可红（实现时自检，不必常驻反证断言）。
- 来源：review-resume round 1

### resume/MF-4 [P2] 收尾探针在「beginUiRun → core register」窗口内误收尾，本轮流式 UI 全丢

- 维度：竞态正确性（主会话核心路径新引入）
- 文件：`apps/mobile/src/screens/tabs/chat-tab/ChatTabProvider.tsx`（`useRunResumeProbe` 接线处；如需参数透传，涉及 `apps/mobile/src/hooks/use-run-resume-probe.ts`）
- 问题：用户发送消息后 `beginUiRun` 先把 `uiRunning` 置 true，core 侧 `abortRegistry.register` 要到 agent-runner 真正跑起来才发生。若恰逢回前台触发探针收尾方向（`uiRunning=true && registry.has=false`），且 800ms 复询时仍未 register，探针调 `onRunEnded` → `abort.markRunEnded()`，`uiRunning` 翻 false；随后真 `RUN_STARTED` 到达时 `shouldIgnoreStaleRunStarted` 只看 `uiRunning=false`，按 stale 拒收，本轮流式 UI 全丢。概率极低，但这是主会话核心路径新引入的窗口（子会话只读、无发起路径，故无此问题）。
- 改法（建议方案 a）：
  - 方案 a（发起保护窗，建议）：时间戳记在 `lifecycle.beginUiRun`（不要记在 `abort.markRunStarted`——它还会被探针合成恢复调用，记那边会把合法的兑底收尾也推迟 N 秒）。探针 `onRunEnded` 前检查——发起后 N 秒内不收尾（窗口内 `registry.has=false` 视为「尚未 register」而非「run 已结束」）；N 建议 2~3 秒（须覆盖正常 register 延迟，具体取值实现时定），窗口过期后仍 `!has` 才允许收尾校准。守卫落在 Provider 的 `onRunEnded` 闭包一处即可覆盖前台探针与 30s 轮询两条触发路径，`use-run-resume-probe.ts` 无需改动。
  - 方案 b（备选）：收尾误翻后允许同 session 的 `RUN_STARTED` 重激活（不按 stale 拒收、重新置 `uiRunning=true`）——改动面在 lifecycle stale 守卫，波及面大于 a。
- 验收：补「保护窗内探针不收尾」用例：`beginUiRun` 后保护窗内 `registry.has=false` + 探针触发（含 800ms 复询），断言 `markRunEnded` / `onRunEnded` 未被调用；窗口过期后 `!has` 时收尾正常。若最终拍板「接受不修」，本条降级为 open question 并在代码注释记录接受理由。
- 来源：review-resume round 1

## Open Questions（待拍板附录）

1. **MF-4 误判窗口修还是接受**：概率极低（需恰逢回前台 + 800ms 内未 register + 探针触发），但为主会话核心路径。建议修，成本一个保护窗；若接受，需记录接受理由并撤 MF-4。
2. **主/子会话收尾 reload 语义差异**：主会话收尾走 `handleMessagesChanged`，子会话探针走 reload，两者是否语义等价（缓存、滚动意图、immediate 行为）待确认。
3. **裸 tsc（`tsconfig.json`）是否纳入 CI**：现状 include `__tests__` 又 exclude `src/web/**`，测试文件 import web 文件必然 TS6307（main 上即有 367 处），纳入 CI 前需先修 include/exclude 配置；是否纳入由用户定。
4. **Step 5 真机验收（manual_user）待执行**：路径 A/B 生成中退出重进（含反复三次）、thinking 展开样式、结束后无重复无错乱、abort partial 保留，维持 spec Step 5 口径。

## Spec Deviations

1. **注入 hook 位置**：spec 变更点清单写「注入 hook（新，如 `useChatStreamResumeInject`）」未定目录、结构上归入 `hooks/` 口径，实际落在 `apps/mobile/src/screens/tabs/chat-tab/useChatStreamResumeInject.ts`。属组织差异，放 screens 侧与 ChatTabProvider 装配紧密、反而合理——按现状收窄，建议后续同步 spec 措辞。
2. **顺序约束未显式说明**：spec 未写明两处 effect 声明顺序约束（= MF-2），修复后 fixed，同步在 spec「总体方案」补一句即可（随下轮文档修订）。

## K 节建议（验证与推进）

- 按 **MF-1 → MF-2 → MF-3 → MF-4** 顺序修复（MF-1 纯类型清理无风险先行；MF-2 注释 + 可选守护；MF-3 / MF-4 均为测试补例，MF-4 需实现改动配合）。
- 修复完成后复跑：`apps/mobile` 下 `npx jest` 全量 + 根目录 `npm run typecheck`，另跑一次裸 `npx tsc --noEmit` 核对相对 main 净增为零（口径见 MF-1 验收）。
- 真机验收维持 spec Step 5 口径（见 Open Questions 第 4 条），不因本轮 must-fix 变化。
