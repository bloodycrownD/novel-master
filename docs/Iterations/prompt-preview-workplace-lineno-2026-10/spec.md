---
date: 2026-10-05
---

# 预览提示词 workplace 压缩后刷新 + 预览行号移除 技术规格（SPEC）

需求来源：`docs/Iterations/prompt-preview-workplace-lineno-2026-10/prd.md`（口径现状：PRD 三项默认口径两轮澄清未获用户作答，本 SPEC 按 PRD 默认口径设计——①手动压缩后完整刷新、自动压缩不清；②行号仅预览显示层移除、wire 不变；③双端同构。若用户推翻，主要影响 Step 1/3/5 的语义参数，结构不变）。

## 设计目标

1. **手动压缩刷新 workplace**：手动「压缩上下文」成功后清空该会话 KKV 的 `rule_snapshot` + `file_cache` 两域，下一次拼提示词（发送或预览）时 workplace 块按当前工作区重评估（新文件进清单、正文重读）。效果与「手动调整工作区规则」的刷新等价（清域后 `assembleWorkplaceDisplay` 的 `loadOrCreateRuleSnapshot` miss 即重评估，`assemble-workplace-display.ts:279-305`）。
2. **自动压缩不清**：agent 回合中段的条件压缩（`agent-runner.ts:574`）维持 2026-09-29 拍板行为，保住「回合内前缀冻结」不变量。
3. **行号仅显示层移除**：预览 cards 构造层剥离行号前缀；发给 LLM 的 wire（`buildPromptLlmInputFromLayout` 产物）不变（以 T-PL7 结构判据验证，仓内无字节级 golden 机制）。
4. **预览屏刷新时机**：压缩完成后，mobile 预览屏焦点回流重取、desktop 预览面板订阅压缩成功事件重取。
5. **文档对齐**：修正「压缩清两域」类漂移注释（run-compaction 头+函数、session-kkv-domains、session-kkv.port、load-or-fill-file-cache、clear-session-prompt-caches、chat-prompt-tokens 共六处）与显示口径四处同步、RULE.md 三条目——完整清单见 Step 10 七项，防 CD-57 式漂移复发。

## 总体方案

**方案 A（压缩刷新）**：`RunCompactionParams` 增可选判别字段 `trigger?: "manual" | "auto"`（缺省 `"auto"`，既有调用零改动、向后兼容）；`runCompaction` 在 token 失效点（`run-compaction.ts:78-81`）之后、`return {ok:true}` 之前，`trigger === "manual"` 时清两域。**清域而非调 `refreshRuleSnapshot`**：清域只需既有 `deps.sessionKkv`（零新依赖、不破坏 core 分层）；`refreshRuleSnapshot` 是「写 canon」语义且需要 workplace 句柄，子会话场景下其 sessionId 与评估 scope 存在语义分裂坑（`agent-session.port.ts:20-34`：KKV 恒等自身、评估按父），清域天然按传入 sessionId（= `kkvScopeSessionId`）处理，与置位/导入两处既有口径一致。**错误口径：吞错 + `console.warn`**（清域失败只影响下一次组装多读一次 VFS，`file_cache` 是纯加速层——`load-or-fill-file-cache.ts:11-13`；不能把「压缩成功」翻成「失败」，与 `invalidateSessionApiPromptTokenEntry` 的容错理由同类，`session-api-prompt-token-store.ts:257-268`）。`ok:true` 即刷（与 hide 实际命中数无关）；hide 失败早 return 不刷（现有 `run-compaction.ts:70-72` 结构天然保证）。**不复用** `clearSessionPromptCaches`（它额外清 `usage_stats.toolUseCount` 哨兵，导入专属语义）。

**方案 B（行号剥离，core cards 层单点）**：预览与发送分叉彻底——wire 链 `buildPromptLlmInputFromLayout`（`render-prompt.ts:349-397`）不调用 `buildPromptAssemblyFromLayout`、不读 `ctx.workplaceFiles`/cards；`cards` 全仓消费方仅 4 处（core 生产 + mobile `RealPromptScreen` + desktop `RealPromptPanel` + desktop `handlers/prompt.ts` DTO 映射）。故在 `prompt-preview-turns.ts` 的 cards 构造处剥离：**双端 UI 共 8 个渲染点纯透传、零改动**（需求「双端同构」天然满足）。剥离按卡类型限定，不用全行一致启发式：

| 卡类型 | 剥离判据（每行至多替换一次，非全局贪婪） | 依据 |
|---|---|---|
| workplace `files[].body`（:501-508，map 出新对象、勿 mutate `ctx.workplaceFiles`） | `^\d+\|`（零前导空格） | `workplace-display.ts:41` `${idx+1}|`、filename 档 `:44`、header 档 `front-matter.ts:59-68`；原文自身以 `数字\|` 开头的行（如 `12|2024|年报`）只剥外层一次即逐字还原 |
| toolGroup `result.body`（:206-225） | `^ +\d+\|`（至少 1 个前导空格） | read/skill load 的 `String(n).padStart(6," ")`（`format-tool-output.ts:32-34,48-74`）在行号 < 100000 时必有前导空格；至少一空格的判据把「普通文本恰好 `数字\|` 开头」的误伤面压到近零。代价：行号 ≥ 100000 的超长文件行漏剥（罕见，接受）。追加行（截断提示、`续读请用 skill read…`，`format-tool-output.ts:57-71,335-349`）无行号自然保留 |
| user/assistant/thinking 文本卡 | **不剥** | 误剥用户正文（`验收标准 3` 要求其余字符逐字一致）；assistant 正文由模型生成无行号 |
| user 附件（JSON 转义形态） | P2 定向处理（Step 7，允许降级） | 附件正文在 `"content": "1|xxx\n2|yyy"` 的 JSON 转义串内、单物理行，逐行正则不可达（`user-vfs-save-mapping.ts:261-267`） |

**方案 C（预览屏刷新）**：mobile `RealPromptScreen` 用 `useFocusEffect` 单通道替换挂载 effect（首次聚焦即触发，不双跑）+ 请求序号竞态守卫；受该文件头「导航红线」约束（`RealPromptScreen.tsx:8-10`），两个既有测试的 `@react-navigation/native` 整模块 mock 须同步补 `useFocusEffect`（先例：`TokenUsageStatsScreen` / `useFocusListReload.ts`）。desktop `RealPromptPanel` 组件自治订阅 renderer 进程内已有的 `window` CustomEvent `session-compacted`（压缩成功必发，`ConversationPanel.tsx:1122-1129`；同范式先例 `SessionDetailDrawer` 订阅 `context-changed`），按 `sessionId` 过滤 + `visible` 时重载。不复用 `onComposerAttachmentsSuggest`（载荷语义是 composer 附件条，不符）。

## 最终项目结构

```
packages/core/src/service/compaction-conditions/run-compaction.ts   # trigger 字段 + manual 清两域 + 头/函数注释
packages/core/src/service/prompt/prompt-preview-turns.ts            # 剥离纯函数 + 2 处接入 + 头/字段注释
packages/core/src/domain/session-kkv/model/session-kkv-domains.ts   # 漂移注释修正（:30-31）
packages/core/src/service/session-kkv/session-kkv.port.ts           # 漂移注释修正（:13）
packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts # 漂移注释修正（:44-46）
packages/core/src/service/vfs/logic/clear-session-prompt-caches.ts  # 注释口径改写（:23-27，置位不动）
apps/desktop/src/main/services/chat-prompt-tokens.service.ts        # 注释口径改写（:571-574，门禁落地后）
apps/desktop/src/main/ipc/handlers/compaction.ts                    # 传 trigger:'manual' + run 门禁
（apps/desktop/src/main/ipc/handlers/agent.ts 零改动——isDesktopSessionRunInFlight 已导出，直接 import）
apps/desktop/renderer/features/chat/RealPromptPanel.tsx             # 订阅 session-compacted
apps/desktop/shared/ipc-types.ts                                    # DTO 注释（body 行号描述）
apps/mobile/src/services/compaction-warm-orchestration.service.ts   # 传 trigger:'manual'
apps/mobile/src/screens/stack/RealPromptScreen.tsx                  # focus 重载 + 竞态守卫
docs/apm/RULE.md                                                    # :16 压缩条、:17 导入条、:27 workplace 条口径更新
（测试改动见「测试策略」）
```

## 变更点清单

1. `run-compaction.ts`：`RunCompactionParams` 增 `readonly trigger?: "manual" | "auto"`（缺省 `"auto"`）；成功路径尾部增 manual 清两域分支（try/catch + warn）；模块头注释（:1-21）与函数注释（:51-56「rule_snapshot/file_cache 不清」句）一并改写新口径。
2. `prompt-preview-turns.ts`：新增 `stripWorkplaceLinePrefix` / `stripToolResultLinePrefix` 纯函数（每行一次 `replace`）；workplace `files` 构造 map 新对象（现 :501-508 是引用直传，改 `files.map(f => ({...f, body: strip(f.body)}))`，**禁止原地 mutate**——desktop DTO 映射 `handlers/prompt.ts:56-61` 整数组直传，mutate 会污染 `ctx.workplaceFiles`）；`buildToolResultCell` 的 body 出口接入；函数头注释与四处字段注释（`prompt-preview-turns.ts:34` `PromptToolGroupResultData.body` **新增**注释、`:64-66` workplace file body「行号格式原样」改写、`apps/desktop/shared/ipc-types.ts:975` workplace DTO 描述改写、`:931` `PromptToolGroupResultDto.body` **新增**注释）——core 侧统一写明「cards 为显示层口径（已剥行号），items/body 为 wire parity 口径（保留行号）」；desktop 侧（cr-desktop/C-1 修正后）写 desktop 层语义：「body 为显示层口径（已剥行号）；wire parity 带行号原文在 core `PromptPreviewTurn.items`/`.body`，不经本 DTO 下发（`PromptPreviewTurnDto` 只有 cards，无 items/body 字段）」。
3. `compaction.ts`（desktop handler :32-36）：传 `trigger:"manual"`；main 侧补 run 在途门禁——**直接 import 既有导出** `isDesktopSessionRunInFlight`（`handlers/agent.ts:280-285` 已是 `export function`，且 `chat-prompt-tokens.service.ts:48` 已有直接 import 先例，零新改动面）；拦截返回**零契约变更**的 error 形态 `{ok:false, error:{code:"AGENT_RUN_IN_FLIGHT", message:"Agent 运行中无法压缩"}}`（即 `IpcResult` 既有失败分支形态，`ipc-types.ts:205-214`，仓内 machine-readable 码惯例是 `IpcErrorPayload.code`；**不引入 data 层 `reason` 字段**——与变更点 8「IPC 契约不变」自洽）；renderer **零改动**——现有 `!result.ok → showToast(result.error.message)` 链路（`ConversationPanel.tsx:1110-1114`）自动弹出该文案（文案与 :681/798/806 回滚/置位/分叉的 running 拦截同款）。**不做 renderer 侧预拦截**：`runCompaction` 包装函数是模块级（`ConversationPanel.tsx:1106`）拿不到组件 running 态、`SessionDetailDrawer` 亦无 running 来源，双保险无落点即不做，main 侧门禁为唯一守卫。
4. `compaction-warm-orchestration.service.ts`（mobile :79-86）：传 `trigger:"manual"`（编排层已有 `agentRunning`/`isMobileAgentActive()` 门禁在两个 UI 入口，不改）。
5. `RealPromptScreen.tsx`：`useEffect(load)` 换 `useFocusEffect` 单通道 + `requestIdRef` 竞态守卫（旧响应丢弃）。
6. `RealPromptPanel.tsx`：`useEffect` 订阅 `window` `session-compacted`（detail.sessionId 匹配且 `visible` 时 `void load()`，卸载移除监听）。
7. 注释/文档：代码注释修订七项清单见 Step 10（run-compaction 头+函数注释、session-kkv-domains、session-kkv.port、load-or-fill-file-cache、clear-session-prompt-caches、chat-prompt-tokens、显示口径四处同步）+ `docs/apm/RULE.md:16/:17/:27` 三条目。
8. **零改动面（明确不动）**：wire 链（`render-prompt.ts` 发送路径）、`prepare-user-messages-for-prompt.ts`、`workplace-display.ts`、`format-tool-output.ts`、`items`/`body`（CLI parity 冻结面）、双端 8 个卡片渲染组件、`refreshRuleSnapshot`、`clearSessionPromptCaches`、置位/导入链路、IPC 契约（DTO 键集不变，parity check 只比 key）。

## 详细实现步骤

- Step 1 — phase-core-compaction-refresh — blocking: yes — qa: auto：core `runCompaction` 增 `trigger` 判别 + manual 成功路径清 `rule_snapshot`+`file_cache`（吞错 warn；**不加** `workplaceRefreshed` 之类新返回字段——无消费方无用例，观测走 `listKeys`）+ 模块头注释改写。实现于独立 worktree（RULE：未验证代码不进 main）。
- Step 2 — phase-core-compaction-refresh — blocking: yes — qa: auto：core 测试更新（T-CR1~T-CR4，见测试策略）；定向跑法须带 `--experimental-test-module-mocks --tsconfig tsconfig.test.json`（RULE 假信号条）。
- Step 3 — phase-entry-wiring — blocking: yes — qa: auto：desktop handler 传 `trigger:"manual"` + `isDesktopSessionRunInFlight` 提共享 + 入口门禁；mobile 编排传 `trigger:"manual"`。
- Step 4 — phase-entry-wiring — blocking: yes — qa: auto：desktop 既有 `T-IPC1` **改写**为 T-IPC1R + 门禁用例（T-CR6）；mobile 编排 trigger 断言（T-CR7）。
- Step 5 — phase-preview-lineno — blocking: yes — qa: auto：core `prompt-preview-turns.ts` 两个剥离纯函数 + workplace files / tool result body 接入（map 新对象）+ 头注释；`metaText` 字数随剥后正文自然变化（同步改测试期望，口径=与用户所见字符一致）。
- Step 6 — phase-preview-lineno — blocking: yes — qa: auto：core `render-prompt-turns.test.ts` 更新 :128-162 + 新增 T-PL 系列用例；desktop `ipc-types.ts` DTO 注释更新。
- Step 7 — phase-preview-lineno — blocking: no — qa: auto：user 附件 JSON 转义形态定向剥离（仅 `"content": "…"` 值内匹配**字面 `\n` 转义序列**（反斜杠+n 两字符、非真换行——正文经 `JSON.stringify(params, null, 2)` 转义后是单物理行，`user-vfs-save-mapping.ts:261-267`）的 `(^|\\n) *\d+\|` 每处一次）；**降级条款**：实现中若发现误伤不可控（如 dir 树/binary 降级文案的 content 形态与行号正文不可判别），允许裁剪为「本轮不做」——裁剪生效即构成 PRD 验收 3 的**口径变更**（user 附件项同步出本轮范围），须记录进验收记录并经用户确认后方可按裁剪口径验收，不阻塞交付。
- Step 8 — phase-preview-refresh — blocking: yes — qa: auto：mobile `RealPromptScreen` focus 重载（`useFocusEffect` 单通道替换挂载 effect，首次聚焦即触发、不双跑）+ `requestIdRef` 竞态守卫（旧响应丢弃）；文件头「导航红线」注释同步改写为「顶层只 import `useRoute` / `useFocusEffect`」（`RealPromptScreen.tsx:8-10` 原文只许 useRoute，不改进去会留失真红线）；两个既有套件 mock 补 `useFocusEffect`；新增 T-PR1/T-PR2。
- Step 9 — phase-preview-refresh — blocking: yes — qa: auto：desktop `RealPromptPanel` 订阅 `session-compacted`；测试落 `real-prompt-panel-rounds.test.tsx`（该文件处置由「不改」改为「加 T-PR3 + window 桩扩 `addEventListener`/`removeEventListener`/`dispatchEvent`/`CustomEvent`」——node 测试环境现桩只有 `window.novelMasterDesktop`，无事件 API）。
- Step 10 — phase-docs-align — blocking: yes — qa: manual_user：RULE.md **三条目**（:16 压缩条、:17 导入条中「置位/压缩裸 await（清空失败=状态错乱须报错）」表述按「压缩改 manual 吞错」收窄改写、:27 workplace 条）+ 代码注释按新口径定稿，清单七项：① `run-compaction.ts` 模块头（:1-21）与函数注释（:51-56）；② `session-kkv-domains.ts:30-31`；③ `session-kkv.port.ts:13`；④ `load-or-fill-file-cache.ts:44-46`；⑤ `clear-session-prompt-caches.ts:23-27`（「置位/压缩裸 await 上抛是刻意的」表述按「压缩改 manual 吞错」口径改写，置位不动）；⑥ `apps/desktop/src/main/services/chat-prompt-tokens.service.ts:571-574`（「手动压缩 IPC 没有 run 忙闲守卫」在门禁落地后失真，改为已有守卫）；⑦ 显示口径**四处**同步（`prompt-preview-turns.ts:34` `PromptToolGroupResultData.body` **新增**注释、`:64-66` workplace file body「行号格式原样」改写、`apps/desktop/shared/ipc-types.ts:975` workplace DTO 描述改写、`:931` `PromptToolGroupResultDto.body` **新增**注释）。
- Step 11 — phase-verify — blocking: yes — qa: auto：三端定向回归 + 受影响 app 全量各一次（RULE：分支开发期至少一次全量）；改 core 后重建 dist 再跑 desktop/mobile 测试（RULE dist 条）。
- Step 12 — phase-verify — blocking: no — qa: manual_user：真机/桌面手动验收（PRD 验收 1/3 的端到端：新建文件→手动压缩→预览见新文件；预览页各卡正文无行号；压缩后焦点回流/事件驱动刷新）。

## 测试策略

### 测试用例

**压缩刷新（T-CR）**

- T-CR1 — blocking: yes — core `run-compaction.test.ts` 新增：`trigger:"manual"` + `ok:true` → `listKeys(sessionId,"rule_snapshot")` 与 `("file_cache")` 皆空、token 失效断言不变（原 T-CC2 :123-183 拆出）。→ Step 1/2
- T-CR2 — blocking: yes — 原 T-CC2 另半：不传 trigger / `trigger:"auto"` → 两域保留（现断言 `["canon"]`/`["fc-key"]` 原样）。T-CC3（depth 传递）保持为 auto 语义用例。→ Step 1/2
- T-CR3 — blocking: yes — 原 T-CC4 扩展：manual 场景下 hide 抛异常 → `ok:false` 且两域不清（现有早 return 结构天然保证，断言补 trigger 变量）。→ Step 1/2
- T-CR4 — blocking: yes — 新增：manual 清域时 `clearDomain` 抛错 → `ok:true` 照旧返回 + warn（吞错不翻盘）。→ Step 1/2
- T-IPC1R — blocking: yes — desktop `compaction-handler.test.ts` **改写既有用例 T-IPC1 为 T-IPC1R**（断言方向反转：`handleCompactionManual` 后两域空（`rt.sessionKkv.listKeys` 皆 `[]`）、`user_vfs_pending` 保留（:146-149 原样）、composer 广播恰好 1 次（:153-164 原样）；**原「不得清两域」断言块不保留、不得与新块并存**——留下必红、验收 6 全绿过不去；编号避开既有用例 T-CR5「无预置 kkv」——那条不动）。附注：T-IPC2/IPC2b 断言不动，观察超时（清域后 warm 的 VFS 重读变慢，必要时调 timeout，不判回归）。→ Step 3/4
- T-CR6 — blocking: yes — desktop 新增：run 在途**注入真态**（向 `rt.abortRegistry` 注册该 sessionId——即 `isDesktopSessionRunInFlight` 的判定源；desktop 测试运行器未开 `--experimental-test-module-mocks`，**勿用 mock.module**）→ 手动压缩被拦（返回 `{ok:false, error:{code:"AGENT_RUN_IN_FLIGHT", message:"Agent 运行中无法压缩"}}`）。断言走**副作用代理**（禁 mock.module 下 spy 不到 `runCompaction` 本体）：composer 广播 0 次 + 两域 `listKeys` 未变（用例先预置 `file_cache`+`rule_snapshot` 各一键再触发，防空对空恒真——同 T-IPC1 预置手法；广播计数与同文件既有「假 webContents 捕获 send」手法同款，`compaction-handler.test.ts:122-164`）。→ Step 3/4
- T-CR7 — blocking: yes — mobile `compaction-warm-orchestration.test.ts`：mock 的 `runCompaction` 收到 `trigger:"manual"`（既有用例时序断言不动）。→ Step 3/4
- T-CR8 — blocking: no — core `agent-runner-compaction.test.ts` 可选补一条：自动路径不传 trigger（mock 透传断言）。→ Step 1

**行号剥离（T-PL）**

- T-PL1 — blocking: yes — workplace full 档多行 `N|` 逐行剥离、每行一次。→ Step 5/6
- T-PL2 — blocking: yes — filename 档单行 `1|basename` → `basename`；header 档两个同形兜底 `1|（无 Front Matter）`（`front-matter.ts:62`）/ `1|（空 Front Matter）`（`:65`）→ 剥前缀。→ Step 5/6
- T-PL3 — blocking: yes — tool result read 输出 `     1|正文` 6 位右对齐剥离；行号 ≥ 100000 无空格行漏剥的已知边界写进用例注释（接受）。→ Step 5/6
- T-PL4 — blocking: yes — skill load 追加行（`续读请用 skill read 的 offset/limit。`、附属文件列表）无行号不误剥；非 read 工具输出（grep `path:line:col:`、JSON 兜底）零改动。→ Step 5/6
- T-PL5 — blocking: yes — 原文自身含 `12|34`：workplace body 为 `1|12|34` → 剥后 `12|34`（只剥外层一次）。→ Step 5/6
- T-PL6 — blocking: yes — text/thinking 卡以 `N|` 开头的正文零改动（不被误剥）。→ Step 5/6
- T-PL7 — blocking: yes — wire 不变（**结构判据**——仓内无字节级 golden 机制，勿写「逐字节一致」）：① `buildPromptLlmInputFromLayout` 产物由 layout + messages + workplaceDisplay 组装，不经 cards 构造路径（与剥离函数零交集，源码 import 关系断言）；② 剥离为纯函数且不改入参（cards 为新对象、`ctx.workplaceFiles` 原 body 不变，fixture 断言）；③ `PromptPreviewTurn.items`/`.body`（wire parity 口径）仍带行号（fixture 断言）。→ Step 5/6
- T-PL8 — blocking: yes — `metaText` 字数按剥后正文计（更新 `render-prompt-turns.test.ts` :154-157 期望）。→ Step 5/6
- T-PL9 — blocking: no — user 附件 `"content"` 值内转义行号定向剥离（Step 7 配套；降级时此用例随步骤裁撤）。→ Step 7

**预览刷新（T-PR）**

- T-PR1 — blocking: yes — mobile：`RealPromptScreen` focus 回流触发 `load`（mock 补 `useFocusEffect` 后，既有 `real-prompt-screen-scope`/`prompt-turn-expand-control` 两套件仍绿）。→ Step 8
- T-PR2 — blocking: yes — mobile：竞态守卫——两次快速 load，旧请求响应被丢弃、state 为最后一次结果。→ Step 8
- T-PR3 — blocking: yes — desktop `real-prompt-panel-rounds.test.tsx` 新增（window 桩扩事件 API）：dispatch `session-compacted`（sessionId 匹配 + visible）→ panel 重取；sessionId 不匹配或不可见不重取。→ Step 9

**手动验收（qa: manual_user）**：Step 12 覆盖 PRD 验收 1（新建文件→手动压缩→预览含新文件）与验收 3（双端预览正文无行号）；Android 端按 RULE 硬规则走 Metro dev server 流程，禁止内嵌 bundle、禁止卸载。

### 既有测试处置汇总

| 文件 | 处置 |
|---|---|
| `packages/core/test/compaction-conditions/run-compaction.test.ts` | T-CC2 拆两条；T-CC3/T-CC4 保持（T-CC4 补 manual 变量断言） |
| `apps/desktop/test/compaction-handler.test.ts` | 既有 T-IPC1 **改写**为 T-IPC1R（断言反转、原块不保留不得并存；编号避开既有 T-CR5「无预置 kkv」）；T-CR5/T-IPC2/2b 断言不动（超时观察） |
| `packages/core/test/prompt/render-prompt-turns.test.ts` | :128-162 用例期望更新（剥后正文 + 字数） |
| `apps/mobile/__tests__/{real-prompt-screen-scope,prompt-turn-expand-control}.test.tsx` | mock 补 `useFocusEffect` |
| `apps/mobile/__tests__/compaction-warm-orchestration.test.ts` | 加 trigger 参数断言 |
| `apps/mobile/__tests__/prompt-workplace-card.test.tsx`（T-WP1-2/T-WP1-3） | **不改**——UI 直喂 DTO 锁定「透传」语义，core 剥离不触碰 |
| `apps/desktop/test/real-prompt-panel-rounds.test.tsx`（T-WP1） | T-WP1 断言不改（UI 直喂 DTO 锁「透传」）；**新增 T-PR3 + window 桩扩事件 API**（Step 9，该文件由「不改」改为此处置） |
| `refresh-rule-snapshot.test.ts`、`clear-session-prompt-caches.test.ts`、`history-compat-t-cr8`、`prompt-token-invalidation.test.ts`、`session-detail-drawer.test.ts` | 不改（口径未动的回归面） |

## 风险与回滚方案

1. **口径未拍板**：三项默认口径用户尚未确认（两轮澄清未答）。若推翻「完整刷新」→ 只清 `rule_snapshot` 的变体只需改 Step 1 的清域清单；若推翻「仅显示层」→ wire 去行号是独立大改，本 SPEC 作废重写。**spec 确认前不进 impl。**
2. **手动压缩变慢**：清域后 handler 内 await 的 token 预热（desktop :51-54）会连带全量重读 VFS，IPC 返回时间上升——PRD 已声明接受；T-IPC2 超时观察，必要时调 timeout 不判回归。
3. **desktop 门禁竞态窗口**：`isDesktopSessionRunInFlight` 与 core run 注册存在时序残窗（`chat-prompt-tokens.service.ts:571-576` 先例记录）——最坏后果是下一 step 多读一次文件，不会错乱，接受残窗。
4. **`notifyComposerStatusAfterFloorOrCompaction` 与清域顺序**：清域发生在 `runCompaction` 内部（notify 之前）——该通知只读 annotate store 组装 composer 附件条（`project-composer-status.service.ts:16-21`），不读 `file_cache`，清域不影响其内容；Step 4 验收时以 T-IPC1R 的广播断言（恰好 1 次）交叉核实。
5. **行号剥离误伤**：判据按卡类型限定 + 每行至多一次替换，T-PL4/T-PL5/T-PL6 锁死误伤面；user 附件转义形态（Step 7）允许降级裁撤，不阻塞。
6. **mobile focus 重载放大并发**：预览 load 无中止点（`buildSessionPromptInput` 头注释：非 chip 消费方不传 shouldBail，行为不变——本迭代不改该语义），用 `requestIdRef` 竞态守卫兜底；不加 inflight 全局去重（scope 控制）。
7. **回滚**：无 DB 变更、无 IPC 契约变更、`trigger` 缺省 auto 向后兼容——回滚 = 双端入口去掉 `trigger` 参数 + revert core 两文件即可整体回到现行行为；行号剥离回滚 = 删 `prompt-preview-turns.ts` 两处调用。worktree 分支按 RULE 并行开发，merge 由用户决定。

## Context Bundle（探索摘要）

```yaml
iteration_name: prompt-preview-workplace-lineno-2026-10
requirement_path: docs/Iterations/prompt-preview-workplace-lineno-2026-10/prd.md
spec_path: docs/Iterations/prompt-preview-workplace-lineno-2026-10/spec.md
explore_summary: >
  三路 readonly 子代理（2026-10-05）：①压缩链——手动/自动共用 runCompaction
  （run-compaction.ts:58-84）无 trigger 判别；desktop 手动入口缺 run 门禁
  （mobile 两入口各有）；子会话 KKV 恒等自身、评估按父，清域按传入 sessionId
  与置位/导入一致；错误处理三档口径（置位裸 await/压缩吞错/导入 best-effort）
  的依据与先例。②预览链——wire（buildPromptLlmInputFromLayout）与预览
  （buildPromptPreviewTurnsFromLayout/cards）物理分叉，cards 消费方仅预览 UI；
  行号三形态（workplace ^N|、read ^右对齐 6 位、user 附件 JSON 转义不可达）；
  双端 8 渲染点纯透传。③刷新时机——mobile RealPromptScreen 仅挂载取数 +
  导航红线 mock 约束；desktop panel 常驻仅 visible 翻转重取；window
  CustomEvent session-compacted 是现成压缩成功信号。
impact_files:
  - packages/core/src/service/compaction-conditions/run-compaction.ts
  - packages/core/src/service/prompt/prompt-preview-turns.ts
  - apps/desktop/src/main/ipc/handlers/compaction.ts
  - apps/desktop/renderer/features/chat/RealPromptPanel.tsx
  - apps/mobile/src/services/compaction-warm-orchestration.service.ts
  - apps/mobile/src/screens/stack/RealPromptScreen.tsx
  - docs/apm/RULE.md（+6 处漂移注释与 4 处显示口径同步，见 Step 10）
constraints:
  - 自动压缩不得清两域（2026-09-29 拍板：前缀回合内冻结）
  - wire 不变——以 T-PL7 结构判据验证（勿写「逐字节一致」，仓内无 golden 机制）
  - items/.body 为 CLI parity 冻结面，保留行号
  - desktop 既有 T-IPC1 改写为 T-IPC1R（原块不保留）须与实现同笔提交
  - 改 core 后重建 dist 才跑双端测试；定向测试带双 flag
blocking_steps: [1, 2, 3, 4, 5, 6, 8, 9, 10, 11]
```
