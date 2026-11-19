---
date: 2026-11-19
title: nm-style-toolchain 检测器工具链重写（立项，spec-generate 流程中）
keywords: nm-code-style, 工具链重写, symbol-index, 形态无关引用计数, TS CLI, 插件式规则, spec-generate, spec-check-loop
abstract: 用户口述需求：p24 对象化后 check-inline/check-methods/find-fake-exports 对 namespace 成员失明（覆盖缺口非报错），dead/inline 引用计数必须形态无关（裸函数/对象成员/namespace/class，同 IDE 索引符号不索引声明形态）；现有脚本职责混乱轻重不齐，重写为 TS 编译 + CLI + 仓库内插件式规则注册表，SKILL.md 随工具同步。用户拍板流程：spec-generate 出稿 → spec-check-loop 两遍 → 直接开工（重写无需求逐项确认）。规模 ~1811 行 + 5 自测；typescript 6.0.3 在 root node_modules 现成。
---

user（口述需求，2026-11-19）：
对象化后 nm-code-style 脚本还有效吗（inline/dead/all/sign）？→ 主代理核实：signatures/dup-gate/bare-exports 满血；inline 只收函数声明+函数值变量、methods 只认 class、fake-exports 只认顶层导出——namespace 成员掉进三段之间的缝。用户判断：①脚本需要升级修复，dead/inline 的计算规则本身仍必要，且必须支持裸函数/对象/namespace 各种形态的引用计算（IDE 不会因为是对象就无法索引）；②当前脚本乱、功能混乱、轻重不齐；③可用 TS 写+编译，改 CLI 风格，功能插件式，方便更新优化；④脚本更新后 skill 也要更新。

assistant:
问开工方式（AskUserQuestion：先立 spec / spec 后直开 / 先 p25 后重组），用户答：「使用 spec generate skill，然后 loop 两遍，就基本可以开工了，因为基本是重写，其实没什么需要我确认的」。即 spec-generate → spec-check-loop×2 → 开工，无需用户逐项评审。
已启动 spec-generate 流程：需求=口述（无 prd.md）；同主题 memory=本文件；探索面拆 4 片并行（A scripts 精读 / B 集成调用面 / C 数据格式+golden / D TS 构建约束），同步等待后汇总落 docs/Iterations/nm-style-toolchain/spec.md。

assistant(探索汇总 + spec 落盘,2026-11-19):
4 份探索报告关键结论：①覆盖缺口实证（inline 只收函数声明+函数值变量 check-inline.mjs:95-101、methods 只认 class :101-103、fake-exports 只认顶层导出 :70-96）；②确认缺陷 7 项（inline isExported 对箭头失效→guards.ts 2 条 KFP 即其产物；keepDirective 对箭头取错父节点→agent-registry KFP 真因疑似此 bug 非 >20 门槛；signatures 私有 gitLines 1MB；suppressPrefixes 不含 bare-exports 段；check-oop 注释≥8 vs 实现≥6；list-bare-exports 幽灵引用；每段双执行+--changed fake 逐文件全仓扫）；③重复实现 8 处（fake-exports 自带工具副本已漂移、gitLines 双实现、passThrough×2、keepDirective×3、BLOCKING 集合×2、扫描管线样板×6、定义收集×3、导出识别×4）；④集成面：nm-style 脚本不进 CI/hooks 纯文档驱动，硬契约=汇总行格式/退出码三值制/KFP 匹配键/各 spec「新增 0」；⑤两仓漂移：check-style 两代（worktree 少 bare-exports 段）、KFP 33/29 分叉、主仓 dup 基线 66/176 实为扫 worktree 的快照、worktree 105/253 旧态含 judgedAfterP17/P18 人工裁决（唯一完整副本须抢救）；⑥golden 已现场验证：worktree HEAD=683892567=tag，bare gate 283→283、dup 66→66/176→176、clusters PASS、A 类旧名 core 侧 grep 0；⑦TS 路线：根无 type 字段→.mts 源编 .mjs（NodeNext），typescript 6.0.3 default import 实测可用，编译须 process.execPath+bin/tsc 数组式（win32 .cmd shim 坑），tsconfig 继承 base 关 composite/declaration 不写 baseUrl，.mts 需补进 check-encoding 白名单，tsx 路线否决（跨包隐式依赖）。
spec 已落盘：docs/Iterations/nm-style-toolchain/spec.md（9 步 Step/13 组 T 用例/golden 硬门槛 Step 7/KFP 逐条复核 cutover 硬门槛/dup 基线允许数值变化以 delta 可解释替代/p25 降级预案=旧架构两小补丁先放行）。核心裁决：hygiene 三合一（verdict 统一+form 列）、KFP 覆盖面放开到全部规则且 segment→rule、baseline 显式参数化废「脚本在哪个仓用哪份基线」暗语义、入口自动编译启动器（编译失败 exit 3）。

user(2026-11-19 追加拍板):
「脚本为什么不用 ts 编写？编译一下也没麻烦哪去吧？而且还能 npm link」——澄清：spec 本就是 TS（原走 .mts+skill 目录内启动器）；用户点子升级为正经 workspace 包方案并采纳：tools/nm-style 包（type:module、bin 挂 nm-style 命令、根 workspaces 增 tools/*、npm link 全局），源码普通 .ts（.mts 路线作废，.ts 本在 check-encoding 白名单无需改动）。spec 已改写：§2.6/§3.1/§3.4/§3.6/§四/§五/Step1/Step8/风险表；顺手自查补 hygiene verdict 清单漏掉的 FAKE_PUBLIC 与 DEPRECATED_METHOD 去向（deprecated 降为 note，不再单列阻断）。

assistant(spec-check-loop 两轮完成,execute-ready,2026-11-20):
第 1 轮 judge「Go 带修订」+ 模块A「not ready」（2 P0：index 只收顶层丢嵌套函数→基线 feed/drain/finishPartial 组消失、judged 悬空；PromptBuilder 六条退役依据不成立——绑定是标识符值属性非方法简写）+ 模块B「ready」。doc-fix 闭合 2 P0 + 16 P1 + 关键 P2 共 23 处，要点：嵌套函数收录对齐旧全树口径（消失组必须=0 作 golden 闸）、新增 object-binding 绑定形态（成员注册语义，机制级修六条假阳性）、hygiene 三 face 阻断矩阵（private/class-public/exported 保旧分段语义）、导出面保留 fake-exports 全套机制（import 感知/prod-test 分桶/uniqueNames→AMBIGUOUS/public snapshot allowlist/JSDoc 剔除）、private class 方法同文件同类限定、judged 计数修正 named 12+shaped 4、smart-sort-rule 改预期迁移（13 行<20 门槛）、bare-exports 口径钉死（重载去重保留首行/全域扫描域/files map 零 diff 除外元数据）、clusters 四视图保留（list clusters --all）、KFP 值域收窄 signatures|hygiene|oop 且 bare-exports 不吃 KFP（豁免唯一通道 keep-bare 注释）、form 八值唯一权威清单、原 clusters gate 并入 gate bare、测试统一 node --test tools/nm-style/test/（Node 20 目录参数）+ 启动器构建互斥、baseline 读默认（被扫仓根 scripts/）写显式、lockfile 重生成入 Step 1、CI build 聚合声明有意、p25 spec 同步面扩 §二/§四/§六/§八、rebase 顺序写死（主仓 cutover→worktree rebase+git rm 决断→退役 commit）。第 2 轮终审 judge read-after-write：全部闭环、新发现仅 4 条 P2 措辞级（F1 过时命令引用/F2 AMBIGUOUS 跨 face 注记/F3 bare 全域口径半句/F4 旧基线处置择一）——已随后全部落掉，结论 **Go / execute-ready**。用户预授权生效（「loop 两遍就基本可以开工，没什么需要我确认的」），直接进 Step 1（tools/nm-style 包骨架 + npm link）。下一步：spec-check-loop 两遍 → 开工。
