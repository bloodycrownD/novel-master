# web-search-curl CR fix-spec

## 元信息

- repo/worktree：D:/worktree/web-search-curl（branch：feat/web-search-curl）
- base_sha：e6ffe24fb
- head_sha：f34ffcbff0ba2a23d64c21fdfbf38fbf7accd04f（`git rev-parse HEAD` 实测；范围内 2 个 commit：c6a4d8029 refactor(tool/search)、f34ffcbff feat(i18n)，diff 51 文件；r2 复测（2026-11-13）HEAD 未推进、`git diff f34ffcbff..HEAD` 为空，工作区脏文件 2 个：SessionDetailScreen.tsx（r1 即有）与本文件；r3 复测（2026-11-13，本轮 spec-fix 实跑 `git rev-parse HEAD` → f34ffcbff0ba2a23d64c21fdfbf38fbf7accd04f）HEAD 仍未推进（`git log f34ffcbff..HEAD` 空，0 个新 commit）、工作区脏文件仍为上述 2 个）
- prd_path：docs/Iterations/web-search-curl/prd.md
- spec_path：docs/Iterations/web-search-curl/spec.md（v2 透传：spec-v2-passthrough.md）
- review_round：3（r1 见「第 1 轮」节；r2/r3 为复审对账轮，见「第 2 轮」「第 3 轮」节）
- dag_version：1
- 状态：fix-spec-ready（review-final 终态认证通过，2026-11-13，见文末 Fix-Spec Closure）
- **用户拍板（2026-11-13，CR 报告交付后）——以下 4 条决策覆盖本文件相应条目的原改法，fixer 以此为唯一口径**：
  - **A2 paramHint 口径：追认「不限长」**，不恢复 500 双道。修 scope = 把 spec-v2-passthrough §8 与 PRD R5 的「500 字上限」改为「不限长」+ 清掉 `builtin-tool-context.ts:172`、`run-agent-turn.ts:218` 的失真注释 + 删对应死断言。影响条目：`core-exec/A-1`。
  - **A3 schema 方向：追认 params-only（`search(engine?, params)`）**，不恢复四参。修 scope = `prd.md:80`、`prd.md:133`、spec-v2 §6、`iteration-state.yaml:44` 改为新口径 + 补偏离声明。影响条目：`core-search/A-1`、`test-docs/A-1`。
  - **A4 双端对齐：desktop 也收 v3，测试按钮一并退役**。desktop 详情页删 defaultBody 编辑 / `{{apiKey}}` 注入方式快捷选择 / 宏校验（`uses(macro)`）/ 测试搜索按钮，只留 连接（method+url，内置只读）+ 认证三态 + paramHint（内置只读）；`testEngine` 整链退役：core `search-config` 的 `testEngine` store 方法、desktop IPC `handlers/search.ts:147`、invoke-registry、ipc-types 的 TestEngine DTO、desktop UI 入口。**`core-search/B-1`（testEngine `params={}` 对 GET 模板必失败）随其退役自动消解，不再单独修**。影响条目：`ui-copy/A-1`、`core-search/B-1`。
  - **C5 锁定提示：`SessionDetailScreen` 删模型锁定小字是拍板简化**（置灰 + 🔒 足够），不是误删；该未提交改动随本轮一起提交。
- 第 1 轮输入：tmp/cr/findings-{core-exec,core-search,test-docs,ui-copy,global}-r1.json（5 域共 38 条 findings + 24 条 openQuestions，全部 status=open）
- 第 2 轮输入：tmp/cr/findings-{core-exec,core-search,test-docs,ui-copy,global}-r2.json（5 域共 39 条 findings + 24 条 openQuestions；verdict 均 not-ready）
- 第 3 轮输入：tmp/cr/findings-{core-exec,core-search,test-docs,ui-copy,global}-r3.json（5 域共 40 条 findings + 24 条 openQuestions；verdict 均 not-ready）
- 汇总口径：r1 去重/合并 6 条后 32 条独立问题 = 开放 must-fix 28 条（P0=0 / P1=8 / P2=20）+ P3 建议 4 条（记入「K 节建议」，按本文件结构约定不入 must-fix 表）。r2 复审 HEAD 未推进（f34ffcbff）、修复零落地：39 条 findings 中 38 条为 r1 条目逐条复核（全部维持 open，去重并入原条目），新增 1 条 P3 建议 global/G-2（入 K 节）；开放 must-fix 仍为 28 条（P0=0 / P1=8 / P2=20），无一条闭合。r3 复审 HEAD 仍未推进、修复仍零落地：40 条 findings 全部为既有条目回归复核（39 条维持原严重度并入原条目），唯一实质变更：test-docs 域作为文件属主独立复核 global/G-2（mobile 详情测试死重量，r2 记 P3/K 节）并判 P2，按「同文件同维同问题保留最高严重度」升格进 must-fix 表；开放 must-fix 变为 29 条（P0=0 / P1=8 / P2=21），K 节 P3 余 4 条，无一条闭合
- 历史轮次：上一 loop 第 1、2 轮已全部闭合，原文归档于文末（见 iteration-state.yaml cr_round_1 / cr_round_2）

---

# 第 1 轮（v3 复审，2026-11-13）

> 来源：code-review-loop 首轮，5 审查域并行互盲（core-exec / core-search / test-docs / ui-copy / global），verdict 均为 not-ready。
> BASE=e6ffe24fb → HEAD=f34ffcbff。本轮 2 个 commit message 仅写「nm-code-style 收尾」「i18n 迁移」，但实际携带 v3 契约改形（schema 收口 / paramHint 限长废除 / searxng URL 改形 / mobile 功能面收缩）且四处文档声明未同步、无偏离登记——本轮 P1 的主轴。

## Must-fix（按 P0 → P1 → P2）

### P0

无。

### P1（8 条）

#### core-exec/A-1 · [P1] · A · paramHint ≤500 双道拆除且未登记偏离
- **文件**：packages/core/src/service/agent/logic/run-agent-turn.ts:226-245（assembleSearchToolContext）、packages/core/src/domain/tool/builtin/search/types.ts:302-303、packages/core/src/domain/tool/builtin/builtin-tool-context.ts:172-174、run-agent-turn.ts:218-219（失真 JSDoc）
- **问题**：paramHint ≤500「保存拒绝 + 装配期防御截断」双道被整体删除：diff e6ffe24fb..HEAD（commit c6a4d8029）删除 `SEARCH_PARAM_HINT_MAX_LENGTH` 常量与装配侧 `.slice(0, 500)`，grep 全仓 0 命中；types.ts:302-303 仅 trim 且注释改口「paramHint 不限长」；保存路径只扫密钥不扫长度；search-tool.test.ts:455 与 search-config.test.ts:1158 已反向锁「不限长」新口径。而 PRD R5（prd.md:95）、spec.md:18、spec-v2 §8（:62「明确不变」）仍写双道限长；builtin-tool-context.ts:172-174 与 run-agent-turn.ts:218-219 两处 JSDoc 仍宣称「装配期防御性截断 500——此为第二道」（失真注释）。iteration-state.yaml spec_deviations 无此偏离。风险敞口：paramHint 用户可编辑且全链无上限，多引擎时直进系统提示无闸。
- **改法**：二选一并落口径（默认按 a，与待拍板 OQ-A2 联动）：(a) 恢复双道——validateSearchEngineTemplate 对 paramHint 加 ≤500 硬校验（保存拒绝，走 TOOL_SEARCH_TEMPLATE_INVALID）+ assembleSearchToolContext 恢复 `.slice(0, 500)` + search-tool.test.ts:455 / search-config.test.ts:1158 两处测试锁改回截断/拒绝断言；(b) 拍板「不限长」为新口径 → iteration-state.yaml spec_deviations 补登 + PRD R5 / spec.md / spec-v2 §8 补丁式改口径 + 删除两处失真 JSDoc。文档落盘动作统一归 test-docs/A-1。
- **验收**：恢复口径下：T-D1 含「paramHint 超 500 截断/拒绝」断言、保存超长 paramHint 被 reject、六份出厂模板 paramHint 实测 ≤500；偏离口径下：deviations 登记 + 四处文档/注释同步。两方向共同：grep「防御性截断 500」在两文件内不再有失真注释；测试锁与最终口径一致。
- **来源**：core-exec r1/A + core-search r1/A + global r1/A（三域同题，已合并；global 附独立复核证据）

#### core-exec/B-1 · [P1] · B · signal 已 abort 时 ToolRunner.call 仍启动工具副作用
- **文件**：packages/core/src/domain/tool/logic/tool-runner.ts:63
- **问题**：`const work = tool.run(...)` 在竞速 promise（:69-86）构造之前执行，竞速只让调用方 reject、不阻止已启动的 work；runParallel worker 循环（:121-153）在 abort 后仍从队列取下一个 call 走同一入口——一批超过并发数的工具调用中途停止时，剩余调用逐个被启动（写类工具副作用照常落盘）而 outcome 全记「工具调用已取消」；agent-runner.ts:857-861 在 signal.aborted 时 break、session.append 不执行，副作用不落 tool_result（VFS 状态与聊天历史脱节）。
- **改法**：:63 之前加早退（竞速逻辑保留，覆盖 in-flight abort）：`const signal = (ctx as { readonly signal?: AbortSignal } | null | undefined)?.signal;` `if (signal?.aborted) throw toolFailed(name, new Error("工具调用已取消"));` 然后再启动 `tool.run`。
- **验收**：tool-runner-abort.test.ts 新增：① call 进入时 signal 已 abort ⇒ run spy 计数 0；② 20 个调用、并发 8、中途 abort ⇒ abort 后不再发起新 run。
- **来源**：core-exec r1/B

#### core-exec/K-1 · [P1] · K · TEMP-DIAG 诊断包装遗留生产路径
- **文件**：packages/core/src/service/agent/logic/run-agent-turn.ts:247-264（buildSearchContext，装配点 :794 / :1206）
- **问题**：TEMP-DIAG 包装随功能分支遗留：注释自标「定位完成后连同本函数一并删除」（:248-250），:254-256 与 :260-262 两条 searchLog.info 每回合（主+子装配各一次）打印 runtime 键清单（`Object.keys(runtime)`）与快照引擎 id；assembleSearchToolContext 的 keep-public 注释（:225）已被改写为指向这个临时包装。
- **改法**：删除 buildSearchContext 整个函数，两个装配点恢复内联 `...(runtime.searchConfig != null ? { search: await assembleSearchToolContext(runtime.searchConfig) } : {})`；:225 keep-public 注释改回「生产侧两个装配点直接调用」。若「runtime.searchConfig 缺失」问题未定位完，移交对应迭代的诊断任务，不带进合并。
- **验收**：全仓 grep "TEMP-DIAG" 0 命中；正常回合日志无 search 装配 info 输出（合并后 QA-4 手工复核）。
- **来源**：core-exec r1/K + global r1/K（已合并）

#### core-search/B-1 · [P1] · B · testEngine 模板分支 params={} → brave/searxng 测试按钮必失败（本轮回归）
- **文件**：packages/core/src/domain/tool/builtin/search/search-config.ts:766（testEngine 模板分支 :759-772）
- **问题**：testEngine 以 params={} 调 runTemplateEngine，URL 不含 {{query}} 的 GET 模板测试请求不带搜索词。出厂 brave（preset-templates.ts:60）与 searxng（:71）即此形态；baseline（git show e6ffe24fb）两者 URL 含 q={{query}} 自带搜索词，本轮 c6a4d8029 去占位符后回归：Brave 缺 q 必 422、searxng 缺 q 无结果数组——用户配置正确也判失败，PRD「测试搜索通过」验收无法达成。
- **改法**：testEngine 模板分支在 GET 且 url 不含 {{query}} 时并入搜索词：`const params = template.method === "GET" && !template.url.includes("{{query}}") ? { q: input.query } : {}`（或 TestEngineInput 增可选 params 通道、由双端测试按钮按引擎方言传 q——与待拍板 OQ-B6 一并拍板）；search-config.test T-C5 同步补断言。
- **验收**：search-config.test 新增用例：mock fetch 断言 brave 测试请求 URL 含 `?q=test`；searxng（自定义 URL）同理；POST 模板与含 {{query}} 的自定义 GET 模板行为不变（不双发）。真引擎端到端见合并后 QA-1。
- **来源**：core-search r1/B

#### core-search/A-1 · [P1] · A · search 工具 schema 收口为 engine/params，四处文档声明相反且无偏离补登
- **文件**：packages/core/src/domain/tool/builtin/search/search-tool.ts:128-131（inputSchema；派生逻辑 :161-172）；文档面 prd.md:80（R3）、prd.md:133（验收）、spec-v2-passthrough.md:50（§6）、spec-v2 §8、iteration-state.yaml:44、CHANGELOG.md
- **问题**：inputSchema 只剩 engine/params 两参，搜索词/条数在 run 内从 params 派生（q/query/search_query + count/max_results/maxResults 别名，:161-172）；测试已反向锁新形态（T-S1，search-tool.test.ts:200-209）。而 PRD R3/验收写「query 必填、maxResults clamp 1..20」、spec-v2 §6 写「schema 不变：search(query, engine?, maxResults?, params?)」、spec-v2 §8「明确不变」含工具面、iteration-state.yaml:44 自述「工具 schema 不变」——四处声明与实现相反且无偏离补登；commit c6a4d8029 message 自述 refactor 未提 LLM 工具契约变更（git log -S "search_query" 实证唯一落点）。
- **改法**：二选一（默认按 a，与待拍板 OQ-A3 联动）：(a) 文档追认——prd.md R3/验收补丁式 v3 标注、spec-v2 §6 改写收口口径（query/maxResults 并入 params，三别名归一后只喂 {{count}} 占位符与 DDG 客户端截断）、iteration-state spec_deviations 补登（注明测试锁 T-S1）、CHANGELOG search 条目补一句「搜索词在 params」；(b) 恢复 schema 四参（query 必填 + maxResults），T-S1 与搜索词提取逻辑回改。文档动作统一归 test-docs/A-1。
- **验收**：选定方向后 prd / spec-v2 / iteration-state / CHANGELOG 四处口径一致（或反向：inputSchema.safeParse({query:"x"}) 通过）；grep 无「query 必填」「schema 不变」现行口径残留；两侧测试锁与最终口径一致。
- **来源**：core-search r1/A + global r1/A（已合并；global 附跨切面证据）

#### test-docs/A-1 · [P1] · A · v3 契约漂移全面未落盘（文档总账）
- **文件**：docs/Iterations/web-search-curl/prd.md:95 等多处、spec-v2-passthrough.md:62、iteration-state.yaml:44、CHANGELOG.md；对照 packages/core/test/tool/search-tool.test.ts:458 / search-config.test.ts:1157-1163 / preset-templates.test.ts / apps/mobile/__tests__/search-engine-detail-screen-save-reload.test.tsx:13
- **问题**：v3 改形四处与文档矛盾且无登记：① 工具 schema 收口（→ core-search/A-1）；② paramHint 500 双道废除（→ core-exec/A-1）；③ searxng 出厂 URL 完整端点 + needsBaseUrl 判据改形（→ core-search/K-1）；④ mobile 功能面收缩（删 curl 导入、测试搜索按钮、DDG 详情入口、create 预填 defaultBody 字段——mobile 测试自证 v3 口径），而 PRD R2 未分端、验收「mobile 与 desktop 同构可用」已不成立。另外 CR 第 2 轮拍板 3「帮助真源 mobile 逐字同步」已被 v3 双端帮助分叉事实取代而无记录。测试面与实现自洽（新契约已全面改锁），唯文档面完全失真。
- **改法**：① 新建 docs/Iterations/web-search-curl/spec-v3-*.md（或在 spec-v2 追加 v3 节）逐条记录四项改形（含「搜索词/条数移入 params、q/query/search_query 多键探测」）；② prd.md R2/R3/R5/验收做补丁式 v3 标注（照 CR2-10 先例）；③ iteration-state.yaml:44 的 v2 偏离条目追加 v3 勘误（删除/修正「工具 schema 不变」表述）并在 spec_deviations 补登四项；④ CHANGELOG Unreleased search 条目核对 v3 口径（写明 agent 可见影响：engine 参数说明、catalog 描述）。
- **验收**：grep 全套迭代文档不再出现「query 必填」「maxResults clamp」「500 截断双道」「searxng URL 用 {{baseUrl}}」的现行口径表述；iteration-state spec_deviations 含 v3 条目；文档与 search-tool.ts:128-131 / preset-templates.ts:68-75 / mobile 屏现状逐条对得上。
- **来源**：test-docs r1/A

#### ui-copy/A-1 · [P1] · A · v3 功能收缩只落 mobile，desktop 未对齐（双端分叉）
- **文件**：apps/mobile/src/screens/stack/SearchEngineDetailScreen.tsx（全文无 curl 导入与测试搜索区）；apps/desktop/renderer/features/settings/SearchEngineDetailView.tsx:482-518,611-637、SearchEnginesView.tsx:157-160,168-176
- **问题**：mobile create 模式缺 curl 粘贴导入、全端缺测试搜索按钮，与 PRD R2 / spec §5/§8「双端同构、curl 导入非 desktop-only」相悖；desktop 列表 DDG 行仍可进详情页（全行可点 + DDG 只读详情分支仍在），与 mobile v3「DDG 无详情页」相反。实证：grep -rn 'testEngine|curl|Curl' apps/mobile/src 仅命中注释与无关文件；mobile 列表 DDG 点击 return（测试锁 reorder.test.tsx:401「点击无反应」）。
- **改法**：需主代理拍板对齐方向（待拍板 OQ-A4）后派单。建议正向补齐：mobile create 分支加 curl 粘贴导入区（parseCurlCommand 走 @novel-master/core 直连，core-shim 补 export 供测试）、详情页加测试区（searchStore.testEngine 草稿直测 + 前 2 条 JSON 预览，照 desktop runTest 形态；帮助弹窗补第五段 test_quota）；desktop 列表 DDG 行禁点对齐 v3。若拍板反向（mobile 砍两能力、desktop 留 DDG 详情），改走 deviation 通道：iteration-state 补登 + PRD/spec v3 标注 + 帮助文案核对。
- **验收**：按拍板方向：mobile create 页粘贴合法 curl 预填 method/URL/headers、密钥替换 {{apiKey}}；测试按钮草稿直测且不发任何写 IPC；desktop DDG 行点击无反应（或反向拍板后有 deviation 记录）；mobile 帮助弹窗段数与功能对齐。
- **来源**：ui-copy r1/A

#### ui-copy/B-1 · [P1] · B · 预置引擎表单预填出厂模板而非生效模板，既有覆盖静默丢失
- **文件**：apps/desktop/renderer/features/settings/SearchEngineDetailView.tsx:127-138,293-295；apps/mobile/src/screens/stack/SearchEngineDetailScreen.tsx:184-186；契约面 packages/core/src/domain/tool/builtin/search/search-config.ts:691-701
- **问题**：desktop 预置引擎恒取出厂模板（`custom?.template ?? factory`），用户在带 headers/defaultBody 覆盖的预置引擎改表单保存时，patch 按出厂基线 diff（:293-295），core updatePresetOverride 合并 `{...factory, ...overrides, ...patch}`（:693-696）按整键替换——被改字段整键覆盖，既有覆盖内容静默丢失；mobile 只读展示同样失真（显示的不是引擎真正在用的值）。SearchConfigDto.presetOverrides 仅 Record<string,boolean>（presence），UI 无从重建生效模板。
- **改法**：表单预填与 patch 基线统一为生效模板：core readConfig 的 presetOverrides 扩为携带生效模板（或 SearchConfigDto.engines 值加 effectiveTemplate；core 已有 effectiveTemplate() 直接复用），desktop factory 取值改为生效模板、presetDefault 同步使 diff 基线正确；mobile 表单展示同源生效模板（只读字段也显示真实生效值）。若 DTO 扩展被否，备选：预置存在覆盖期间禁编模板字段（提示先恢复默认再编辑），杜绝整键替换丢覆盖。
- **验收**：desktop：对 bocha 先保存一条 headers 覆盖，重进详情页表单应显示覆盖后的 headers；再只改 defaultBody 保存，重进后 headers 覆盖仍在（search-engines-view.test.tsx 补回归锁）；mobile 有覆盖预置的详情页只读字段显示生效值（合并后 QA-2 手工复核）。
- **来源**：ui-copy r1/B

### P2（20 条）

#### core-exec/B-2 · [P2] · B · curl 入口不检查 ctx.signal 已 abort
- **文件**：packages/core/src/domain/tool/builtin/curl-tool.ts:296-303
- **问题**：对已 aborted 的 signal 注册 listener 不补发回调（WHATWG 语义），run() 无 `parentSignal?.aborted` 早退分支；ToolRunner 修复（core-exec/B-1）后正常链路不会带已 abort signal 进 curl，但工具直调（测试、未来装配点）仍裸露，网络资源占用至 timeoutMs。
- **改法**：run() 创建 controller 之前加 `if (ctx.signal?.aborted) throw toolFailed("curl", new Error(`请求已取消：${normalizedUrl}`));`（normalizedUrl 在该点已可用）。
- **验收**：curl-tool.test 补「预 abort 的 ctx.signal ⇒ fetchFn 未被调用（计数 0）且错误文案为取消」。
- **来源**：core-exec r1/B

#### core-exec/G-1 · [P2] · G · tool-runner 取消竞速测试缺四类用例
- **文件**：packages/core/test/tool/tool-runner-abort.test.ts:14-48
- **问题**：现仅 2 用例（hang+abort reject、signal 缺省不变）；runParallel 的 abort 传播（outcome 记 `{ok:false}`，tool-runner.ts:146-148）与竞速 listener 清理路径（:78-84 removeEventListener）均无用例锁定。
- **改法**：补 4 类用例：① 进入时已 abort ⇒ run spy 计数 0（配合 core-exec/B-1 修复）；② 带 signal 正常完成且同一 controller 连续多次 call（锁定 listener 清理、不积压）；③ runParallel 在 abort 下逐 outcome 记 `{ok:false, error}` 且顺序对齐 calls；④ abort 后 work 才 reject ⇒ 无 unhandled rejection（进程级监听）。
- **验收**：packages/core 的 tool-runner-abort 套件全绿（npm run --prefix packages/core test 口径）。
- **来源**：core-exec r1/G

#### core-exec/K-2 · [P2] · K · 注释引用已删除的 formatSkillLoadOutput（悬空引用）
- **文件**：packages/core/src/domain/tool/logic/skill-read-truncation.ts:96
- **问题**：format-tool-output.ts 本轮将 formatSkillLoadOutput 删除并内联；grep 全仓仅剩该注释命中（「`formatSkillLoadOutput` 只吃 path/content/truncated/files，故这里也不返回」）。
- **改法**：注释措辞改为「formatToolOutputForLlm 的 skill load 分支只吃 path/content/truncated/files，故这里也不返回」。
- **验收**：grep formatSkillLoadOutput 全仓 0 命中。
- **来源**：core-exec r1/K

#### core-exec/nm-style-1 · [P2] · nm-style · check-style signatures 段 4 处 FIND（含 1 处本轮回归）
- **文件**：packages/core/src/service/agent/logic/run-agent-turn.ts:1107-1114、:1254-1262、:198、:279
- **问题**：`node .agents/skills/nm-code-style/scripts/check-style.mjs <6 个域文件>` 输出「check-signatures: 4 处」：:1107 ToolError 错误构造一行被本次 diff 拆成 4 行（回归）；:1254 createAgentRunner 调用、:198/:279 两签名多行为存量形态随搬移保留。
- **改法**：:1107 收一行 `throw new ToolError("FAILED", { key: "error.agent.child_session_busy", params: { child_session_id: childSessionId } }, { toolName: "task" });`；:1254 调用收一行或提命名中间变量；:198/:279 签名各收一行。
- **验收**：重跑 check-style.mjs 对 run-agent-turn.ts signatures 段 0 FIND。
- **来源**：core-exec r1/nm-style

#### core-search/G-1 · [P2] · G · search 取消传播链路零测试锁
- **文件**：packages/core/test/tool/search-tool.test.ts（全文件无取消用例）+ packages/core/test/tool/template-engine.test.ts:255（仅自有超时）
- **问题**：本轮新增的 abort 透传链路（search-tool.ts:179 取 signal、:190/:202 两处「搜索已取消」兜底、template-engine.ts onParentAbort 转发）无用例锁：runner 层锁的是「reject 不等待」，恰恰不覆盖「用户点停止 → 在途 fetch 同步 abort → 不再尝试链上剩余引擎」这一新契约。
- **改法**：search-tool.test 补取消用例：两引擎链上第一引擎请求中途 abort（signal.abort 触发的 mock fetch reject）→ ① run 以「搜索已取消」ToolError 终止（不是链聚合错误、降级链被取消短路）② fetch 收到的 init.signal 已 aborted ③ 第二引擎零请求；template-engine.test 补父 signal 先行 aborted / 中途 abort 的执行器级用例（监听器移除无泄漏顺带断言）。
- **验收**：新用例在 abort 时序提前（abort 于链首请求前）与中途（首个引擎 401 后）两态下都绿；npm test（core tool 域）绿。
- **来源**：core-search r1/G + test-docs r1/G（已合并）

#### core-search/K-1 · [P2] · K · searxng 出厂 URL 改形与 engineBaseUrls 失真未补登
- **文件**：packages/core/src/domain/tool/builtin/search/preset-templates.ts:60,71、search-config.ts:57,350-352,375,397；文档面 spec.md §3/§5 表、spec-v2 §8、iteration-state.yaml
- **问题**：出厂 GET 模板 URL 去占位符（brave 删 {{query}}/{{count}}、searxng 由 `{{baseUrl}}+q={{query}}` 改完整端点）未补登偏离；spec-v2 §1 url「保留不变」声明失真；search-config.ts:57 注释「engineBaseUrls 当前仅 searxng 出厂模板引用」已不成立（出厂零 {{baseUrl}} 引用）。新增 isUnconfiguredSearxng「URL 等于出厂示例即未配置」启发式（:350-352）驱动 needsBaseUrl（:375）与 canRun 特判（:397）；双端 baseUrl 字段可见性改由「草稿是否引用 {{baseUrl}} 宏」判定——机制自洽，但列表页「未设实例地址」标签与详情页无 baseUrl 输入框的信号错位需文案侧复核。
- **改法**：iteration-state spec_deviations 补登「出厂 GET 模板 URL 去占位符/宏（搜索词与条数全走 params；searxng 改完整端点、未配置判定改 URL 等于出厂示例值）」；spec.md §3/§5 表、spec-v2 §8 同步该行；search-config.ts:57 注释改「自定义实例 {{baseUrl}} 模板的实例地址槽位」；列表页标签指引文案核对（点击后用户应改 URL 而非找 baseUrl 框，见 QA-5）。
- **验收**：grep spec-v2 §1 / iteration-state 与新 URL 形态一致；search-config.ts:57 注释更新；出厂 searxng 改 URL 后 canRun 含 searxng（search-config.test 既有断言覆盖）；T-P3/T-P4 保持绿（已随改，无需新动作）。
- **来源**：core-search r1/K + global r1/A（已合并；global 附 needsBaseUrl 信号语义跨切面证据）

#### test-docs/G-1 · [P2] · G · 新增 public 子入口 ./settings 逸出 package-exports 快照纪律
- **文件**：packages/core/test/package-exports/public-subpath-allowlist.test.ts:5-20
- **问题**：本轮 package.json exports 新增 "./settings"（src/public/settings.ts re-export 三类型），但 SUBPATHS 硬编码 14 个子入口无 settings，snapshots/ 目录无 public-settings-allowlist.json——settings 是唯一无锁子入口，未来 export 漂移不被测试捕获。
- **改法**：SUBPATHS 数组追加 "settings"，并新增 snapshots/public-settings-allowlist.json（内容为 collectNamedExports(@novel-master/core/settings) 的排序输出：SettingsMessageDescriptor / SettingsMessageKey / SettingsMessageLike）。
- **验收**：npx tsx --test packages/core/test/package-exports/public-subpath-allowlist.test.ts 全绿，且对 settings 子入口故意加一个假 export 能让测试红。
- **来源**：test-docs r1/G

#### test-docs/G-3 · [P2] · G · 搜索词/条数多键探测边界无用例
- **文件**：packages/core/test/tool/search-tool.test.ts:166-186（「schema：params 缺搜索词」用例）
- **问题**：search-tool.ts:163-169 按 ["q","query","search_query"] 顺序取第一个非空 string、:171 count 三键回落——现测试仅覆盖「全缺失败 + 单键成功路径」；优先序、空白串回退、非字符串忽略、max_results/maxResults 别名均无锁。
- **改法**：在「run 基础行为」describe 补 2 用例：① params:{q:"  ",query:"真词"} → 实际请求搜索词为「真词」（空白串跳过回退）；② params:{q:42,count:"7",max_results:9} → number 优先、字符串 count 忽略、max_results 别名生效（带合法 query 时 DDG count 归一 9 / POST body {{count}} 与 count 同效），锁三键回落优先序。
- **验收**：新断言逐条对应 search-tool.ts:163-172 的分支；改坏探测顺序（如调换 q/query 优先级）时用例红。
- **来源**：test-docs r1/G + core-search r1/G（别名用例部分并入本条）

#### test-docs/C-1 · [P2] · C · reorder 套件头注与用例矛盾
- **文件**：apps/mobile/__tests__/search-engines-screen-reorder.test.tsx:10
- **问题**：头注仍写「行点击导航（DDG / 预置）」，用例已是「DDG 兜底无详情页：点击无反应」（:401-404）——本轮 v3 改造遗留未同步。
- **改法**：头注该行改为「保留项：行点击导航（仅预置 / 自定义实例；DDG 无详情页不导航）、标题栏「?」帮助弹窗、排序写库失败 toast」。
- **验收**：读文件头注与 :401 用例标题口径一致。
- **来源**：test-docs r1/C

#### test-docs/C-2 · [P2] · C · T-C7 首个用例标题 stale（{{baseUrl}} 形态）
- **文件**：packages/core/test/tool/search-config.test.ts:1085
- **问题**：标题仍写「searxng 的 {{baseUrl}} 形态经占位符感知 URL 校验」，v3 起出厂 searxng URL 是完整端点不含 {{baseUrl}}（preset-templates.test.ts:172-173 断言 url 不含任何 {{），占位符感知 URL 校验的 {{baseUrl}} 分支对出厂六模板已无触发者。
- **改法**：标题改为「六份出厂模板全部通过校验（searxng 完整端点 URL 无占位符）」；若需保留 {{baseUrl}} URL 校验覆盖，用例内补一条手工构造 url:"{{baseUrl}}/search" 的 validate 断言（该分支实现仍在 types.ts）。
- **验收**：标题与用例体、preset-templates 现状三方一致；{{baseUrl}} URL 校验分支仍有断言触达（或明确删锁说明）。
- **来源**：test-docs r1/C

#### ui-copy/J-1 · [P2] · J · desktop 预置引擎 Method 下拉未锁定（双端分叉）
- **文件**：apps/desktop/renderer/features/settings/SearchEngineDetailView.tsx:417-430
- **问题**：desktop method select 无 disabled；mobile 同字段预置态锁定（FormChipGroup disabled={nameLocked}）。desktop 把 brave/searxng（GET、URL 含 query 语义）改成 POST 会生成语义坏掉的覆盖模板（模板校验只查 URL 合法性不拦）。
- **改法**：desktop method select 加 disabled={isPreset}（与 mobile 预置锁口径一致；searxng 的 URL 例外放开不受影响，method 仍锁）；desktop 测试套件补一条「预置引擎 method 禁用」断言。
- **验收**：desktop 预置行详情页 Method 下拉禁用；自定义/create 可编辑；search-engines-view.test.tsx 断言 disabled。
- **来源**：ui-copy r1/J

#### ui-copy/J-2 · [P2] · J · 自定义引擎认证形态双端能力不对齐
- **文件**：apps/desktop/renderer/features/settings/SearchEngineDetailView.tsx:543-570（仅注入方式下拉）vs apps/mobile/src/screens/stack/SearchEngineDetailScreen.tsx:470-501（bearer/header 自定义头名/none 三选）
- **问题**：mobile v3 三形态（Authorization Bearer / 任意头名自定义 / 无认证）；desktop INJECTION_OPTIONS 仅三项快捷下拉（只能往 headers 追加），无法表达「无认证」与「Authorization 之外的 Bearer 头」（onChange 只写 headers、无删除/none 路径）。
- **改法**：拍板对齐方向：desktop 下拉补「无认证（移除认证头）」与自定义头名输入（照 mobile 三形态），或认定「desktop 以 headers JSON 手编为准、mobile 三形态为快捷方式」并补登偏离（帮助文案 desktop 侧补一句 headers 手编口径）。
- **验收**：按拍板方向：desktop 能产出 none 认证的自定义引擎（保存后模板 headers 无认证头），或偏离已补登。
- **来源**：ui-copy r1/J

#### ui-copy/C-1 · [P2] · C · mobile 详情屏 DDG 只读分支是死代码，连带死 key
- **文件**：apps/mobile/src/screens/stack/SearchEngineDetailScreen.tsx:392-400；packages/core/src/domain/settings/i18n/keys.ts:49 + settings.{zh-CN,en-US}.json:34（builtin_body.mobile）
- **问题**：全仓唯一 navigate('SearchEngineDetail', {engineId}) 入口在列表屏且 DDG 已被拦（测试锁「点击无反应」），分支不可达；删除后 settings.search.detail.builtin_body.mobile 随之变死 key。
- **改法**：删 SearchEngineDetailScreen.tsx:392-400 分支；builtin_body.mobile 三方同步撤（keys.ts、两 locale JSON）；desktop 侧同 key（builtin_body.desktop）在 desktop DDG 详情仍存活期间保留（若 ui-copy/A-1 拍板 desktop 也砍 DDG 详情，则连 .desktop 一起撤）。
- **验收**：mobile 详情屏无 DDG 分支、typecheck 绿；i18n 三方 key 数一致（153-1=152）；settingsTranslator 无裸 key。
- **来源**：ui-copy r1/C

#### ui-copy/i18n-1 · [P2] · i18n · 一批用户可见文案在模块 import 期求值并永久冻结
- **文件**：apps/mobile/src/screens/stack/search-engine-meta.ts:17-39、SearchEngineDetailScreen.tsx:91-105；apps/desktop/renderer/features/settings/SearchEnginesView.tsx:29-50、search-engine-meta.ts:11-46
- **问题**：ENGINE_LABELS/ENGINE_HINTS/CUSTOM_ENGINE_HINT/AUTH_STYLE_OPTIONS/WRITE_FAIL_MESSAGES/HELP_SECTIONS/ENGINE_META 均为模块顶层 `const = settingsTranslator({...})`，而 settingsTranslator 注释明言「locale 决定权留给后续设置层」——接动态 locale 后这批常量不随语言切换刷新，与其余 render 期调用点形成双态漂移。
- **改法**：把译文求值移到调用点：meta 表改为函数（engineHint(id) 内部翻译）或组件内 useMemo；HELP_SECTIONS 移入组件函数体；至少在「接动态 locale」的任务清单里点名这批模块级常量清单，避免后续只改 translator 漏掉这批。
- **验收**：切换 locale 后列表副标题/认证方式选项/帮助弹窗文案随之变化（或拍板维持 zh-CN 单语并记录，见 OQ-B3）。
- **来源**：ui-copy r1/i18n

#### ui-copy/nm-style-1 · [P2] · nm-style · setEnabled 判 INLINE_LOCAL（1 call / 0 ref）
- **文件**：apps/mobile/src/screens/stack/SearchEnginesScreen.tsx:102
- **问题**：check-style 实跑输出「INLINE_LOCAL …setEnabled 1 call / 0 ref 只有一处外部引用，内联；总结 inline=FIND」；行开关虽带 keep-local 注释（乐观翻转+回滚+togglingRef 互斥不变量），脚本仍要求内联或走报告列明通道。
- **改法**：二选一：把 setEnabled 体内联进 renderItem 的 Switch onValueChange（回滚闭包仍可表达、togglingRef 互斥保留），或按 nm-code-style 交付要求在迭代报告列明 keep-local 保留理由（注释已在，补报告条目即可）。
- **验收**：重跑 check-style.mjs 该文件 inline 段无 FIND，或迭代报告含该保留项。
- **来源**：ui-copy r1/nm-style

#### ui-copy/either-1 · [P2] · either · parseHeaders 以 string 并集当错误通道
- **文件**：apps/desktop/renderer/features/settings/SearchEngineDetailView.tsx:201-211（parseHeaders），调用点 :215-219、:551-555
- **问题**：签名 `parseHeaders(text): Record<string, unknown> | string`（string=错误原因），错误形态未收窄、调用方靠 typeof 判别，违背仓内 Result 化约定（域内其余错误路径均走 Result/IpcResult）。
- **改法**：改判别联合 `{ok:true; headers: Record<string,unknown>} | {ok:false; reason:string}`（或复用仓内 Result 形态），readTemplate 与注入 onChange 两处调用点同步改 .ok 分支。
- **验收**：typecheck 绿；headers 非法 JSON 时两处错误文案行为不变（desktop 测试 :601 用例保持绿）。
- **来源**：ui-copy r1/either

#### ui-copy/G-1 · [P2] · G · mobile 详情页「恢复默认模板」「清除密钥」两条写路径零测试
- **文件**：apps/mobile/__tests__/search-engine-detail-screen-save-reload.test.tsx（用例清单 :323-530）；被测按钮 SearchEngineDetailScreen.tsx:503-517,570-588
- **问题**：mobile v3 重写后 resetPresetOverride 与 clearEngineKey 无任何回归锁（desktop 侧对 reset 有部分覆盖）。
- **改法**：照既有 mockRuntime 模式补 2 用例：① 有覆盖预置点恢复默认 → 断言 resetPresetOverride 调用、toast「已恢复默认模板」、silent 回读；② hasKey 引擎点清除密钥 → 断言 clearEngineKey 调用、toast 含引擎名、回读后按钮消失。
- **验收**：两用例绿且覆盖失败路径（reject 时 WRITE_FAIL_MESSAGES 对应文案）。
- **来源**：ui-copy r1/G

#### ui-copy/E-1 · [P2] · E · desktop buildChatListItems 逐消息重建 tool_result map，O(n²)~O(n³)
- **文件**：apps/desktop/renderer/features/chat/message-blocks.ts:68-90、:175
- **问题**：isTurnToolExecuting 内部对每条 assistant 重建全量 tool_result map（turnToolResultsComplete 内 buildToolResultByUseId），:175 逐消息调用——长会话全量快照构建被放大；mobile 同族已改 O(n) 预扫（buildToolPairingContext，mobile message-blocks.ts:157-195），desktop 未跟进（重构保留原复杂度，非本轮回归）。
- **改法**：照 mobile buildToolPairingContext 移栽：buildChatListItems 预扫一次 results map + lastIncomplete，isTurnToolExecuting 改收 context 的 O(1) 判定版本（desktop DTO 同构，行为锁 isTurnToolExecuting 测试保持）。
- **验收**：desktop message-blocks 相关测试保持绿；长会话（500+ 消息）快照构建不再随 n 平方放大（计时断言或人工核对复杂度）。
- **来源**：ui-copy r1/E

#### ui-copy/K-1 · [P2] · K · 「以 mobile 为真源逐字同步（五段）」注释与测试名已失真
- **文件**：apps/desktop/renderer/features/settings/SearchEnginesView.tsx:23-28（HELP_SECTIONS 注释）+ apps/desktop/test/search-engines-view.test.tsx:445（用例名）
- **问题**：现状 mobile 帮助弹窗四段（无测试配额段，v3 mobile 无测试按钮）、desktop 五段，且 custom_engine 段文案已按端拆 .mobile/.desktop 不同句——不再逐字同源，注释/测试名是旧口径。
- **改法**：注释与测试名改为事实口径：「双端各自 catalog 键；desktop 含测试配额段（mobile 无测试按钮故无此段）」；若 ui-copy/A-1 拍板 mobile 补测试按钮，则 mobile 补第五段后恢复同构并还原同源声明。
- **验收**：注释/测试名与实际渲染段数一致；双端 key 引用各自 .mobile/.desktop 后缀无混用。
- **来源**：ui-copy r1/K

#### global/A-3 · [P2] · A · settings 域 i18n 子系统与 spec §10 口径相反且未登记（51 文件里最大的结构新增）
- **文件**：packages/core/src/domain/settings/i18n/keys.ts（新）、packages/core/locales/settings.{zh-CN,en-US}.json、packages/core/src/public/settings.ts、packages/core/package.json（./settings exports）、apps/desktop/shared/logic/settings-i18n.ts、apps/{desktop/renderer,mobile/src}/i18n/settings.ts（commit f34ffcbff）
- **问题**：153 key 双语真源 + 双端 translator + 6 个 UI 文件全量迁移（213 处调用替换），与 spec.md:177 §10 明文「双端设置页 UI 静态文案硬编码中文——本次延续，不接 MessageDescriptor 通道」方向相反；spec「最终项目结构（Δ）」（:193-221）与 iteration-state spec_deviations 均未登记该子系统（良性方向也须登记）。
- **改法**：iteration-state.yaml spec_deviations 补登一条（方向：settings UI 文案迁入 settings 域双语 catalog，spec §10 口径作废）+ spec.md §10 补「settings.search.* 走 settings 域 catalog（zh/en 双源，双端 translator）」新口径 + Δ 清单补 5 个新文件与 package.json exports 一行。文档动作可与 test-docs/A-1 同波。
- **验收**：spec.md §10 与代码一致；iteration-state Δ/deviations 含全部新文件；npm run --prefix packages/core typecheck 过（exports 子路径类型可解析）。
- **来源**：global r1/A

## Spec deviations（复审发现未登记的偏离，登记动作由对应 must-fix 落盘）

| id | 偏离内容 | 现状 | 登记归属 |
|---|---|---|---|
| DEV-1 | search 工具 LLM 契约收口为 engine/params 两参（query/maxResults 并入 params，多别名探测） | iteration-state:44 反向声明「工具 schema 不变」；spec-v2 §6/§8、PRD R3 未同步 | core-search/A-1 + test-docs/A-1 |
| DEV-2 | paramHint ≤500 双道限长（保存拒绝 + 装配期截断）整体废除 | spec_deviations 无条目；两处 JSDoc 失真 | core-exec/A-1 + test-docs/A-1 |
| DEV-3 | searxng 出厂 URL 改完整端点；「URL=出厂示例即未配置」链判据；engineBaseUrls 仅剩自定义模板可达 | spec.md §3/§5、spec-v2 §1/§8 失真 | core-search/K-1 |
| DEV-4 | mobile 功能面收缩：删 curl 导入、测试搜索按钮、DDG 详情入口、create 预填 defaultBody（双端分叉） | PRD R2/验收未同步；CR2 拍板 3 被事实取代无记录 | ui-copy/A-1 + test-docs/A-1 |
| DEV-5 | settings UI 文案迁入 settings 域双语 catalog（153 key + 双端 translator），spec §10「硬编码中文」口径作废 | spec_deviations 与 Δ 清单均无 | global/A-3 |

## Open questions / 待拍板

> 全部 5 域 openQuestions（24 条）收拢于此，去重合并后 15 条，不进 must-fix。拍板 A 组直接决定 P1 条目的修复路径，优先拍。

### A 组：v3 方向拍板（阻塞 P1 修复路径）

- **OQ-A1（总闸）**：v3 改形（schema 收口、paramHint 不限长、searxng URL、mobile 功能面收缩、auth 三形态、DDG 无详情页、参数说明全屏编辑、砍请求体字段）是否有用户显式指令在案？本轮 2 个 commit message 均未提及。若有指令记录 → core-search/A-1、core-exec/A-1、core-search/K-1、ui-copy/A-1 的改法聚焦文档补登；若无 → 需用户逐项拍板保留或回退。（来源：test-docs oQ1 + ui-copy oQ1）
- **OQ-A2**：paramHint 分岔：恢复 500 双道（a，core-exec/A-1 默认）还是登记「不限长」偏离并同步四处文档（b）？test:455 已反向锁「不限长」说明实现有意，但 PRD/spec-v2 均未修订。（来源：core-exec oQ2）
- **OQ-A3**：schema 分岔：文档追认 engine/params 两参（a，core-search/A-1 默认）还是恢复四参（b）？（来源：global r1/A-1 fix 内嵌分岔）
- **OQ-A4**：ui-copy/A-1 对齐方向：mobile 补 curl 导入 + 测试搜索 + desktop DDG 禁点（正向，建议），还是反向登记偏离？

### B 组：架构 / scope 确认

- **OQ-B1**：create-user-vfs-turn-service.ts:77 是第三个 BuiltinToolContext 装配点，未注入 signal——该入口的工具永不取消；若会跑长耗时 curl/search，停止按钮点不动。是否接线请 owner 确认。（来源：core-exec oQ1）
- **OQ-B2**：core-exec/B-1 早退只挡「进入时已 abort」；工具 run 已启动、signal 后到且工具不监听（纯 VFS 类）时副作用仍会在后台完成——竞速设计把责任交给工具自行透传（curl/search 已接）。VFS 工具链是否也要接 signal 属 scope 外，确认是否立案。（来源：core-exec oQ3）
- **OQ-B3**：双端 settingsTranslator 均固定 zh-CN（与 chat/core translator 同款先例，注释「locale 决定权留给后续设置层」）——en-US catalog 运行时不可达。按先例留待设置层接线，还是本轮登记「双语真源暂无英文出口」口径？（来源：core-search oQ1 + global oQ5）
- **OQ-B4**：core 错误 catalog en-US.yaml 缺 error.tool.search_* 全部 8 键（baseline 同为 0，英文环境走 translator fallback）——基线既有缺口，是否另立条目补键。（来源：core-search oQ2）
- **OQ-B5**：自定义引擎 CRUD 多存储顺序写（KKV×2-4 + SKSP）无事务性，中断可留中间态（读路径归一自愈，SKSP ref 可能残留孤儿）——global 已备案为已知设计而非缺陷；是否需要补偿写/幂等回收。（来源：core-search oQ3 + global oQ②）
- **OQ-B6**：testEngine 对 defaultBody 为空的 POST 自定义引擎测试会发 POST {}（spec-v2 §2 约定行为）——是否给测试按钮开 params 通道，与 core-search/B-1 修法一并拍板。（来源：core-search oQ4）

### C 组：文案 / 一致性建议（不阻塞合并）

- **OQ-C1**：取消文案三处措辞不一致：tool-runner「工具调用已取消」/ curl「请求已取消：<url>」/ search「搜索已取消」（均 LLM-facing 硬编码中文，照 spec.md:177 口径不进 catalog）——是否统一措辞。（来源：core-exec oQ4）
- **OQ-C2**：core 摘要抬头用引擎 id（build-tool-result-block.ts:169 `${output.engine} · 响应文本`），而 CR1 拍板 3 错误文案用引擎显示名——摘要抬头是否也应用显示名。（来源：ui-copy oQ3）
- **OQ-C3**：desktop 列表自定义引擎行无「已配置」标签（configured tag 排除 isCustom），mobile 完整配置时显示——展示口径差异是否有意。（来源：ui-copy oQ4）
- **OQ-C4**：mobile create 预填 headers 含 Content-Type/Accept 但无 defaultBody（v3 无请求体字段），新建 POST 引擎开箱即 POST {}——若 OQ-A4 拍板 mobile 补 defaultBody 编辑则顺带解决，否则确认「依赖 agent 传 params」为可接受口径。（来源：ui-copy oQ5）
- **OQ-C5**：SessionDetailScreen.tsx 未提交改动删除了模型锁定行的内联提示文案（MODEL_LOCK_TOAST hint，agent 行同位 hint 保留）——是拍板简化还是误删？（来源：ui-copy oQ2，联动 K 节 global/K-2）
- **OQ-C6**：潜在 i18n 碰撞（现无活跃触发点）：catalog 文案含字面 {{apiKey}}/{{count}} 样例，而 createTranslator 插值正则为单花括号 /\{(\w+)\}/g（common/i18n.ts:63）——未来含 {{...}} 的 key 一旦传同名 param 会渲成 {{5}} 形态。是否加防御（正则排除后随 } 收尾、或约定此类 key 禁 params + 测试锁）。（来源：test-docs oQ2）
- **OQ-C7**：desktop real-prompt-panel-rounds.test.tsx 的正则锁与源码引号风格强耦合（'toolGroup' → "toolGroup"，本轮已对齐），后续格式化再变会再碎——是否值得改语义解析。（来源：test-docs oQ4）

## 已豁免（复审核对通过 / 明确不判为本轮问题，记录在案）

- **切分完整性核对 PASS**：51 文件 = `git diff --name-status e6ffe24fb..HEAD`（50）+ 工作区 1；对照消费面未见必须同波修改而遗漏的文件——mobile jest.config.js 无需新增映射（@novel-master/core/settings 仅 type import 被 transform 擦除）；mobile navigation/types.ts:45 engineId 已是 string；desktop X1 门禁无违反。（global oQ③）
- **全局一致性核对 PASS**：settings 域 key 三方一致实跑通过（keys.ts 153 = zh-CN 153 = en-US 153，双向差集空、无死键、无跨端误用）；i18n 调用全 descriptor 形态；error.tool.search_* 九个 key 在 keys.ts + zh-CN catalog + generated-catalog 齐备；either/Result 分层符合声明。（global oQ⑦）
- **IPC 五层 parity PASS**：channels → DTO（SearchConfigDto/SearchEngineStatusDto 与 core 同构含 paramHint）→ invoke-registry → client 再导出 → handler-registry → handlers/search.ts 薄封装，全链齐且 engineId 均 string；双端 catalog search 描述逐字一致（CR2-5 已闭合）。（global oQ①）
- **check-style --changed PASS 留痕**：worktree 根目录实跑 PASS（signatures/inline/methods/oop 全 0，exports 段仅 KEEP）；注意 --changed 只扫工作区未提交文件（本次 1 个），已提交范围依赖 iteration-state style-pass: done 记录。（global oQ⑥）
- **style 脚本假阳性备案**：format-tool-output.ts exports 段 oop=REVIEW（MANY_EXPORTS，8 纯函数 0 state）按约定不计入；isReadOutput 等守卫 keep-public 理由（测试直引，curl-tool.test.ts:17 等）经 grep 证实成立。desktop ipc-types.ts ×16 DEAD 与 mobile message-blocks ×3 TEST_ONLY 属类型位置引用/测试直引契约的已知假阳性。ui-copy 批中 handleSave 与 desktop save/runTest/removeEngine 为 KEEP_LOCAL 且注释已点名共享状态，不另立条目。（core-exec oQ5 + ui-copy nm-style-1 附带）
- **testEngine draft+engineId=duckduckgo 组合语义**（draft 优先、不路由 DDG 适配器）已在 TestEngineInput JSDoc :140 声明。（global oQ②附带）
- **CR 第 2 轮拍板 4（custom id 宽度不统一容忍不修）延续有效**，本轮无新证据推翻。

## 合并后 QA（manual_user）

| id | 场景 | 步骤 | 关联 |
|---|---|---|---|
| QA-1 | brave/searxng 测试按钮真实通过 | core-search/B-1 修复后，双端设置页对出厂 brave / searxng（配真实实例）点「测试」，应成功返回预览；再对错误 key 验证失败文案可读 | core-search/B-1 |
| QA-2 | 预置覆盖不丢失（生效模板基线） | desktop 对 bocha 存一条 headers 覆盖 → 重进详情页表单显示覆盖值 → 只改 defaultBody 保存 → 重进后 headers 覆盖仍在；mobile 有覆盖预置的详情页只读字段显示生效值 | ui-copy/B-1 |
| QA-3 | mobile curl 导入 / 测试搜索（按 OQ-A4 拍板方向） | 若正向补齐：mobile create 页粘贴合法 curl 预填 method/URL/headers、{{apiKey}} 替换生效；测试按钮草稿直测且不发写 IPC；desktop DDG 行点击无反应 | ui-copy/A-1 |
| QA-4 | 正常回合日志无 search 装配 info | core-exec/K-1 修复后跑一轮含搜索的对话，日志无 TEMP-DIAG / runtime 键清单输出；全仓 grep TEMP-DIAG 0 命中 | core-exec/K-1 |
| QA-5 | searxng 未配置动线自洽 | 出厂 searxng 在列表页显示「未设实例地址」标签 → 点进详情页应引导改 URL 字段（非找 baseUrl 输入框）→ 改 URL 后 canRun 恢复 | core-search/K-1 |
| QA-6 | 工作区干净 | 合并前 `git status`：SessionDetailScreen.tsx 已按归属拍板处理（独立 style commit 或还原），不随本迭代合并提交携带 | global/K-2 |
| QA-7 | 三端终检 | npm run --prefix packages/core typecheck + test、desktop/mobile typecheck + 相关套件、check-style 触达路径（按仓 qa 口径） | 全部 |

## K 节建议（P3 条目与卫生类建议，不阻塞合并）

> 结构约定：must-fix 表只收 P0/P1/P2，P3 findings 记录于此，字段与 must-fix 同构。

#### global/nm-style-1 · [P3] · nm-style · barrel 假公开（四符号生产零消费）
- **文件**：packages/core/src/index.ts:169
- **问题**：readSearchConfig / resolveEngineChain / SEARCH_KKV_MODULE / searchApiKeyRef 四个具名导出生产零消费（双端只走 store 方法/工厂；core 测试全部直连模块路径 import）；keep-public 注释以「测试直引」为由违反 nm-code-style「测试/allowlist 不算消费者」规则。
- **建议**：index.ts:169 收敛为 `export { createSearchConfigStore }`（类型行不动）；四符号保持模块级 export（测试直连路径消费）；同步更新 packages/core/test/package-exports/snapshots/main-entry-allowlist.json。
- **验收**：main-entry-allowlist 快照测试绿；grep 双端无 barrel 消费断言失败。
- **来源**：global r1/nm-style

#### global/G-1 · [P3] · G · 「失败摘要首行化 + 120/117 截断」7 处魔法数拷贝
- **文件**：apps/desktop/renderer/features/chat/message-blocks.ts:118,126 + apps/mobile/src/components/chat/message-blocks.ts:276,284 + apps/mobile/src/web/chat-transcript/webview/runtime/render/tool-logic.ts:27,33 + packages/core/src/domain/tool/logic/build-tool-result-block.ts:287
- **问题**：同语义实现在本轮从每文件 1 份翻倍到 2 份（三端 UI 各自新增 firstLine 变体与既有纯文本变体并排，加 core 持久化侧共 7 处），无共享常量——后续改截断档位必漂移。
- **建议**：抽单一常量/纯函数（如 core common 或 chat 域 `SUMMARY_MAX=120/SUMMARY_CLIP=117` + firstLineOf(summary)），双端 UI 与 webview 经既有通道消费；短期至少在本轮新增三处旁注 keep-local 理由并互指真源。
- **验收**：grep "117" 实现处仅 1 处（或三端各 1 处且注明真源）；三端 tool 卡片摘要回归测试绿。
- **来源**：global r1/G

#### global/K-2 · [P3] · K · 无关的 mobile 会话详情屏风格重构半成品滞留工作区
- **文件**：apps/mobile/src/screens/stack/SessionDetailScreen.tsx（工作区未提交，+49/-148）
- **问题**：与搜索迭代无关的 prettier-200 重排 + runManualCompaction hooks 提取（ManualCompactionHooks 类型已存在、可编译、check-style --changed PASS）滞留本迭代工作区，易被误并入搜索分支收尾 commit。
- **建议**：归属拍板：单独 style commit（注明 style-only、不混入搜索迭代）或 checkout 还原；不随 web-search-curl 合并提交携带（见 QA-6）。MODEL_LOCK_TOAST hint 删除是否有意见 OQ-C5。
- **验收**：git status 干净或该文件以独立 style commit 落盘。
- **来源**：global r1/K

#### global/K-3 · [P3] · K · 未知 id 展示名兜底双端语义分叉
- **文件**：apps/desktop/renderer/features/settings/search-engine-meta.ts:51-53 vs apps/mobile/src/screens/stack/search-engine-meta.ts:49-55
- **问题**：desktop engineLabel 未命中返回空串、mobile engineTitle 未命中返回原始 id——读模型 name 恒非空故兜底实际不可达（观察级），但双端注释均自称「同构口径」，口径其实不同。
- **建议**：二选一统一（建议 mobile 语义：兜底显 id 优于空白行）；或改注释明说「兜底语义双端有意不同」。
- **验收**：双端 engineLabel/engineTitle 未命中分支返回值一致（或注释声明分叉）。
- **来源**：global r1/K

**卫生类建议（非 findings，随手项）**：
- 失真注释/标题订正类条目（core-exec/K-2、test-docs/C-1、test-docs/C-2、ui-copy/K-1，加上 core-search/K-1 与 global/A-3 内的注释同步）建议合并给单一 agent 串做，避免多 agent 碰同批文档。
- TEMP-DIAG 若「runtime.searchConfig 缺失」问题未定位完，移交对应迭代诊断任务，不带进合并（core-exec/K-1 内嵌约定）。

---

# 第 2 轮（复审对账，2026-11-13）

> 来源：code-review-loop 第 2 轮，5 审查域并行互盲（core-exec / core-search / test-docs / ui-copy / global），verdict 均 not-ready。
> 复审前提：HEAD 仍为 f34ffcbff（与 r1 同 commit，`git diff f34ffcbff..HEAD` 为空），fix-spec（r1 稿）已收编全部 r1 findings 但 fix 波尚未派单——本轮性质是「对账轮」：39 条 findings 中 38 条为 r1 条目逐条复核（全部维持 open、无一条闭合），新增 1 条 P3 建议（global/G-2）。r3 在修复 commit 落盘后按本节对账单回归。

## Must-fix（按 P0 → P1 → P2）

> r2 无新增 P0/P1/P2、无闭合项：第 1 轮 28 条开放 must-fix 全部维持 open，条目全文（文件/问题/改法/验收/来源）以第 1 轮为准，本节只记复核要点。下表即开放项对账单，r3 以此逐条对账。

### P0

无。

### P1（8 条，全部维持 open）

| id | r2 复核要点（证据均在 f34ffcbff 上实测） | status |
|---|---|---|
| core-exec/A-1 | `grep -c SEARCH_PARAM_HINT_MAX_LENGTH` types.ts / run-agent-turn.ts 均 0；:236 `paramHint: engine.paramHint` 无 slice；types.ts:227 注释仍「不限长」；search-tool.test.ts:455 反向锁仍在；两处失真 JSDoc（run-agent-turn.ts:218、builtin-tool-context.ts:172-173）仍在；spec_deviations 仍无条目 | open（维持） |
| core-exec/B-1 | tool-runner.ts:58-66 仍 `const work = tool.run(...)` 先于任何 aborted 检查；runParallel worker（:121-153）abort 后仍从队列取下一个 call；agent-runner.ts:857-861 abort 时 break 不落 tool_result | open（维持） |
| core-exec/K-1 | grep "TEMP-DIAG" 仍命中 :225 / :248 / :252 / :794 / :1206（本文件独立复核 :225/:248 一致） | open（维持） |
| core-search/B-1 | search-config.ts:766 仍 `runTemplateEngine(template, resolved, input.query, options, {}, globalThis.fetch)`（params 恒空）；preset-templates.ts:60/:71 两 URL 无 {{query}} 未变 | open（维持） |
| core-search/A-1 | inputSchema（search-tool.ts:128-131）仍两参；`git status` prd.md / spec-v2 / iteration-state.yaml 三份零输出 | open（维持） |
| test-docs/A-1 | 四处文档矛盾全在案：search-tool.test.ts:455 与 search-config.test.ts:1158 反向锁、iteration-state.yaml:44「schema 不变」、prd.md:95「≤500 截断」、preset-templates.ts:71 完整端点；r1→r2 唯一进展是本 fix-spec 收编（属计划非修复） | open（维持） |
| ui-copy/A-1 | mobile grep testEngine\|parseCurlCommand 仅命中 search-config.store.ts:6 注释；desktop SearchEnginesView.tsx:154-161 行按钮对含 DDG 的全部 id push 详情页 | open（维持） |
| ui-copy/B-1 | desktop reload 仍 `custom?.template ?? factory`（预置恒出厂）；mobile :184-186 仍直取 PRESET_TEMPLATES；core updatePresetOverride 合并语义未动 | open（维持） |

### P2（20 条，全部维持 open）

| id | r2 复核要点 | status |
|---|---|---|
| core-exec/B-2 | curl-tool.ts:296-303 仍无 `parentSignal?.aborted` 早退分支 | open（维持） |
| core-exec/G-1 | tool-runner-abort.test.ts 仍 2 用例（`grep -c "it("` = 2） | open（维持） |
| core-exec/K-2 | grep formatSkillLoadOutput 仍命中 skill-read-truncation.ts:96（dist 产物随源码消失，无需单独处理） | open（维持） |
| core-exec/nm-style-1 | 复跑 check-style.mjs：signatures 段 4 处 FIND（:1107 / :1254 / :198 / :279）不变；inline/methods 段 0 新 FIND（4 处 KEEP_LOCAL 均有 keep-local 注释） | open（维持） |
| core-search/G-1 | grep「已取消\|max_results\|maxResults」search-tool.test.ts 仅 :304 注释命中；取消分支/别名仍零断言 | open（维持） |
| core-search/K-1 | preset-templates.ts:71 完整端点未变；search-config.ts:57 失真注释原样；三份文档零输出 | open（维持） |
| test-docs/G-1 | `grep '"settings"'` allowlist.test.ts 0 命中、snapshots 无 settings 快照文件 | open（维持） |
| test-docs/G-3 | grep `q:"  "` / max_results 输出空，优先序/空白回退/别名仍无用例 | open（维持） |
| test-docs/C-1 | reorder.test.tsx:10 头注原样、:401 用例未变 | open（维持） |
| test-docs/C-2 | 标题仍 stale；r2 行号修正：r1 记 :1085，实际 :1083（本文件复核 grep 一致） | open（维持） |
| ui-copy/J-1 | :417-431 select 块仍无 disabled 属性 | open（维持） |
| ui-copy/J-2 | INJECTION_OPTIONS 仍仅 :72 三常量、:549/:563 消费，无 none/删除路径 | open（维持） |
| ui-copy/C-1 | :391-400 DDG 只读分支原样在；navigate 入口与列表拦截未变 | open（维持） |
| ui-copy/i18n-1 | meta 表仍模块顶层 settingsTranslator 求值；desktop HELP_SECTIONS 仍 :29 模块常量 | open（维持） |
| ui-copy/nm-style-1 | 复跑 check-style：INLINE_LOCAL（setEnabled 1 call / 0 ref）FIND 不变 | open（维持） |
| ui-copy/either-1 | parseHeaders 签名与 string 返回路径原样（:200-211） | open（维持） |
| ui-copy/G-1 | grep 恢复默认/清除密钥/reset/clear 仅命中 mock 装配（:193/:201）与按钮定位注释（:126），无断言用例 | open（维持） |
| ui-copy/E-1 | 该文件无工作区改动、无新 commit，O(n²)~O(n³) 状态未变 | open（维持） |
| ui-copy/K-1 | :23-28 注释仍称「五段」勿漂移；mobile 四段（:300-303）未变 | open（维持） |
| global/A-3 | spec.md:177 原文未动；iteration-state 无 settings 域条目（grep 0 命中） | open（维持） |

## Spec deviations（r2 复核）

无新增偏离。DEV-1..5（第 1 轮表）经 r2 复核全部未落盘：三份迭代文档 git status 零输出、spec_deviations 无 v3 条目、两处失真 JSDoc 原样——登记动作仍由对应 must-fix 随 fix 波落盘。

## Open questions / 待拍板（r2）

待拍板附录（第 1 轮 15 条）本轮不增不减，全部仍悬置；r2 各域 openQuestions（24 条）经比对均为对既有 OQ 的重申或留痕，无新分岔。三条 r2 备注挂账：

- **闭合判据（r2 共识，适用于全部 28 条开放项）**：r2 各域以「fix-spec 条目 + 代码现状」双证判定，HEAD 未推进且域内文件 git 干净 ⇒ 维持 open；r3 在修复 commit 落盘后按第 1 轮条目逐条对账闭合。
- **global/G-2（本轮新 P3）处置挂 OQ-A4**：拍「正向补齐」→ mobile 详情测试文件头描述与 testEngine mock 转为现役回归锁载体（补 FIX-1 分流 / FIX-27 错误红真实断言）；拍「反向砍能力」→ 删 mockTestEngine 三处死重量 + 文件头改写 v3 口径。两方向都要求文件头不再宣称不存在的回归锁；fix 波派单 ui-copy/A-1 时把该测试文件列入同一读取集。
- **SessionDetailScreen.tsx 定性（core-exec r2 观察）**：该工作区改动（197 行）经查为 mobile 设置页 import 收口与 manual-compaction 服务类型整理，不触及 core 取消面契约，不进 core-exec findings；MODEL_LOCK_TOAST 内联提示删除的归属拍板仍见 K 节 global/K-2 + OQ-C5。

## 已豁免（r2 重跑 PASS 留痕）

- **fix-spec 收编完整性审计 PASS**：r2 复核本文件（r1 稿）元信息自述「38 条 findings + 24 条 openQuestions」与 tmp/cr/findings-*-r1.json 实数一致（core-exec 7/5、core-search 5/4、test-docs 6/4、ui-copy 11/5、global 9/6）；global 9 条全部可追溯（3 条并入他域 P1、1 条独立 P2、searxng 入 core-search/K-1、4 条入 K 节）；OQ 全部承接。（global r2 oQ②）
- **check-style --changed r2 复跑 PASS**：worktree 根目录 `node .agents/skills/nm-code-style/scripts/check-style.mjs --changed` → PASS（signatures/inline/methods/oop 全 0、exports KEEP=1）；--changed 仅扫工作区未提交文件的口径限制与 r1 相同，已提交范围沿用 r1 记录。（global r2 oQ④）
- **settings 域 key 三方一致 r2 复跑 PASS**：keys.ts 153 = zh-CN 153 = en-US 153，双向差集全 0。（global r2 oQ⑤）
- **IPC 五层 parity r2 复跑 PASS**：12 channels / 12 invoke-registry / 12 client，handler-registry 绑定与 handlers/search.ts 实现在位；either/Result 边界与 i18n descriptor 形态因代码零变更沿用 r1 实证（HEAD 同 commit）。（global r2 oQ⑤）

## 合并后 QA（r2）

QA-1..7（第 1 轮表）全部未触发——r2 零修复落地，无一项可执行；表不增不减，待 fix 波落地后由 r3 复核执行情况。

## K 节建议（r2 新增 1 条；第 1 轮 4 条 P3 经复核全部维持 open）

#### global/G-2 · [P3] · G · mobile 详情测试的 testEngine mock 与文件头声明已成死重量（r2 新增）
- **文件**：apps/mobile/__tests__/search-engine-detail-screen-save-reload.test.tsx:2,12-17,21,185,202,335-338；对照生产屏 apps/mobile/src/screens/stack/SearchEngineDetailScreen.tsx
- **问题**：文件头仍宣称「测试请求分流（FIX-1 拍板 1 回归锁）」「测试失败文案错误红（FIX-27）」并 mock+reset testEngine（:185 mockTestEngine、:202 挂进 mockRuntime.searchConfig、:335-338 beforeEach mockReset().mockResolvedValue），但生产屏 grep testEngine = 0（v3 已把 mobile 测试按钮整体删除），11 条 it() 用例（:342-:530，逐一核对标题）无一条触发测试动作——回归锁声明与 mock 均无生产对应物。
- **建议**：随 ui-copy/A-1 的 OQ-A4 拍板联动：拍「正向补齐」→ 文件头描述与 mock 转为现役回归锁载体（补 FIX-1 分流 / FIX-27 错误红真实断言）；拍「反向砍能力」→ 删 mockTestEngine 三处死重量 + 文件头改写 v3 口径。两方向都要求文件头不再宣称不存在的回归锁。
- **验收**：拍板方向落地后文件头声明与 it() 用例一一对应；mock 与生产面一致（有按钮则有 mock 消费，无按钮则无 mock）。
- **来源**：global r2/G（G-10，r2 新增；交叉 ui-copy/A-1，OQ-A4 待拍板）
- **status**：open（r3 升格 P2，见第 3 轮节）

---

# 第 3 轮（复审对账，2026-11-13）

> 来源：code-review-loop 第 3 轮，5 审查域并行互盲（core-exec / core-search / test-docs / ui-copy / global），verdict 均 not-ready。
> 复审前提：HEAD 仍为 f34ffcbff（`git log f34ffcbff..HEAD` 空，0 个新 commit），fix 波仍未派单——本轮性质仍是「对账轮」：40 条 findings 全部为既有条目逐条复核回归，39 条维持原严重度并入原条目（全部 status=open，无一条闭合），唯一实质变更是 global/G-2 的严重度升格（见下）。r4 在修复 commit 落盘后按本节对账单回归。
> 升格说明：test-docs 域作为 mobile 详情测试文件的属主独立复核 global/G-2（r2 记 P3、置 K 节），证实同题并判 P2——「失真的覆盖声明会误导后续 CR/维护（以为 FIX-1/FIX-27 在 mobile 有锁），属测试完整性缺陷而非纯卫生项」；按「同文件同维同问题保留最高严重度」升格进 must-fix 表（条目全文见下方 P2 表尾），K 节不再保留该条目。

## Must-fix（按 P0 → P1 → P2）

> r3 除升格外无新增 P0/P1/P2、无闭合项：第 1 轮条目全文（文件/问题/改法/验收/来源）仍是真源，本节只记复核要点。下表即开放项对账单，r4 以此逐条对账。

### P0

无。

### P1（8 条，全部维持 open）

| id | r3 复核要点（证据均在 f34ffcbff 上实测） | status |
|---|---|---|
| core-exec/A-1 | `grep -c SEARCH_PARAM_HINT_MAX_LENGTH` types.ts / run-agent-turn.ts 均 0；run-agent-turn.ts:236 `paramHint: engine.paramHint`（无 slice）；:218 与 builtin-tool-context.ts:172-173 两处失真 JSDoc 原样；types.ts:227「不限长」注释、types.ts:302-303 仅 trim、search-tool.test.ts:455 反向锁原样；spec_deviations 仍无此偏离；OQ-A2 拍板仍悬置 | open（维持） |
| core-exec/B-1 | tool-runner.ts:58-64 仍 `const work = tool.run(...)` 先于任何 aborted 检查；竞速（:69-86）只让调用方 reject 不阻止已启动 work；runParallel worker（:121-153）abort 后仍从队列取下一 call；agent-runner.ts:857-861 abort 时 break 不落 tool_result | open（维持） |
| core-exec/K-1 | grep "TEMP-DIAG" 仍命中 :225（keep-public 注释）与 :248（函数头注释）；函数体 :252、装配点 :794/:1206 均在 | open（维持） |
| core-search/B-1 | search-config.ts:766 仍 `runTemplateEngine(template, resolved, input.query, options, {}, globalThis.fetch)`（params 恒空）；preset-templates.ts:60/:71 两 URL 无 {{query}} 未变；连续三轮未修 | open（维持） |
| core-search/A-1 | inputSchema（search-tool.ts:128-131）仍两参；git status 显示 prd.md / spec-v2-passthrough.md / iteration-state.yaml 均无工作区改动；OQ-A3 拍板仍悬置 | open（维持） |
| test-docs/A-1 | 四处文档矛盾全在案（域内 13 文件 git status 零输出）：`grep "工具 schema 不变"` iteration-state.yaml:44 原样、`grep "≤ 500 字符"` prd.md:95 原样、「paramHint 不限长」反向锁在 search-tool.test.ts / search-config.test.ts 各 1 处、`grep "searx.example.com"` preset-templates.ts:71 原样；r2→r3 唯一进展仍是本 fix-spec 对账（计划非修复） | open（维持） |
| ui-copy/A-1 | mobile `grep -rn 'testEngine\|parseCurlCommand' apps/mobile/src` 仅命中 search-config.store.ts:6 注释；desktop SearchEnginesView.tsx:154-161 行按钮仍对含 duckduckgo 的全部 engine.id push 详情页；OQ-A4 拍板仍悬置 | open（维持） |
| ui-copy/B-1 | desktop :128 仍 setPresetDefault(factory)（`custom?.template ?? factory` 预置恒出厂）、:293-295 出厂基线 diff 未动；mobile :186 仍 `template = PRESET_TEMPLATES[engineId]`；core updatePresetOverride 合并语义未动 | open（维持） |

### P2（21 条 = 20 条维持 open + 1 条自 K 节升格）

| id | r3 复核要点 | status |
|---|---|---|
| core-exec/B-2 | curl-tool.ts:296-303 仍无 `parentSignal?.aborted` 早退分支（listener 注册原样） | open（维持） |
| core-exec/G-1 | `grep -c "it("` tool-runner-abort.test.ts = 2 不变（hang+abort reject、signal 缺省不变） | open（维持） |
| core-exec/K-2 | `grep -rn formatSkillLoadOutput`（src）仍仅命中 skill-read-truncation.ts:96 注释 | open（维持） |
| core-exec/nm-style-1 | 复跑 check-style.mjs：run-agent-turn.ts signatures 段 4 处 FIND（ARGS :1107 ToolError / ARGS :1254 createAgentRunner / PARAMS :198 assembleSkillsToolContext(3) / PARAMS :279 assembleAgentsToolContext(4)）不变；6 文件全量 signatures=FIND inline=PASS methods=PASS exports=PASS oop=REVIEW（4 处 KEEP_LOCAL 均带注释） | open（维持） |
| core-search/G-1 | `grep -c "已取消"` search-tool.test.ts = 0；max_results/maxResults 仅 :304 注释命中；取消分支与别名派生仍零断言 | open（维持） |
| core-search/K-1 | search-config.ts:57 失真注释原样（sed 实读）；preset-templates.ts 零改动；iteration-state spec_deviations 仍无 v3 URL 改形条目 | open（维持） |
| test-docs/G-1 | `grep -c '"settings"'` allowlist.test.ts = 0；snapshots 目录无 settings 快照文件 | open（维持） |
| test-docs/G-3 | `grep -c 'max_results'` search-tool.test.ts = 0；优先序/空白串回退/非字符串忽略/别名用例仍不存在 | open（维持） |
| test-docs/C-1 | :10 头注原样（「行点击导航（DDG / 预置）」）；:401 用例「DDG 兜底无详情页：点击无反应」未变 | open（维持） |
| test-docs/C-2 | :1083 stale 标题原样（grep 实锚）；preset-templates.ts:71 与 preset-templates.test.ts「url 不含 {{」断言未变 | open（维持） |
| ui-copy/J-1 | :418-425 grep disabled = 0（select 块仍无 disabled）；mobile :448 FormChipGroup disabled={nameLocked} 未变 | open（维持） |
| ui-copy/J-2 | INJECTION_OPTIONS 三常量与 onChange 只写 headers 形态未变（r3 核验该文件无工作区改动、无新 commit） | open（维持） |
| ui-copy/C-1 | :392-400 DDG 只读分支原样在（sed :392-393 确认 `if (engineId === 'duckduckgo')`）；navigate 入口与列表拦截未变 | open（维持） |
| ui-copy/i18n-1 | 四个文件 r3 核验均无改动，模块 import 期 settingsTranslator 求值并冻结形态不变 | open（维持） |
| ui-copy/nm-style-1 | 复跑 check-style.mjs（mobile 9 文件）：INLINE_LOCAL（setEnabled 1 call / 0 ref）FIND 不变 | open（维持） |
| ui-copy/either-1 | :201 签名 `parseHeaders = (text: string): Record<string, unknown> | string` 原样（sed 实读） | open（维持） |
| ui-copy/G-1 | grep resetPresetOverride\|clearEngineKey 过滤 mock 装配后仍零断言用例命中（仅 :193 mockClearEngineKey、:201 resetPresetOverride jest.fn） | open（维持） |
| ui-copy/E-1 | message-blocks.ts 无工作区改动、无新 commit，O(n²)~O(n³) 状态未变 | open（维持） |
| ui-copy/K-1 | :24 注释「以 mobile 为真源逐字」原样（sed 实读）；mobile 四段渲染未变 | open（维持） |
| global/A-3 | `grep -c "不接 MessageDescriptor 通道"` spec.md = 1（:177 原文未动）；`grep -c settings` iteration-state.yaml = 0（deviations 仍无 settings 条目） | open（维持） |
| **global/G-2** | 自 K 节 P3 升格 P2（升格全文见下） | open（升格 P2） |

#### global/G-2 · [P2] · G · mobile 详情测试的 testEngine mock 与文件头声明已成死重量（r3 由 P3 升格）
- **文件**：apps/mobile/__tests__/search-engine-detail-screen-save-reload.test.tsx:2,12-17,185,202,335-338；对照生产屏 apps/mobile/src/screens/stack/SearchEngineDetailScreen.tsx
- **问题**：文件头仍宣称「测试请求分流（FIX-1 拍板 1 回归锁）」（:12）「测试失败文案错误红（FIX-27）」（:17）并 mock+reset testEngine 三处（:185 定义、:202 挂进 mockRuntime.searchConfig、:335 mockReset().mockResolvedValue），但生产屏 `grep -c testEngine` = 0（v3 已删 mobile 测试按钮），11 条 it() 无一条触发测试动作——回归锁声明与整套 mock 均无生产对应物。test-docs r3 属主判语：失真的覆盖声明会误导后续 CR/维护（以为 FIX-1/FIX-27 在 mobile 有锁），属测试完整性缺陷而非纯卫生项。
- **改法**：随 OQ-A4 拍板二选一：拍「正向补齐」→ 文件头与 mock 转现役回归锁载体（补 FIX-1 分流 / FIX-27 错误红真实断言，照 desktop search-engines-view.test.tsx:744/:800 同款用例）；拍「反向砍能力」→ 删 mockTestEngine 三处 + 文件头改写 v3 口径（删「测试请求分流」「错误红」两行声明）。两方向均要求文件头声明与 it() 用例一一对应；与 ui-copy/A-1 同读取集派单。
- **验收**：拍板方向落地后：文件头不再宣称不存在的回归锁；mock 与生产面一致（有按钮则有 mock 消费，无按钮则无 mock）；触达文件 jest 套件绿。
- **来源**：global r2/G（G-10，时记 P3）+ test-docs r3/G（属主独立复核，判 P2；两域事实面一致，severity 分歧按最高严重度取 P2）
- **status**：open

## Spec deviations（r3 复核）

无新增偏离。DEV-1..5（第 1 轮表）经 r3 复核全部未落盘：三份迭代文档 git status 零输出、spec_deviations 无 v3 条目、两处失真 JSDoc 原样——登记动作仍由对应 must-fix 随 fix 波落盘。

## Open questions / 待拍板（r3）

待拍板附录（第 1 轮 15 条）本轮不增不减，全部仍悬置；r3 各域 openQuestions（24 条）经比对均为对既有 OQ（A2/A3/A4/B1/B3/B4/B5/C2/C3/C5/C6/C7）的重申或复核留痕，无新分岔。四条 r3 备注挂账：

- **global/G-2 severity 口径已并轨（r3）**：test-docs r3 oQ 声明该条与 global/G-2 同题、请主代理合并时二选一口径——已按「保留最高严重度」并轨为 P2（见上方升格条目），分歧项就此闭合。
- **循环状态提示（global r3 oQ，维持 r2 判断）**：fix-spec 仍 draft 且 4 个关键 OQ（A2 paramHint 口径 / A3 schema 方向 / A4 双端对齐方向 / C5 锁定提示）均未拍板——global 域 P1 里两条（schema、paramHint）的方向选择直接被 OQ-A2/A3 决定，建议主代理先收拍板再派 fix 波，避免返工。
- **闭合判据（沿 r2 共识）**：r3 全部条目以「fix-spec 条目 + 代码现状」双证判定，HEAD 未推进且各域文件 git 干净 ⇒ 维持 open；r4 在修复 commit 落盘后按第 1 轮条目全文逐条对账闭合。
- **SessionDetailScreen.tsx r3 复查（core-exec r3 oQ，维持 r2 定性）**：diff 中 signal/abort/cancel/stop 关键字 0 命中，仍为 mobile 设置页 import 收口与压缩服务类型整理，不触及 core 取消面，不进 findings；MODEL_LOCK_TOAST 归属拍板仍挂 OQ-C5 + K 节 global/K-2。

## 已豁免（r3 重跑 PASS 留痕）

- **check-style --changed r3 复跑 PASS**：worktree 根目录 `node .agents/skills/nm-code-style/scripts/check-style.mjs --changed` → PASS（signatures/inline/methods/oop 全 0、exports KEEP=1）；--changed 仅扫工作区未提交 1 文件的口径限制与 r1/r2 相同，已提交范围沿用 r1/r2 记录。（global r3 oQ）
- **settings 域 key 三方一致 r3 复跑 PASS**：keys.ts 153 = zh-CN 153 = en-US 153，差集全 0。（global r3 oQ）
- **IPC 五层 parity r3 沿用 PASS**：invoke-registry 12 / client 12 / handler-registry 绑定 24 处在位；either/Result 边界与 i18n descriptor 形态因代码零变更（HEAD 同 commit）沿用 r1 实证。（global r3 oQ）

## 合并后 QA（r3）

QA-1..7（第 1 轮表）全部未触发——r3 零修复落地，无一项可执行；表不增不减，待 fix 波落地后由 r4 复核执行情况。

## K 节建议（r3 复核）

global/G-2 已升格 P2 移入上方 must-fix 表（第 2 轮节保留其 P3 历史稿）；其余 4 条 P3 经 global r3 逐条复核全部维持 open：

| id | r3 复核要点 | status |
|---|---|---|
| global/nm-style-1 | `grep -c readSearchConfig` index.ts = 1（:169 未动），四导出生产零消费不变 | open（维持） |
| global/G-1 | grep 117 三端 UI 文件各 2 处 + core 1 处不变 | open（维持） |
| global/K-2 | `git diff --stat` 仍 +49/-148；lockHint 相关 3 处仍删除态；文件内 MODEL_LOCK_TOAST 仍 2 处（:28 import + :119 showToast） | open（维持） |
| global/K-3 | desktop :52 `?? ""`、mobile :54 `?? engineId` 两行实读未动 | open（维持） |

---

# 归档：上一 loop（base 9d912b6af，全部条目已闭合）

> 状态：第 1 轮 FIX-1..29 全数修复（commit 436b924c5，见 iteration-state cr_round_1；FIX-2 随 v2 透传改造字段消亡）；第 2 轮 CR2-1..13 随本轮 commit 修复（见 cr_round_2）。以下内容原样保留，仅供追溯与本轮「照先例」引用（如 CR2-10 补丁式标注先例）。

## 第 1 轮（已闭合）

> 来源：code-review-loop 首轮（5 审查者并行互盲：scope-core / scope-store / scope-toolsurface / scope-ui / review-global）+ 主代理真机 e2e 实测发现。
> BASE=9d912b6af HEAD=15d5fb5de（修复继续在 feat/web-search-curl 分支追加 commit）。
> 复审目标：本文件全部条目闭合后，第 2 轮复审。

### 主代理拍板记录（可被用户推翻）

1. **P1-1 修法**：按 spec §8 本来定义的 engineId 通道回接——预置引擎且 `presetOverrides[id] === true` 且表单模板与出厂逐字段相等 → 测试请求**省略 draft**（core 合并覆盖 + SKSP 现读）；表单有改动或 key/baseUrl 草稿非空 → 带 draft（草稿直测语义不变）。双端同规则。
2. **curl 多密钥整体拒绝**：维持（简单优先，spec 未约定更复杂语义）。
3. **模板引擎错误文案用引擎显示名**（`template.name`，如「博查搜索」），不用裸 id。
4. **paramHint 扩扫明文密钥**：保存路径（createCustomEngine / updatePresetOverride 的 paramHint 入参）纳入 `findPlaintextSecrets` 扫描（paramHint 流入 agent 可见工具描述，风险面成立）；name 不扫。
5. **预置展示名统一**：双端「读模型 `name` 优先、静态表仅未知 id 兜底」。
6. **iterations.yaml** `in-progress → active`：合并 main 时转（本 CR 不动）。
7. **偏离 #1 收口（双端统一严口径）**：needsKey 模板且无已存 key 且 key 草稿为空 → 保存拦截提示先配 key（mobile 现行为为基准）；非 needsKey 或有 key → 正常保存；本次零写操作（无 patch/无 key/无 baseUrl 变更）→ toast「无改动」。

### must-fix 总表

#### P1

| id | 文件 | 问题 | 改法 | 来源 |
|---|---|---|---|---|
| FIX-1 | desktop `SearchEngineDetailView.tsx:133,337-339`；mobile `SearchEngineDetailScreen.tsx:486,687-693` | 预置引擎有覆盖时「测试」按钮测出厂模板而非生效模板（draft 恒传优先于 engineId；desktop 折叠区「当前使用已保存的自定义覆盖」提示与行为矛盾） | 按拍板 1 判定基线双端改造；UI-only，不扩 DTO/handler | ui/P1-1 |

#### core / types.ts（一个 agent 串做，回归断言落 search-config.test.ts T-C7）

| id | 文件:行 | 问题 | 改法 | 来源 |
|---|---|---|---|---|
| FIX-2 | `search/types.ts:344-353` | `envelope.okValues` 接受空数组 → 执行器「code 有值即失败」全废 | 校验 `values.length === 0 → invalid` | core/P2-3 |
| FIX-3 | `search/types.ts:272-279` | headers 不校验头名：空名/含换行头名通过保存，执行期 fetch 抛原生 TypeError 绕过 engineFailed 通道 | 头名非空 + token 字符集（`/^[!-9;-~]+$/`） | core/P2-4 |
| FIX-4 | `search/types.ts:314` | GET 模板携带 bodyTemplate 被静默丢弃（UI 表单恒有该字段，用户配置无效果） | 校验层拒绝：`GET && bodyTemplate != null → invalid` | core/P2-5 |
| FIX-5 | `search/types.ts:298-310` | JSON key 含白名单占位符（`{"{{query}}x":1}`）放行但执行器只替换值 | 校验遍历对 `Object.keys(node)` 拒绝含占位符的键 | core/P2-6 |

#### core / 执行器域

| id | 文件:行 | 问题 | 改法 | 来源 |
|---|---|---|---|---|
| FIX-6 | `engines/template-engine.ts:99,153` | 错误消息未脱敏：JSON parse 失败 `e.message` 内嵌响应体片段、GET URL invalid 的 `e.message` 含明文 key URL；违背 types.ts:110 自声明 | 两处 `e.message` 过 `redactSecret(…, resolved.apiKey)`；补「parse 失败且 body 回显 key」测试断言 | core/P2-2 |
| FIX-7 | `engines/template-engine.ts`（错误文案处） | 错误文案用引擎 id（"bocha API error 4001"） | 改用 `template.name` 显示名 | 拍板 3 |
| FIX-8 | `test/tool/template-engine.test.ts:30` | 孤儿注释（helper 已不存在） | 删 | core/P2-9 |
| FIX-9 | `curl-import.ts:232` | `collectSecrets(findPlaintextSecrets(header.value))` 是组合串检测的完全子集 | 删该行保留组合串调用 | core/P2-1 |
| FIX-10 | `engines/dispatch.ts:34-38` | 声明返回 Promise 但 template 缺失分支同步 throw（时序不一致） | 函数标 `async` | core/P2-7 |
| FIX-11 | `engines/duckduckgo.ts:32` | `DUCKDUCKGO_TIMEOUT_MS` 假公开（无外部消费） | 撤 export 改 const | core/P2-8 |

#### core / 配置存储域（search-config.ts + search-config.test.ts 同 agent）

| id | 文件:行 | 问题 | 改法 | 来源 |
|---|---|---|---|---|
| FIX-12 | `search-config.ts:457-464` | `saveEngineKey`/`clearEngineKey` 不校验 engineId 已知性（dangling SKSP ref） | 两方法校验 `state.order.includes(engineId)`，未知 throw engineNotFound；补 rejects 断言 | store/P2-1 |
| FIX-13 | `search-config.ts:266-271,322` | baseUrl 只 trim 不 normalize：canRun 与串行链口径分叉（非法 URL 判可跑） | readEngineState 逐值 `normalizeEngineBaseUrl`，非法丢弃；补 canRun 与链一致性断言 | store/P2-2 |
| FIX-14 | `search-config.ts:362-374` | 显式 engine 分支对 enabled 的 inputEngine 重复 resolveOne（多一次 SKSP IO） | 记 `pinnedTried` 跳过重复 | store/P2-3 |
| FIX-15 | `search-config.ts`（paramHint 入参处） | paramHint 明文密钥不扫描（流入 agent 可见工具描述） | createCustomEngine/updatePresetOverride 的 paramHint 过 `findPlaintextSecrets`，命中走 search_secret_detected | 拍板 4 |
| FIX-16 | `search-config.test.ts` | 测试缺口：createCustomEngine 错误分支（id 不符/重复/名空）、update/delete 未知 id、testEngine draft+engineId 组合与 draftKey 回落；FIX-2..5 回归断言 | 各 describe 补 `assert.rejects`/组合用例 | store/P2-4 |

#### core / 工具面

| id | 文件:行 | 问题 | 改法 | 来源 |
|---|---|---|---|---|
| FIX-17 | `search-tool.ts:92-95` | JSDoc 仍写「装配期不取数」与本次改造矛盾 | 改写为「逐引擎段消费装配期 engineSnapshot；链解析与凭据仍在 run 内」 | tool/P2-1 |
| FIX-18 | `search-tool.ts:101` + `builtin-tool-context.ts:159-161` | 空快照三路径失真：`ctx.search==null`（CLI/旧 mock）实际 run 抛「未装配搜索上下文」但描述承诺「返回配置指引」；readConfig 降级路径同样失真 | description 区分 `ctx.search == null`（中性文案「当前运行时未装配搜索能力」）与空快照（保留指引但软化）；同步修 builtin-tool-context 两处 JSDoc；T-D1 describe 扩两条断言 | tool/P2-2 |

#### 双端 UI

| id | 文件 | 问题 | 改法 | 来源 |
|---|---|---|---|---|
| FIX-19 | desktop `SearchEngineDetailView.tsx:89` + mobile `SearchEngineDetailScreen.tsx:139-141,819-822` | 密钥注入头名漂移：desktop 写 `X-API-Key`、mobile 识别/删除按 `X-API-KEY` 精确匹配 → 跨端编辑误判+残留双头 | 统一常量 `X-API-Key`，mobile 匹配删除大小写不敏感 | ui/P2-1 |
| FIX-20 | desktop `SearchEnginesView.tsx:33-49` vs mobile `SearchEnginesScreen.tsx:362-386` | 帮助弹窗双端漂移：desktop 少「密钥安全」段、标题措辞不一致 | desktop 补齐五段，以一侧为真源逐字同步 | ui/P2-2 |
| FIX-21 | 双端 `search-engine-meta.ts` | deepseek/zhipu 副标题文案漂移（「按量计费 · 中文检索」vs「按量计费 · 中文」） | 定稿后双端同步 | ui/P2-3、glob/P2-2 |
| FIX-22 | desktop `SearchEngineDetailView.tsx:282-312` | 零改动保存假成功（零 IPC 仍 toast「已保存」）；needsKey 无 key 不拦截（与 mobile 不一致） | 按拍板 7：零写操作 → toast「无改动」；needsKey && !hasKey && key 草稿空 → 拦截提示 | ui/P2-4 |
| FIX-23 | 双端展示名取值 | 预置展示名双端不同源（desktop 读模型 name 优先、mobile 静态 LABELS 优先） | 按拍板 5：双端统一读模型 name 优先、静态表兜底 | glob/P2-1 |
| FIX-24 | mobile `SearchEngineDetailScreen.tsx:471-516,657,661` | 保存/删除回读走全屏 loading（表单闪屏、焦点丢失） | `load()` 拆「首次骨架屏 / 静默回读」，保存失败路径走静默分支（照列表屏 `reload({silent})` 先例） | ui/P2-5 |
| FIX-25 | mobile `SearchEngineDetailScreen.tsx`（EMPTY_DRAFT） | mobile create 表单全空白（desktop 有智能预填 headers/body/resultPath/fieldMap 默认），首次保存必被 validate 拦 | mobile EMPTY_DRAFT 对齐 desktop 预填基线 | ui-dev-4 |
| FIX-26 | 双端 Body 字段帮助文案 | 「整数占位用整值 "{{count}}"」读作裸形态（e2e 实测误导），实际必须带引号 | 改为「整数字段写 "{{count}}"（带引号），执行时自动转为数字」；帮助弹窗占位符段同步核对 | e2e 发现 |
| FIX-27 | 双端测试结果错误展示 | 失败错误灰字与说明同色，警示弱 | 错误文案改错误红（双端各自样式体系） | e2e 发现 |
| FIX-28 | mobile `__tests__/` | mobile UI 测试缺口：create 保存、预置有覆盖时测试请求不带 draft（FIX-1 回归锁）、差异提交 | 补 detail 套件用例（mockRuntime 模式照 reorder 套件抄） | ui/P2-6 |

#### docs 收尾（修复波全部完成后）

| id | 文件 | 动作 | 来源 |
|---|---|---|---|
| FIX-29 | `iteration-state.yaml` | spec_deviations 补登（FIX-1 测试按钮 draft 优先已修 / FIX-20 帮助漂移已修 / FIX-19 头名漂移已修 / FIX-25 create 预填已修 / FIX-23 展示名统一——均以「已修复于 CR 第 1 轮」口径登）；Δ 清单补登 `search-engines-ui-hook.mjs`、`BuiltinTag.tsx`，注明 `jest.config.js` 豁免理由 | glob-2 + ui devs |

### 明确不做（本轮 backlog，记录在案）

- 校验失败的行内字段定位/滚动提示（现在 toast 已含字段名 reason；行内校验 UI 属较大行为改动，留后续迭代）
- mobile `ApiKeyStatusTag` 复用为 baseUrl 状态语义混用（观察级）
- desktop 自定义模板删除 `{{baseUrl}}` 引用后已存 engineBaseUrls 的 orphan 清除（观察级）
- `assembleSearchToolContext` 不 gate registry（成本极小，先例对齐可后续做）

### 执行波次（文件冲突域）

- **W1（core-types）**：FIX-2..5（types.ts 串做；断言落 T-C7 归 W2 文件——W1 只改实现+template-engine.test 若涉及，约定：FIX-2..5 的 T-C7 断言由 W2 写）
- **W2（core-config）**：FIX-12..16 + FIX-2..5 的 T-C7 回归断言（search-config.ts + search-config.test.ts）
- **W3（core-exec）**：FIX-6..11（template-engine.ts + template-engine.test.ts + curl-import.ts + dispatch.ts + duckduckgo.ts）
- **W4（core-tools）**：FIX-17..18（search-tool.ts + builtin-tool-context.ts + search-tool.test.ts）
- **W5（desktop-ui）**：FIX-1(desktop) + FIX-19(desktop 侧若涉) + FIX-20 + FIX-21(desktop) + FIX-22 + FIX-23(desktop) + FIX-26(desktop) + FIX-27(desktop)
- **W6（mobile-ui）**：FIX-1(mobile) + FIX-19(mobile) + FIX-21(mobile) + FIX-23(mobile) + FIX-24 + FIX-25 + FIX-26(mobile) + FIX-27(mobile) + FIX-28
- **W7（docs）**：FIX-29（W5/W6 完成后）

W1–W4 并行；W5/W6 并行（W5/W6 依赖 W1 的 types 校验改动可先行无依赖，实际可同波全并行——W1..W6 六 agent 同波发出）；W7 收尾。
验收门（每 agent 自跑）：触达文件 typecheck + 相关测试文件绿；主代理终检三端 typecheck + 三端全量测试 + check-style 触达路径 + commit。

## 第 2 轮（已闭合）

> 来源：v2 透传改造（HEAD=5f9438d0e）后的第 2 轮复审。共 13 条 = 1 P1 + 12 P2，修复随本轮 commit 落盘。

### 拍板记录（可被用户推翻）

1. **摘要纯文本抬头**：search summary 对 results 为 JSON 文本形态（模板引擎透传）显示「引擎 · 响应文本」，与 format-tool-output 抬头同词，不解析条数；数组形态维持「引擎 · N 条结果」。
2. **PRD 补丁式**：PRD 的 v1 残留照 R1 先例做补丁式 v2 标注同步（逐处括注「**v2**」），不大改 PRD 结构；背景段引用旧口径属历史记录保留。
3. **帮助真源 mobile**：双端帮助弹窗以 mobile 为真源逐字同步（「，」标点定稿），desktop 不再自行措辞。
4. **custom id 不统一**：UI 生成 8 位 id 与存储校验 `custom:[A-Za-z0-9_-]{1,64}` 宽度不统一——容忍不修（id 为内部标识不展示，存储校验为生成值的等价超集，无行为冲突），记录在案。

### must-fix 总表

| id | 文件 | 问题 | 改法 | 来源 |
|---|---|---|---|---|
| CR2-1 | core `search/types.ts`（HEADER_NAME_PATTERN） | 头名正则宽口径 `[!-9;-~]` 放行括号/逗号/分号/引号等分隔符，执行期 `new Headers` 抛原生 TypeError 绕开 engineFailed 通道 | 收紧为 RFC 7230 tchar 字符集（字母数字与 `!#$%&'*+-.^_` 等安全符号，分隔符全拒） | core/P1-1 |
| CR2-2 | core `logic/build-tool-result-block.ts`（search summary） | 模板引擎透传形态 results 为 JSON 字符串，走通用 JSON 回落，summary 失真 | 新增文本分支「引擎 · 响应文本」（拍板 1）+ search-tool.test 回归断言 | tool/P2-3 |
| CR2-3 | core `search/search-config.ts`（normalizeEngineBaseUrl） | 额外拒绝 userinfo（username/password 非空判非法），spec §5 仅约定 http(s) 校验+尾斜杠 | 良性安全收紧维持，偏离补登 iteration-state.yaml spec_deviations | store/P2-5 |
| CR2-4 | desktop `SearchEnginesView.tsx`（帮助弹窗） | curl 导入句与 mobile 标点漂移（非逐字同句） | 按 mobile 真源逐字同步（拍板 3）+ 回归锁改逐字断言 | ui/P2-7 |
| CR2-5 | 双端 agent 工具 catalog | search 描述 v1 残留「返回标题/链接/摘要结果列表」 | 改「返回引擎原始结果数据（JSON 文本）」双端同句（desktop 已落，mobile 随 ui 域） | ui/P2-8 |
| CR2-6 | desktop `SearchEngineDetailView.tsx`（预置保存） | needsKey 拦截按已存 engine.needsKey 判定，误拦「草稿已删 {{apiKey}} 引用」的清 key 草稿 | 拦截改按草稿 usesApiKey 判定（与 mobile draftNeedsKey 同源） | ui/P2-9 |
| CR2-7 | 双端 custom 引擎 id | UI 生成 8 位 vs 存储校验 ≤64 宽松字符集不统一 | 拍板 4：容忍不修，记录在案 | ui/P2-10 |
| CR2-8 | `CHANGELOG.md` Unreleased search 条目 | v1 残留「请求体模板与响应字段映射」「前 5 条结果」 | 改 v2 口径：请求模板（URL/headers/可选请求体默认值）+ 响应透传 AI + 预览前 2 条 JSON | glob/R2-2 |
| CR2-9 | `spec-v2-passthrough.md` | 未显式作废 spec.md T-E6「maxResults 客户端截断」 | §7 补作废声明：v2 只喂 {{count}} 占位符，不做客户端截断 | glob/R2-3 |
| CR2-10 | `prd.md` 多处 | v1 残留：范围 1/3、配置者旅程、R2 表单段、测试按钮、验收 4 处、待确认项展示条数 | 照 R1 先例补丁式 v2 标注逐处同步（拍板 2） | glob/R2-4 |
| CR2-11..13 | core/双端散点 | 过时/失真注释订正 ×3（随上述各域修复顺带落地） | 见本轮各域 commit | 注释类 |

---

# Fix-Spec Closure（review-final 终态认证，2026-11-13）

> 来源：code-review-loop review-final（read-after-write 单点、readonly，在末次 spec-fix 之后派出）。认证输入 = 本文件最后一版 + tmp/cr/findings-{core-exec,core-search,test-docs,ui-copy,global}-r{1,2,3}.json 全轮对账 + 按 file:line 抽读关键代码复核（P1 全部 8 条 + P2 12 条样本跨 5 域，证据链与 r3 findings 逐条一致、无失真、无新发现）+ 双检查实跑留痕（见下表末行）。

| 项 | 状态 |
|---|---|
| fix-spec-ready | **yes** |
| fix_spec_path | docs/Iterations/web-search-curl/cr-fix-spec.md |
| dag_version / review_round | 1 / 3（r1 首轮 5 域 → spec-fix 收编 → r2/r3 对账轮零修复落地 → 本认证） |
| review-global 每轮参与 | yes（r1/r2/r3 均 5 域并行互盲，global 每轮在 wave） |
| 末轮 review-final | 通过（本节；read-after-write 成立：HEAD=f34ffcbff 未推进，读到的即最后一版 fix-spec） |
| 开放 must-fix（已写入 fix-spec） | **P0=0 / P1=8 / P2=21，共 29 条**（= 第 3 轮对账单；另 K 节 P3 建议 4 条，不阻塞） |
| 未写入的开放 must-fix | **0**（r3 全部 40 条 findings 逐条对账 = 33 条独立条目〔29 must-fix + 4 P3〕+ 7 条跨域重复并入原条目；每条 must-fix 均有「文件 + 问题 + 改法 + 验收/来源」，无「只批评、无改法」条目；OQ 分岔条目均附默认方向与双分支改法） |
| spec_deviations | 已收窄写入本文件：DEV-1..5 全部挂「登记归属」must-fix（改法内含 iteration-state.yaml / PRD / spec 补丁式登记动作），待 fix 波落盘后由下轮 review 验证转 fixed；登记方向挂 OQ-A1..A4 拍板（均附默认方向 a），按 loop 约定不阻塞 ready |
| C-orch | N/A（三轮 5 域 findings 与本文件均无 C-orch 维度条目，grep 实锚 0 命中） |
| C 类合并后 QA（manual_user） | QA-1..7 在案，不阻塞 fix-spec-ready；随 fix 波执行、合并前收口（QA-6 工作区归属 + QA-7 三端终检） |
| 检查实跑留痕 | ① `node .agents/skills/nm-code-style/scripts/check-style.mjs --changed` → **PASS**（signatures=PASS inline=PASS methods=PASS exports=PASS oop=PASS，三段全 0；口径=仅扫工作区未提交 1 文件 SessionDetailScreen.tsx，已提交范围样式项 core-exec/nm-style-1、ui-copy/nm-style-1 已在 must-fix 表）② `npx prettier --check --print-width 200` 触达 19 文件（core 10 + desktop 4 + mobile 5）→ 18 干净；唯一不干净 skill-read-truncation.ts 不在本轮 diff 范围（`git diff e6ffe24fb..HEAD` 该文件 0 命中，属基线漂移非本轮开放项，恰为 core-exec/K-2 触达文件、改 :96 注释时顺手可治） |
| 待办 | ① 开工确认时请用户收口 OQ-A1（总闸）/A2/A3/A4 + OQ-C5（global/K-2 归属），未拍板项按各条目默认方向执行；② fix 波按第 3 轮对账单派单（SessionDetailScreen.tsx 不随本迭代合并提交携带，见 QA-6）；③ fix 波落盘后下轮 review 按「第 1 轮条目全文」逐条对账闭合，spec_deviations 转 fixed |
