# CR Fix Spec: prompt-preview-workplace-lineno（预览 workplace 刷新 + 行号移除）

## 元信息
- 代码 repo：`D:\Dev\nm-worktree\ppwl`（分支 `feat/prompt-preview-workplace-lineno`）；迭代文档在主仓库 `D:\Dev\Js\novel-master`
- base_sha / head_sha：`44d266dbc` / `cd258cba9`（7 commits，20 文件 +1468/−107）
- prd_path / spec_path：`docs/Iterations/prompt-preview-workplace-lineno-2026-10/prd.md` / `spec.md`
- review_round: 2 已完成（wave1 = 三 scope 并行；wave2 = review-full 终轮）；本文档为 round 1 + round 2 spec-fix 产物
- dag_version: 3
- 状态：fix-spec-ready（待用户确认开工）
- spec-check-loop（对本文档的独立审查循环）：round 1 No-Go（P0×1 / P1×3 / P2×9）→ doc-fix 闭合 → round 2 **Go**（12/13 完全闭合，P1×1 半闭合 + P2×2 措辞）→ 残留 4 项已全部补齐（C-2 改法字段带 spec 两处、执行说明注明 C-2 跨两库、mobile B-1 附空集守卫注释提示）→ **execute-ready**

**Wave1 结论摘要**：P0=0、P1=0、P2=12（core 4 / desktop 4 / mobile 4），全部已认定且改法明确，逐条落盘如下。desktop / mobile 两节点 scope-ready；core 节点因上述 P2 未落 fix-spec 判 not-ready（首轮无 fix-spec 属预期，本文件即闭合动作）。

**Wave2（review-full）结论摘要**：上轮 12 条逐条抽验通过（文件/改法/验收/行号符号全对上）；新发现 1 条 P2（cr-full/C-1，RULE.md:27 同源漂移，已写入）；3 项 spec_deviations 处置核验后全部标 fixed（Step 7 收窄经证据核验**不构成口径收窄**，详见该节）；5 处精度修正已并入对应条目；跨端 C-orch 三链（trigger 单点装配 / 行号剥离单一数据流 / 压缩后刷新信号）核验**已收敛**。修复后 P0=P1=0、未写入 fix-spec 的开放 must-fix=0、无 open spec_deviations。

**执行说明（下游 code-dev-loop / 实现任务照此开工；两类落点，勿混）**：
- **代码/测试共 11 条**落 worktree `D:\Dev\nm-worktree\ppwl`（分支 `feat/prompt-preview-workplace-lineno`）。
- **两条例外落主仓库** `D:\Dev\Js\novel-master`：`cr-full/C-1` 改 `docs/apm/RULE.md:27`（主仓库未提交区）；`cr-desktop/C-2` 的 spec 同步改 `docs/Iterations/prompt-preview-workplace-lineno-2026-10/spec.md`（该条**跨两库**：其 `compaction.ts` 与 `compaction-handler.test.ts` 两处仍落 worktree，仅 spec 同步在主仓库）。**勿动 worktree 的 `docs/`**——那是旧副本，worktree 内没有本迭代 spec.md（迭代惯例见 Spec deviations §4）。
- 测试运行口径沿用迭代内既有约定——core 定向 `npx tsx --test --experimental-test-module-mocks --tsconfig tsconfig.test.json <file>`、desktop 定向需 `NODE_OPTIONS=--import file:///...test/register-electron-mock.mjs` + `--tsconfig tsconfig.renderer.json`、mobile 定向 jest；改完 core src 后重建 core dist。

---

## Must-fix（按 P0 → P1 → P2；本轮全为 P2）

### cr-core/G-1 [P2] 补测试：hide 命中 0 条时 manual 仍清两域且 ok:true
- 维度：G
- 文件：`packages/core/test/compaction-conditions/run-compaction.test.ts`（T-CR1 用例之后；注意路径无 `service/` 层）
- 问题：spec《总体方案》写明「`ok:true` 即刷（与 hide 实际命中数无关）」，但现有用例（含 T-CR1）都塞了多条可隐藏消息并断言 `hiddenCount > 0`，未覆盖「锚不出可隐藏范围」分支。该分支生产可达（`resolveHideMessageRange` 锚不出时返回 null 而不抛错，`runHideMessageAction` 直接 return，`runCompaction` 照样清两域返回 ok:true——短会话用户点压缩的真实路径）。若将来有人把清域挪进 `hiddenCount > 0` 分支（看似自然的优化），全套测试仍绿，短会话手动压缩刷新静默失效——正是本迭代要治的病。
- 改法：新增 `it("T-CR1b：hide 无可隐藏范围（锚不出真用户输入）时 manual 仍清两域且 ok:true")`（编号用 T-CR1b——T-CR5 已被 desktop `compaction-handler.test.ts` 的既有用例占用，勿撞车）：① 建 project/session；② 只 append 2 条消息（`["assistant","assistant"]`，slice 内无真用户输入 → 锚不出）；③ 预置 `rule_snapshot` 与 `file_cache` 各一键；④ 调 `runCompaction(..., { sessionId, projectId, hideStartDepth: 6, trigger: "manual" })`；⑤ 断言 `result.ok === true`、无消息被隐藏（`hidden` 计数为 0）、`listKeys(sessionId, RULE_SNAPSHOT)` 与 `listKeys(sessionId, FILE_CACHE)` 皆 `[]`。
- 验收/测试要点：现状必须绿；把 run-compaction 清域分支改成受 `hiddenCount` 门控时必须红（该用例的唯一价值，勿写成顺手补充）。
- 来源：review-scope-core / round 1

### cr-core/G-2 [P2] 补测试：items/body 保留行号的 parity 断言盖到 workplace 段与附件 user 段
- 维度：G
- 文件：`packages/core/test/prompt/render-prompt-turns.test.ts`（T-PL7、T-PL9 附近）
- 问题：「items/body = wire parity 口径（保留行号）」写进了 5 处字段注释 + 模块头（core `prompt-preview-turns.ts` :50/:80/:94 + desktop `ipc-types.ts` :932/:987；另模块头 :14），但现有 parity 断言（T-PL7 ③）只盖普通 assistant 聊天轮；本迭代真正剥离的 **workplace 合成段**（`workplaceTurnOf` 的 `ctx.workplaceDisplay` 是无行号字面量 "WT"，无从验起）与**带附件的 user 段**（T-PL9 只断 `cards[0].body`）两处均无断言。将来若把剥离上提到 `toPreviewSegment` / `segment.body`，wire parity 静默破掉而测试全绿。
- 改法（**先于 cr-core/G-3 执行**；②不动既有 `userCardBody` 辅助——它只返回 `card.body`、吃掉整轮，G-3 还要复用它）：① 新增 T-PL7④：构造 `ctx.workplaceDisplay` 为带行号的 `<file path="a.md">\n1|第一行\n2|第二行\n</file>`，`buildPromptPreviewTurnsFromLayout(workplaceLayout, ctx)` 后断言 `turn.items[0].body` 与 `turn.body` 均 `match(/1\|第一行/)`，同时断言同次组装的 `cards[0].files[0].body` 已是 `"第一行\n第二行"`（一正一反钉死分叉）。② T-PL9 的 `userAttach` 场景补断言：**内联**调 `buildPromptPreviewTurnsFromLayout` 拿整轮（或另加返回整轮的 `userTurnOf(text)` 辅助），断言 `turns[0].items[0].body` 仍含 `"content": "1|第一行\\n2|第二行"`，而 `turns[0].cards[0].body` 已是剥后形态。
- 验收/测试要点：把 `toPreviewSegment` 改成剥行号（或对 `item.body` 剥离）时这两条必须红。
- 来源：review-scope-core / round 1

### cr-core/G-3 [P2] 补测试：workplaceChange 附件块剥离无用例
- 维度：G
- 文件：`packages/core/test/prompt/render-prompt-turns.test.ts`（T-PL9 describe 内）
- 问题：`prompt-preview-turns.ts` 的 `LINE_NUMBERED_ATTACHMENT_ACTION` 显式枚举 `userAttach|workplaceChange`，测试只覆盖前者；`workplaceChange`（工作区规则调整变更卡）是生产常客。枚举被误改/收窄时现有用例一条不红，workplaceChange 附件行号漏剥——PRD 验收 3 明列场景。
- 改法：加 `it("workplaceChange 块同样剥（与 userAttach 同判据）")`：用 `buildFileRefActionXml({ action: "workplaceChange", path: "notes/a.md", content: "1|第一行\n2|第二行", display: "full" })` + `wrapUserMessageForLlm` 造轮，复用既有 `userCardBody` 辅助，断言 `/"content": "第一行\\n第二行"/` 且 `doesNotMatch(/\\n\d+\|/)`。
- 验收/测试要点：故意把枚举收窄成只 `userAttach` 时该用例红。
- 来源：review-scope-core / round 1

### cr-core/C-1 [P2] 注释：file_cache 改写方清单漏「回滚/截尾」
- 维度：C（注释准确性）
- 文件：`packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts:45-46`
- 问题：改后清单「改写它的只有改规则 / 手动压缩 / 置位 / 会话删除」不完整——回滚/截尾经 `packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts:324` → `truncateTailInTransaction`（`:113-115` 清 `SESSION_KKV_COMPOSER_STATUS_DOMAINS`，含 `file_cache`）。本迭代主题正是消灭这类漂移注释（PRD 核心需求 6 / 风险项6 防 CD-57 复发），该句本次被编辑过却仍失真。
- 改法：清单改为「改写它的只有改规则（`refreshRuleSnapshot`）/ 手动压缩 / 置位 / 回滚与截尾（`truncateTailInTransaction` 清 `SESSION_KKV_COMPOSER_STATUS_DOMAINS`，含本域）/ 会话删除（自动压缩不清，见 run-compaction 头注释）」。
- 验收/测试要点：纯注释改动不跑测；核对注释内符号名与 `truncate-tail-in-transaction.ts:113-115`、`session-kkv-domains.ts:110-113` 对得上。
- 来源：review-scope-core / round 1

### cr-full/C-1 [P2] 注释：RULE.md:27 与 cr-core/C-1 同源漂移（第二个落点）
- 维度：C（注释/文档准确性）
- 文件：`D:\Dev\Js\novel-master\docs\apm\RULE.md:27`（主仓库未提交区）
- 问题：cr-core/C-1 认定的那句「改写 file_cache 的只有改规则/压缩/置位/会话删除」在 RULE.md:27（workplace 条）有第二个落点，同样漏了「回滚与截尾」（`packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts:324` → `truncateTailInTransaction` → `SESSION_KKV_COMPOSER_STATUS_DOMAINS` 含 `file_cache`）。RULE.md:27 属 spec Step 10 第⑦项本轮必改条目、且本迭代刚编辑过该行——与 cr-core/C-1 同一论证：被编辑过却仍失真。后续 agent 读 RULE.md 当权威会得出「回滚不动 file_cache」的错误结论。
- 改法：在 RULE.md:27 枚举里补一项：「…改写缓存的只有用户改规则（`refreshRuleSnapshot`）、手动压缩（2026-10-05 起 `trigger:"manual"` 清两域，自动压缩不清）、置位、**回滚与截尾**（`truncateTailInTransaction` 清 `SESSION_KKV_COMPOSER_STATUS_DOMAINS`，含 `file_cache`）、会话删除。」
- 验收/测试要点：纯文档不跑测；核对与 `session-kkv-domains.ts:110-113`（`SESSION_KKV_COMPOSER_STATUS_DOMAINS = [SESSION_KKV_DOMAIN_FILE_CACHE, SESSION_KKV_DOMAIN_USER_VFS_PENDING]`）、`truncate-tail-in-transaction.ts:113-115` 对得上。
- 来源：review-full / round 2

### cr-desktop/C-1 [P2] 注释：DTO 层误植 core 对照句（desktop DTO 只有 cards）
- 维度：C
- 文件：`apps/desktop/shared/ipc-types.ts:932`（`PromptToolGroupResultDto.body`）、`:987`（`PromptWorkplaceFileDto.body`）
- 问题：注释写「cards 为显示层口径（已剥行号），items/body 为 wire parity 口径（保留行号）」——该句在 core 成立，但 desktop 的 `PromptPreviewTurnDto` 只有 cards、无 items/body 字段（`real-prompt-panel-rounds.test.tsx:1198-1205` 有断言）。注释挂在恰好叫 `body` 的 DTO 字段上，读者会误读成「此 body 是 wire parity 侧」，与事实相反。同文件 `PromptTextCardDto.body`（:975）的写法正确可作模板。
- 改法：两处首句改为 desktop 层语义，例如：「结果正文 —— **显示层口径（已剥行号）**。wire parity 的带行号原文在 core `PromptPreviewTurn.items` / `.body`，不经本 DTO 下发（`PromptPreviewTurnDto` 只有 cards，无 items/body 字段）。」
- 验收/测试要点：只动注释；`T-DP4` 保持绿；全仓不再出现「cards 为…items/body 为…」句式挂在 DTO 层。
- 来源：review-scope-desktop / round 1

### cr-desktop/C-2 [P2] 命名：错误码 kebab-case 破全仓 SCREAMING_SNAKE 惯例
- 维度：C（惯例一致性）
- 文件：`apps/desktop/src/main/ipc/handlers/compaction.ts:40`；同步改主仓库 `docs/Iterations/prompt-preview-workplace-lineno-2026-10/spec.md` 的**两处**——变更点 3（:56）与测试策略 T-CR6（:89，`{ok:false, error:{code:"run-in-flight", …}}`）——以及 `apps/desktop/test/compaction-handler.test.ts` 内 T-CR6 的 `result.error.code === "run-in-flight"` 断言（按符号定位，当前 :248）
- 问题：`error.code: "run-in-flight"` 是 desktop `IpcErrorPayload.code` 家族内唯一 kebab-case 机器码（注：`ipc-types.ts:1472` 的 `StoredConfigInvalidDto.code` 也有 kebab 值但属另一族 DTO，勿混）；同类「run 在途」拦截先例 `agent.ts:412` 用 `AGENT_BUSY`，其余（agent-registry/app-info/skills/renderer 分支 `ROLLBACK_*`）全 SCREAMING_SNAKE。实现严格照 spec 写——是 spec 与仓惯例的冲突，须本轮定掉，否则后续 CR/改动代理会按惯例当漂移改掉（CD-57 同类）。
- 改法（采纳方案 a，与 `AGENT_BUSY` 对齐）：码改 `AGENT_RUN_IN_FLIGHT`；**spec 的两处**——变更点 3（:56）与测试策略 T-CR6（:89）——连同 `compaction-handler.test.ts` 内 T-CR6 的 `result.error.code` 断言（按符号定位，当前 :248）一并同步改。renderer 无人按此码分支（只 `showToast(error.message)`），零连带。
- 验收/测试要点：desktop 定向 `compaction-handler.test.ts` 绿；grep 全仓 error.code 无 kebab 残留。
- 来源：review-scope-desktop / round 1（其 open_question 2 由主代理裁定走方案 a；用户可改豁免保留 kebab + spec 记录理由）

### cr-desktop/B-1 [P2] 面板 load() 补竞态守卫（与 mobile requestIdRef 对称）
- 维度：B（竞态）
- 文件：`apps/desktop/renderer/features/chat/RealPromptPanel.tsx:70-78`；测试 `apps/desktop/test/real-prompt-panel-rounds.test.tsx`（T-PR3 describe 内）
- 问题：`load()` 无请求序号守卫，响应回来无条件 `setTurns`。本次新增的 `session-compacted` 订阅多了一条触发源：压缩事件触发的 load 在途时切会话，旧会话响应后到会把别的会话轮卡写进面板（projectId/sessionId 依赖换了，旧 promise 闭包照样执行）。属既有缺陷、本次提高可达性；同迭代 mobile 侧专门加了 `requestIdRef`（Step 8 / T-PR2），desktop 缺失形成不对称。
- 改法：`import { useRef }` → `const requestIdRef = useRef(0);`；`load` 开头 `const requestId = ++requestIdRef.current;`；`setTurns(...)` 前加 `if (requestId !== requestIdRef.current) return;`。
- 验收/测试要点：T-PR3 补一条「旧响应后到不覆盖新数据」。**前置**：现有 `installGlobals` 的 `invoke` 桩是 `Promise.resolve({ok:true, data: currentTurns})`，挂载响应必先落定、构造不出「旧的在后到」——先给桩加**按调用序排队的手控响应**（如新增 `queueInvokeResponse(data)` 返回 `{resolve}` 供用例控制时序），再用它写用例：连发两次取数（第一次挂 pending、第二次先 resolve 新数据），断言 `ipcInvokeCount()===2` 且面板轮卡为第二次数据（对齐 mobile T-PR2 口径）。
- 来源：review-scope-desktop / round 1

### cr-desktop/G-1 [P2] 测试基建：mountPanelWith 提前还原全局，埋卸载即炸的雷
- 维度：G
- 文件：`apps/desktop/test/real-prompt-panel-rounds.test.tsx:371-379`
- 问题：`mountPanelWith` 在 `finally` 里立刻 `restore()`，但被挂载面板已在临时 window 对象上注册了 `session-compacted` 监听（RealPromptPanel.tsx:106）。现有 6 个调用点都不 unmount 所以不炸；任一用例将来加 `renderer.unmount()` 时，React 清理走 `window.removeEventListener` 而全局 window 已还原为 undefined → TypeError，报错点离成因隔着 helper。
- 改法（拍板方案一）：`mountPanelWith` 返回 `{ renderer, restore }`，`restore` 交由 6 个调用点在用例末尾（或所在 describe 的 `afterEach`）统一还原；禁止 helper 内部提前 `restore()`。
- 验收/测试要点：6 个用例断言行为一字不变；新增一条 mountPanelWith 路径下 unmount 不抛错的用例。
- 来源：review-scope-desktop / round 1

### cr-mobile/B-1 [P2] 预览屏 refocus 整屏 spinner + 展开态被收（改静默档）
- 维度：B（行为/体验回归）
- 文件：`apps/mobile/src/screens/stack/RealPromptScreen.tsx:108`、`:114-115`、`:147-151`
- 问题：焦点回流被当「整屏首载」处理：`load()` 无条件 `setLoading(true)` + 清空 `openTurnIds/openGroupIds`，而 `loading ? <ActivityIndicator/> : <FlatList/>` 二选一渲染——每次回到本屏整列表换成全屏转圈、用户刚展开的轮被收起。`PromptTurnDetailScreen` 是同栈 push 在本屏之上（点子卡看全屏详情再返回是本屏最高频出入栈路径），即「每读一张卡返回一次闪一次 spinner、丢一次展开态」，外加一次完整 `buildRealPromptPreviewTurns` 重建（手动压缩刚清完 file_cache 那一次尤重）。非 spec 写错——Step 8 要 focus 重取，只是没考虑本屏自身的出栈路径。仓内现成惯例：`useFocusListReload` 的 `focusSilent`。
- 改法（拍板口径，主方案 `hasLoadedRef`；两个口径**各管各的**，勿合并）：①`load(opts?: {silent?: boolean})` —— `silent` **只压 `setLoading(true)` 这一步**；②展开态清空改按会话判——`const lastSessionRef = useRef<string | null>(null)`，`load` 内 `if (lastSessionRef.current !== sessionId) { setOpenTurnIds(new Set()); setOpenGroupIds(new Set()); lastSessionRef.current = sessionId; }`（同会话 refocus 保留展开态，换会话必清，对齐既有注释「换了会话，旧会话的展开态没有意义」）。执行时在 ② 上留一行注释说明「此处可无条件换新 Set——原空集原引用守卫防的是 load 换引用循环，现只在 sessionId 变化触发且 load 依赖不含展开态，前提已消失」，防后来者照原注释改回去。③`const hasLoadedRef = useRef(false)`，`useFocusEffect` 回调里 `const silent = hasLoadedRef.current; hasLoadedRef.current = true; load({silent}).catch(...)`——首焦整屏档、之后一律静默档。勿用 `turns.length` 进依赖（focus 回调换身份→重跑→循环 load）。
- 验收/测试要点：T-PR1 扩断言——refocus 后 `listData` 是新数据**且仍是 `prompt-list` 节点（没被 spinner 顶掉）**；第二条「refocus 后展开态保留」落 `apps/mobile/__tests__/prompt-turn-expand-control.test.tsx`（`real-prompt-screen-scope.test.tsx` 把 `PromptTurnCard` 整族桩成空 View，屏上没有 `prompt-turn-body`，验不了）——press `prompt-turn-head` → refocus → `prompt-turn-body` 仍在；**前置**：该文件现有 `useFocusEffect` mock（:36-39）不登记回调，需照 `real-prompt-screen-scope.test.tsx:26-48` 的 `mockFocus` 补 handler 登记，模拟 refocus 才有效。
- 来源：review-scope-mobile / round 1（其 open_question 1 由主代理裁定走静默档；这是对 spec Step 8 行为口径的微调，见 Spec deviations §2）

### cr-mobile/C-orch-1 [P2] 注释：压缩编排层补「手动专属」硬约束
- 维度：C-orch
- 文件：`apps/mobile/src/services/compaction-warm-orchestration.service.ts:59-64`（JSDoc）、`:88`
- 问题：`trigger: 'manual'` 硬写在这一层，但函数名与 JSDoc 看不出「本编排只服务手动入口」的前置条件。现在两处调用方（`useChatTabMessageActions.ts:114`、`SessionDetailScreen.tsx:165`）恰好都是手动入口所以正确；将来谁把回合中段的条件压缩接进这个编排（名字中性、warm 逻辑正是自动压缩也想要的），会静默清两域、打破 2026-09-29 拍板的「回合内前缀冻结」——且跑出来全绿、只在真机上炸。
- 改法：JSDoc 第一行补硬约束：「⚠️ 本编排是**手动压缩专属**入口：两处调用方均为 UI『压缩上下文』按钮，故 trigger 硬写 "manual"。接自动压缩前必须先给本函数加 trigger 透传参数，不得沿用这一行——自动压缩清两域会打破回合内前缀冻结。」类型注释同步点一句的对象是 `RunCompactionWithTokenWarmOutcome`（`:34`）或 `RunCompactionWithTokenWarmHooks`（`:46`）——勿自造 PascalCase 名；仓内实际函数导出是小写 `runCompactionWithTokenWarm`（`:65`），别混。
- 验收/测试要点：纯注释，无需测试。
- 来源：review-scope-mobile / round 1

### cr-mobile/G-1 [P2] 补测试：过期请求的失败不覆盖新一轮成功结果
- 维度：G
- 文件：`apps/mobile/__tests__/real-prompt-screen-scope.test.tsx`（T-PR2 之后；注意实际路径在 `apps/mobile/__tests__/`，非 `src/screens/__tests__/`）
- 问题：竞态守卫三分支（成功过期守卫 / catch 过期守卫 / scope 缺失早退作废在途请求）只钉了第一条。catch 侧守卫（旧请求报错不覆盖新一轮状态）是真机最易撞的时序（VFS 读一半被新压缩打断），被「简化」掉后屏上会跳出上一轮报错文案、看起来像当前会话出错。
- 改法：先给现成 `deferred` 辅助（`real-prompt-screen-scope.test.tsx:136-143`）**补 `reject`**（当前只导出 `resolve`），再加 `it('T-PR2b 过期请求的失败不覆盖新一轮成功结果')`：两次 `mockBuildSegments` 分别挂 first/second；renderScreen 后 refocus；`second.resolve([{id:'turn-new',...}])` → flush → `first.reject(new Error('stale boom'))` → flush；断言 `listData` 仍 `['turn-new']` 且无 `Text` 渲染出 `stale boom`。
- 验收/测试要点：用例绿；删掉 catch 内守卫时该用例红。
- 来源：review-scope-mobile / round 1

### cr-mobile/G-2 [P2] 测试：T-CR7 断言改全等，钉住 hideStartDepth
- 维度：G
- 文件：`apps/mobile/__tests__/compaction-warm-orchestration.test.ts:132-145`
- 问题：T-CR7 用 `expect.objectContaining({sessionId, projectId, trigger})`，没钉 `hideStartDepth`（压缩深度唯一来源，core 缺省走 `DEFAULT_HIDE_START_DEPTH`）。被人顺手清掉该键时套件仍全绿，压缩深度静默变默认值。
- 改法：断言改全等：`expect(mockRunCompaction).toHaveBeenCalledWith(expect.anything(), { sessionId: 's-manual', projectId: 'p', hideStartDepth: 3, trigger: 'manual' })`（`beforeEach` 里 `mockGetHideStartDepth.mockResolvedValue(3)` 固定回 3）。
- 验收/测试要点：用例绿；将来编排层增参时全等断言提醒同步更新。
- 来源：review-scope-mobile / round 1

---

## Spec deviations

1. **Step 7 附件剥离作用域收窄 —— fixed（round 2 经证据核验：不构成口径收窄）**
   - 实现：`stripAttachmentContentLinePrefix` 作用域限定 `<action name="userAttach|workplaceChange">` 块内；spec Step 7 字面只写「仅 `"content": "…"` 值内匹配字面 `\n` 转义序列的 `(^|\n) *\d+\|`」。
   - round 2 核验证据（review-full）：`build-attachment-action-xml.ts:32` 类型注释明写 `userAttach`/`workplaceChange` 的 content 是**行号正文**；`workplaceChange` 唯一产出点 `prepare-user-messages-for-prompt.ts:184/254/605`；`skillAttach`（SKILL.md 裸文）、`annotate`（无 content 键）、`dirTree` 本来就无行号。即限定这两个 action **恰好覆盖全部带行号附件正文**，PRD 验收 3 覆盖面未收窄，也未触发 Step 7「裁剪为本轮不做」降级条款。实现口径成立，无需用户豁免。

2. **mobile 预览屏 refocus 静默档（cr-mobile/B-1）—— fixed**：spec Step 8 只规定「focus 回流重取」，未规定 loading 档位；收敛到仓内惯例（`useFocusListReload.focusSilent`）不违背 spec 任何一句。随 cr-mobile/B-1 一并生效。

3. **desktop 错误码 `AGENT_RUN_IN_FLIGHT`（cr-desktop/C-2）—— fixed**：spec 变更点 3 的 `run-in-flight` 改名，spec 同批更新。随 cr-desktop/C-2 一并生效。

4. **澄清（非 deviation，round 2 复核成立）**：`docs/apm/RULE.md:16/:17` 已在主仓库未提交区按新口径更新；`:27` 同样已更新但含与 cr-core/C-1 同源的清单漏项（见 cr-full/C-1）。worktree diff 不含 docs 属迭代惯例（docs 留主仓库、不随 feat 分支走），review-scope-core 报的「RULE.md 未更新」系只读 worktree 旧副本所致误报。

---

## Open questions / 待拍板
1. **预览屏底部提示文案（两端同款）**：desktop `RealPromptPanel.tsx:247` 与 mobile `RealPromptScreen.tsx:174` 都是「在会话工作区调整纳入规则可改变预览内容。」——本迭代后手动压缩也能刷新预览，文案是否补一句（如「或手动压缩上下文后刷新」）？产品文案口径，请拍板；不改不阻塞。
2. **desktop T-CR5 顺序耦合**：复用 T-IPC1R 的 sessionId，其「无预置 kkv」前提靠前者跑完留空的空域成立（当前断言不依赖、不会红）。是否顺手自建独立会话拆掉顺序耦合？倾向顺手拆（约 3 行）。
3. **cr-desktop/B-1 严重度**：review-full 指出若 load#1 在 load#2 之后返回，错会话数据会持续到下一次重取（不只闪一下），严格说够 P1；维持 P2 的理由是只读预览、下一次 visible 翻转或压缩事件自愈。维持 P2，留此记录。
4. **两 strip 函数合并 / 两域三元组抽公共数组 / `clearSessionPromptCaches` 存量单 try**：均为未认定的风格/存量项（前者合并会把语义判据藏进参数、后者三处事务与错误策略确实不同、第三处是存量代码不在本迭代范围）。倾向全部不动，留档。
5. **`registerRunInFlight` helper 重复**（desktop 两测试文件各一份内联）：跨文件复用需新建共享模块，现状可接受，留档。
6. **`useFocusEffect` mock 保真度**（失焦时也会跑回调，真实实现仅 focused 才跑）：本屏 load 依赖路由参数 push 后不变，近似无害且与既有套件先例一致。留档不追。
7. **端到端链路自动化缺口**：「手动压缩 IPC 成功 → renderer dispatch → 面板重取」全链无自动化（T-PR3 只到事件→重取）。按 spec 原设计由 Step 12 手动验收兜底，留档。

## 已豁免（用户确认不修）
- 无。

## 合并后 QA（manual_user，不阻塞）
- mobile e2e（进行中）：新项目/会话发消息 → 工作区建 e2e-new.md → 预览#1（workplace 不含它、正文无行号）→ 手动压缩 → 预览#2（workplace 含 e2e-new.md、正文无行号）；截图留档 `D:\Dev\nm-worktree\ppwl\tmp\`。
- desktop 面板刷新场景实机补测（mobile 结果良好后）。
- 真机最终验收（PRD 验收 1/3 端到端，用户在场）。

## K 节建议（下游执行时闭合）
- 本 skill 未跑任何测试/build。
- 下游执行完 13 条后建议按定向清单复验：core 3 套件（run-compaction / render-prompt-turns / agent-runner-compaction）、desktop 2（compaction-handler / real-prompt-panel-rounds）、mobile 3（compaction-warm-orchestration / real-prompt-screen-scope / prompt-turn-expand-control），再加一次受影响端全量（分支开发期惯例，RULE.md:72）。
- 格式收口：本轮新增行有数处超 printWidth 80（如 `compaction-warm-orchestration.test.ts:136`、`real-prompt-screen-scope.test.tsx:16/:113`）；同文件存量已有多行超宽在库、不构成本轮新纪律违反，下游收尾时对**本轮触碰的文件**跑一次 prettier 收口即可，不必全仓 format。

---

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | yes |
| fix_spec_path | docs/Iterations/prompt-preview-workplace-lineno-2026-10/cr-fix-spec.md |
| dag_version / review_round | 3 / 2 |
| P0 / P1 / P2（已写入 fix-spec） | 0 / 0 / 13 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none（3 项处置均已 fixed，1 项澄清成立；见 Spec deviations 节） |
| C-orch | ✅ 已收敛（trigger 单点装配 3 处一一对应、行号剥离单一数据流无双写、刷新信号两端各有行为级断言、run 在途门禁层级不对称为 spec 显式决策） |
| C 类合并后 QA | mobile e2e 进行中 + desktop 面板场景补测 + 真机验收（见「合并后 QA」节，不阻塞） |
| spec-check-loop round 1 | No-Go → doc-fix 闭合 P0×1（执行说明两类落点分列：11 条 worktree / 2 条主仓库，勿动 worktree 旧 docs）+ P1×3（C-2 补 spec:89 T-CR6 第二处；mobile B-1 拍板 silent 只压 loading、清展开态按会话判；G-2/G-3 helper 冲突定序与内联）+ P2×9（路径/编号/行号/桩前置等） |
| spec-check-loop round 2 | **Go**（13 条文件/符号/行号/反向验收全部复核通过；残留 4 项纯文档小项已补齐）→ execute-ready |

