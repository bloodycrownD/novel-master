---
date: 2026-08-30
dependency: []
---

# 主会话流式重进恢复 SPEC 第 1 轮审查（readonly）

## 请求

以 readonly 模式审查 `docs/Iterations/main-session-stream-resume/{prd,spec}.md` 是否 execute-ready，第 1 轮（无上轮 must-fix）。要求对照代码库验证 spec 的关键声明，只给 Go/No-Go 建议，不改任何文件。

## 审查中阅读的文件

- `apps/mobile/src/screens/stack/SubagentSessionScreen.tsx`（三件套：L116-119 放宽接纳、L145-153 per-step reset、L181-190 mount 探测、L221-259 注入 effect）
- `apps/mobile/src/screens/tabs/chat-tab/ChatTabProvider.tsx`（L303-307 reset effect、装配顺序、context）
- `apps/mobile/src/screens/tabs/chat-tab/useSessionStream.ts`（事件过滤链、onStepCommitted 已支持但主会话未传）
- `apps/mobile/src/screens/tabs/chat-tab/useSessionAbort.ts`（uiRunning 状态机）
- `apps/mobile/src/hooks/useAgentRunLifecycle.ts`（activeRunId 形状、acceptRunEvent 纯谓词）
- `packages/core/src/service/agent/logic/agent-run-lifecycle-helpers.ts`（shouldIgnoreStaleRunStarted 只看 uiRunning）
- `packages/core/src/service/agent/agent-abort-registry.port.ts` / `agent-stream-registry.port.ts`（均无 runId 暴露，「拿不到 runId」属实）
- `packages/core/src/service/agent/impl/agent-runner.ts`（~L612 streamRegistry.reset，publish STEP_COMMITTED 后）
- `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx`（onReady L90、generating 只在 snapshot 载荷 L480、flush effect ~L434 先于 messages effect L988）
- `apps/mobile/src/screens/tabs/ChatTabScreen.tsx`（注意：实际路径无 chat-tab/ 前缀；L167-169 条件渲染、L122-133 openConversation）
- `apps/mobile/src/screens/tabs/chat-tab/ChatConversationPanel.tsx`（主会话未传 onReady；agentRunning=agentActive + uiRunning 双传）
- `apps/mobile/src/screens/tabs/chat-tab/useChatTabMessages.ts`（cache hydrate 同步、外部事件 reload）
- `apps/mobile/src/runtime/agent-activity.ts`、`apps/mobile/src/screens/stack/useSubagentRunProbe.ts`

## 核心结论：No-Go（1 P0 / 1 P1 / 2 P2）

- **P0**：webviewReady / streamInjectedRef 提升到常驻 ChatTabProvider 后的生命周期未定义。子会话这两个标记的生命周期 = Screen 生命周期（离开即销毁）；主会话 Provider 常驻、ChatConversationPanel 条件卸载（ChatTabScreen L167-169）。照 spec 实施：路径 A 二次重进时 streamInjectedRef 残留 true → 不再注入（PRD 场景三「反复三次」验收必挂）；webviewReady 残留 true → 新 webview 未就绪即注入 → 内部 flush effect 先于 messages effect → delta 先于 sessionSnapshot（正是 spec 要防的顺序）。需明确在离开 conversation / sessionKey 变化时复位两个标记。
- **P1**：恢复窗口首事件反填（syncActiveRunId）执行落点未指定。acceptRunEvent 现为纯谓词（lifecycle L97-99）；若反填不作为放宽 accept 的同步副作用，FINISHED/FAILED 作为窗口首事件会被 onRunFinished 内部守卫（activeRunId==null 必拒，L120）拒绝 → uiRunning 永久残留。spec 需写死反填位置并补 T-R2 用例。
- **P2**×2：「registry.has 变 false 关窗」无反应式信号（port 无变更订阅）；主会话 messages.length 有非 step 变化源（外部 reload），mid-step 重跑注入 effect 有 double-inject 风险。

## 已验证为准确的 spec 声明

- 路径 A/B 两条故障路径属实；三件套与 ChatTabProvider 行号全部准确；onStepCommitted「主会话没传」属实（hook L73/L401 已支持）；两个 registry 均拿不到 runId；agent-runner ~L612 reset 属实；onReady 存在且提升可行；「合成 markRunStarted 早于 snapshot」在 effect 顺序上可实现（webview 随 sessionKey 重挂、ready 异步晚于父 effect）；shouldIgnoreStaleRunStarted 只看 uiRunning，合成置 true 后迟到 RUN_STARTED 可反填真实 runId——spec 判断正确。

## 其他备注

- 用户给的 ChatTabScreen 路径带 chat-tab/ 前缀，实际在 `screens/tabs/ChatTabScreen.tsx`。
- 主会话面板 agentRunning 传的是全局 agentActive（refcount），generating 条来自 uiRunning；refcount 切走泄漏 spec 已明示另行处理，不阻塞本轮。

## 第 1 轮 fix（非 readonly，本轮已闭合）

按主代理派发的 must-fix 清单修改 PRD/SPEC（只改文档，不动实现代码）：

- **P0-1 闭合**：spec §总体方案 3 新增「注入资格与 WebView 当前 mount 绑定」——复位时机写死为 chatSubview 离开 'conversation' / transcriptWebRef.current 变 null / sessionKey 变化任一发生 → webviewReady=false 且 streamInjectedRef=false；变更点清单补第 ⑤ 项复位 effect；T-R5 补「反复重进 ≥2 次每次都重新注入」「注入不早于 sessionSnapshot」两条断言。
- **P1-1 闭合**：spec §总体方案 2 写死「放宽 accept 是带副作用的函数（显式设计决策）：通过时同步 syncActiveRunId(runId) 反填并关窗，反填先于 onRunFinished/onRunFailed 内部守卫求值」；Step 1 与 T-R2 补「FINISHED 是窗口内第一条事件」用例（收尾正常、refcount 正确递减、uiRunning 归 false）。
- **P2-1 闭合**：spec 明确恢复窗口关闭只由「首事件反填」与「sessionId 切换」承担；registry.has 无变更订阅、禁止实现者自行发明；has 复评挂探针/轮询节点（唯一复评点）只作收尾校准——写进 §总体方案 2/5、变更点清单、Step 4、T-R6；风险章节删除「registry.has 关窗兜底」旧表述。
- **P2-2 闭合**：与 P0-1 mount 绑定机制合并覆盖——本 mount 内已注入（或已事件流式）后不因 messages.length 变化重注入，streamInjectedRef 仅在 step 提交或 mount 复位时重置；新增 T-R8 锁定 mid-step 外部 reload 不二次注入；风险章节补「mid-step 重跑 double-inject」条目并写明残余窗口由「先 snapshot 后 inject」守卫兜底。
- PRD 小改：验收标准第 3 条（反复重进三次）补「每次进入均恢复到当前进度、不因重复恢复出现重复段」语义，与 SPEC T-R5 对齐。

改动文件：docs/Iterations/main-session-stream-resume/spec.md（总体方案 / 变更点清单 / 详细实现步骤 / 测试用例 / 风险与回滚方案）、prd.md（验收标准）。未触碰 agent-run-parallel-and-notify/ 下任何文件。

# 主会话流式重进恢复 SPEC 第 2 轮审查（readonly）

## 请求

第 2 轮 readonly 审查，核验第 1 轮 4 条 must-fix（P0-1 复位三信号 / P1-1 带副作用 accept + 同步反填 / P2-1 关窗两信号 / P2-2 mount 绑定 + T-R8）是否真正闭合，并查修复是否引入新问题。禁改文件、只给建议。

## 本轮阅读

- `useSessionStream.ts` L300-512（六个订阅点 subText/subThinking/subToolUse/subStep/subFinished/subFailed 全部先过 acceptRunEvent；subFinished 的 abortRetainPending 分支 finishRun 走异步 finally）
- `agent-run-lifecycle-helpers.ts` 全文（shouldAcceptRunEvent 在 activeRunId=null 必拒 → 放宽须加在 lifecycle 层）
- `useAgentRunLifecycle.ts` 全文（onRunFinished/onRunFailed 内部守卫 L120/L134 在 accept 之后求值 → 同步反填方案自洽）
- `ChatTabScreen.tsx` L167-169（路径 A 条件渲染确认）、`ChatConversationPanel.tsx`（主会话未接 onReady，提升属实）
- `ChatTranscriptWebView.tsx`：pushStreamDelta 即 queueStreamDelta（L728），webReady=false 时直接 return 不入队（L412-414）——spec L24 的「delta 入队先于 snapshot」故障机理与代码不符；setWebReady(true) 与 onReady() 同步连调（L790-791）；snapshot 载荷 generating 依赖 uiRunning（L480/L495）
- `SubagentSessionScreen.tsx` L221-259（注入守卫链与 spec 逐项一致）；`useSubagentRunProbe.ts` 全文（现状仅收尾方向，mount 方向在 Screen L189-190 内联，抽出是真实工作量）
- `useChatTabMessages.ts`（外部 force reload 属实，L191/L211）；`use-chat-stream-runtime.test.ts` 范式（TestRenderer 手工装配 hook）

## 结论

上轮 4 条 must-fix 全部实质闭合且与代码自洽。新引入 1 P1 + 3 P2：

- **P1（新）**：Step 1 单测覆盖含「窗口超时关闭」，与总体方案 2「关窗只由两信号承担」+ 变更点清单直接矛盾，超时参数未定义，blocking 测试点无法按两信号口径落地。
- P2×3：① L24 故障机理二表述与 queueStreamDelta 实际行为不符（实为静默丢弃 + 本 mount 永不重注入，修复方向不受影响但误导实现者）；② sessionKey 构成未定义、transcriptWebRef.current 变 null 非 React 可观测信号（应注明由 chatSubview/sessionKey 伴随）；③ 注入 effect 若内联 Provider，T-R3/R4/R5/R8 只能测复刻品，建议明确抽 hook。

建议：修掉 P1 一处文档矛盾后即 execute-ready。

# 主会话流式重进恢复 verify-resume（独立复跑验证，readonly）

## 请求

节点 verify-resume：在 worktree `.woktree/stream-resume`（分支 feat/main-session-stream-resume，HEAD 66de06f）以非实现者身份复跑验证——jest 全量、tsc、git log/diff 核对改动范围、抽查 spec 四项关键设计与实现一致性。不改任何代码/文档。

## 结果

- **jest 全量**：184 套件 / 1069 测试全过（含 use-chat-stream-resume、use-agent-run-lifecycle、subagent-run-probe、use-chat-stream-runtime、chat-tab-screen 相关）。
- **tsc**：正式口径 `tsc --noEmit -p tsconfig.build.json` 通过（exit 0）；裸 `npx tsc --noEmit` 在本分支报 373 错、在 main 同样报 367 错——`tsconfig.json` include `__tests__` 又 exclude `src/web/**`，测试文件 import web 文件必然 TS6307，属现存配置问题非本分支引入；分支相对 main 净增 6 错全在新增的 `use-chat-stream-resume.test.ts`（TS2556×2 + TS18046×4，正式口径 exclude 测试故不可见）。
- **提交/范围**：main..HEAD 共 4 commit（daf446a/2db9f20/bb3c048/66de06f），改动 10 文件 +1081/-33，全部在 apps/mobile，core/desktop 零改动，与预期清单一致（另含两个 chat-tab-screen 测试各 +15，属测试文件范围）。
- **spec 四项抽查全过**：①恢复窗口无超时（resumeWindowRef 无定时器，关窗仅反填/resetUiForSessionChange 两处）；②accept 带副作用同步反填（acceptRunEvent L130-139 同步关窗+syncActiveRunId，先于 onRunFinished 内部守卫）；③复位三信号挂 state 依赖（useChatStreamResumeInject L87-99，effect 依赖 [chatSubview, sessionKey]，transcriptWebRef.current===null 为防御性断言）；④注入 hook 独立文件（useChatStreamResumeInject.ts 新增 152 行）。
- 备注：spec「useSessionStream 目前没传 onStepCommitted」指 Provider 装配层没传（main 上 ChatTabProvider 0 处），hook 本身 L73 已支持——本分支在 Provider 接 handleStepCommitted → inject.resetInjection()，符合意图。测试用例放新文件 use-chat-stream-resume.test.ts（626 行）而非 spec 提的 use-chat-stream-runtime.test.ts 补充，属文件组织差异。

结论：PASS，无阻塞问题。

## 第 2 轮：diff 评审（review-resume，2026-08-30）

readonly 评审 feat 分支 diff（6c8a872..66de06f，4 commits），模式 diff 单轮深审，维度 B–K 全维含 C-orch。核实：4 个测试套件 30 例全绿 + subagent-run-probe 7 例不回归；正式 typecheck（tsconfig.build.json）通过；裸 tsc（tsconfig.json）6 处瑕疵属实（TS2556×2 L35/36 + TS18046×4 L129-161，均在新测试文件 use-chat-stream-resume.test.ts，正式口径不含 tests 目录故不受影响）。结论：通过（无 P0/P1 must-fix；4 条 P2：裸 tsc 6 处类型瑕疵、顺序约束未显式锁定、T-R3 顺序断言为代理、主会话收尾探针发起窗口误判——后三条建议随下轮顺手修或记 open question）。cr-func 两条已知偏离维持 open。

# 主会话流式重进恢复 spec-fix-resume（fix-spec 撰写，2026-08-30）

## 请求

节点 spec-fix-resume：只改文档不改实现。在 worktree `.woktree/stream-resume`（base_sha 6c8a872，head_sha 66de06f）创建 `docs/Iterations/main-session-stream-resume/cr-fix-spec.md`，写入 review-resume round 1 的 4 条 must-fix（均 P2）、open_questions 附录、spec deviations 节、K 节建议。

## 结果

- 新建 `cr-fix-spec.md`（元信息 review_round=1 / dag_version=2 / 状态=draft）：
  - MF-1 测试文件裸 tsc 6 处类型瑕疵（TS2556×2 mockFlushRunUi/mockFlushAgentStepUi spread 无 rest 目标；TS18046×4 mockRuntime: unknown 属性访问 + 2 处 as never）；改法=mock 写显式 rest 签名 + mockRuntime 给具体形状（或 satisfies）；验收=裸 tsc 相对 main 净增清零 + 正式口径零报错（裸 tsc 全仓 main 上即有 367 处配置类既有错误，已写明口径避免不可达验收）。
  - MF-2 两处 effect 顺序约束仅靠排列维持：useChatStreamResumeInject 复位 effect→注入 effect；ChatTabProvider reset effect→useRunResumeProbe。改法=声明处显式中文注释（「不得移到 XX 之后」+理由），守护测试可选（行为级挂 T-R5/T-R1）；验收=注释存在。
  - MF-3 T-R3 补 mountFull 路径「先 snapshot 后 inject」顺序断言（mock postToWeb 序列，断言 sessionSnapshot 序号先于注入 delta）；验收=新用例绿。
  - MF-4 beginUiRun→core register 窗口内探针误收尾致真 RUN_STARTED 被 stale 拒收；建议方案 a 发起保护窗（beginUiRun 时间戳，N 建议 2~3s 内不收尾），备选方案 b 同 session RUN_STARTED 重激活；验收=「保护窗内探针不收尾」用例。
- open_questions 4 条：MF-4 修或接受（建议修）、主/子会话收尾 reload 语义等价性、裸 tsc 是否纳入 CI、Step 5 真机验收待执行。
- deviations：注入 hook 在 screens/tabs/chat-tab/ 而非 spec 的 hooks/（按现状收窄，建议后续同步 spec 措辞）；顺序约束未显式说明=MF-2（修复后 fixed）。
- K 节：MF-1→MF-4 顺序修复；复跑 apps/mobile jest 全量 + npm run typecheck + 裸 tsc 净增核对；真机验收维持 Step 5 口径。
- 未触碰 prd.md / spec.md / 任何实现代码。

# 主会话流式重进恢复 review-full-resume（fix-spec 第 2 轮校验，2026-08-30）

## 请求

readonly 校验 cr-fix-spec.md（节点 review-full-resume，模式 full 第 2 轮）：逐条核对 4 条 must-fix 覆盖度与可执行性、抽查 MF-4/MF-1 改法可落地性、spec_deviations 表述、有无新问题，给出 fix-spec-ready 结论。

## 结果

- 实测裸 tsc：分支 373 = main 基线 367 + 净增 6（TS2556×2 L35/36、TS18046×4 L129/137/148/161，全在新测试文件），fix-spec 数字与口径完全自洽；测试文件为本次新增且 tsconfig 未动，「相对 main 净增清零」可简化为「该文件 0 报错」，可测。
- MF-4 竞态链全链核实：beginUiRun→onRunUiActivate→abort.markRunStarted（Provider L302 接线）；探针 onRunEnded→abort.markRunEnded 翻 uiRunning=false；core 侧 shouldIgnoreStaleRunStarted 即 !uiRunning，真 RUN_STARTED 必被拒。方案 a 可落地：时间戳记 lifecycle.beginUiRun（或 abort.markRunStarted），守卫放 Provider onRunEnded 闭包（前台探针+30s 轮询同汇此点），use-run-resume-probe.ts 无需改；T-R6 为隔离 hook 测试不受影响。注意点：时间戳若记在 abort.markRunStarted，探针合成恢复也会刷窗、兜底收尾最多延迟 N 秒（仅 backstop，事件路径不受影响）——建议记在 beginUiRun。
- MF-3 发现落地口径需钉死：sessionSnapshot 由真 ChatTranscriptWebView 经 ChatTranscriptBridge postToWeb 发出（handle 上只有 pushStreamDelta），现有 mountInject harness（mock handle）观测不到 snapshot——补顺序断言需 mock bridge postToWeb + 更宽挂载（集成级），否则易写成同义反复。
- MF-2 核实两处约束排列属实；小瑕疵：问题陈述说「无注释」，但 Provider L330-334 已有描述性顺序注释（改法自己也承认），措辞内部略不一致。
- spec_deviations 两条与 spec 原文（L55/L40-42）核对属实：仅注入 hook 落 screens/，use-run-resume-probe.ts 本身落在 hooks/。
- 结论 fix-spec-ready: yes（附 3 条非阻断建议：MF-3 钉测试层级、MF-2 措辞对齐、MF-4 时间戳位置首选 beginUiRun）。

# cr-func-cr-resume 闭合小检（2026-08-30）

## 请求

readonly 功能小检节点 cr-func-cr-resume：波次 git diff 49e44c1..64172b4（5 提交，MF-1~MF-4 + memory）。检查 A（4 条 P2 实质闭合，抽查 MF-3 层级与 MF-4 两向）、G（verify 证据链）、spec_deviations（两处已登记偏离核实 + 新偏离排查）。

## 结果

- MF-1 闭合属实：mock 目标函数补 rest 签名消 2 处 TS2556；mockRuntime 以 satisfies 对齐 AgentAbortRegistry/AgentStreamRegistry、移除 as never，4 处 TS18046 消除。实测裸 tsc 该文件 0 报错。
- MF-2 闭合属实：两处「不得移到 XX 之后」注释各带理由与行为守护指向（T-R5/R5b、T-R1），符合 fix-spec 验收格式。
- MF-3 闭合属实且层级合规：集成级挂真 ChatTranscriptWebView，mock 落在 react-native-webview 组件的 postMessage 边界（test-utils/react-native-webview-mock），snapshot（组件 L472）与注入 streamDelta 走同一真 bridge 通道，非自造通道；断言首条 sessionSnapshot 序号 < streamDelta 且 delta 内容即 registry partial；提交信息记录了反转变红自检。
- MF-4 闭合属实：RUN_LAUNCH_PROTECT_WINDOW_MS=3s + beginUiRunAtRef 均在 useAgentRunLifecycle（时间戳记 beginUiRun 而非 markRunStarted，符合 fix-spec 提示）；守卫单点在 Provider onRunEnded 闭包，覆盖前台探针与 30s 轮询；测试两向齐（窗内 800ms 复询不收尾 + 过期后收尾 uiRunning 归 false）。注意：该用例在 mountFull 组装级复刻守卫，非 Provider 级直测（fix-spec 未钉死层级，可接受）。
- 证据链抽查：两测试文件 jest 13 例实跑全绿；根目录 npm run typecheck 实跑通过；裸 tsc 全仓 368 处，use-chat-stream-resume.test.ts 0 报错（MF-1 验收达标）。
- 发现 verify 摘要不精确（非阻断）：「裸 tsc 净增 0」仅在 MF-1 目标文件口径成立；本波在 chat-tab-screen.integration.test.tsx 实际净增 2 处裸 tsc 报错——TS6307×1（新 import test-utils/react-native-webview-mock，目录不在 tsconfig include，与 Open Question 3 同类既有配置问题）+ TS2454×1（新用例 L462 `let tree` used before assigned，既有用例同款 pattern）。正式口径不受影响。
- 两处已登记偏离核实均无害：常量挪 useAgentRunLifecycle（避免测试 import Provider 拖重链，且与时间戳同源）；MF-4 先于 MF-3 提交（两提交独立，最终树一致）。新见未登记项：MF-3 顺带把 integration 的 transcript 引擎 mock 改为按用例可控变量（默认 legacy-rn 不变，属测试基建细节，不算 spec 偏离）。
- 结论 func-ready: yes（附 1 条建议：下轮文档修订时把 verify 口径收窄为「目标文件净增 0」，或顺手清 integration 文件那 2 处裸 tsc 新增）。
