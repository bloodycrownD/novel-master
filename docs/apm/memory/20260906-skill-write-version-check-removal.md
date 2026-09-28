---
date: 2026-09-28 18:16
title: skill/write 工具版本校验移除（last-write-wins）与 2026-09-28 并发语义追问
keywords: skill 工具, write 工具, edit 并发, expectedVersion, versionCheck, 乐观锁, last-write-wins, replace 竞态, pathTail, runParallel
abstract: 两段式：①skill 工具版本校验移除——vfs write 默认 versionCheck=true 而 skill 工具无版本参数致编辑已存技能必 CONFLICT，先入口绕开后按用户拍板底层乐观锁全拆（60af90b），write 固定 last-write-wins；②2026-09-28 追问「skill edit 支持并发吗」——分层结论：底层无锁（replace 事务外读-改-写非原子），toolRunner pathTail 只串行化 write/edit/fs 三个工具名的同路径调用、skill 工具不在名单，同 step 多笔 skill edit/write 并发必撞竞态致「只有最后一条生效」（历史 revision 可回滚）；跨 runner（子会话）也无保护。规避靠单写者编排，恢复保护属产品决策。
---

user:
还有一个类似的工具问题，skill 工具需要填写版本 check，但实际没必要。移除这个参数，另外 edit/write 等写工具也移除吧，UI 上的开关也都移除。

assistant:
调研结论：根因在 vfs write 的版本语义分层——revision-aware-vfs 的 write 默认 versionCheck=true（无 expectedVersion 更新已有文件即 CONFLICT），write 工具显式传 versionCheck ?? false 所以没事，edit 走 replace（内部读-改-写自洽，天然无版本参数），唯独 skill 工具的 write 动作调 writeSkillFile 时不带任何版本参数 → vfs 默认 true → 编辑已存在 SKILL.md 必 CONFLICT，且工具入参里根本没有可填版本的字段（死局）。另一个发现：session-fs.versionCheck 偏好（mobile ChatConfigScreen「版本校验」开关 + desktop WorkspaceSettingsView 同款）是死配置——两端编辑器保存都硬编码自带 read 版本，没有任何写入路径读这个偏好。user-vfs-turn 的合成保存经 toolRunner.runParallel 走 write 工具 schema，注入的 options 真实生效。
方案：① write 工具 schema 删 options（expectedVersion/versionCheck），run 硬编码 versionCheck:false；② writeSkillFile 改为「带 expectedVersion 才校验」（UI 技能编辑器保留锁，LLM 路径 last-write-wins）；③ build-user-vfs-turn-op 删 UserVfsSaveVersionOptions 与注入块（desktop 直写分支保留编辑器锁）；④ 偏好三方法+key+双端 IPC+两端开关全移除；⑤ desktop 直写分支（req.expectedVersion != null）与 PreviewPane 传参保留——那是编辑器透明锁，不是开关。

user:
（实施后验收）结果如何？

assistant:
分支 fix/vfs-version-check-removal（基于 main c95bf97，worktree .worktree/vfs-version-check-removal），提交 86772c1。重要修正：session-fs.versionCheck 偏好并非全死——CLI session vfs write 是它唯一真实消费者（GUI 从未消费），已同步改为缺省免校验、--version/--no-version-check 旗标保留，CLI preferences 白名单移除该 key。验证：core 全量 1790 绿（T-AR-02 改锁新语义：stale options 被 zod 剥离后 last-write-wins）；desktop typecheck 仅剩 main 自带的 3 个统计半成品错（stash 对照证明非本次引入）；mobile tsc+jest 绿；cli typecheck 绿，preferences-e2e 7/8（C5 因本地环境挂：migration 日志混入 stdout 污染 id 解析 + 本地所有建会话 e2e 在基线 worktree 同样全挂，CI 形态已对齐 vfs-zip 的成熟模式）。坑：新 worktree 需逐个 build 的 dist 远不止 tdbc/core——tokenizer-driver-node、sksp-mac/linux/windows、cloud-sync-driver-s3、tdbc-driver-op-sqlite 都要建，CLI e2e 才能跑。

user:
所以直接移除 vfs 底层的 version check 吧，或者直接封装掉，我是真觉得没用。现在是怎么做的？

assistant:
（现状盘点后实施底层移除——见后续轮次）

assistant:
现状：底层乐观锁仍在（仓库层 UPDATE 带 head_version 谓词，服务层 write 缺省 versionCheck=true），但全部入口都在绕开它——8+ 处 {versionCheck:false} 补丁（vfs-copy×2、vfs-tree-copy×3、vfs-batch-io、双端保存服务、write 工具、CLI），真正用锁的只剩 replace() 内部自洽与 UI 编辑器透明锁。按用户拍板全拆：仓库层 UPDATE 去版本谓词（删 VfsWriteRepoOptions、vfsConflict）；服务层删 CONFLICT 检查与 WriteOptions 透传（类型整体移除）；8 处补丁还原朴素 write；skills 层 SkillWriteOptions 只剩 builtinSeed；双端编辑器透明锁拆除（漂移 console 探测保留）；CLI --version/--no-version-check 旗标移除。版本号继续自增（revision 历史/回滚依赖 head_version 记账），仅不再比对。提交 60af90b（净删 300 行），core 1788 绿、CLI e2e 除 C5 环境挂外全过、双端 typecheck/jest/lint 绿。

user:
主 worktree 干净了，现在可以迁移到主 worktree 的开发分支了

assistant:
误读成本轮教训：把「开发分支」理解成合回 main，已合了一笔+第二笔冲突中途被用户拦下；git merge --abort + git reset --hard 回滚到 504ea39 无损复位（未 push 过，安全）。确认意图后新建 dev 分支（基于 main@504ea39），两笔 --no-ff 合入（04e4f31、11e6d8c），CHANGELOG 冲突手解为统一 Unreleased 段（agent 条目 + vfs 修复/变更条目），迭代状态与统计记忆文件取 ours。合并后验证：tdbc/core 重建零错、core 全量 1799 绿、desktop/cli/mobile 官方 typecheck 全零错（mobile 裸 tsc 会把 __tests__ 算进去出 376 个 ThemeTokens 历史漂移错，官方脚本用 tsconfig.build.json 排除，main 上同口径也是零——勿被裸跑吓到）。收尾：两个 side worktree 移除（agent-tool 的 lockfile 漂移用 --force）、两根 fix 分支已并入删除。主 worktree 现在挂在 dev 上，等待后续 main 合并节奏由用户定。

user:
（CR fix impl-apps 节点派发）dev 分支三件套 CR fix spec 的 apps 侧三条 must-fix：MF-1 重写 mobile 契约测试已失效的乐观锁断言、MF-2 删两个 CLI e2e 里的死偏好键操作、MF-4 删 FileEditorScreen 死 state。不提交，主代理统一收。

assistant:
impl-apps 节点执行完毕（主 worktree dev，无提交）：① MF-1 new-skill-modal-contract.test.ts——历史 MF-8 用例重写为「重写分支锚点存在 + 分支内 writeSkillFile( 直写 + 全文无 readSkillFile(/expectedVersion」，头注释与 describe 名同步去掉 MF-8 乐观锁描述（保留 D-1 保留名新建门）；② MF-2 session-rollback-e2e.test.ts 删 seedProjectSession 里 preferences set session-fs.versionCheck 段，chat-smoke-e2e.test.ts 的 set+get 换成 get chat.llmStream 断言默认值 "true"（KNOWN_KEYS 已只剩三个 key：chat.llmStream/chat.thinkingContext/user-vfs 统一工具回合，get 输出裸值）；③ MF-4 FileEditorScreen.tsx 删 version state（先 grep 确认全文无读点，仅一处声明+三处 setVersion）。自检：契约测试 2 绿 + file-editor-screen/ui-parity-regressions 18 绿（NODE_ENV=test），grep 零残留。坑位提醒：git status 里 packages/core 一堆并行节点改动混在同工作区，apps 侧提交时只显式 add 四个文件。CLI e2e 未本地自跑（基线同样挂的已知环境问题，verify 波统一跑）。

user:
skill edit 支持并发吗？agent 反馈只有最后一条生效。

assistant:
（brain-storm，2 只读子代理并行探索 + 主代理代码抽查）分层结论：底层不支持——乐观锁 2026-09-06 已拍板全拆（60af90b），write 注释明文 last-write-wins（vfs-tools.ts:250-252）；skill edit 走 editSkillFile → vfs.replace（skills.service.ts:379-404），replace 是「事务外 read → computeReplaceResult → write」三步非原子（revision-aware-vfs.service.ts:99-117）。唯一的保护层在 toolRunner.runParallel 的 pathTail 同路径串行（tool-runner.ts:134-158），但 classifyMutatingToolCall 只认 write/edit/fs 三个工具名（fs-command-classify.ts:57-75）——**skill 工具不在名单**，同 step 多笔 skill write/edit 真并发，两笔都基于同一份旧内容计算、后写整份覆盖先写，「只有最后一条生效」正是这个竞态的表象；vfs edit 工具同 step 同路径（字符串一致）会被串行化、能叠加。pathTail 也跨不了 runner 实例，子会话（共享父工作区）并发同文件同样无保护。被覆盖内容仍在 revision 历史可回滚。成因排序：①同 step 多笔 skill edit/write 并发（分类名单漏 skill）②模型实际调 write 全量覆盖（2026-09-06 同款误判先例）③跨 agent 并发。可选修法：把 skill 工具纳入 classifyMutatingToolCall 的突变路径提取（合成 /meta/skills/{name}/{rel}）借现成 pathTail 串行化；跨 agent 保护需重引 expectedVersion（产品决策）；编排上维持同一文件单写者（loop skill 已有「同文件禁止并行 impl/fix」惯例）。

user:
额，我的想法是和 edit 工具统一，edit 工具它们不是支持并发的吗？

assistant:
澄清：edit 工具的「并发安全」= toolRunner pathTail 对同路径突变调用强制排队串行（执行上并不并发，效果是依次叠加），跨 agent 仍无保护——「统一」即让 skill 工具加入同一套排队。落点就是 classifyMutatingToolCall 加 skill 分支（action=write/edit → 突变，路径合成 /meta/skills/{name}/{rel}，须与 skills.service 的 resolveSkillRelPath 同源；load/read/list 非突变）。连带核查干净：vfsMutated 链（anyToolUseMutatesWorkspace）用的是独立名单 isMutatingFileToolName，不受影响；user-vfs-turn 的 collectMutatingPathsFromCalls 只见用户编辑操作，也不受影响。细节：global/project 两域同路径字符串会互相排队（无害的过度串行），要精确可在 key 里带 domain。统一后同 step 多笔 skill edit 叠加生效的前提是后一笔 oldString 匹配前一笔改完的正文，撞段则 REPLACE_NOT_FOUND——与 edit 工具行为完全一致。待用户拍板是否实施。

user:
跨 agent 的场景不需要支持，本来这样也不合理，那就按照最小方案改动吧，global 域和 project 域的同名技能这个你处理就好。看起来改动不大？那直接在主分支开发，并更新changelog吧。

assistant:
（agile-dev，轻量直改，主代理直接实现——探索已完成于本会话 brain-storm 轮，未重复派遣；用户点名直接在 main 开发，偏离 skill 默认分支约定）按拍板实施：①新增 domain/skills/logic/skill-paths.ts（SKILLS_ROOT/SKILL_ENTRY_FILE/resolveSkillRelPathCore 纯函数，service 与分类器单源）；②skills.service.ts 的常量与路径解析迁走，resolveSkillRelPath 变 SkillError 包装（错误文案逐字保留）；③fs-command-classify.ts 加 skill 分支：write/edit 突变、排队键 `skill:{domain}:{逻辑路径}`（write 缺省域 project 与 skill-tool 同口径；load/read/list 只读；非法输入保守不排队）；④测试 +4 用例（classifier 键口径/只读/保守；skill-tool 串行化 describe：同名同域两笔 edit 首笔延迟 30ms 竞态下双改动共存、global/project 同名交错执行）。验证：定向 69/69 绿（fs-command-classify + skill-tool + tool-runner-parallel + user-vfs-turn + skills.service），core dist 重建零错。CHANGELOG Unreleased 补「修复」条目（同轮多次编辑技能文件只有最后一次生效）；留痕 docs/Iterations/skill-tool-path-serialization/（prd+spec，按仓库平铺小迭代形态而非 agile-dev 的 bugs/ 子目录约定）。RULE.md 并发语义条目更新为修复后状态。跨 agent 不保护（拍板）。
