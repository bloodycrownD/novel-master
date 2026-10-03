# CR Fix Spec: ui-prompt-fixes-2026-10

## 元信息

- repo：worktree `D:\Dev\nm-worktree\upfx`（分支 `feat/ui-prompt-fixes-2026-10`）
- base_sha / head_sha：`f9574534` / `1d3999928`（69 文件 +3188/−934，10 笔提交）
- prd_path / spec_path：`docs/Iterations/ui-prompt-fixes-2026-10/prd.md` / `spec.md`
- review_round / dag_version：1（scope）→ 2（full：no，fix-spec 自身 5 处修正）→ 3（full：通过）→ 4（spec-check-loop r1 doc-fix）→ 5（r2 doc-fix）→ 6（r3 doc-fix：r2/G-2 变异靶点重写）→ r4 复审 Go
- 状态：execute-ready（CR loop 三轮 + spec-check-loop 四轮收敛，r4 复审 Go）
- 模式：scope（r1r3 / r2-attach / r4-rounds 三路并行）→ full
- must-fix 计数：**P1×3 + P2×22 = 25 条**（round 1 原 26 条，review-full 判定 r1r3/G-2 为伪 must-fix 已删——T-L6 实际已由 `apps/mobile/__tests__/sanitize-rich-html.test.ts:97` 交付，见 spec deviations 表）

---

## Must-fix（按 P0 → P1 → P2）

### r1r3/G-1 [P1] zones/assembly 两处 lifecycle 判定无 step≥1 测试
- 维度：G（断言无牙性）
- 文件：`packages/core/src/service/prompt/render-prompt.ts:88-91`（zones）、`:326`（assembly）；测试落点 `packages/core/test/prompt/render-prompt-lifecycle.test.ts`
- 问题：R3 改的三个 `agentStepIndex === 0` 判定点里，只有 `buildPromptLlmInputFromLayout`（`:380`）有 step≥1 负向覆盖；zones 与 assembly 两处全仓无任何 step≥1 用例——把这两处改成恒真，core 全量不红一条。`zones.dynamicCount` 是 `normalizeForLlmExport` 切 dynamic 段的依据（`agent-runner.ts:585` 每 step 调），回归即静默错切导出切片。
- 改法：`render-prompt-lifecycle.test.ts` 补两条用例——① `computeLlmExportZonesFromLayout(layout, {agentStepIndex:0}).dynamicCount === N` 且同 layout `{agentStepIndex:1}` 时为 0；② `buildPromptAssemblyFromLayout` 在 step0 产出 `dynamic-*` 段、`{agentStepIndex:1}` 不产出任何 `dynamic-` 前缀 id 段。
- 验收/测试：新用例本身绿；变异验证——临时把 `:89`/`:326` 判定改 `true`，两条用例红（验完还原）。
- 来源：review-scope-r1r3 round 1

### r2/G-1 [P1] T-A7「存量 action XML 原样带过」断言无牙
- 维度：G / B（seen 语义）
- 文件：`packages/core/test/chat/prepare-user-messages-for-prompt.test.ts:1540-1570`（T-A7）；被测 `packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts:250`
- 问题：把 `if (attachment.content.includes("<action "))` 旁路整段删掉，T-A7 照绿——`legacyXml` 仅 ~70 字符不超预算，走 `fileRefAction` 也能渲染出 `/1\|OLD/` 命中。
- 改法：断言升级为「XML 外形原样、未被 `fileRefAction` 重排」：① `assert.match(body, /"content":"1\|OLD"/)`（`legacyXml` 是紧凑 JSON 冒号后无空格，原样带过保持紧凑；`fileRefAction` 出口是 `JSON.stringify(params, null, 2)` 带缩进——**勿写带空格形态**，那是降级出口的产物，写反了正确行为下当场红）；② `assert.equal(body.includes('"display"'), false)`（原样带过无 display 键——本条是主牙齿）；③ 补一条变体——`legacyXml` 正文撑到 `ATTACH_PROMPT_CHAR_BUDGET + 1`，断言仍不降级（钉「不计量」）。
- 验收/测试：变异验证——删 `:250` 旁路后 ①②③ 至少两条红（验完还原）。
- 来源：review-scope-r2-attach round 1；断言形态经 review-full round 3 修正

### r2/G-2 [P1] T-A4/T-A4b 对 workplace 豁免红线零牙齿（变异靶点=":586 透传缺失"，非 :231）
- 维度：G / A（用户红线：workplace 豁免——**spec Step 4 已拍板的设计，非待定项**）
- 文件：`packages/core/test/chat/prepare-user-messages-for-prompt.test.ts:1423-1469`（T-A4）、`:1471-1506`（T-A4b）；被测 `prepare-user-messages-for-prompt.ts:557-561/:632/:586`（hydrateWorkplaceWithSeen 签名/调用点/硬传 undefined——真正的豁免层）与 `:231`（source==="workplace" 判——现状死代码，见问题）
- 问题（经 spec-check-loop r3 修正）：①两条用例的「预算被吃光」前提从未成立（`tryConsume` 超限不动 `used`，前置 `BUDGET+1` 让 used 停 0）；②**`:231` 是不可达代码**——附件按 source 分区派发（`:617-638`），workplace 走 `hydrateWorkplaceWithSeen`（签名无 budget 形参），`:586` 向 `hydrateFileFull` 硬传 `undefined` → `:230` 的 `budget == null` 先返回，`:231` 永不执行。删 `:231` 行为零变化、T-A4b 不会红——真正的豁免层是 `:586`。
- 改法（三步，(a) 是让第二层防线活过来的实现前提）：
  **(a) budget 透传**：`hydrateWorkplaceWithSeen` 签名加 budget 形参（`:557-561`）、`:632` 调用点传入、`:586` 的 `undefined` 改 `budget`——**行为零变化**（透传后 workplace 附件走到 `:231` 即被 source 判据拦住，不计量不降级），但 `:231` 从死代码变活防线；该处注释同步改写为「workplace 豁免=此处显式 source 判据（透传后生效）」。
  **(b) T-A4 原样保留**——`/fn.md` 是 filename 档（`cached.body` 空串、`tryConsume(0)` 恒过），删豁免后仍绿是正确行为；换 full 档夹具会弄红 `:1466`/`:1468` 并丢「filename 档渲染 `1|basename`」覆盖。
  **(c) 只改 T-A4b 前置**：`/huge.md` 从「超预算（BUDGET+1）」改为「恰好吃满」——`await vfs.write("/fill.md", "F".repeat(ATTACH_PROMPT_CHAR_BUDGET))` 计入成功拉满 used=100000；`/w.md`（full 档 16 字符）断言原样保留；T-A4b 无 m1 断言无需反转。
- 验收/测试：变异验证（在 (a) 透传落地后）——删 `:231` 判据后 **T-A4b 必红**：`/w.md` 走 `:289+` 分支 `cached.body`="1|WORKPLACE-FULL"（16 字）→ `tryConsume(16)` 于 used=100000 → next=100016 > 100000 → false → 降级 → `:1504`/`:1505` 双红；**T-A4 照绿**（filename 档 0 字恒过）。正常态（含 (a) 透传后）两用例全绿；透传本身零行为变化由「正常态全绿 + 既有 T-A 组全绿」兜底。
- 来源：review-scope-r2-attach round 1；变异靶点经 spec-check-loop r3 重写（原 `:231` 靶点不可达）

### r1r3/B-1 [P2] highlighted 分支 mermaid 未豁免语言标（口径不对称）
- 维度：B
- 文件：`apps/mobile/src/components/rich-content/prepare-transcript-rich-html.ts:84-86`
- 问题：`copyBtn` 两分支都按 `isMermaid` 豁免，语言标只豁免了未高亮分支（`:92` 早返回）；highlighted 分支 label 无脑回落 `plain`。当前注册表无 mermaid 打不着，但一旦注册（或换 bundle），MF-1「图表链路无语言标」即破。
- 改法：`:85` 改一行三态 `const label = isMermaid ? "" : normalized ? \` data-lang="${normalized}"\` : ' data-lang="plain"';`
- 验收/测试：现有 T-L1/T-L2/T-L4 全绿不变；新增（可选）一条「normalized 命中 + isMermaid=true 时无 data-lang」的纯函数级断言。
- 来源：review-scope-r1r3 round 1

### r1r3/C-1 [P2] prompt-block.ts 空壳死文件
- 维度：C（死代码）
- 文件：`packages/core/src/domain/prompt/model/prompt-block.ts`（整文件）
- 问题：删 `PromptBlockLifecycle` 后零导出、零引用（`git grep prompt-block -- packages apps` 仅命中自身 `@module` 行），纯注释空壳。
- 改法：`git rm packages/core/src/domain/prompt/model/prompt-block.ts`。
- 验收/测试：core `npm test` 全量 + desktop/mobile typecheck 零新红。
- 来源：review-scope-r1r3 round 1

### r1r3/C-2 [P2] 三份逐字相同的 schema 常量
- 维度：C（DRY）
- 文件：`packages/core/src/domain/agent/model/agent-definition.schema.ts:40-62`
- 问题：`persistTextBlockValueSchema` / `dynamicTextBlockValueSchema` 逐字相同（同 preprocess + 同 strict object），`persistBlockValueSchema` 又是别名——三份零差异。
- 改法：抽 `const textBlockValueSchema = z.preprocess(stripLifecycleKey, z.object({...}).strict());`，三个原名改为该常量别名（不动 import 面）。
- 验收/测试：`agent-definition.test.ts` L10-Z 系全绿（strip 四态断言不因收敛而变）。
- 来源：review-scope-r1r3 round 1

### r1r3/A-1 [P2] 「生命周期」用户可见文案残留
- 维度：A（双端文案）
- 文件：`packages/core/src/config-forms/agent/agent-editor-state.ts:147`；消费方 desktop `AgentEditorView.tsx:1149`、mobile `PersistBlocksCard.tsx:157`；测试 `packages/core/test/config-forms/agent-editor-state.test.ts:66-68`
- 问题：`persistRegionHint: "持久区禁止宏与生命周期。"`——lifecycle 概念已下线，用户读到困惑，属 R3 漏网的可见文案。
- 改法：改「持久区禁止使用宏。」；同步测试等值断言两行。
- 验收/测试：`agent-editor-state.test.ts` 绿；双端编辑页 hint 显示新文案（e2e/手测一眼）。
- 来源：review-scope-r1r3 round 1

### r2/C-1 [P2] builtin-tool-context.ts 注释漂移（预算筛选已退役）+ CLI 边界显式化
- 维度：C（文档漂移）
- 文件：`packages/core/src/domain/tool/builtin/builtin-tool-context.ts:41-43`；另 `packages/core/src/domain/chat/logic/attach-budget.ts`（模块头注释补一句）
- 问题：`RunChildAgentOptions.attachments` 注释仍写「预算内物化 + 预算筛选」，机制已退役（现全量挂载）。另：CLI `nm prompt render` 不走 prepare（attach 恒 content:null），这条边界无人写明。
- 改法：注释改「`fileAttachment` 全量物化出的附件（`attachmentsFromPaths` 合规形态），随子 session 首条 user 消息落库；体积预算与降级由子会话自己的 prepare 链负责」；`attach-budget.ts` 模块头补「CLI `nm prompt render` 不走 prepare，附件不 hydrate——预算只覆盖实发/预览/token 三链」。**注：与 r2/C-3 同改 `attach-budget.ts` 模块头，两批注释一句话各不重叠，同 commit 合并执行。**
- 验收/测试：纯注释，typecheck 即可。
- 来源：review-scope-r2-attach round 1（open_question 1 的默认动作）

### r2/C-2 [P2] 死机制注释 + 恒真断言（旧映射闭包）
- 维度：C
- 文件：`packages/core/test/service/agent/subagent-task-session-attach.test.ts:544-669`
- 问题：describe 标题「真实 VfsContentSize 映射（G-2）」与「牙齿：映射若把 inline 当 blob…」注释描述的映射闭包（run-agent-turn 的 getContentSize 注入）已删；`:667` 的 `doesNotMatch(/超出附件预算/)` 恒真。
- 改法：推荐整条 describe 删除（存在理由就是钉那层映射）；若保留则改写标题与注释为「遗留 inline 行附件照常全量挂载」的普通回归用例并删恒真断言。
- 验收/测试：core 定向该文件绿；全量零新红。
- 来源：review-scope-r2-attach round 1

### r2/B-1 [P2] legacy `<file>` 外壳计量含行号前缀（口径与 spec 不一致）
- 维度：B（计量口径）
- 文件：`packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts:266`
- 问题：spec Step 4 写「按原始明文 length 计（忽略行号前缀开销）」，存量分支传的是 `stripLegacyFileWrap` 后的 `fileBody.length`——旧 `<file>` 外壳内层已带 `1|xxx` 行号，计量系统性偏高；读盘分支是纯明文，两出口口径不一致。
- 改法：legacy 分支按行剥前缀求和——`wasLegacyFile` 时 `fileBody.split("\n").reduce((n, l) => n + stripLinePrefix(l).length, 0)`（`stripLinePrefix` 若无现成则内联 `/^\d+\|/` 剥离）。
- 验收/测试：新增小用例——legacy `<file>` 外壳包 2 行各 10 字正文，前面已挂满预算附件，断言该附件不降级（若按含行号计量会差 4 字符而降级）。
- 来源：review-scope-r2-attach round 1（spec deviation「原始明文计量」转闭合）

### r2/C-3 [P2] attach-budget 死面（used getter / limit 形参）+ 语义注释
- 维度：C
- 文件：`packages/core/src/domain/chat/logic/attach-budget.ts:27-28, 37-39`
- 问题：`used` getter 全仓零读取；`createAttachBudget(limit)` 形参零调用方传入。另「超限项不占预算（tryConsume 失败不动 used）」语义是本迭代有意翻转（旧子会话链是 exhausted sticky），无人写明。
- 改法：`limit` 形参删掉；`used` getter 删掉或留并加注释「仅供将来观测/调试」；模块头补注释「超限项不占用预算——降级后不注入正文；与已退役子会话链的 exhausted-sticky 语义相反，为有意设计。workplace 常驻前缀 full 档不经 prepare 累加器（走 assemble 链 `loadOrFillFileCache` 直连），不计预算，为 spec Step 4 拍板的设计」。
- 验收/测试：core typecheck + attach 相关定向测试绿。
- 来源：review-scope-r2-attach round 1（open_question 3 的默认动作）

### r2/C-4 [P2] consumeAttachBudget 命名语义反向
- 维度：C（命名）
- 文件：`packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts:225-234`（消费点 `:266`、`:311`）
- 问题：返回 `true` 表示「超限」，与 `AttachBudget.tryConsume` 返回 `true`=计入成功 相反，读调用点需反向脑补。
- 改法：改名 `isOversizedAttach(attachment, plainLength, budget)`。
- 验收/测试：typecheck 绿（两消费点同步改）。
- 来源：review-scope-r2-attach round 1

### r2/G-3 [P2] 双端测试硬编码 100_001
- 维度：G / C（DRY）
- 文件：`apps/desktop/test/session-prompt-input.service.test.ts:149`、`apps/mobile/__tests__/session-prompt-input.service.test.ts:333`；导出面 `packages/core/src/public/chat.ts` + 快照 `packages/core/test/package-exports/snapshots/public-chat-allowlist.json`（注意：按 subpath 命名取 `public-${name}-allowlist.json`，**不是** prompt 那份）
- 问题：两端各硬编码一份 `100_001`，预算调整时以「不降级」红脸告终、根因在 core。
- 改法：`ATTACH_PROMPT_CHAR_BUDGET` 加进 `packages/core/src/public/chat.ts` 导出 + `public-chat-allowlist.json` 快照补条目；两端测试改 `ATTACH_PROMPT_CHAR_BUDGET + 1`；**同步删除两端测试里「该常量目前未从 public 子路径导出…按约定不改 core 导出面」的旧注释**（desktop `:141-148`、mobile `:325-332`）——改 import 后该注释与新代码自相矛盾。
- 验收/测试：`test/package-exports` 快照用例绿；双端 session-prompt-input 定向绿。
- 来源：review-scope-r2-attach round 1；快照路径经 review-full round 3 修正

### r2/G-4 [P2] 跨消息预算累加无用例
- 维度：G（覆盖缺口）
- 文件：`packages/core/test/chat/prepare-user-messages-for-prompt.test.ts`（新增用例）
- 问题：「m1 附件吃满预算 → m2 附件降级」这个累加器跨消息共享（作用域在 `prepareUserMessagesForPrompt` 函数体）的最直观场景零覆盖。
- 改法：新增——m1 挂 `ATTACH_PROMPT_CHAR_BUDGET` 字符 `/a.md`（计入成功拉满），m2 挂 1000 字符 `/b.md`，断言 m2 body 含 `文件过长，可用 read` 且不含 `1\|BBBB`。
- 验收/测试：新用例绿；与 r2/G-2 改法共享「恰好拉满」造数。
- 来源：review-scope-r2-attach round 1

### r2/C-5 [P2] noteText/oversized 分支互斥靠隐式推导
- 维度：C（耦合）
- 文件：`packages/core/src/domain/chat/logic/prepare-user-messages-for-prompt.ts:185-200`
- 问题：`fileRefAction` 里 `noteText` 分支先于 `oversized`，互斥性靠「filename 档 ⟺ image/binary ⟹ 不计量」隐式维持，一侧判据改动即静默丢降级。
- 改法：两分支上方补注释写明互斥依据；或在 `hydrateFileFull` 先算 `oversized` 再互斥组装。推荐前者（零行为风险）。
- 验收/测试：注释级，typecheck。
- 来源：review-scope-r2-attach round 1

### r4/B-1 [P2] 非 assistant 轮 body 与 items 双份下发（payload 重复）
- 维度：B / C-orch；含 spec 修订
- 文件：`apps/desktop/src/main/ipc/handlers/prompt.ts:31-46`、`apps/desktop/shared/ipc-types.ts:918-925`、`apps/desktop/renderer/features/chat/RealPromptPanel.tsx:211`（**一处 `?? ""` 收口，非零改动**）、`docs/Iterations/ui-prompt-fixes-2026-10/spec.md:75`（同步一句）
- 问题：非 assistant 轮的 `body` 是同轮 items 的前缀行拼接版，模板区（workplace 文件树、persist 人设、user 多段）在 IPC 传两份；spec「payload 不近似翻倍」只在 assistant 轮兑现。DTO `body` 必填导致 handler 只能全带。
- 改法：`PromptPreviewTurnDto.body` 改 `readonly body?: string`；handler 只对 `kind === "assistant"` 带 body——**items 三元保持现有源码形态 `turn.kind === "assistant" ? {} : { items: … }`（body 用独立展开叠加），不要并进同一三元**（`real-prompt-panel-rounds.test.tsx:379-382` 有正则锁 assistant 分支为空对象，并进去当场红；若确要并三元则同步改该断言）；`RealPromptPanel.tsx:211` 的 `value={detailTurn.body}` 改 `value={detailTurn.body ?? ""}`（assistant 轮恒带 body，兜底仅类型收口）；spec.md:75 payload 策略句同步修订为「非 assistant 轮不带 body（renderer 该分支只消费 items），assistant 轮带 summary+body 不带 items」。⚠️ 此条涉及 spec 文档修订，执行前见 Open questions 待拍板，用户不确认则按「已豁免」处理。
- 验收/测试：desktop typecheck 绿（含三处可编辑调用方零改动）；`real-prompt-panel-rounds.test.tsx` 补一条——构造 template/user 轮 payload 不含 body，面板渲染正常（现有用例数据天然覆盖 assistant 带 body）。
- 来源：review-scope-r4-rounds round 1

### r4/B-2 [P2] 不可达兜底 `?? ""`（空轮暗示）
- 维度：C
- 文件：`packages/core/src/service/prompt/prompt-preview-turns.ts:142,148`
- 问题：`group.items[0]?.id ?? ""` 兜底不可达（pushGroup 后必 push item），真发生时产出 `id: ""` 撞 key。
- 改法：改 `group.items[0]!.id` / `group.items[0]!.title`（或显式空轮 continue 守卫）。
- 验收/测试：T-R1~T-R5 定向绿。
- 来源：review-scope-r4-rounds round 1

### r4/B-3 [P2] 模板段分支不置 current=null（隐式不变量）
- 维度：B
- 文件：`packages/core/src/service/prompt/prompt-preview-turns.ts:115-118`
- 问题：模板段 `continue` 时不复位 `current`，靠「模板段只出现在 chat 前后」的隐式布局假设成立；将来 layout 中段插模板段会静默并进上一 assistant 轮。
- 改法：模板分支补 `current = null;` 一行（零风险，行为不变）。
- 验收/测试：T-R1~T-R5 定向绿。
- 来源：review-scope-r4-rounds round 1

### r4/B-4 [P2] PromptAssemblySegment.seq 死字段
- 维度：C；含 spec 一致性
- 文件：`packages/core/src/service/prompt/render-prompt.ts:42`、`packages/core/src/service/prompt/prompt-preview-turns.ts`
- 问题：`seq` 唯一读者是测试断言；spec.md:64 点名要的字段成了挂公开类型的死字段。
- 改法：让 `prompt-preview-turns.ts` 真用起来——**先给 `TurnGroup` 增 `seq?: number` 并在 message 段入组时记录 `segment.seq`**（现状 `toPreviewSegment` 丢弃 seq、`pushGroup("assistant")` 的组上无 seq 可读），然后轮 id 改 `group.seq != null ? \`turn-${group.seq}\` : group.items[0]!.id`（template 轮无 seq 保留段 id 拼法——`render-prompt.ts:270-296` 模板段无 seq、`:312-320` 仅 message 段填），连带 `render-prompt-turns.test.ts` 的 seq 断言从「存在性」升「参与 id」。
- 验收/测试：T-R1~T-R5 定向绿（id 断言相应更新）。
- 来源：review-scope-r4-rounds round 1

### r4/B-5 [P2] mobile service 名实不符（Segments 名返回 Turns）
- 维度：C（命名/两端对称）
- 文件：`apps/mobile/src/services/prompt-preview.service.ts:61`、`apps/mobile/src/screens/stack/RealPromptScreen.tsx:22,56`、`apps/mobile/__tests__/real-prompt-screen-scope.test.tsx:33`
- 问题：desktop 已改名 `buildRealPromptPreviewTurns`，mobile 仍叫 `buildRealPromptPreviewSegments` 却返回轮数组。
- 改法：改名为 `buildRealPromptPreviewTurns`，同步两处消费与测试 mock key（该用例断言调用实参不锁名，改名不破绿）。
- 验收/测试：mobile 定向 `real-prompt-screen-scope` + `prompt-turn-card` 绿。
- 来源：review-scope-r4-rounds round 1

### r4/B-6 [P2] CodeEditorProps 无判别联合
- 维度：B（类型契约）
- 文件：`apps/desktop/renderer/components/ui/CodeEditor.tsx:16,25`
- 问题：`onChange` 与 `readOnly` 独立可选，漏传 onChange 又漏传 readOnly 时静默得到不可编辑编辑器且 tsc 不报。
- 改法：`CodeEditorProps` 改判别联合 `{readOnly: true; onChange?: never; onSave?: never} | {readOnly?: false; onChange: (value: string) => void; onSave?: () => void}`——**可编辑分支必须保留 `onSave?: () => void`**（三处既有调用方 `PromptCollapsibleField.tsx:89`、`SkillDetailView.tsx:358`、`PreviewPane.tsx:434` 全部传 onSave，漏了会三处 typecheck 红）。
- 验收/测试：desktop typecheck 绿；三处既有调用方（PromptCollapsibleField/SkillDetailView/PreviewPane）不改仍编译过。
- 来源：review-scope-r4-rounds round 1

### r4/B-7 [P2] PromptTurnCard 重复计算 + 不可达兜底 + 两端文案不一致
- 维度：C
- 文件：`apps/mobile/src/components/prompt/PromptTurnCard.tsx:42-43`（双算）、`:67`（兜底与文案）
- 问题：`detailTitle(turn.summary)` 算两遍；`turn.summary || '（空轮）'` 不可达（core 保证非空）；role 文案「助手轮」vs desktop「assistant 轮」。
- 改法：`const title = detailTitle(turn.summary)` 提取复用；删 `|| '（空轮）'`；文案与 desktop 对齐——注意 desktop 测试锁了「assistant 轮」文案（`real-prompt-panel-rounds.test.tsx:260`、`:281`），若统一成「助手轮」须连带改这两处断言（取对齐成本低者并在 commit message 注明）。
- 验收/测试：`prompt-turn-card.test.tsx` 绿（若锁了旧文案则同步断言）。
- 来源：review-scope-r4-rounds round 1

### r4/B-8 [P2] PromptTurnRow 的 Fragment key no-op
- 维度：C
- 文件：`apps/mobile/src/screens/stack/RealPromptScreen.tsx:119`
- 问题：非 assistant 分支 Fragment 带 key（keyExtractor 掌 key，no-op），assistant 分支反而无 key——同函数两种写法误导读者。
- 改法：两分支统一不加 key（key 归 keyExtractor）。
- 验收/测试：`real-prompt-screen-scope.test.tsx` 绿。
- 来源：review-scope-r4-rounds round 1

### r4/B-9 [P2] .prompt-turn-card 整套抄 .prompt-segment（hover 需先补基线）
- 维度：C（DRY/样式一致性）
- 文件：`apps/desktop/renderer/styles/shell.css:3875-3886`（对照 `.prompt-segment :3787-3793`）、`apps/desktop/renderer/features/chat/RealPromptPanel.tsx`（assistant 卡 JSX）
- 问题：`.prompt-turn-card` 把 margin/padding/border/radius/background 整套复制只多一条 border-left。注意 `.prompt-segment` **本身没有 `:hover` 规则**（全文件唯一 hover 是 `.prompt-turn-card:hover`）——合并前必须先给 `.prompt-segment` 补 hover 基线，否则 assistant 卡失去 hover 反馈。
- 改法：(a) 在 `.prompt-segment` 块（`:3787-3793`）后补 `.prompt-segment:hover { background: var(--background); }`（两卡 hover 观感统一）；(b) `.prompt-turn-card` 只保留 `border-left: 3px solid var(--primary);` 与 `:role/:preview/:chevron` 三处覆写，删独立 box 复制与自身 `:hover`；(c) JSX assistant 卡同时挂 `prompt-segment prompt-turn-card` 两类。
- 验收/测试：desktop 手测两卡 hover 背景一致、assistant 卡左侧 3px 主色描边保留；`real-prompt-panel-rounds.test.tsx` 绿（若断言类名则同步）。
- 来源：review-scope-r4-rounds round 1；改法经 review-full round 2 重写（原「hover 随 .prompt-segment 原规则」指向不存在的规则）

### r4/G-1 [P2] T-R6 补「assistant 轮即使带 items 也不展开」断言
- 维度：G / C-orch（契约双侧锁定）
- 文件：`apps/desktop/test/real-prompt-panel-rounds.test.tsx`（新增一条用例）
- 问题：契约只验「handler 不下发 items」，没验「renderer 即使收到也不消费」——handler 侧日后放宽，测试不响。（原条目里「注释与断言不符」半条经 review-full 复核不成立——`/onChange=\{/` 与下一条 `/onChange\?:/` 合起来语义完整，不列 must-fix；可选 nit：把 `// onChange 改可选` 注释改 `// 只读态不挂 onChange 回调`。）
- 改法：加一条用例——给 assistant 轮 payload 塞 2 个 items，断言仍只出 1 张 `.prompt-turn-card` 且 `.prompt-segment` 计数不变。**与 r4/B-9 同批执行**：B-9(c) 合并双类名后 `classNodes` 的 className 全等匹配口径需改 `hasClass`（**4 处** `prompt-turn-card` 断言，`:256/:270/:303/:326`），「`.prompt-segment` 计数不变」基线随类名合并同步调整。
- 验收/测试：新用例绿；把 renderer assistant 分支改成展开 items 时该用例红（变异验证）。
- 来源：review-scope-r4-rounds round 1（C-orch 缺口建议）；经 review-full round 2 拆条、round 3 补跨条目协作提示

---

## Spec deviations

| 项 | 状态 | 处置 |
|---|---|---|
| T-L6「sanitize 透传 data-lang 值形态」字面未交付 | **不成立** | review-full 复核实锤：T-L6 已由 `apps/mobile/__tests__/sanitize-rich-html.test.ts:97` 交付（本轮 diff 新增 hunk，`data-lang="plain"` + `code-copy` 断言俱在）；round 1 的 r1r3/G-2 系 scope 误报，已删 |
| Step 4「计量按原始明文 length」legacy 分支含行号 | 转 fixed | 由 r2/B-1 修实现闭合 |
| spec.md:75 payload 策略只对 assistant 轮成立 | 转 fixed | 由 r4/B-1 修 DTO+spec 同步闭合（待用户拍板，见 Open questions） |

## Open questions / 待拍板

1. **r4/B-1 的 body 可选化**（唯一改 spec 行为语义的条目）：推荐执行；若用户倾向「保持 body 必填（渲染兜底方便）」则该条移「已豁免」，spec deviation 按现状收窄记录。
2. **workplace 前缀 full 档两套「文件太大」措辞**：`packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts:235`（inline 档，闸门 `CHARACTER_CARD_MAX_SINGLE_FILE_BYTES`）与 `:247`（blob 档 ×4 折算，闸门 `CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES`）的占位符文案先于 prepare 的 100k 预算命中（闸门在 hydrate 前的 `findContentSize` 判定，预算在 `consumeAttachBudget`）。默认接受现状（两种情况都未注入正文，行为无害）；用户要统一措辞则另立小迭代。
3. **mobile 详情页空正文静默空白**（T-R7-7 已测既定行为）：默认不动。
4. **desktop 详情 Modal 无 focus trap / aria**：与 `PromptCollapsibleField` 既有范式一致，属仓内既有欠账，默认不在本迭代处理。

## 已豁免（用户确认不修）

- **r4/B-1（条件豁免登记）**：若用户对 Open question 1 拍板「保持 body 必填」，本条自动转此处豁免、spec.md:75 deviation 按现状收窄；**用户确认执行前不得跳过本条**。

## 合并后 QA（manual_user）

- 双端编辑页 hint 不再出现「生命周期」字样（r1r3/A-1）。
- desktop 提示词面板：template/user 轮折叠展开与改前视觉一致、assistant 摘要卡左侧 3px 主色描边保留（r4/B-9 重构后）。
- mobile 提示词预览轮结构与 e2e 已验证形态一致（本轮 e2e 四项 PASS 基线）。

## K 节建议（下游执行时闭合）

- worktree 根目录四个未跟踪文件（`tmp-bundle.js`、`tmp-gradle-st.txt`、`tmp-rn-config-err.txt`、`tmp-rn-config.json`）删除（e2e/构建残留，不入库）。
- 全部修完后跑四件套门禁（core `npm test` / mobile jest / desktop test / 双端 typecheck）+ 既有红归因对照（verify-full.md 基线：core 9 / mobile 12 全既有）。

## Fix-Spec Closure

| 项 | 状态 |
|---|---|
| fix-spec-ready | yes（CR loop round 3 复核通过；spec-check-loop 四轮收敛：三轮 No-Go 修订 14+7+3=24 处全部落盘、r4 复审 Go） |
| fix_spec_path | docs/Iterations/ui-prompt-fixes-2026-10/cr-fix-spec.md |
| dag_version / review_round | 6 / 4（wave：3×scope → full → full-r3 → spec-check-loop r1/r2/r3 doc-fix → r4 复审 Go） |
| P0 / P1 / P2（已写入 fix-spec） | 0 / 3 / 22（共 25 条；round 1 原 26 条中的 r1r3/G-2 经复核为伪 must-fix 已删） |
| 未写入的开放 must-fix | 0 |
| spec_deviations | T-L6 不成立（已交付）；其余 2 条均有闭合路径（r2/B-1 修实现；r4/B-1 待用户拍板，不确认则按现状收窄） |
| C-orch | ✅ 已查（三链单源收敛验证通过；缺口 r4/G-1 契约双侧锁定已入条目） |
| C 类合并后 QA | 已附（见「合并后 QA」节） |

**执行顺序提示**：r4/B-9 与 r4/G-1 同批执行（类名口径联动）；r2/G-2 与 r2/G-4 共享「恰好拉满」造数；r2/C-1 与 r2/C-3 同改 attach-budget.ts 模块头（注释合并不重叠）；r4/B-2、B-3、B-4 同改 prompt-preview-turns.ts（B-2/B-4 都动 map 段）须同批；其余条目独立可并行。改动面口径：**纯测试/注释条目 7 条**（r1r3/G-1、r2/G-1、r2/G-4、r4/G-1、r2/C-1、r2/C-2、r2/C-5），**动 src 的 18 条**（r2/G-2 经 spec-check-loop r3 修订后含 (a) budget 透传的实现前提——签名加参+两处调用，行为零变化但属 src 改动）——其中 r2/B-1（计量口径变更）、r4/B-4（轮 id 变更）、r4/B-6（类型收紧）、r4/B-1（DTO+spec 变更，待拍板）四条是行为/契约级变更，非局部小改，执行时各自跑对应定向测试面。
