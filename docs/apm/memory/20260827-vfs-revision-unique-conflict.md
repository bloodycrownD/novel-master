---
date: 2026-08-28 02:00
title: fs 工具 rm/mv 报 vfs_revision UNIQUE 约束冲突：根因、修复、合并与 changelog 全链路
keywords: vfs_revision, UNIQUE constraint, rm, mv, 墓碑, head_version, sqlite_sequence, entry-sequence-repair, op-sqlite, changelog
abstract: mobile 端 agent 调 fs 工具 rm/mv 报 vfs_revision 唯一键冲突，根因是 head+1 发号撞回拨占号。已完成 PRD/SPEC、worktree 开发（dev-ready）、合入集成分支与 main，并对比 v1.5.4 盘点补齐 Unreleased changelog（含 ux-fixes 三条）。
---

user:
agent 调用 fs 工具执行 rm 报错：`Error: Exception in HostFunction: [op-sqlite] statement execution error: UNIQUE constraint failed: vfs_revision.entry_id, vfs_revision.version`。mv 也遇到过类似报错。为什么 rm/mv 这种"删除/移动"操作会撞唯一键？

assistant:
派子代理探索后结论：这不是 op-sqlite 驱动的事务 bug，`[op-sqlite]` 前缀只是驱动包装错误的文案，同样的错位数据放 desktop（better-sqlite3）上一样撞。真正机理：

1. rm 不是物理删除——`appendDeletedRevision`（`revision-aware-vfs.service.ts`）会往 vfs_revision INSERT 一条 `status='deleted'` 的墓碑，version = 当前 head_version + 1。vfs_revision 的主键就是 `(entry_id, version)`（`vfs-revision-schema.ts`），所以只要 head_version+1 这个号已被占用，INSERT 必撞。
2. 占号的两条路径：
   - **head 回拨**：`resetHeadToVersion`（checkpoint 回滚、turn 失败补偿都调它）把 head_version 拨回旧值但**不删 revision**（append-only 设计），被 checkpoint 钉住的旧 revision（ref_count>0）不被 sweep 清理、永久占号。之后 rm 的墓碑 head+1 就撞历史版本。write 同理。
   - **entry_id 复用**：vfs_entry 的 AUTOINCREMENT 发号器（sqlite_sequence）低于孤儿 revision 占用的最大 entry_id 时，新建 entry 复用旧 id，v1 号被占直接撞。这是官方已知 bug，`entry-sequence-repair.ts` 文件头注释写的症状与此报错一字不差，bootstrap 启动期注册修复推号。
3. 修复的漏洞：repair 的 `readSequenceBoundaries` 查询异常时 catch 返回 `{seq:0, needed:0}`，detect 会静默判健康跳过修复；bootstrap 侧 repair 失败也被 `catch {}` 吞掉。所以存量错位库可能修复没跑成。
4. mv 在当前实现（`vfs-move.ts` → rename 原语）**不写任何 revision**，纯 UPDATE path。用户感知的 mv 报错大概率来自同批次其它写操作或旧版实现（旧版是 read→write(to)→delete(from)，write/delete 都写 revision）。

诊断 SQL：`SELECT seq FROM sqlite_sequence WHERE name='vfs_entry'` 对比 `SELECT MAX(entry_id) FROM vfs_revision`；再查 `SELECT e.entry_id, e.head_version, MAX(r.version) FROM vfs_entry e JOIN vfs_revision r ON r.entry_id=e.entry_id GROUP BY e.entry_id HAVING e.head_version < MAX(r.version)`。

修复方向建议：墓碑/版本分配改用 `findMaxVersionForEntry+1`（repo 已有此方法），或 INSERT 前用 `existsByEntryAndVersion` 预检；同时修 repair 的静默 catch。该错误一旦出现会持续复现（占号 revision 不删）。

user:
那就生成 spec 和 prd 吧。

assistant:
按 prd-generate / spec-generate 流程又派了两轮探索子代理，拿到实现级细节后把 PRD 和 SPEC 写进 `docs/Iterations/vfs-revision-unique-conflict-fix/`（注意项目目录是大写 `Iterations`，不是 skill 默认的小写 iterations）。关键结论：head_version 的全部读方只依赖「head 指向存在的 revision 行」，MAX+1 改造不用动 head 语义；真正要改的是三个 head+1 分配点（`applyContentHashUpdate`、`appendDeletedRevision`、`appendDeletedRevisionsForSubtree`）加 entry-sequence-repair 的裸 catch 和 bootstrap 吞错。既有 spec `message-rollback-execution-redesign` 的 T-RB1 早已拍板「live version 可 ≥ 锚点」，本修复是把实现补齐到该语义。测试跑法：core 是 node:test + tsx（`npm run test:vfs`），断言要按 scope 过滤防内置技能 seed 污染。两份文档待用户确认。

user:
所以版本计数其实也没什么用了吧？反正都能回滚？

assistant:
澄清了一个设计误解：回滚恰恰是靠版本号实现的——checkpoint 钉 headVersion 指针、resetHeadToVersion 按 (entry_id, version) 寻址、乐观锁 WHERE head_version=expected、GC 引用坐标、redo/短路优化全都依赖版本号。真正该扔的只是「head_version 兼任计数器（head+1 发号）」这个分配策略，spec 已换 MAX+1。另外确认 schema 里没有专门的版本计数器字段（旧 vfs_entry.version 列已退役且当年也只是 head 的同步副本，sqlite_sequence 数的是 entry_id），MAX+1 等价于零迁移的虚拟计数器。

user:
新建 worktree 开发吧。

assistant:
按 code-dev-loop 开发：worktree `.woktree/vfs-revision-unique-conflict-fix`（分支 `feat/vfs-revision-unique-conflict-fix`，基于 main），spec/prd 已随首个提交入库。环境踩坑：core 测试跑的是构建产物 dist（helper 导入 `@novel-master/core/*` 解析到 dist），worktree 需先 `npm install` + `npm run build -w @novel-master/core` + build tdbc-driver-better-sqlite3 才能跑测试；因此 DAG 里构建由主代理串行执行，避免并行子代理撞 dist。VFS 基线 267/267 全绿。DAG：wave-0 [impl-alloc, impl-repair] 并行 → 主代理构建 → verify 三节点并行 → cr-func → changelog（用 novel-master-changelog skill）。

user:
[impl-repair 节点] 执行 spec Step 4+5：repair 去吞错 + bootstrap 消费报告补日志 + T-V4/T-V5 测试。

assistant:
两个提交完成（均在 worktree 内）：`36f13e1` 删 readSequenceBoundaries 裸 catch（查询异常上抛，registry 按需修复保守处理）+ T-V4（mock 连接注入异常，断言 detect 上抛 / runIntegrityRepair 判 needsRepair=true 且 error 挂报告）；`1b2af8a` bootstrap 消费 runAll 报告 error（对齐 seedBuiltinSkills 的 warn 模式）+ 两处静默 catch 补 warn + T-V5（Proxy 只拦 `FROM sqlite_sequence` 查询模拟修复失败，spy console.warn 断言携带 vfs-entry-sequence-repair 的 warn——bootstrap 链路仅 entry-sequence repair 查 sqlite_sequence，拦截不会误伤）。要点：①全新库 sqlite_sequence 无行是空结果集不是抛错（表随 AUTOINCREMENT 建表即存在），`?? 0` 兜底语义保留，健康库行为不变；②`tsconfig.test.json` 继承 rootDir=./src 又 include test/**，纯 tsc 无法直接跑，类型自检用临时 tsconfig（rootDir 放宽到 monorepo 根 + include 跨包 tokenizer/tdbc 源码），错误数改动前后均 364（存量、与本次无关），自检后删临时配置；③同 worktree 有 impl-alloc 并行节点的未提交文件（repo 层三文件），提交时只 add 自己的文件，且不要在并行节点工作期间 git stash 整个 worktree（会把别人的改动一起卷走，这次验证基线时用了 stash，幸而 pop 无冲突）。测试未跑（跑 dist、由主代理统一构建后执行）。

user:
[主代理] 构建与验证波次 + cr-func + changelog，收尾到 dev-ready。

assistant:
验证与收尾均闭合，迭代达到 dev-ready：①主代理串行构建后跑新用例 16/16（T-V3 曾因测试造数漏建隔离根目录报 PARENT_NOT_FOUND，主代理一行修复重绿）；②vfs+message-checkpoint 373/373；③core 全量 2193/2193（注：`npm run test` 脚本里 `!(performance)` 是 bash extglob，sh 会报语法错，用 find 列文件替代）。cr-func（readonly 子代理）结论 func-ready: yes：矩阵全闭合、乐观锁/ref 配对/blob 时序三处不变量未动、三处自报波及（vfs.service/vfs-batch-io 传 head+1、CopyVfsTreeOptions.revisions 可选字段、mock 适配）均判合规非偏差；唯一 cosmetic（双分号）已修并复核维持 func-ready。changelog 按 skill 约定写进 Unreleased 修复段（用户视角一条，不提内部术语）。最终提交链 ada985b→783179f 共 9 个提交，分支 `feat/vfs-revision-unique-conflict-fix`（基于 main@3ce296b），未合并未发版，不称 merge-ready。

user:
合并到主 worktree 的 feature 分支，可以新建一个 feature，我要测试。

assistant:
主仓当时已在 main（7ee7f47，ux-fixes 已合入），按 `feat/xxx-integration` 惯例从 HEAD 新建 `feat/vfs-revision-unique-conflict-fix-integration` 并合入修复分支（合并提交 11ea821，无冲突；主仓里未跟踪的 spec/prd 副本与分支内提交版本 diff 一致后删除让路）。主仓重新构建 core 后 vfs+message-checkpoint 371/371 全绿，用户未提交的改动（.vscode 删除、AGENTS.md/RULE.md 修改等）原样保留。主 worktree 停在集成分支上供用户测试（desktop `npm run desktop:dev` / mobile `npm run mobile:android`）。

user:
merge 到 main 吧，然后对比上次 tag，写 changelog。

assistant:
集成分支合进 main（fast-forward 到 11ea821），上次 tag 是 v1.5.4（2026-08-25），范围 105 提交。逐一校验后发现：fetch-tool、markdown-code-block-render、token-usage-stats-enhance 三个迭代只有 docs 进了 main（b3429b0 五迭代文档提交），代码分支均未合入，**不进 changelog**；真正 tag 后落地的用户可感知改动是思考开关两选代（Unreleased 已有条目）、ux-fixes-2026-08（**缺条目**）、vfs 修复（已有）。按 changelog skill 补 ux-fixes 三条修复：Android 输入框抖动、项目工作区逐级返回、超长提示词限高+全屏编辑（tag 闪烁择期未修不写）。提交 e4c2e8b。main 领先 origin 约 95 提交未推送，发版需另走 novel-master-publish skill。

user:
Android 输入框抖动没修复吧？把 tag 修复的地方都回滚，我看看最原始的效果。

assistant:
查证后澄清：抖动与闪烁是两件事——换行点漂移抖动有修复（5250eaa 去 paddingHorizontal，T-C1），tag 每键闪烁三轮实验全回滚、择期。用户要求回滚看原始效果，把 ComposerAtPathInput.tsx checkout 回 5250eaa~1（即 v1.5.4 原始版，未提交只暂存）。过程中发现真回归：aed7861（摘 metro 调试日志）把 v1.4.21 就有的 onChangeText atomic 早退（`if (atomic != null) { emitMentionValue(atomic); return; }`）一并删了——加日志时它被包进日志区，摘日志时误删，main 因此丢失发布版既有行为。

user:
原始和修复后一样，那不如保持不变，changelog 也改下。

assistant:
真机对比无感知差异，定案：保留原始样式。提交 d628694——回退 T-C1 去 padding（组件+测试都回 5250eaa~1，T-C1 断言随之移除，composer-at-path 11/11 绿）并顺手补回被误删的 atomic 早退（该回归是未发布代码引入又修复，按 changelog 原则不写条目）。changelog 撤掉「Android 输入框抖动」条目（261d4ef），Unreleased 修复段剩：项目工作区逐级返回、超长提示词限高+全屏、vfs 唯一键冲突。教训：抖动/闪烁类原生时序问题单测测不到（jest 测不出），changelog 只写真机验证过有感知差异的修复；摘调试日志要警惕连带误删被日志包裹的既有逻辑。

user:
分身更新过 changelog 了，和上一个 tag 对比进行 CR；CR 后只一个 P2，简单修修就行。

assistant:
按 code-review-loop diff 模式派只读子代理对照 v1.5.4..a276565 评审 Unreleased 段：覆盖度无遗漏（未合入迭代/择期闪烁/过程回归均正确未出现）、两条思考新条目技术事实全部代码验证属实、分类与措辞达标。唯一 must-fix 是 P2 口径不一致：新增段「关闭则不进入」漏了变更段的工具调用最低保留例外。用户拍板简单直修（豁免 fix-spec 落盘）：补括注「（进行中工具调用的必要思考除外）」并提交 37b98e9。遗留 open_question 未拍板：CLI `nm preferences` 支持思考开关是否入 changelog（既有条目从不提 CLI 端，沿用惯例不写）。

user:
发版吧，应该是 1.5.5？

assistant:
确认 v1.5.5（项目惯例功能也走 patch 号）。按 publish skill 走完：CHANGELOG Unreleased 转正 `## [1.5.5] - 2026-08-28`；双端 package.json + build.gradle 默认 versionName 兑底值都 bump 1.5.5；验证时发现 mobile 全量 jest 有 3 个红——查实是 77d3b69（1.5.4 前）拆除取消隐藏菜单时**漏删测试文件**导致的孤儿红测试（use-chat-tab-message-actions-unhide.test.ts），非本次批次引入，删测试后 861/861 绿；双端 typecheck 过。提交 226da93（删孤儿测试）+ ffec472（版本 bump），打 tag v1.5.5 并推送（触发 release.yml 构建 APK/NSIS/DMG），main 同步推送（5783116..ffec472）。发版跑测试前必须先看失败是不是存量：git log -S 定位功能拆除提交、对照 tag 验证，别把遗留红灯当新回归修。
