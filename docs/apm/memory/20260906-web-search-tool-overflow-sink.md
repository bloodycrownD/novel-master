---
date: 2026-09-12 10:05
title: web-search-tool 迭代（overflow-sink / mobile-ui / desktop-ui / fix-desktop / ui-ddg / spec-fix-cr2 / fix2-ui 节点：超预算落盘+read 截断简化 + 双端配置页/导航/测试锁 + cr-fix 修复 + DDG 内置兜底双端 UI + round2 cr-fix-spec 追加 + round2 ui2 五条修复）
keywords: [web-search-tool, engineOrder, 串行搜索链, resolveEngineChain, T-S3, overflow-sink, curl 50KB, read 截断, capUtf8BytesFill, search 落盘, T-O1, T-R1, mobile SearchEnginesScreen, desktop SearchEnginesView, searchConfig 装配, IPC nm:search, 工具计数锁 11, cr-fix-spec, ui/B-1, ui/B-2, ui/C-1, ui/C-2, X1 门禁, shared/logic 薄再导出, cr-func-fix 收口, func-ready, impl-desktop-ui-polish, 帮助弹窗, icon-btn, desc 精简, duckduckgo, BuiltinTag, BuiltinEngineTag, settings-tag--primary, 内置兜底, ui-ddg, a7da0894, 兑底错字修正, ddg 视觉审查, spec-fix-cr2, cr-fix-spec round2, core2/C-1, loadEngineConfig 死接口, core2/G-1 回炉, 四引擎注释漂移, SettingsStatus, 空 key 保存口径, ui2/C-orch-1, fix2-ui, ui2/B-1, ui2/B-2, ui2/C-1, ui2/C-2, 空 key 保存拦截, SettingsStatus error inline, clearKey catch, 使用说明, 五引擎注释]
abstract: web-search-tool 迭代多节点单次执行——overflow-sink 公共落盘/curl 预算收紧/read 截断简化（core 全量 1876 用例绿）；mobile-ui：searchConfig 装配、AI 搜索配置页与导航、计数锁 10→11；desktop-ui：runtime searchConfig + IPC 五通道 + SearchEnginesView + 导航 + 测试锁（109/109 绿）；fix-desktop：cr-fix-spec ui/B-1 清除↔保存双向互斥、ui/B-2 URL 校验前置+userinfo、ui/C-1 引擎清单收敛 core 单一真源（经 shared/logic/search-engines 薄再导出绕 X1 门禁）、ui/C-2 SegmentedControl 禁用态样式（commit 22a65d87）。（各节点只 add 显式路径，mobile/desktop 交错提交互不干扰）；21:37 cr-func-fix 收口：10 条 must-fix 全闭合，func-ready: yes；09-08 impl-core-serial：修订版 spec 重构 core——defaultEngine→engineOrder 串行链 + 逐引擎降级 + 120s 链总预算 + attempts 轨迹 + T-S3（core 1909 绿，apps 适配留待下一 wave）；09-08 impl-desktop-ui-polish：用户嫌配置页空白处文案多——列表页长说明删净收进「?」帮助弹窗（三段口径与 mobile 同构）、engine desc 精简为计费短语、详情页删 SKSP 长段落、SettingsListItem 加 desc 副标题位（复用 settings-row__desc 零新 CSS），commit d2e503df；09-11 mobile 视觉验收：列表页与帮助弹窗两截图审查通过（无必改项，副标题/帮助弹窗/配色均达标，仅「未连接」胶囊对比度等可选打磨点）；21:00 暗色补验：两截图审查通过无必改项，对比度像素实测全过关（副标题 4.85:1/正文 5.93:1/知道了 4.66:1），排版与亮色逐像素同位，可选打磨「未连接」药丸 4.1~4.3:1 与弹窗底 #1c1c1e 对遮罩后卡片仅差 2/255 两条；21:54 ui-ddg：DDG 内置兜底引擎双端配置页适配——mobile ae869375 / desktop d479f7e0，DDG 行「内置」主题色徽标（ApiKeyStatusTag 二态装不下）+ 详情页只读说明卡 + 帮助弹窗优先级段补兑底句（双端逐字一致）+ reorder 测试 4→5 同步，双端 typecheck/测试全绿；21:54 后 a7da0894 修正 ui-ddg 五文件「兑底」→「兜底」错字（存量注释同款错字另记未夹带）；22:00 DDG 列表上屏视觉审查通过——副标题放大验证确为「兜底」、「内置」主题色徽标与灰色「未连接」胶囊同形协调、五行节奏一致，无必改项；22:32 spec-fix-cr2：round2 评审 10 条 must-fix 追加进 cr-fix-spec（P1 core2/C-1 死接口 loadEngineConfig + 9 条 P2，含 core2/G-1 上轮 core/G-3 回炉、ui2/C-orch-1 空 key 保存双端口径统一、兑底错字 16 处、四引擎注释 5 处），行号全部 grep 实证（loadEngineConfig 实际 4 处含测试 mock 点 L163），另 8 项 round2 Open questions，状态 draft，仅改 cr-fix-spec.md 一个文件；09-12 fix2-ui：round2 ui2 五条闭合——ui2/B-1 desktop 列表页 .settings-error 裸类改 SettingsStatus error inline、ui2/B-2 clearKey 补 catch→setError、ui2/C-orch-1 mobile 空 draft 保存对齐 desktop 拦截（提示 toast + 不回读，同步改 save-reload 测试断言）、ui2/C-1「四引擎」注释 6 处→引真源「全部引擎（ENGINE_IDS）」+ shell.css 禁用注释通用化、ui2/C-2 帮助弹窗标题双端统一「使用说明」，desktop b464a923 / mobile 1925b04a 两 commit，双端 typecheck+测试全绿
---

# web-search-tool 迭代：impl-overflow-sink 节点

## 2026-09-06 22:40 · impl-overflow-sink（Step 5/6/7 + 测试）

user:
【节点任务】在 web-search-tool worktree（分支 web-search-tool，前序 703130ba/0a5f86a5/391af96c 已落地 search 核心）执行 spec「详细实现步骤」Step 5、6、7 全部内容 + 测试策略 T-O1/T-O2/T-O3/T-O4、T-R1/T-R2 + curl-tool 既有用例按新行为更新；含 cr-func warning 顺手修（search-config resolveEngine 注释与代码不一致）；按逻辑块 2-3 个 commit，只 add 显式路径；不做 Step 8-11。

assistant:
按 spec 完成全部内容，2 个 commit 落地（3928ef23 源码 / 7900ef68 测试+顺手修）：

**Step 5（overflow-sink）**：新建 `packages/core/src/domain/tool/builtin/overflow-sink.ts`——`sinkOversizedOutput(ctx, {tool, content, contentType})` → `{savedPath, message}`；文件名 `/tmp/{tool}-{yyyyMMdd}-{rand4}.{ext}`（ext 按 content-type 映射 html/json/txt、缺省 txt）；落盘后照 write 工具口径执行 file_cache upsert（try-catch 包裹，失败不阻断）与 /tmp 目录规则补齐（函数内部自吞错）；vfs.write 失败抛给调用方降级。vfs-tools.ts 导出 `upsertFileCacheAfterWrite` / `ensureDirRulesForNewPath`（原模块私有）。

**Step 6（curl 改造）**：`CURL_MAX_BODY_BYTES`（256KB）整体移除，引用（含 build-tool-result-block.ts 的 import 与档位判定）统一换 `TOOL_OUTPUT_MAX_BYTES`（50KB）；正文超预算时截断前全文经 sink 落盘、body 置空串占位（zod schema 必填不变）、输出附 savedPath/message、truncated=true、originalBytes 与 url/method/status 等 meta 保留；落盘失败（vfs 不可用）降级回字节截断（truncateToByteBudget 保留），不因落盘故障丢正文；10MB content-length 预检与非文本占位维持现状。formatter 加 savedPath 分支、summary 加落盘优先分支（「已落盘 /tmp/…」）、description 换 50KB 落盘口径（与 catalog 前波预写措辞一致）。search-tool.ts 的 TODO 桩接线同一 sink（序列化超 50KB 落盘返回 {engine, savedPath, message}，失败回落完整结果）。

**Step 7（read 简化）**：tool-output-limits.ts 新增 `capUtf8BytesFill`（预算内尽量填满、末行允许截到预算点、不切半个字符，返回 lastLinePartial；既有 capUtf8Bytes/truncateLine 不动——fs ls/grep excerpt/skill 仍用旧口径）与 `sliceUtf8BytePrefix`；vfs-tools read 路径移除 truncateLine 应用、换 fill、行号分页保留；末行截断后 nextOffset=offset+returnedLines 跳过该行（尾部不可续读，lastLineTruncated 字段 + formatter 英文提示注明），被截行是文件末行时不给 nextOffset（避免续读超界报错）；read description 补 50KB 预算与末行截断说明。

**顺手修**：search-config resolveEngine 注释写「顺位继续」而实现 return null——选改动小方案改注释为「终止解析链（不静默改写显式指定的引擎）」语义，代码不动（T-S2 现有用例两方案均兼容）。

**测试**：T-O1（30KB 照常）/T-O2（>50KB 落盘：savedPath/message/truncated/originalBytes、body 空串、meta 保留、/tmp/ 全文 read 可读回；子代理落父会话工作区由 T-SS-3 装配断言锁定，用例注释引用）/T-O3（search 超长落盘，maxResults=20 × 3KB snippet 构造——缺省 5 条仅 15KB 不触发预算，踩过一次）/T-O4（预检与非文本沿用既有 T-CT7/T-CT9）；T-R1（单行 300KB 返回 50KB 前缀 + 三段续读链）/T-R2（5000 行行数帽分页不变）；既有 T-CT3/T-CT10/T-CT11/T5 按新行为更新，新增降级路径用例；tool-output-limits 补 fill/prefix 单测。

验证：`npx tsc --noEmit` 干净；`NODE_ENV=test npm test` 全量 1876/1876 绿。注意：vfs-tools.test.ts 的 `fs cp -r` 用例在单文件跑时失败但全量绿、且基线（stash 对照）同样失败——worktree 环境问题（同类于既有约束），非本次回归。

# web-search-tool 迭代：impl-mobile-ui 节点

## 2026-09-06 23:55 · impl-mobile-ui（Step 9 + mobile 测试锁 + runtime searchConfig 装配）

user:
【节点任务】impl-mobile-ui：search-config store（照 cloud-sync-config.store 模式，KKV nm-search + SKSP ref）+ create-mobile-runtime/types 暴露 searchConfig；SearchEnginesScreen（ScreenFormLayout + 每引擎 FormSectionCard + ApiKeyStatusTag + FormChipGroup 默认引擎仅列 configured 候选 + StickyFormFooter）；导航接线（types/header-config/RootNavigator/ProfileTabScreen CONFIG_MENU「AI 搜索」）；AgentEditorToolsSection hint 10→11 + search；测试锁（agent-editor-form-tool-count + tool-policy-picker 8 处 /10→/11）；3 个 commit 只 add 显式路径。

assistant:
按 spec Step 9 完成，3 个 commit 落地（8e19cf70 / d750e75c / f77faea9）：

**store + runtime**：create-mobile-runtime 用 core 导出的 createSearchConfigStore(kkv+secretStore) 装配 MobileNovelMasterRuntime.searchConfig（在两者声明之后装配，踩过一次 used-before-declaration）；run-agent-turn 主/子装配点经可选端口自动消费，search 工具随之可用。services/search-config.store.ts 为 UI 侧薄封装收口读写入口；core 未从公共面导出 ENGINE_IDS/KEY_ENGINE_IDS 常量（只导出类型），UI 展示副本 SEARCH_KEY_ENGINE_IDS 集中在 store 模块并注释同步——mobile 无深路径子导出可用，这是不改 core 约束下的唯一解。

**SearchEnginesScreen**：bocha/tavily/brave 填 key（不回显，留空保存=保留原密钥，另设清除入口）；searxng baseUrl 直接回显编辑（非密钥，空串保存即清除，与 store 语义一致）；默认引擎 chip 仅列 configured 候选（与 resolveEngine 同口径），「auto」哨兵映射 setDefaultEngine(null)，当前默认指向已清除凭证的引擎时保留 disabled 展示。表单校验仅非空/URL 形状。

**测试锁**：tool-policy-picker 8 处 /10→/11（分母 BUILTIN_TOOL_CATALOG.length 动态）+ 全选用例硬编码名单补 search（不加则「全部工具（11/11）」不成立）+ it 描述同步；agent-editor-form-tool-count 同步并加「全部内置工具（10」防残留断言。

验证：两测试锁 7/7 绿；token-usage-stats-screen（渲染 ProfileTabScreen 的 T-S7）35/35 绿；__tests__ 全量 stash 基线对照 14 failed/36 vs 本地 13 failed/31，回归集为空（基线多出的 1 个失败正是 tool-policy-picker 锁——core catalog 已 11 而 mobile 还锁 /10，被本次修复）；typecheck 官方脚本：tsconfig.build 仅剩基线同有的 2 个 @aws-sdk 双 node_modules 错（cloud-sync.service.ts，worktree 环境噪音），web/e2e 两段零错。注意：stash 基线对照时 untracked 新文件不会被 stash 走，需把第 3 个报错（searchConfig 不存在）人工排除。

# web-search-tool 迭代：impl-desktop-ui 节点

## 2026-09-06 20:30 · impl-desktop-ui（Step 8：IPC 五通道 + runtime 装配 + SearchEnginesView + 导航 + hint/测试锁）

user:
【节点任务】impl-desktop-ui：desktop runtime 装配 searchConfig（core 工厂包 kkv+secretStore）；IPC 通道 nm:search/getConfig、saveEngineKey、clearEngineKey、setSearxngBaseUrl、setDefaultEngine（DTO 只回 configured 布尔不含 key 明文）；SearchEnginesView（SettingsFormSection + 每引擎 SettingsSection 卡 + ApiKeyStatusTag + 密码框留空不改 + 清除按钮 + searxng baseUrl + 默认引擎 SegmentedControl 仅列 configured 候选 + 保存 footer）；settings-nav/SettingsOverlay 导航接入；AgentEditorView 与 AgentDefinitionEditorForm hint 10→11 加 search；tool-policy-picker 3 处 /10→/11；3 个 commit 只 add 显式路径；不改 mobile/core 文件。

assistant:
按 spec Step 8 完成，3 个 commit 落地（8c9588d8 / 1793ff63 / 626763be）：

**runtime + IPC**：DesktopNovelMasterRuntime 加 searchConfig 字段（createSearchConfigStore(kkv+secretStore)，与 mobile 同构；run-agent-turn 经结构化兼容自动消费，无需改 agent-run.service）。IPC 五通道走 cloud-sync 三层链同款模式：ipc-types（通道 + SearchConfigDto/四个请求 DTO，engines 用 Record<string, configured>）→ handlers/search.ts（照 preferences handler 的 getDesktopRuntime 模式；engineId 不二次校验——setDefaultEngine core 内有运行时兜底，save/clear 脏 id 只写孤儿 SKSP ref 无危害，注释留痕）→ handler-registry bindNoArg/bindReq → invoke-registry/client 薄封装。

**SearchEnginesView**：照 AgentEditorView 的 SettingsPanel>SettingsFormSection(footer 保存)>SettingsSection 嵌套卡模式。每卡：desc hint + 配置状态 ApiKeyStatusTag + key 引擎密码框（留空不改语义）+ 已配置时清除按钮（即时生效并回读刷新）；searxng baseUrl 文本框回显编辑（空串=清除）；默认引擎 SegmentedControl「自动 + configured 候选」，当前默认引擎掉出候选（key 被清）时补挂防幽灵态。保存一次性提交三段（key 非空才写 / baseUrl 变化才写含 URL 形状前端校验 / 默认引擎变化才写）后 reload。校验仅非空与 http/https URL 形状，无连通性测试。

**导航**：SettingsViewId/SETTINGS_NAV AI 组/SETTINGS_TOP_LEVEL 加 searchEngines「AI 搜索」（顶栏标题经 TOP_LEVEL 兜底自动生效）；SettingsOverlay renderContent 加 case（单一表单页无 navState 传参）。

**hint/测试锁**：两处 hint 10→11 名单尾加 search（AgentDefinitionEditorForm 未挂载组件照旧同步）；tool-policy-picker 3 处断言 /10→/11 + 全选数组补 search（不加则「全部工具（11/11）」分支不成立）+ 注释同步。

验证：typecheck（官方脚本，tsconfig.json 盖 main+shared）绿；desktop 全量测试 109/109 绿——其中 4 个 build 冒烟（dist/icons 产物）与 1 个 skill-zip（sksp-mac/windows/linux dist 缺失）初跑失败，补跑 sksp 三平台包 build + npm run build 后全绿，均 worktree 未构建产物的环境问题非代码回归。renderer tsconfig 基线本就有存量类型错误（官方门禁不含 renderer，hint prop 等历史欠账），本次新增文件零新增错误。并行注意：mobile 节点同 worktree 交错提交，edit 工具瞬时 ENOENT 一次（文件系统抖动，重试即恢复）；settings-nav 整批 edit 因首条 oldText 失配整体回滚过一次，重发成功——逐条验证 diff 别只看工具返回值。

## 2026-09-06 21:27 · fix-desktop 节点（cr-fix-spec ui/B-1、ui/B-2、ui/C-1 desktop 部分、ui/C-2）

user:
【节点任务】fix-desktop：web-search-tool worktree 执行 cr-fix-spec 的 ui/B-1（clearing 互斥）、ui/B-2（URL 校验前置+userinfo）、ui/C-2（SegmentedControl 禁用态）、ui/C-1 desktop 部分（引擎清单收敛 core 单一真源）；约束不改 apps/mobile 与 packages/core；验证 typecheck + tool-policy-picker 测试；1-2 个 commit 只 add 显式路径。

assistant:
四项全修完，单 commit 22a65d87（3 文件：SearchEnginesView.tsx / shell.css / 新建 shared/logic/search-engines.ts），typecheck 绿 + eslint（改动文件）绿 + tool-policy-picker 2/2 绿。

**ui/B-1**：补 clearing: KeyEngineId|null 状态；save() 入口 if (clearing != null) return；clearKey 守卫扩为 saving||clearing!=null 且 try/finally 复位；清除按钮 disabled={saving||clearing!=null} + 「清除中…」在途文案；保存按钮 disabled 同步加 clearing。

**ui/B-2**：save() 第 0 步先算 nextUrl 并做形状校验（isValidHttpUrl 补 !url.username && !url.password，对齐 mobile isValidHttpBaseUrl），非法 setError 早退零 IPC；key 提交循环与「与已存值不同才提交」diff 逻辑保留不动。

**ui/C-1 关键发现**：desktop eslint 有 X1 门禁（v1.4.21 引入）禁 renderer/** 直接 import @novel-master/core（含子路径），存量已 9 处违规（useAgentStream/SessionDetailDrawer 等）但新增违规不该再添。正统合规路径是 shared/logic/ 薄再导出层（root.ts/config-forms-agent.ts 先例，禁 export *）——新建 shared/logic/search-engines.ts 具名转发 ENGINE_IDS/KEY_ENGINE_IDS/EngineId/KeyEngineId，SearchEnginesView 改从 @shared/logic/search-engines import。本地 type KeyEngineId 与 KEY_ENGINES 数组删除；ENGINE_CARDS 改 Record<EngineId,{label,desc}>，渲染循环 ENGINE_IDS.map（顺序 bocha/tavily/brave/searxng 与原数组一致，UI 顺序不变）；defaultOptions 补挂逻辑 ENGINE_CARDS.find 改 Record 索引（defaultEngine as EngineId 判 undefined）。

**ui/C-2**：shell.css .segmented-control__btn.is-active 规则后补 :disabled（opacity 0.45 + cursor:not-allowed）与 :disabled:not(.is-active):hover（background:transparent 屏蔽 hover，:not(.is-active) 防 specificity (0,3,0) 压掉叠加态选中底色）；叠加态 = 灰化 + 保留选中底色，可辨识「当前值但已失效」，opacity 0.45 对齐 mobile FormChipGroup。

验收核对：非法 URL+非空新 key 点保存 → 第 0 步早退零 IPC 写；http://u:p@host 被拦；grep 全仓无第二个硬编码 ['bocha','tavily','brave'] 数组字面量（desktop 侧清零，唯一真源 core types.ts）；mobile 侧 SEARCH_KEY_ENGINE_IDS 副本归 fix-mobile 节点（本节点不动 apps/mobile）。

## 2026-09-06 21:37 · cr-func-fix 节点（修复波次收口检）

user:
【readonly 功能小检】cr-func-fix 收口：通读 cr-fix-spec 10 条 must-fix，对照本波次 6 提交（core 2e71023a/147dc458/9b101d70/fc953dcc、desktop 22a65d87、mobile c3a98ec8）逐条验收 + 复核 verify 证据 + 排查修复引入的新问题（sliceUtf8BytePrefix 对 read 分页影响、desktop save() 重排行为、shared 薄再导出正确性），给 func-ready 结论。

assistant:
10/10 全闭合，func-ready: yes。逐条证据：core/B-1 bocha 业务码脱敏（parseBochaResults 增 apiKey 入参，redactSecret 后拼接，T-C2 用例断言明文→***）；core/B-2 代理对块边界右移（块起点变量传递防重叠，T-B2 三预算断言无孤立代理）；ui/B-1 clearing 双向互斥（save 入口 if(clearing) return + 按钮双向禁用 + 清除中…文案 + finally 复位）；ui/B-2 校验前置第 0 步零 IPC 副作用 + isValidHttpUrl 补 userinfo 拒绝；ui/B-3 catch 内 await load() 回读（新测试 2/2 过，mock 半程生效断言标签翻转）；ui/C-1 真源唯一（grep 全仓唯一数组字面量在 core types.ts；desktop 经 shared/logic/search-engines.ts 薄再导出合规绕 X1 门禁——门禁与 root.ts 先例均实证；mobile 删 SEARCH_KEY_ENGINE_IDS 改重导出 + core-shim 补导出防 jest 环境拿 undefined；dist 已重建实证）；ui/C-2 :disabled 规则级联正确（opacity 0.45 + not-allowed，is-active 选中底色保留，浅色主题 L710 高特异性不受压）；core/G-1（mock.timers 挂起 fetch + tick 60s 断言 timed out after 60000ms）/G-2（vfs.write 抛错降级回落完整 SearchResponse）/G-3（真实 VFS 端到端：落盘 + file_cache + 目录规则 + read 分页拼回全文）。

抽跑复核：core 三个测试文件 29+15+32 全绿；mobile B-3 用例 2/2（NODE_ENV=test）；双端官方 typecheck 干净。新问题排查：sliceUtf8BytePrefix 唯一调用方是 capUtf8BytesFill 末行截断路径，短行单块行为不变、仅超 8192 字符长行更正确，纯收紧；desktop save() 第 0 步早退在 try 内、finally setSaving(false) 不残留；薄再导出 10 行具名转发无 export *。遗留 nit（不阻塞）：desktop save() 无 saving 自守卫（按钮已 disabled 挡 UI 路径，与 mobile handleSave 的 saving 检查不对称，纯防御差异）；工作区有未提交 package-lock.json 改动（worktree 环境噪音，非本波次产物）。

## 2026-09-08 · impl-core-serial（修订版 Step 2/3/4 core 部分 + 既有测试更新 + T-S3）

user:
【节点任务】impl-core-serial：按修订版 spec 重构 search 核心行为——①search-config.ts KKV 键 defaultEngine→engineOrder（JSON 数组），readSearchConfig 返回 engineOrder: EngineId[]（容错补齐去重），resolveEngine→resolveEngineChain（按序候选数组，显式 engineId 从该引擎起截取），setDefaultEngine→setEngineOrder（合法排列校验）；②search-tool.ts 串行执行（逐引擎降级、全链聚合错误不泄漏 key、120s 链总预算、attempts 轨迹、显式 engine 失败不降级）；③dispatch.ts 保持单引擎；④formatSearchOutput attempts 轨迹行；⑤既有测试更新 + T-S3 四用例（含 mock timers 预算耗尽）；⑥index.ts 导出面与 allowlist 同步。2-3 个 commit，只 add 显式路径；不改 apps/*。

assistant:
按修订版 spec 完成全部内容，3 个 commit 落地（b43d9f99 配置层 / 8343a68a 工具与串行执行 / 0f87513a 测试），core 全量 1909 用例绿（基线 1903 + 新增 6）。要点：engineOrder 容错归一恒为四引擎全排列（非 JSON/含非法项/重复时合法前缀保留+缺项默认序补齐）；resolveEngineChain 返回 ResolvedEngineConfig[]（凭据随项现读，竞态 get 不到 key / searxng baseUrl 损坏视作未配置跳过），显式引擎从该引擎起截取——指向未配置引擎时只回落截取链内 configured（不再全局回落，语义按修订版收紧）；串行循环放 search-tool.ts run 内，聚合错误经 toolFailed 包装（ToolError.cause.message 携带逐引擎明细，formatToolErrorForLlm 解包路径模型可见）；超 50KB 落盘保险丝移到循环外避免落盘故障被误计入引擎失败；T-S3④ 用 mock.timers（apis: setTimeout+Date）+ 挂起 fetch（监听 abort reject）：bocha/tavily 各 60s 超时后 brave 尝试前预算 120s 拦下（零请求、错误注明剩余未尝试引擎）。apps/* 的 setDefaultEngine 等旧引用（ipc-types/SearchEnginesView/search handler）留待下一 wave 双端适配。

# web-search-tool 迭代：impl-desktop-ui-polish 节点

## 2026-09-08 11:20 · impl-desktop-ui-polish（搜索配置页 UI 精简）

user:
【节点任务】desktop 搜索配置页「空白处写太多字很难看」：SearchEnginesView 删页内长说明；行副标题精简（bocha『按量计费 · 中文检索』/tavily、brave『按量计费 · 国际』/searxng『自托管 · 免费』，search-engine-meta.ts 同步）；页头加「?」帮助按钮弹三段说明弹窗（引擎优先级/自动降级/密钥安全，mobile 并行同构口径）；详情页删长说明保留字段级短 hint；只用现有 shell.css 类不新增硬编码色值；不动排序/保存/清除逻辑；1 commit 显式路径。

assistant:
单 commit d2e503df 落地（4 文件 +78/-17）：

**列表页 SearchEnginesView.tsx**：页首整段操作说明（settings-hint 长文案）删除，换成 SettingsListSection header 里右对齐「?」icon-btn（settings-toolbar--end），点击开 SearchHelpModal——形态照 AddModelModal（text-prompt-overlay + text-prompt-modal--wide + confirm-modal__actions「知道了」），三段用 settings-hint 内嵌 strong 小标题；行内新增 desc={meta.desc} 副标题。HELP_SECTIONS 常量集中存三段文案并注释「与 mobile 同构改造保持一致，双端文案勿漂移」。

**search-engine-meta.ts**：四引擎 desc 换成计费/部署形态短语（同任务口径），详情页 desc={meta.desc} 随之变短保留。

**settings-ui.tsx**：SettingsListItem 加可选 desc prop，复用 settings-row__desc 渲染（嵌在 settings-list-item__label 内，同 settings-row--switch 结构），零新增 CSS。

**详情页 SearchEngineDetailView.tsx**：删底部「API Key 经 SKSP 安全存储…」长段落（密钥安全口径已进帮助弹窗）；「留空不修改」「留空 = 清除」字段级短 hint 保留。

验证：NODE_ENV=development npm run typecheck -w @novel-master/desktop 干净；NODE_ENV=development npm test -- test/tool-policy-picker.test.tsx 2/2 绿。未动 apps/mobile 与 packages/core；排序/保存/清除逻辑未触碰。注：mobile 侧 SearchEnginesScreen 当时仍是旧长文案（并行节点未合入），双端口径以任务给定文案为准。

# web-search-tool 迭代：mobile UI polish 视觉验收

## 2026-09-11 20:47 · 视觉审查（/tmp/search-list.png + /tmp/search-help.png）

user:
移动端搜索配置页 UI polish 视觉验收：期望列表页为干净的引擎列表（引擎名 + 短副标题 + 未连接标签 + 箭头，标题栏「搜索配置」+「?」帮助按钮，无大段灰字说明），帮助弹窗为居中「使用说明」+ 三段加粗小标题 +「知道了」；审查残留文案/排版/配色/视觉 bug，给通过与否结论。

assistant:
**视觉验收通过，无必改项。**列表页：四引擎卡片（Bocha/Tavily/Brave/SearXNG）行结构完整（名称粗体 + 副标题「按量计费 · 中文检索 / 按量计费 · 国际 / 自托管 · 免费」+ 灰色「未连接」胶囊 + ⋮ 菜单 + > 箭头），第四卡片以下纯背景色、长文案已删净，层级清晰无错位/截断/重叠；帮助弹窗：「使用说明」+ 引擎优先级/自动降级/密钥安全三段加粗小标题 + 正文完整两行/段，底部细分割线 + 居中蓝色「知道了」，无溢出遮挡，Material 惯例样式；配色白卡 + 浅灰底 + 蓝 accent 与 app 协调。可选打磨点（非阻塞）：①「未连接」胶囊灰字灰底对比度偏低可加深一档；② ⋮ 与 > 触达区域视觉偏窄（约 16dp），建议代码确认 padding 补足 48dp 热区；③ 本次截图均为亮色模式，暗色模式适配需另行补截图验证；④ Tavily/Brave 副标题连续重复「按量计费 · 国际」属既定文案口径非 bug。

## 2026-09-11 21:00 · 视觉审查暗色补验（/tmp/search-list-dark.png + /tmp/search-help-dark.png）

user:
暗色模式补验两截图（搜索配置列表页 + 帮助弹窗）：审查暗色下文字对比度（尤其灰色副标题与「未连接」标签）、弹窗遮罩与卡片层次、有无颜色异常（发白/发黑/溢出色）、排版与亮色一致性；给通过/需调整结论。

assistant:
**暗色适配通过，无必改项**，2 条可选打磨（延续 20:47 亮色轮口径）。PIL 取色 + WCAG 实测：背景纯黑 #000000、卡片 #2c2c2e、顶栏/弹窗底 #1c1c1e、灰字 #98989d、药丸底 #373739、「知道了」#0a84ff。对比度全过关：卡片标题 13.94:1、灰色副标题 4.85:1、弹窗正文 5.93:1、小节标题 17:1、「知道了」4.66:1、⋮/> 图标 4.62:1；无发白/发黑/溢出色。可选打磨：①「未连接」药丸字 #98989d on #373739 ≈ 4.1~4.3:1 略低于 AA 4.5:1——与亮色轮①同元素同性质，两模式可同批提亮/加深一档；②弹窗底 #1c1c1e 与遮罩后卡片 #1a1a1c 仅差 2/255，上缘叠卡片处边界靠黑隙与圆角撑住，建议弹窗底提到 #2c2c2e（非阻塞）。排版一致性硬证据：亮/暗两版弹窗边界（y=761/1718）、六行正文与分隔线（y=1575）逐像素同位；遮罩强度两模式对称（黑 ~40%）；状态栏 #757575 亮暗相同属系统层行为，非适配问题。

## 2026-09-11 21:54 · impl-ui-ddg（DDG 内置兑底双端 UI）

user:
【impl-ui-ddg】core 已加 duckduckgo（ENGINE_IDS 五引擎默认序 [bocha,tavily,brave,searxng,duckduckgo]、configured 恒 true、dist 已重建）。双端任务：mobile SearchEnginesScreen 的 ENGINE_HINTS 加 duckduckgo、DDG 行用简单 Text 徽标（tokens 主题色）文案「内置」（ApiKeyStatusTag set/not set 二态装不下）、照常可排序可点详情；SearchEngineDetailScreen DDG 只读说明卡（无表单无保存无清除）；帮助弹窗引擎优先级段补兑底一句；reorder 测试 4→5 同步。desktop search-engine-meta 加条目、SearchEnginesView「内置」徽标、SearchEngineDetailView 只读说明、HELP_SECTIONS 补句（双端逐字一致）、ContextMenu 确认 DDG 照常排序。验证：mobile jest 两文件+官方 typecheck；desktop typecheck+tool-policy-picker。2 commit，只 add 显式路径。

assistant:
双端全部落地，2 commit：mobile ae869375 / desktop d479f7e0。

mobile（3 文件）：SearchEnginesScreen——ENGINE_LABELS/ENGINE_HINTS 补 duckduckgo（'内置 · 免费兑底'，Record<EngineId> 缺键原本 typecheck 红）、导出 BuiltinTag（主题色胶囊，尺寸/形状与 ApiKeyStatusTag 协调仅换 primary 色）、DDG 行 trailingMeta 分流、帮助弹窗优先级段补「未配置任何引擎时由内置 DuckDuckGo 免费兑底（无需密钥）」；SearchEngineDetailScreen——isDuckduckgo 分支渲染只读说明卡（标题+hint+「内置」徽标+说明文案，无 footer/输入/清除），load/save/clear 均 early-return（configured 恒 true 免读库；handleClearKey 补 isDuckduckgo guard 后 clearEngineKey 的 KeyEngineId 收窄过 typecheck）；reorder 测试 mock 4→5、末位下移禁用改断言 DDG、新增 DDG 徽标与详情导航两断言（detail save-reload 不涉 DDG 未动）。

desktop（5 文件）：search-engine-meta 的 ENGINE_META 补 duckduckgo（DuckDuckGo / 内置 · 免费兑底）；settings-ui 加 BuiltinEngineTag（settings-tag--primary 主题色胶囊）+ shell.css 加 .settings-tag--primary（color-mix 12% primary 底）；SearchEnginesView DDG 行 meta 分流徽标 + HELP_SECTIONS 优先级段补句（与 mobile 逐字一致）；SearchEngineDetailView DDG 分支只读说明（文案同 mobile 逐字）、reload 对 DDG 跳过 IPC；ContextMenu 排序基于 engineOrder 无 configured 依赖，DDG 照常可排序（确认无需改）。

验证全绿：mobile NODE_ENV=test jest 两文件 11/11 + npm run typecheck（三段全过）；desktop NODE_ENV=development typecheck + tool-policy-picker 2/2。desktop 无搜索配置页既有测试无需同步。package-lock.json 工作区既有改动未 add。

## 2026-09-11 22:00 · 视觉审查（/tmp/ddg-list.png：DDG 兜底引擎上屏验证）

user:
DDG 兜底引擎上屏视觉审查：期望五引擎列表（Bocha/Tavily/Brave/SearXNG/DuckDuckGo），DDG 行副标题「内置 · 免费兜底」+ 主题色「内置」徽标（区别于其它行的灰色「未连接」胶囊），行结构与其它引擎一致；审查徽标协调性（尺寸/形状/颜色区分）、五行排版节奏、文案错字（注意不是「兑底」）、其它视觉异常；返回问题清单与通过/需调整结论。

assistant:
**通过，无必改项。**五行顺序与 engineOrder 默认序一致；DDG 行结构完整（DuckDuckGo 粗体 + 副标题「内置 · 免费兜底」+ 浅蓝底主题蓝字「内置」胶囊 + ⋮ 菜单 + > 箭头）。副标题裁剪 3 倍放大验证末二字为「兜底」（⺤+白+儿复杂结构），非「兑底」——源码 SearchEnginesScreen.tsx:60、详情页只读卡、帮助弹窗均为「兜底」；git 考古：ae869375（ui-ddg）提交时确带「兑底」错字，a7da0894（fix: DDG 文案错字「兑底」→「兜底」，5 文件）已修，截图为修字后的包，21:54 轮记忆所记「免费兑底」对应的是错字时期的代码。「内置」徽标与「未连接」胶囊同为全圆角同高同字号胶囊，宽度因 2 字 vs 3 字自然收窄，右缘均对齐 ⋮ 前一致位置；浅蓝/主题蓝 vs 灰底灰字区分清晰、语义合理（内置=开箱可用高亮，未连接=待配置中性）。五卡同高同圆角同间距，徽标垂直居中于文本块、逐行对齐，无截断/重叠/错位。可选打磨（沿 20:47 亮色轮口径，非阻塞）：「未连接」灰胶囊对比度偏低。旁注（非本页 UI 纯注释，不阻塞、a7da0894 有意未夹带的存量错字）：「兑底」散布 mobile/desktop 若干注释（useAgentRunLifecycle.ts:112、ChatTabProvider.tsx:375、ProviderDetailScreen.tsx:101、token-usage SummaryTab/format/TokenUsageStatsScreen、PieChart.tsx:28、mermaid-core.ts:69、desktop agent.ts:328 等），用户不可见，另记统一修。

## 2026-09-11 22:32 · spec-fix-cr2（第二轮 cr-fix-spec 追加）

user:
【节点任务】spec-fix-cr2：只改 cr-fix-spec 文档不改实现代码。元信息更新（base_sha=dc9ac9f1、head_sha=e3852438、review_round=2、dag_version=2、状态=draft），追加第二轮 10 条 must-fix（1 P1 + 9 P2）+ 8 项 Open questions 待拍板；上轮 10 条与 Closure 保留为第一轮历史留痕；业务 Spec/PRD 只读参考勿改。

assistant:
cr-fix-spec.md 完成第二轮追加，仅改这一个文件。元信息按指示更新（状态 draft）；Must-fix 拆「第一轮（已执行完毕）」（原 10 条保留留痕）与「第二轮（当前待执行）」两节；第二轮 10 条全部写入：core2/C-1 [P1] 死接口 loadEngineConfig 三处删除 + spec Step 3 措辞同步——grep 实证评审清单外还有第 4 处测试 mock 点（search-tool.test.ts L163），已并入改法（不删则接口收窄后 typecheck 红）；core2/G-1 [P2] 上轮 core/G-3 回炉（真实 VFS 落盘集成测试上轮声称闭合但现 grep 落盘/overflow 零命中，标注回炉）；core2/C-2 dispatch.ts 头注释「返回 null」→「返回空数组时」（头注释实文确认）；core2/C-3 源码「兑底」5 处；ui2/B-1 列表页 .settings-error 类 shell.css 确无定义（只有 .settings-error-panel* 系列）改用 SettingsStatus error inline；ui2/B-2 详情页 clearKey 实为 try/finally 无 catch（save 有完整 catch→setError），补 catch 同范式；ui2/C-orch-1 空 key 保存 mobile 虚假成功 toast「配置已保存」被 save-reload 测试锁死（实际路径 apps/mobile/__tests__/search-engine-detail-screen-save-reload.test.tsx L268 附近「留空保存」用例）——对齐 desktop（拦截文案逐字一致已验证）+ 同步改测试断言；ui2/C-1「四引擎」注释 5 处（行号逐一 grep 实证）+ shell.css SegmentedControl 禁用注释过时；ui2/C-2 帮助弹窗标题统一「使用说明」（desktop SearchEnginesView L53 文本 + L142 aria-label 两处）；ui2/C-3 测试「兑底」11 处 + 源码 5 处共 16 处，与 core2/C-3 可合并执行、双 id 互引闭合。Open questions 追加 round2 8 项（回落痕迹/engineErrorBrief 二次脱敏/180s 压线/live smoke/显示名收敛 core/desktop 零自动化测试/副标题与标题双端口径）；K 节补 core dist 重建（core2/C-1、C-3、ui2/C-3）与 NODE_ENV=test/typecheck 脚本提示；Closure 拆「第一轮（已执行完毕，历史留痕）」+「第二轮（当前）draft」两表。

## 2026-09-12 10:05 · fix2-ui（round2 ui2 五条：B-1/B-2/C-orch-1/C-1/C-2）

user:
【节点任务】fix2-ui：执行 cr-fix-spec 第二轮 ui2 五条——ui2/B-1 desktop SearchEnginesView 列表页错误渲染改 SettingsStatus error inline；ui2/B-2 SearchEngineDetailView clearKey 补 catch（与 save 同范式）；ui2/C-orch-1 mobile SearchEngineDetailScreen handleSave key 引擎空 draft 对齐 desktop 拦截提示 + 同步改 save-reload 测试 L268 用例；ui2/C-1「四引擎」注释批量修（desktop ipc-types/search.ts/SearchEnginesView + mobile store/SearchEnginesScreen/reorder 测试）→「五引擎」或「全部引擎（ENGINE_IDS）」+ shell.css 禁用注释改通用描述；ui2/C-2 帮助弹窗标题统一「使用说明」。验证：mobile 两 jest 文件 + 官方 typecheck；desktop typecheck + tool-policy-picker。2 个 commit（desktop/mobile），只 add 显式路径；不改 packages/core。

assistant:
五条全部闭合，2 个 commit 落地（desktop b464a923 / mobile 1925b04a）。ui2/B-1：SearchEnginesView 错误文本原挂未定义的 .settings-error 裸类，改 `<SettingsStatus error={error} />`（import 自 settings-ui，与详情页同组件同口径，shell.css 不新增规则）。ui2/B-2：clearKey 在 try/finally 之间补 `catch (e) { setError(...) }`，IPC reject 不再冒泡 unhandled rejection。ui2/C-orch-1：handleSave key 引擎分支改为空 draft 时 `showToast('请输入 API Key（留空不会修改已保存的密钥）')` + return（try 内早退，finally 复位 saving；不发成功 toast、不 load）；「留空保存」用例改写为断言提示 toast + saveEngineKey 未调用 + readConfig 调用数不变（readsBefore 基线在 renderScreen 后取，避开初始 load 计数）。ui2/C-1：六处注释统一——desktop ipc-types L1429 / handlers/search.ts L8 / SearchEnginesView L131 改「全部引擎（ENGINE_IDS）」（不写死数字）；mobile store L45 / SearchEnginesScreen L2 同款；reorder 测试 L241 按语境改「可配置引擎」（duckduckgo 不走状态标签不在其列，写「五引擎」反而失真）；shell.css 禁用段注释删「默认引擎指向已清 key 引擎时的保底补挂项」场景引用改通用描述。ui2/C-2：SearchEnginesView 标题文本 + aria-label 两处「搜索配置说明」→「使用说明」。注意 handlers/search.ts 的 edit 工具 oldText 曾匹配失败（grep 显示同文但精确匹配不中，疑似不可见字符），改用 python 替换闭合。验证全绿：mobile NODE_ENV=test jest 两文件 11/11 + npm run typecheck exit 0；desktop NODE_ENV=development typecheck + tool-policy-picker 2/2；grep 全部改动文件「四引擎」零命中、settings-error 裸类零命中。
