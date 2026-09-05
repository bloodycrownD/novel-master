---
date: 2026-09-06 01:45
title: skill/write 工具版本 check 参数与「版本校验」开关移除——含死偏好发现
keywords: skill 工具, write 工具, expectedVersion, versionCheck, 乐观锁, session-fs.versionCheck, 死偏好
abstract: vfs write 默认 versionCheck=true 而 skill 工具不传版本参数，编辑已存在技能必撞 CONFLICT——「需要填写版本check」的根因。移除 write 工具的 options 参数、writeSkillFile 无版本时跳过检查、user-vfs-turn 版本注入链与两端「版本校验」开关；并发现 session-fs.versionCheck 偏好本就是死配置（无任何写入路径消费）。
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
