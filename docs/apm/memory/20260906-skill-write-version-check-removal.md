---
date: 2026-09-06 10:56
title: skill/write 工具版本 check 参数与「版本校验」开关移除——含死偏好发现
keywords: skill 工具, write 工具, expectedVersion, versionCheck, 乐观锁, session-fs.versionCheck, 死偏好, CR fix
abstract: vfs write 默认 versionCheck=true 而 skill 工具不传版本参数，编辑已存在技能必撞 CONFLICT——「需要填写版本check」的根因。移除 write 工具的 options 参数、writeSkillFile 无版本时跳过检查、user-vfs-turn 版本注入链与两端「版本校验」开关；并发现 session-fs.versionCheck 偏好本就是死配置（无任何写入路径消费）。后续演进到底层乐观锁全拆（last-write-wins）+ dev 分支 CR fix 三条 apps 侧 must-fix（MF-1 契约测试重写、MF-2 CLI e2e 死键清理、MF-4 mobile 死 state 删除）。
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
