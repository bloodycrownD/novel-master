---
date: 2026-09-13 11:20
title: 智能排序迭代全程：legado 调研→PRD/SPEC→实现→两轮 merge→真机验收重构→CR×2→round4 执行
keywords: smart-sort, 智能排序, capture_kind, 正则字面量, 高亮预览, ownerRouteKey, VFS 文件名校验, CR loop, 迁移, BOOT_VERSION
abstract: 从 legado 目录规则调研到 smart-filename-sort 迭代交付：比较器六条全序、三端管理页、CLI；两轮 merge main（v1.5.13/v1.5.16，BOOT_VERSION 顺延 13、正则系统被 main 移除）；真机验收多轮重构（字面量输入、description、高亮正则测试、capture_kind 三档、捕获下拉、帮助弹窗、排序方式 picker、ownerRouteKey 转场修复）；两轮 CR loop 收敛（round3 旧批次 11 条已执行、round4 增量 16 条也已执行闭合——三波次 14 commits 终验全绿）；另有 VFS 文件名校验新需求并入。
---

user:
调研 .reference/legado 这个项目，想了解它的 text 目录规则，是否能参考这个目录规则，给 novel-master 的普通文件名排序新增一个智能排序？这样第一章、第二章这样的文件也能正常排序了。

assistant:
（brain-storm 双子代理探索 + 主代理抽查证实，手工验证关键代码）

**legado 侧（KMP 重构版，核心逻辑在 shared/src/commonMain/kotlin/io/legado/app/）：**

1. 「text 目录规则」实为正文分章正则族：`txtTocRule.json` 默认 25 条规则（核心字符类 `[\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?` + 章/节/卷/集/部/篇等后缀 + 负向排除如 `节(?!课)`、`正文(?!完|结)`），首开时 `TextFileCore.getTocRule` 取头部 512KB 对启用规则按命中数（间隔>1000字的有效命中）自动优选，选中的正则本身存进 `book.tocUrl` 支持复用/覆盖。
2. 章节顺序 = 文本出现顺序（`forEachIndexed` 赋 index，DB `order by index`），**不存在按标题序号排序**；中文数字转整数 `StringUtils.chineseNumToInt`（支持零〇两/一二三…十百千万亿 + 大写壹贰…，处理「一零二五」逐位式与「一千零二十五」进位式）只用于换源章节定位，不参与排序。
3. 文件名排序（本地导入列表）：`AlphanumComparator` 经典自然排序——字符串切数字块/非数字块，数字块先比长度再逐字符比（`2.txt < 10.txt`），**只认 ASCII '0'..'9'，中文数字文件名仍按 Unicode 字典序**（十.txt 排在三.txt 前）。

**novel-master 侧（关键结论）：**

1. 排序单源汇聚 core：`packages/core/src/domain/workplace/logic/workplace-eval.ts` 的 `compareStrings`（裸 `a.localeCompare(b)` 无 numeric）+ `sortFilesForDir`（name→basename 字典序；created/updated 都只比较同一个 mtimeMs）；`sortDirPaths` 只看 sortOrder 不看 sortField。mobile/desktop/CLI 读取侧零本地排序，core 改动三端自动生效。
2. `SortField = "name"|"created"|"updated"` 定义于 `workplace-types.ts`；`workplace-schema.ts` 有 **CHECK 约束锁死枚举**，新增值必须表重建迁移（`CREATE new → INSERT SELECT → DROP → RENAME`，schema-migrations runner 就绪）+ 按 #10 bump SCHEMA_BOOT_VERSION + 重建 core dist。
3. 全仓无 Intl.Collator/numeric:true/中文数字工具；VFS `listTree` 与聊天附件树 `render-dir-attach-tree.ts` 各有一份独立字典序，不受目录规则管辖。

**结论与建议**：legado 没有现成的「第X章文件名排序」答案（它靠文本出现顺序天然有序），但其两个零件——第X章识别正则 + chineseNumToInt——拼起来正是智能排序所需。推荐方案：SortField 新增 "smart" 值，纯手写智能比较器（文件名切段，「第X章/节/卷/回/集」中文数字转数值、阿拉伯数字块数值比较、其余回退 localeCompare），不改默认 name 行为。改动面约 7 文件 + 1 迁移：core 类型/workplace-eval/DDL+迁移、desktop ipc-types 字面量、mobile DirectoryRuleSheet 与 desktop DirectoryRuleModal 的 SORT_FIELDS、CLI parseSortField、core+mobile 测试、（新增导出时）public-workplace-allowlist.json 快照。决策点：sortDirPaths 是否也尊重 sortField（让「第一卷」目录也智能排）；head/tail 展示档位依赖排序下标，智能排序与「头 N 章尾 N 章」天然契合。不推荐直接改 compareStrings 全局生效（存量行为突变）。

user:
确认要做：目录规则的排序里增加智能选项；设置页面增加「智能排序」规则管理页（类似 legado 章节规则管理页面）。疑问：多个正则的情况下排序规则如何生效？只是简单按正则匹配生成数字比较吗？正则顺序对排序顺序没有额外影响？

assistant:
（第二轮双子代理补充探索）

**多正则生效机制（legado 证据）**：legado 的 25+ 条规则不是同时生效，而是「优选」——每条启用规则在正文头部 512KB 跑一遍，统计有效命中数（相邻命中间隔>1000字符才计数，防正文误命中刷数），命中最多者胜出成为该书唯一分章正则（存 book.tocUrl）。serialNumber（列表顺序）只作平手裁决：遍历方向 serialNumber 从大到小 + `>=` 覆盖，平手时列表更靠前的规则胜。对排序顺序本身无影响（分章顺序=文本出现顺序）。

**为何不能照搬到文件名排序**：单文件名对单正则最多命中一次，没有「命中数」统计量，优选机制失效。推荐改为**优先级列表**模式：按 serialNumber 顺序逐条尝试，第一条匹配的规则用于提取序号——正则顺序决定「哪条规则被采用」，不决定「排序结果」（排序仍由提取出的数值 + 回退比较决定）。

**legado 规则管理页功能面**（shared/src/sharedUiMain .../ui/book/toc/rule/）：列表项=启用开关+名称+example 小字+编辑；置顶（minOrder-1）/置底（maxOrder+1）/删除；长按拖拽换位，松手全量重编号 1..N；批量启停/删/导出；菜单级「导入默认规则」=删负 id 内置行再重灌（用户规则正 id 不受影响）；编辑对话框三字段（名称/规则/示例）+ Regex 试编译校验 + 剪贴板复制/粘贴 JSON；表空时自动灌入默认规则自举。另有阅读页弹窗版单选模式，可手工给某本书指定规则（覆盖自动裁决）。

**novel-master 设置页落地**：无统一设置框架，每子页=导航注册+独立 Screen/View+core service。最同构先例是 regex 域：core 七层（model+zod+repo+service+DDL+public 导出，bootstrap L86 SCHEMA_BOOT_VERSION=10），mobile 三屏（RegexGroupsScreen/RegexRulesScreen/RegexRuleEditorScreen，入口在 ProfileTabScreen CONFIG_MENU，导航 5 处），desktop IPC 五处（ipc-types/handler-registry/handlers/invoke-registry/settings-nav+SettingsOverlay+SettingsViews）。**缺口**：regex 的 sort_order 仅创建时自动追加（nextSortOrder=MAX+1），无手动 reorder API，且 rule 表有 UNIQUE(group_id, sort_order)，新增排序需独立 reorderRules API（整表重编号最稳）。mobile 手动排序建议行内上移/下移按钮（RN 拖拽仓库无先例）。若不分組可单表平铺比 regex 少一层。持久化三模式：实体表（需 bump SCHEMA_BOOT_VERSION）、KKV 偏好（nm-preferences）、KKV 指针（nm-workspace-state）。

user:
确认理解：命中次数是指所有章节都执行一遍目录规则，然后看哪条规则命中的多，就用哪条？

assistant:
修正两点：①样本不是全部章节而是正文头部 512000 字节（bufferSize）——选规则时章节尚不存在（鸡蛋问题），拿头部当样本；②流程是每条启用规则各自在同一段头部文本上跑 findAll，数「像章节标题的行」的命中数，相邻命中需间隔>1000字符才算有效（防正文提及「第一章」字样刷数），有效命中最多者胜出成为该书唯一分章正则（存 book.tocUrl），平手时列表靠前者胜（reversed 遍历 + >= 覆盖）；胜出后才用该正则对全书 8MB 块流式分章。对应到文件名排序场景无样本统计量（单文件名最多命中一次），故推荐优先级列表模式。

user:
也就是我们的实现反而更简单？

assistant:
算法核心确实更简单：legado 的样本统计/间隔防刷/平手裁决/编码探测/8MB 流式分章/前言章/超长章拆分/去重全部用不上，我们只做一次正则匹配+一次中文数字转数值（chineseNumToInt 的 TS 移植约几十行）；但多两块 legado 没有的工作量：①回退链设计（无命中文件名怎么排、有序号/无序号混排、不同规则提取的序号按数值直接互比——需写进设计约定）；②工程面更重：规则表 DDL + SCHEMA_BOOT_VERSION 10→11 + core service 七层 + mobile 导航/屏幕 + desktop IPC 五处 + sort_field CHECK 约束表重建迁移，总计约 core 7 + mobile 6 + desktop 6 处改动。结论：难点从算法移到工程。

user:
拍板：①跨层不用担心——novel-master 各目录层级有自己的规则，卷规则自动匹配外侧目录名，无需额外设计；②目录不看字段是开发缺陷，让它支持；③UI 文本「排序字段」改成「排序方式」；④问：元组如何比较？有元组的大于没有元组的？

assistant:
①认同：目录规则每目录一条各自生效，父目录排卷（子目录）、子目录排章（文件），层级天然分工，不存在跨层拼接；②sortDirPaths 补上 sortField 支持（选智能排序的目录里子目录也按序号排），定位为欠账修复；③两端 UI 文案「排序字段」→「排序方式」；④定义完整全序五条：(a) 都有元组→逐位数值比，前缀相同短者在前，不同规则提取的序号同一数值空间互比；(b) 有元组 vs 无元组→有序号的排前面（章节优先、杂项沉底，写死约定）； 无元组→自然排序（数字块按数值、非数字块按码位，纯中文名退化字典序，无需再回退）；(d) 序号打平→原文件名 tiebreak（第一章.txt vs 第1章.txt）；(e) asc/desc=全序整体取反。任意两文件名顺序唯一确定，单测按约定分组覆盖。

user:
先生成 PRD。

assistant:
切换 prd-generate skill。历史迭代检查：无智能排序相关先例（仅 mobile-chat-thinking-and-vfs-sort 的对齐语义相关，作回归防线引用）。澄清一个问题：规则管理页第一版功能面档位。

user:
批量操作、拖拽排序、导入导出 YAML 也做吧。

assistant:
PRD 落盘 docs/Iterations/smart-filename-sort/prd.md：范围=排序方式加「智能排序」（三端+文案改「排序方式」）、优先级列表比较器（含复合序号/中文数字/自然排序回退/tiebreak/desc 反转）、内置规则集+恢复默认、双端规则管理页（全功能面：列表/启停/增删改/上下移/拖拽/批量/YAML 导入导出/测试预览/恢复默认）、目录排序修复、CLI CRUD+test。不包含：跨层组合、在线导入、优选机制、created/updated 语义合并。验收清单覆盖排序正确性/规则管理/CLI/兼容性。dependency=[]。待用户确认 PRD。

user:
PRD 视为确认（用户投喂 spec-generate skill），生成技术 spec。

assistant:
spec-generate 三子代理补探索（迁移机制/regex+CLI 模板/依赖与 UI 先例）后落盘 docs/Iterations/smart-filename-sort/spec.md。关键定案：D1 CHECK 扩枚举三件套原子（DDL+BOOT_VERSION 10→11+rebuild migration 照抄 git 5d271868^ 的 rebuildTable 含 rowid 分块）；D2 规则单表无分组、sort_order 不加 UNIQUE、调序整表重编号（legado PersistOrder 模式）；D3 内置规则固定 id 前缀 builtin-，seed 幂等 INSERT OR IGNORE，恢复默认删 builtin-% 重灌；D4 sortFilesForDir/sortDirPaths 加可选第三参（smartRules/dirMtimeByPath），缺省 smart 退化自然排序保持兼容；D6 捕获组全可解析才采用否则继续下一条；D7 目录时间排序一并做（vfs_entry.mtime_ms 有数据需新查询 listDirectoryMetaUnderPrefix）；D8 mobile 拖拽非 blocking 可砍（自研不引库）；D10 YAML 导入=替换式+确认；D11 预览单源 core service.previewSort，desktop 走 IPC。17 步实现计划（Step15 拖拽非阻塞、Step17 真机验收 blocking manual_user），测试用例 T-SS/T-WE/T-MIG/T-SR/T-MB/T-CLI/T-DT 19 条。待用户确认 spec。

user:
spec 目录已修正（Iterations 大写），投喂 spec-check-loop skill，进入文档审查循环。

assistant:
初始化 spec-check-loop（iteration-state 被已完成的 dev-tool-fixes 占用，按 skill 允许在对话内 YAML 维护编排状态），第 1 轮审查待派发。

user:
（spec-check-loop 第 1 轮，PRD 修复 wave 派遣任务）非 readonly 修复 prd.md 的 must-fix：P1-1 验收「排序正确性」第 3 条 Given 前提错（[2.txt,10.txt,1.txt] 实际全部命中内置数字序号规则，分隔符类含 `.`）；P1-2 兼容性条目与范围 5 目录排序修复口径冲突；P1-4 补内置规则仅可禁用语义；另按「复合规则优先于单序号规则」同步内置集顺序口径。SPEC 由另一子代理并行同步（flags 列、内置顺序、内置仅可禁用）。

assistant:
docs/Iterations/smart-filename-sort/prd.md 七处定点修改全闭合：①验收第 3 条删「未命中任何序号规则」从句只断言 1.txt、2.txt、10.txt，另起一条真回退用例 [公告.txt, 作者的话.txt, 封面.txt]（三者均不命中内置规则，码位序 作者<公<封）；②兼容性改写为「文件排序与现状一致 + name 排序子目录零回归 + 时间排序子目录序按需求 5 新语义（恒字典序→目录时间）属预期修复」，目标节零回归句同步加例外；③范围 4「删除（带确认）」补「（内置规则除外，仅可禁用）」+ 规则管理验收加「内置规则仅可禁用、不可删除；禁用状态重启保持」；④范围 3 建议集把卷章复合挪到最前并补优先级说明（避免复合文件名被单序号规则抢占只提取卷号）；⑤顺手把范围 2 自然排序示例从 2.txt<10.txt 换成 第2话.txt<第10话.txt（「话」不在内置字集，真回退路径，与 P1-1 同坑）。

assistant:
spec-check-loop 第 1 轮：审查 No-Go（2 P0 + 4 P1 + 6 P2），主代理拍板（复合规则前置、加 flags 列、内置仅可禁用不可删）后双子代理 doc-fix 闭合全部条目，附录正则 12 项 node 实测通过。进入第 2 轮审查。

assistant:
spec-check-loop 第 2 轮：审查结论 Go——上轮 12 项 must-fix 全部闭环（含附录正则独立复验），无新 P0/P1。剩余 2 条 P2（T-DT1/Step17 blocking 口径打架、T-WE2 缺退化分支断言）+ 2 条建议（provider 注入点点名工厂、前导零语义确认）符合 trivial 豁免，主代理直接闭合（T-DT1 升 blocking:yes 注明发版门槛非自动门禁；T-WE2 补缺省退化断言；Step6 点名 create-workplace-service.ts 工厂自取零逐端接线；全序规则3加前导零有意为之注）。文档 execute-ready，待用户确认开工。

user:
确认 execute-ready，新建 worktree 后进入 code-dev-loop 开发。

assistant:
用户确认 execute-ready。建 .worktree/smart-filename-sort（基于 dev），独立 npm install + 重建 core/tdbc/tokenizer-driver-node dist 后按 code-dev-loop 编排实现 DAG。

user:
（code-dev-loop 子代理节点 impl-mobile-drag）实现 Step 15——SmartSortRulesScreen 列表长按拖拽调序：拖拽手柄长按进入拖拽态、PanGesture 位移跟随（reanimated）、实时预览插入位、松手调 reorderRules 刷新；D8 约束自研 gesture-handler 手柄、不引第三方库、不新增 GestureHandlerRootView；真机验收不过可砍。要求 typecheck + 相关测试验证，中文 commit，按逻辑块提交。

assistant:
Step 15 完成（feat/smart-filename-sort 分支 fa5e534a + d935558c 两提交）。关键发现：RNGH 2.31 的 GestureDetector 在无 GestureHandlerRootView 祖先时 DEV 直接 throw（生产手势不识别），与 D8「不补 RootView」互斥——spec 探索期未发现该矛盾，改用 RN 内置响应系统自研：手柄 View onTouchStart 记按压时刻，PanResponder.onMoveShouldSetPanResponder 在按住≥300ms 且位移<12px 时接管（快速滑手柄仍走列表滚动，不误触），reanimated shared value 驱动行 translateY UI 线程跟随。交互形态：行首手柄（三条 View 短横条，无字体依赖）长按 300ms 浮起（zIndex/elevation+阴影），拖动中按行实测布局（onLayout Map，含 gap 语义）实时换算插入位、目标行间高亮指示线（absolute 不占布局），松手乐观重排+reorderRules(新序 ids)+silent reload，失败回滚+toast；拖拽中 FlatList scrollEnabled=false 防坐标系漂移；批量模式隐藏手柄。插入位换算与重排抽纯模块 smart-sort-drag.ts（布局缺失均分兜底、原位等价返回原引用跳过提交），12 条单测。ConfigListCard 加可选 style prop 透传浮起阴影（其余调用处零影响）。验证：typecheck 0 错、全量 jest 1107/1107 绿、eslint 0 error（2 个既有 no-void warning 非本次引入）。真机验收 T-DT2 属用户手动项（非 blocking，可砍）。

user:
（code-dev-loop 执行完毕）

assistant:
code-dev-loop 6 wave 全部 done：wave0 [impl-core-schema(4c), impl-core-comparator(2c)] → wave1 [impl-core-domain(6c, Step5/6/7+快照)] → wave2 [verify-core PASS 1889+行为抽检3/3, impl-cli(3c, 真库冒烟吻合)] → wave3 [impl-desktop(3c, 109/109), impl-mobile(4c, T-MB1绿)] → wave4 [impl-mobile-drag(2c, PanResponder 自研), verify-apps PASS] → wave5 [cr-func-full func-ready:yes]。分支 feat/smart-filename-sort 共 26 commits（含 PRD/SPEC 文档与 D8 实现注），dev-ready 达成。关键技术发现：RNGH 2.31 GestureDetector 无 GestureHandlerRootView 祖先时 DEV throw（后续拖拽类功能可复用此结论，改 PanResponder）。Step 17 真机验收（存量库升级+智能排序效果，发版硬门槛）留用户执行。worktree 环境补建过 sksp×3/webview-dist/rn-driver 等 gitignored dist。

user:
先 CR 吧（code-review-loop）。

assistant:
CR loop 2 轮收敛：wave1 三 scope 并行评审（core/desktop/mobile-cli）出 3 P1 + 7 P2 无 P0——P1 三条：core/B-1 懒加载条件加码 ruleEnabled 致 disabled+smart 第三形态分叉、core/B-2 resetDefaults 重灌撞号按 rule_id 隐式决胜破坏置顶、desktop/B-1 列表加载失败静默显「暂无规则」误导；P2 集中口径/DRY（flags 双实现、工厂内联双实现、ruleId 缺失静默、拖拽 setData 半死、TSV 列序、move 0/1 基、兜底步长双源）。wave2 spec-fix 落盘 cr-fix-spec.md（10 条全写入）→ review-full 复核：代码无新结构问题，fix-spec 自身两处路径笔误（apps/mobile/cli→apps/cli）+ mc/C-1 缺 --to 0 拒绝增补 + B-2 措辞校准，三处 trivial 主代理直接执行闭合。fix-spec-ready 达成（待用户确认后按 fix-spec 执行修复）。9 条 open questions 入附录（含 importRules seed 撞号同型问题、desktop importRules/exportRules 死通道两条需拍板）。

user:
pull 后发现排序算法有变化，评估后确认开工（先 merge dev 适配 + L1 签名修复，再执行 CR fix-spec）。

assistant:
dev 已同步 v1.5.13（huge-card-import-crash：d040dc3f 规则视图按目录一次排序 planByDir 重构、27be71c4 评估链 L1 conn 级缓存、645b18b5 占位块真实 mtime）。试合并仅 2 文件冲突（rule-engine/service，smartRules 接线挪 planByDir 构建点）；关键语义冲突：L1 缓存签名 {vfs,rules} 不含 smart_sort_rule，改智能规则后排序陈旧——补 fix-spec core/B-3 [P0] 三元组签名。执行顺序：merge dev 适配 → CR fix 10+1 条 → 全量 verify。

user:
fix-merge-dev 节点执行：merge dev 解冲突 + core/B-3 L1 缓存签名扩 smartRules 三元组 + core 全量验证（worktree smart-filename-sort）。

assistant:
两提交完成：①merge commit 7c212e7e——rule-engine 的 computeDisplay/walkDir 取 dev planByDir 查询弃现场排序，关键适配在 buildDirSortPlans（同文件 73 行起，dev d040dc3f 的 planByDir 构建点）两处 sortFilesForDir 调用接入 { smartRules: ctx.smartRules }，sortDirPaths 的 { smartRules, dirMtimeByPath } 保留；service import 双边合并，懒加载 provider 与 dev 缓存链（ensureWorkplaceViewEntry/getCachedWorkplaceView/publishWorkplaceView）共存。②B-3 提交 f4a4d874——WorkplaceViewSigs 扩 {vfs, rules, smartRules} 三元组、getCachedWorkplaceView 三比对；采样经新 deps.smartRuleRows provider（SmartRuleRowsProvider 原始行不编译，createWorkplaceService 工厂默认组装，缺省时该来源不参与失效故既有直接构造测试不破）；新测试 workplace-view-cache-smart-sig.test.ts（T-B3a：禁用 builtin-zh-chapter 后签名 miss 重算、有序号优先序退化为自然序行序反转——注意 smart 禁用后退化的是自然排序而非字典序，断言须用「第5章.md/序章.md」命中/不命中混排制造差异；T-B3b：未动智能规则缓存照旧命中）。踩坑：dev 带来的 workplace-view-cache.test.ts spying 面缺本分支新增的 listDirectoryMetaUnderPrefix（dev 上不触发、合并后 service 融合调用必触）已补代理。验证：core 全量 1921 用例 0 fail、typecheck/build 绿。

user:
（code-review-loop cr-func-fix-review 节点，readonly）复审 11 条 must-fix 闭合质量 + merge 适配正确性：逐条核对 cr-fix-spec（core/B-1~C-2、desktop/B-1~C-1、mc/A-1~C-2）代码落点与验收测试真实性；buildDirSortPlans 两处 sortFilesForDir 的 smartRules 传参、walkDir sortDirPaths、L1 三元签名失效语义；spec_deviations 状态与 fix-spec 元信息；给 func-ready 结论。

assistant:
（主代理手工只读复审，未派子代理）结论 func-ready: yes，无新 must-fix。①11 条全闭合：B-1 懒加载条件仅 sortField==='smart'（workplace.service.ts:342）+ 独享库捕获力注释（workplace-smart-lazyload.test.ts 文件头，防共享库 smart 残留掩盖退化）；B-2 resetDefaults 显式 renumerate([builtin 种子序,...userIds 相对序])（smart-sort-rule.service.ts:247-282）+ T-SR2 置顶用例；B-3 三元签名（view-cache.ts:25-30）无条件采样 listOrdered 原始行，T-B3a 特意用「行数不变的整行 update 禁用」戳计数型指纹盲区断言 miss 重算+排序反转，T-B3b 非 smart 库照旧命中；C-1 flags 单源 assertFlagsValid；C-2 工厂 provider=()=>listCompiledRules()；desktop 三条（loadFailed 态+文案区分 2235/2511 回退新建+2117 getData 优先 state 兜底）——desktop 测试为源码正则断言（仓库 readFileSync 惯例同款，偏弱但有合并后 QA 手动项兜底）；mc/A-1 列序 order⇥id⇥enabled⇥flags⇥name⇥pattern + e2e 用 builtin-en-chapter flags='i' 钉死第 4 列、空 flags 不吞 tab；mc/C-1 /^[1-9]\d*$/ + {index:N-1} + 双处「1 基位次」文案 + e2e --to 1 落第一位/--to 0 非零退出；mc/C-2 FALLBACK_ROW_STEP=96+avgRowStep 单源、同源断言喂回 computeInsertIndex。②merge 适配完整：buildDirSortPlans auto 名单（105 行）与全量名单（113 行）两处 sortFilesForDir 均传 smartRules、walkDir sortDirPaths（202）、filetree 宏 sortedChildren 双函数均传；生产唯一入口 createWorkplaceService 同接 smartRules+smartRuleRows 两 provider。③spec_deviations 两条实际已对齐（Step 6 条件=spec 口径、CLI 列序=Step 9 钉死），但 fix-spec 表格状态列仍「open→将 fixed」待刷 fixed，元信息状态 fix-spec-ready 也该刷执行完成态+head_sha（ca1bba60→4f84da40）。④两条 suggestion：workplace.service.ts:272 注释错字「部合反映」→「都会反映」；desktop 源码断言弱于行为测试。分支 38 提交工作区干净。

user:
确认开工（merge dev 适配 + L1 签名修复 + CR fix-spec 执行）。

assistant:
执行完毕：wave-merge fix-merge-dev（merge 7c212e7e 解 2 冲突：planByDir 构建点 buildDirSortPlans 两处 sortFilesForDir 接 smartRules；B-3 签名三元组 f4a4d874，T-B3a 用行数不变的整行 update 戳穿计数型指纹盲区）→ wave-fix 四并行节点闭合剩余 10 条（core-service B-1 06ea55db+C-2 4f84da40——B-1 抓到共享库测试假绿陷阱改独享库；core-rule B-2 a2e2eff9 TDD 先红后绿+C-1 21d10f18；desktop 三条 344001ed 加源码断言测试 4 用例；mcli 三条 d598ebb2+01545706，纠正主代理 prompt 列序笔误）→ verify-all-fix PASS（core 1923/desktop 109/mobile 1113/CLI e2e 4+冒烟 move 1 基落位正确）→ cr-func-fix-review func-ready:yes（11 条逐条核对语义全对、merge 适配三处传参链完整、dev 回归面完好）→ trivial 收尾 e15893e0（fix-spec 执行完成态+注释错字）。分支 39 提交工作区干净。遗留：真机验收（Step17/T-DT1/T-DT2）、open questions 两条拍板（core-oq1 importRules seed 撞号、desktop-oq1 死通道）、并入 dev。

user:
主分支又更新了，合并一下（第二次 merge main，落后 204 提交：v1.5.15/16、export-link-skill-mgmt、desktop-regression-fixes、e2e 提速、第四轮 migration 清理 usage-cache 退役基线升 v1.5.5）。

assistant:
试合并 20 文件冲突（三端注册表追加型为主 + novel-master-bootstrap.ts 语义交互 + core package.json/tsconfig.test.json 合流），schema-migrations/index.ts 自动合并成功（退役行与尾加行不重叠）。派 fix-merge-main2 子代理正式合并 + 全量 verify。

assistant:
fix-merge-main2 完成（merge commit 062eddfe）：20 冲突全解。重要发现：main 在 v1.5.14-16 间移除了正则系统（v11：删 regex 两表与全部注册点；v12：llm_provider.body_params_json）——本迭代参照的 regex 域模板在 main 上已消失，17 个「追加型」冲突实为「main 删 regex × 我们加 smart-sort-rule」的同点交叠，解法一律删 regex 条目留 smart 条目；SettingsViews 删 Regex 三视图保留 SmartSort 两视图（main 新加的 ContextMenu.disabled/SettingsListItem.desc 均向后兼容无需适配）。BOOT_VERSION：我们的 v11 编号被 main 占用 → 顺延 v13（v12 存量库须走慢路径建 smart_sort_rule 表，#10 教训）；T-MIG1 的 user_version=11 硬编码改引用常量。验证全绿：core 2014/desktop 125/mobile 1162/CLI 4+冒烟。分支 HEAD 062eddfe，工作区干净未 push。

user:
启动 metro 并安装到真机；「版本低了，调整下」。

assistant:
真机装配完成：杀掉已闭环 export-link-skill-mgmt 迭代的残留 metro（8081 占用者，17:18 起无人用）→ worktree 首次 npm run android 连环踩坑：nohup 起不了 metro 窗口、JVM 11（换 sdkman 17.0.13-tem）、local.properties 缺失、metro watcher 被 gradle CMake 临时目录删除带崩、versionCode 兜底 1 低于真机 1200（elm 构建）被荣耀拒装——终以 gradle installDebug -PversionCode=1201 -PversionName=1.5.16-smart 装上（用户手机端点了允许）。装后用户直接进到了智能排序规则详情页（中文序号章节/Flags 预设/示例）——v12 库→v13 包升级路径实质打通：慢路径建表+迁移+seed 全正常、旧数据保留。环境姿势已存项目记忆 #112。

user:
真机验收：长按拖拽不生效，直接移除；列表左侧拖拽手柄 icon 也移除。

assistant:
按 spec D8 预案（真机验收不过可砍）移除 mobile 拖拽：删 SmartSortRulesScreen 拖拽全套（DragHandle/DragTranslate/InsertLine/PanResponder/拖拽状态）+ smart-sort-drag.ts 及 12 条单测 + ConfigListCard style prop（若仅拖拽使用则回退）；调序保留上移/下移/置顶/置底；desktop HTML5 拖拽保留（未被点名）；spec D8/Step 15 补移除注记。RN 侧改动 metro reload 即生效。

assistant:
fix-remove-mobile-drag 完成（c415d2e4，净 -573 行）：删 DragHandle/DragTranslate/InsertLine/PanResponder/拖拽状态全套 + smart-sort-drag.ts 与 15 条单测 + ConfigListCard style prop 回退（git log -S 证实唯一使用者是拖拽）；调序保留按钮主路径；spec D8/Step15 补移除注。jest 188 套件 1147 条全绿、typecheck 0 错。真机已重启验证 UI。

user:
flags 输入框多余，可视化配置和输入框保留一个就足够。

assistant:
拍板：双端编辑器 flags 收敛为纯四选预设（无/i/g/gi），删自由输入框；CLI --flags 与 YAML 导入保留全量 flags 能力（zod 不动，gimsuy 仍合法）；spec Step 11/13 措辞同步。

user:
正则输入框要支持全屏输入（参考 agent 配置实现）；支持 /xxx/g 字面量风格输入连 flags 可视化都省掉；不带 // 的输入也应生效（正则大概率 AI 生成）。

assistant:
拍板：① core 加 parsePatternInput/formatPatternInput 纯函数（/ 开头才拆 body+flags，flags 过 gimsuy 白名单；裸输入当纯 pattern flags 空）双端共用+单测；② mobile 正则框换全屏编辑（照 agent 配置先例）+ 接入解析；③ 刚做的 flags 四选预设双端删除；desktop 同步解析、全屏视 agent 先例而定；④ CLI 不动（--pattern/--flags 显式两参，agent 面更明确）；⑤ spec 措辞同步。

assistant:
fix-pattern-input-fullscreen 完成（4 commits：core 08fab0e3 解析单源+2032 测试、mobile eb4729b4 全屏编辑照 PromptEditorScreen 先例（模块级回调存取防串台）+删预设、desktop b53f2ac2 textarea rows=2 接入（agent 无全屏先例不加）+删预设、spec 1ecfe0b0）。parsePatternInput 语义：仅 / 开头才拆（最右未转义斜杠定界），flags 须 gimsuy 不重复、body 非空且无未转义斜杠，任一不满足整串退裸 pattern；formatPatternInput 对未转义斜杠补 \/ 保证回显可逆。遗留观察：desktop run-tests.mjs glob 在 /bin/sh 下只匹配一层子目录，顶层 85 个测试不进 npm test 入口（仓库级既有问题，非本迭代引入）。

user:
全屏编辑是不是没有支持输入框的顶起？

assistant:
对——照抄的 PromptEditorScreen 先例本身就没做键盘避让，且 RN 0.85 + targetSdk 36 默认 edge-to-edge 下 Manifest adjustResize 不可靠（仓库已有踩坑结论：keyboard-controller 的 KAV 在 Android behavior 空等于无效）。修：PatternFullscreenEditorScreen 照仓库范式 A（ChatHistorySearchScreen 同款）补 iOS KeyboardAvoidingView padding / Android AndroidKeyboardClipBody 裁切收缩。typecheck 绿 + 全屏编辑器 4/4 测试过。注意：agent 的 PromptEditorScreen 同款缺失仍在（用户未提，未动）。

user:
五点反馈：① agent 全屏编辑也补键盘避让；② 测试预览重新设计——排序测试作用不大，要正则匹配测试；实时渲染性能差不清晰，改按钮手动触发+下方显示匹配内容；③ 内置正则没显示 //（答：裸 pattern 兼容设计，非 bug；统一改始终显示 /pattern/flags）；④ example 示例作用不大改 description 描述；⑤ 全屏输入意义不大撤掉，改自适应高度的 textarea 式输入。

assistant:
派 fix-preview-redesign 节点：①PromptEditorScreen 补范式 A 键盘避让；②core 加 matchSmartSortPattern 纯函数（正则测试单源），编辑屏预览改「文本输入+测试按钮→匹配结果（匹配文本+捕获组）」，排序测试仅保留在 CLI（previewSort API 不删）；③formatPatternInput 始终输出 /pattern/flags；④example→description（DDL RENAME 迁移刷内置行出厂描述、zod/bundle schema v2 兼容旧字段、CLI/双端 UI 联动）；⑤mobile 撤 PatternFullscreenEditorScreen 全套改 auto-grow multiline，desktop textarea 不动；desktop 正则测试走 IPC preview 通道改语义（renderer 不依赖 core 边界维持）。

assistant:
fix-preview-redesign 完成（9 commits，四端全绿 core 2047/mobile 1147/desktop 125/CLI 4+冒烟）：①agent PromptEditorScreen 补避让（发现 EditorScreenShell 内建避让真机不生效，外层包范式 A 才有效）；②matchSmartSortPattern 单源（非 g 克隆加 g matchAll、可选组 null→'-'），双端按钮手动触发显示「匹配文本 [组]」，排序测试仅留 CLI；③formatPatternInput 始终 /pattern/flags（裸解析兼容不变）；④example→description 全链（RENAME 走 pending migration 不 bump BOOT_VERSION、迁移内联出厂描述刷 builtin 行、bundle v1→v2 兼容旧字段、CLI --description）；⑤撤 mobile 全屏编辑改自适应 multiline（46 起步 170 封顶自建，无仓库先例）、desktop IPC preview 通道改语义为 match（不留死通道）。spec 补重构注。

user:
改的有问题——agent 配置之前的全屏编辑没问题，修改后顶起多出一片空白。

assistant:
教训：PromptEditorScreen 原有键盘行为本来就正常（EditorScreenShell 在该屏场景的内建避让/WebView 自适应已足够），子代理「补」的外层范式 A 避让造成双重补偿出空白。已 revert 63475cd6（e0df8a89，仅 PromptEditorScreen 一个文件），typecheck 绿。智能排序全屏编辑器已随⑤撤除，范式 A 在本迭代无残留使用。子代理的「EditorScreenShell 内建避让不生效」结论只对已删的正则全屏屏成立，不可外推。

user:
描述怎么不是 textarea？//是必须的吗（答：非必须，裸输入一直兼容，有单测）？测试结果要匹配字变色不是字符串+数组；工作区命名规则可能不允许空格特殊字符，影响内置正则吗？

assistant:
命名规则核实：全链路无文件名字符白名单（normalizePath 仅 POSIX 规范化、新建/重命名弹窗无校验、导入无过滤、zip 只拦空名/反斜杠）——内置正则宽容设计无害且合理，不改。派 fix-desc-and-highlight：①matchSmartSortPattern 的 matches 加 index 偏移（matchAll index，供高亮切分防重复文本错位）；②双端描述字段改自适应多行；③测试结果改高亮渲染（匹配段主题色 + 共 N 处匹配，去字符串+数组清单）。

user:
新建/重命名弹窗无校验？最好加个简单校验，不支持换行等特殊字符，即标准 POSIX 规范？POSIX 规范支持换行？

assistant:
答：严格 POSIX 只禁 / 与 NUL（换行技术合法），便携集只有 A-Za-z0-9._-（连空格禁）——均不可照搬（中文文件名核心场景）。拍板设计：拒绝控制字符/NUL/纯空白/首尾空格/./..，其余放行；core VFS 创建/重命名入口统一拦（三端+agent 工具），弹窗前端友好提示，独立 commit 并入本分支。

assistant:
fix-desc-and-highlight（4 commits：core matches 加 index 偏移 82d49964、双端描述自适应多行+高亮渲染+计数 d68160d4、spec 重构注 213a5cd5）与 fix-vfs-name-validation（2 commits：core 校验+五入口接入 43803e39——mkdir/write 创建分支/writeWithRevision/renamePath/renamePrefix 拒控制字符/纯空白/首尾空格/.与..，INVALID_NAME 错误码+双格式化，导入链路不拦；双端弹窗前置校验 b06dae8d——desktop 经 shared/logic 薄再导出绕 renderer X1 gate）全绿：core 2056/mobile 1147/desktop 125/CLI 4。

user:
目录规则的排序方式四个 tag 换行了，改下拉框让页面紧凑无纵向 scroll；终章/序章 legado 怎么处理（我们目前沉底）？性能敏感吗——几百文件会卡吗，之前优化过一次（d040dc3f），智能排序会变差吗？

assistant:
查证：①性能无忧——比较器是 decorate-sort-undecorate（排序前每 basename 预提取一次元组，排序纯数值比较，D5）+ L1 评估链缓存兜底，几百文件毫秒级；②legado 对序章/终章零处理——其目录顺序是正文出现顺序，天然正确；我们文件名排序无出现顺序，当前按「无序号沉底」排后面。方案（待用户拍板）：比较器加特殊锚点段（序章/楔子/引子排最前、终章/尾声/后记排最后）；③排序方式 chip 换 PickerListModal 选择器派单中。

assistant:
fix-sortfield-picker 完成（03ae15e8）：排序方式 4-chip 换 PickerListModal 值行（智能排序排选项首位），面板 346px<360 一屏免滚动；方向 2-chip 与填充 3-chip 单行放得下维持原样；新增交互闭环用例 188/1148 绿。

user:
捕获数字改成智能数字/固定最大/固定最小三档就好——智能数字自动处理中文/阿拉伯混合（单中文/单阿拉伯也不冲突）。

assistant:
设计定案（讨论收敛）：capture_kind 枚举 smart|fixed_max|fixed_min（默认 smart，存量行为零变化）；smart=现有中文+阿拉伯混合管道；fixed 档命中即哨兵元组（±∞ 单元素，仅内存比较不落库不序列化）；同档并列文件名 tiebreak；全序六条不动。新增三条内置规则：序言类 fixed_min、终章类 fixed_max、番外类 fixed_max。编辑 UI 加三档下拉，测试预览显示排序元组。派 fix-capture-kind 单节点全链实现。

user:
（讨论两轮后开工）捕获数字下拉定稿三档：智能数字/固定最大/固定最小——智能数字自动处理中文/阿拉伯混合（匹配范围由正则字符类决定，转换管道由档位决定，两者正交）；固定档哨兵 ±∞ 只在比较时存在；测试预览显示排序元组；内置七条（现有四条标智能+序言 fixed_min/终章 fixed_max/番外 fixed_max）；固定档同值文件名决胜；固定档忽略捕获组。

assistant:
派 fix-capture-kind：core DDL 加 capture_kind 列（pending migration 不 bump BOOT_VERSION）+ 提取管道分档 + seed 七条 + matchSmartSortPattern 返回元组 + bundle 兼容；双端编辑屏下拉与预览元组行；CLI --capture-kind；spec D12。注意存量测试假设内置 4 条的连锁适配（B-2 resetDefaults 断言等）。真机验证需完全重启 app 跑迁移。

assistant:
fix-capture-kind 完成（7 commits + X1 gate 收口 49c580ee）：capture_kind 三档（smart 零变化/fixed_min/fixed_max 哨兵元组跳过捕获组，±∞ 仅内存比较），迁移 add-smart-sort-capture-kind-v1（pending 通道不 bump BOOT_VERSION），内置 4→7 条（prologue/finale/extra 前置 1/2/3），matchSmartSortPattern 加 tuple 展示（"(12,)"/"(固定最小,)"），双端编辑器「捕获数字」下拉+预览元组小字，CLI --capture-kind + list 第7列。验证：core 2071/mobile 1148/desktop 125/CLI e2e 6（全量26失败经基线对照确认环境性）。已知行为：终章/番外同为 fixed_max，文件名决胜「番(U+756A)」<「终(U+7EC8)」→ 番外排在终章前（与小说惯例相反，已锁行为待用户真机拍板）；存量库 seed 后新旧内置 sort_order 撞号 1/2/3 各两条，listOrdered 全序决胜无抢占冲突，调序即收敛。

user:
智能数字下拉框样式调整——参考 agent 配置的灰主体（非白主体）；另报 metro 挂（已修：desktop 打包 release 目录增删带崩 watcher，删残留重启+记忆 #112 补防）。

assistant:
两处下拉值行（编辑屏捕获数字+目录规则排序方式）统一改 tokens.bgSecondary 灰底（对齐 ToolPolicyPicker），5f41ece6，typecheck 绿+相关测试过。

user:
「启用规则」开关放到表单最上方。

assistant:
已移（FormSwitchRow 提到名称字段前），typecheck 绿。

user:
规则卡片的标题与解释移除，改右上角问号（参考搜索配置）。

assistant:
ed6dea90：照 SearchEnginesScreen 先例——标题栏菜单位换 HelpIcon（useFocusEffect + setStackOverride，重聚焦不丢），ModalShell 四段说明（优先级/智能数字/固定档/正则格式）；规则卡片去 title/hint 更紧凑。typecheck+eslint 绿。

user:
发现问号共同问题：点击进入新页面时问号先渲染在原页面再进入新页面，转场动画期间两个页面同时显示问号。

assistant:
根因：HeaderContext 的 stackOverride 是全局单例，转场期间两个屏 header 同时可见且都消费同一 override → 泄漏。修（fa485f10）：HeaderOverride 加 ownerRouteKey，新增 useStackOverrideSetter hook（自动附加当前屏 route.key），StackScreenLayout 把 route.key 传给 AppHeader，AppHeader 仅归属屏应用；七个调用方（搜索配置/引擎详情/供应商详情/云同步/提示词编辑/智能排序编辑/VFS 返回导航）统一切换；5 个 mock HeaderContext 的测试同步补 mock（两个断言旧链路的改共享 mockSetStackOverride）。1148/1148 全绿+typecheck 过——这是全 App 级修复（不止问号，标题 override 同病同修）。

user:
【code-review-loop · scope】review-scope-desktop-cli 节点：readonly 评审 76c03550..fa485f10 的 apps/desktop + apps/cli + packages/core/src/public（维度 A/B/C/C-orch/G），重点新批次：①编辑器终态（字面量+描述+高亮+捕获下拉）②match 通道改语义③X1 gate 薄再导出④CLI capture/description/move⑤public 导出面与 allowlist；已知 desktop-oq1 死通道勿重复报。

assistant:
（readonly 评审，范围 26 文件 +2240）结论 scope-ready: no——新批次 6 条 must-fix 尚未入 fix-spec：dtcli/B-1 [P1] 编辑器测试结果不随测试文本变化清空，旧 matches 偏移对已编辑文本切分 → 高亮错位+计数失真（mobile changeTestText 已清、desktop 漏对齐，SettingsViews.tsx 测试区 onChange 只 setTestText）；dtcli/B-2 [P2] save 的 name 未 trim 无空名前置拦截（core zod min(1) 挡不住纯空白名，mobile 有 trim+拦截）；dtcli/B-3 [P2] 编辑器加载 effect !res.ok 静默 return（desktop/B-1 同款惯例违背）；dtcli/C-1 [P2] 哨兵元组文案三处实现且 formatSortTupleForDisplay 公开导出零生产消费（match tupleForCaptureKind 内联同文案、CLI test 手写哨兵）；dtcli/G-1 [P2] 高亮切分纯函数（零宽/重复偏移）与 match DTO 无桌面行为测试；dtcli/G-2 [P2] CLI import/export round-trip 与 enable/disable 零 e2e。spec_deviations：none（Step 9/10/11+D13 重构注全部落实：match 通道更名+index/tuple DTO、shared/logic/smart-sort 薄再导出过 X1、list 七列、move 1 基含 --to 0 拒绝、smart-sort-rule/vfs allowlist 快照同步）。open_questions：desktop 保存无本地 validateSmartSortRuleDraft 前置（mobile 有，两可）；inner ok:false 无 --error 样式（观感两可）。cr-fix-spec.md 仍为 round2 执行完成态、只覆盖旧批次 11 条，需 spec-fix 增补。

user:
没什么问题，再 CR 一遍吧，code review loop。

assistant:
Round 4（base 76c03550→fa485f10，真机验收增量批次）：三 scope 并行评审（core 5 条全 P2：超长数字 Infinity 溢出击穿哨兵前提/哨兵文案双源/flags 第三份实现/port 注释口径矛盾/注释错字；mobile 1P1+5P2：ownerRouteKey 零测试/加载失败 dirty 恒真/结果不随档位失效/七文件死 import/拖拽注释残留/切分零测试；dtcli 1P1+5P2：desktop 高亮错位（旧偏移切分）/name 未 trim/加载静默/哨兵三处手写/桌面零测试/CLI 四子命令零 e2e）→ spec-fix 合并 15 条落盘 a798ad82（行号实测校正）→ review-full 终审：14/15 完整 + 三项文档级缺口（#2 desktop 实为三入口漏清/新增切分双源收敛 P2/VFS deviation 未流转）→ trivial 直接执行闭合 96860afb，Closure 表附，fix-spec-ready。终审确认：四条迁移叠加顺序正确、快路径不短路 pending migration（#10 事故模式不存在）、D/E/F/H/J 全维无新发现；spec BOOT_VERSION 数字勘误（写 10→11 实为 13）入 K 类。

（记忆去重注 2026-09-13：worktree 分支里子代理曾落 20260912-smart-sort-pattern-literal-fullscreen.md 与 20260912-smart-sort-fix-preview-redesign.md 两个同主题文件，按「一个主题一个文件」已删并入本文件。收编两条关键坑：① EditorScreenShell 内建的三分支键盘避让真机不生效（RN 0.85 + targetSdk 36 edge-to-edge），外层再包范式 A（iOS keyboard-controller KAV padding / Android AndroidKeyboardClipBody）才是有效写法——但 PromptEditorScreen 原本就正常，硬包反而双重补偿出空白（e0df8a89 revert 教训：避让补丁要真机验证过再上，不能拿「另一屏不生效」外推）；② 模拟存量库冒烟时完整 bootstrap 会因缺全套表在前序迁移/seed 上炸，最小化模拟要么预登记前序迁移 applied、要么 user_version=0 走慢路径建全套表。）

user:
看下记忆，然后 .worktree/smart-filename-sort，按照 docs/Iterations/smart-filename-sort/ 的 cr spec 修复吧。可以派遣子代理干活。

assistant:
Round 4 fix-spec（16 条 = 2 P1 + 14 P2）执行，三波次 DAG（起点 HEAD 82ecc6cf）：
- wave1 impl-core 5 commits：8b69603b（B-4 parseChineseNum 三分支收敛单一出口加 Number.isFinite 守卫，±Infinity 溢出返 null）；20318efd（C-3 match 通道 tupleForCaptureKind 删内联哨兵文案改调 formatSortTupleForDisplay，FIXED_MIN/MAX_SORT_TUPLE 直喂）；41d11000（C-4 flags 第三份字面复制收敛 schema 层 isFlagsValid 纯谓词）；7d3b12b0（F-1/F-2 注释口径与错字）；e2ed49dc（#16 core 侧新增 splitSmartSortHighlightSegments 纯函数，{index,text}[] 最小入参，经 public/smart-sort-rule 导出+allowlist 快照同步，切分三边界测试单源到 core）。core 2078/2078。
- wave2 三路并行：mobile 4 commits（310c5f1a G-1 AppHeader ownerRouteKey 三态+setter 断言，跑红验证实测捕获力——临时改回不看 owner 用例②变红；b49674a9 applyPatternInput/换档位两处照 changeTestText 清 testOutcome + 删本地切分改调 core 导出（jest 补 ^@novel-master/core/smart-sort-rule$ moduleNameMapper 直连 dist）；56d1c57e baseline 惰性初始化对齐 DEFAULT_DRAFT 消伪 dirty——偏离 spec 字面 catch setBaseline 但更简等价；ff8c83fd 七处 useHeaderContext 死 import+头注释）1156/1156；desktop 3 commits（3ce5d315 run-tests.mjs glob 修复——/bin/sh 无 globstar 顶层 72 个测试文件从不进入口，入口 20→92 文件、125→484 用例，方案是三模式整体加引号统一 node --test 递归展开而非两段显式 glob（后者会重复传入顶层 .tsx）；d3e3b5b1 invalidateMatchResult helper 三入口清结果+save name trim 空名拦截+list effect 失败 toast；38a38a81 删本地切分经 shared/logic/smart-sort 薄再导出+match handler 行为测试 4 例+源码级断言 5 例）；cli 1 commit（53c7d8d4 test 命令元组显示改调 formatSortTupleForDisplay 带括号格式 + G-2 round-trip e2e：export→disable/enable 双向翻转→import 回灌全表 deepEqual）sort-rule e2e 7/7。
- wave3 主代理终验：core 2078/2078、mobile typecheck+1156/1156、cli typecheck+e2e 7/7、desktop typecheck 过+480/484——4 个失败套件（chat-prompt-tokens/cloud-sync/provider-identity/createDesktopNovelMasterRuntime）经查全是 Secret Service keyring 环境性签名（节点执行期同命令两轮全绿、测试文件属 v1.4.21 既有、与本批无关）；CLI 全量 26 失败基线对照集合一致（环境性存量）。
- 收尾 f164e830：fix-spec 刷执行完成态（16/16 + K 节 glob/勘误/补章全闭合，CI 断言确认留发版期）；spec 三处 BOOT_VERSION 勘误（10→11 实为 13）+ 附录 B VFS 文件名校验补章（设计拍板/五入口/导入豁免/双端前置）。

坑位收编：① desktop 顶层测试被 glob bug 长期挡在入口外（92 个只跑 20 个），修入口后 keyring 会话态成为新变量——「全绿」结论要注明 Secret Service 会话态（test/desk-e2e-regression 的「keyring 解锁后补跑」同坑）；② 用 vitest 跑 CLI 的 node:test 套件会 collection 失败报 no tests，CLI 正确跑法 tsx --test；③ 子代理并行同 worktree 干活可行——git add 精确圈文件+领地纪律（只碰自己 apps/* 目录），三节点零冲突。

user:
（wave3 终验 desktop 480/484，4 个套件报 Secret Service access failed）keyring 解锁的命令给我，我执行。

assistant:
（与用户多轮拉锯后的定性结论）login keyring 被「空闲自动锁定」悄悄锁上导致 4 套件环境性失败；解锁战役走投无路的完整记录：
- 9/7 重启后用过的方案（pkill 全清 + `echo 密码 | gnome-keyring-daemon --daemonize --login` 接管）这次失效，两因：①那次 pkill 砍的是占总线名的孤儿旧 daemon，这次第一刀砍掉的是健康在线的 PAM 正规军（1187），后续全乱；②手动 `--login` 实例这次起后不上总线（PAM 配套模式缺握手）。
- `gnome-keyring-daemon --unlock`（带/不带换行、单实例+控制插座健在的干净状态下）在本机一律挂起成僵尸客户端，连出 4 个卡死实例；D-Bus Unlock 路线的 prompt 对象一创建即消失（守护进程弹不出 gcr 密码框）；gcr-prompter/SystemPrompter 组件齐全（22.04 + gnome-keyring 40），非缺件。
- **唯一可靠解：注销重登**（libpam-gnome-keyring 自动解锁 + 正规守护进程接管），重登后 Locked=b false，4 套件复跑 8/8 全绿。
- 排障工具箱：`busctl --user get-property org.gnome.keyring /org/freedesktop/secrets/aliases/default org.freedesktop.Secret.Collection Locked`（b true/false 即锁态）；进程名 15 字符截断坑——pgrep/pkill 匹配 `gnome-keyring-daemon` 必须 `-f`，且 pkill 命令行里含明文串会自匹配杀掉自己的 bash（用 `[e]` 括号正则且整条命令不得出现明文）。
- 预防：seahorse →「登录」keyring 属性 → 取消「空闲时自动锁定」（待用户有空操作）。

user:
启动 metro，安装到手机看看。（装配成功后）没什么问题，生成 changelog。

assistant:
真机装配 v1202（versionName 1.5.16-smart）：8081 空闲无需杀残留、荣耀真机在线；姿势 = preandroid dists + build:webview:native → gradle installDebug（**先装后起 metro**，防 CMake 临时目录带崩 watcher）→ metro --reset-cache（防 dist 变更被缓存吞）→ adb reverse tcp:8081 补隧道（gradle 直装不走 run-android，reverse 不会自动设）。途中揪出 run-gradlew.mjs 路径 bug 并修复（84652ed5）：f466efa5 引入的跨平台启动器 join(scripts,'..','..','android') 多走一级落 apps/android，spawnSync cwd 不存在时静默 ENOENT 退 1 零输出——e2e:build-apk 自引入起全平台不可用；排障特征是「gradlew 直接跑正常、经脚本零输出退 1」。用户真机验证无问题（规则编辑清结果/调序均正常）。
CHANGELOG Unreleased 落盘（6ac5937a）：新增 3 条（文件名智能排序/规则管理页含 YAML 与正则测试/CLI sort-rule 命令组）、修复 3 条（子目录排序遵循目录规则/文件名校验/移动端转场标题与「?」残留——该缺陷影响 v1.5.15 已发布的 stackOverride 机制故保留）、变更 1 条（「排序字段」→「排序方式」+ picker）、维护 1 条（desktop 测试入口 glob + e2e:build-apk 双脚本修复）。round 4 批次内引入又修复的 bug（高亮错位/伪 dirty 等）按 changelog skill 规则未入修复段；内置规则名与 UI 对齐（序章/开篇、终章/收尾、番外/外传）。
