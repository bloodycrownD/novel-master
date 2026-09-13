---
date: 2026-09-11 23:50
title: desktop-regression-fixes CR 修复 impl-b 节点（case-*/bootstrap 脚本守门与收敛）
keywords: e2e, CR fix-spec, impl-b, MODEL_READDED, T-A1, pickUsableSession, assertLastUserAttach, 退出码
abstract: 迭代 desktop-regression-fixes 首轮 CR 的 impl-b 节点：按 cr-fix-spec 闭合 case-models-skills 断言收紧、case-s3 拖拽对比时序、bootstrap 硬校验、T-A1 守门收口+非零退出码、两脚本收敛 pickUsableSession/assertLastUserAttach、C-2 case 侧死代码；发现 impl-a 交付的 pickUsableSession 缺「已停妥可用会话直接返回」前置段（续库单跑必 throw），已作为阻塞项上报。
---

user:
（impl-b 节点指令：worktree .worktree/desktop-regression-fixes 分支 fix/desktop-regression-fixes，按 cr-fix-spec 闭合所有涉及 case-*.mjs/bootstrap.mjs 的条目——G-1/B-4/A-1+B-3③/B-3②/C-3②；不动 lib.mjs/.gitignore/coverage.md（impl-a 领地）；中文注释与 commit；node --check 验收；按逻辑块提交）

assistant:
闭合 6 个提交（node --check 全过，未跑 e2e——留给 verify）：
- cf226262 G-1：MODEL_READDED 断言 >=0 恒真收紧为 >=1，false 输出 FAIL 前缀与计数
- f56370cc B-4：拖前 before/拖后 after 双快照按列差值 >=1px 判 changed 并输出逐列 diff，删死变量 b0 与 mouse.up 后取对照的 b0c
- afcf9f30 B-3②：bootstrap 末尾集中硬校验 state.msgs>=2 && composerOk===true，state 提升 try 外（SCRIPT_ERROR 时 null 同判失败），不满足 exitCode=1
- 9634ffd9 C-3②：annotate2 的 needPick 整块与 regression-fixes 的 ensureSession 换 pickUsableSession；两处 ~20 行重复附件断言换 assertLastUserAttach（annotate2 保持观察式，守门在 regression-fixes）；import 行同步删去不再使用的 goToProjects
- 7027e1b9 A-1+B-3③：TA2 段 attach 结果收口 record("T-A1", matched && hasAttach)；ALL_PASS=false 或 SCRIPT_ERROR 均 exitCode=1 断链
- b52031e2 C-2 case 侧：case-zip-backup 删旧 worktree 绝对路径死变量 OUT，case-subagent 删未用 spawn import

关键判断与阻塞上报：
1. pickUsableSession 契约缺口（阻塞项，lib 侧归 impl-a）：impl-a 的实现（11cedd48）直接从 #session-list 逐个点入，缺 annotate2 原有的 needPick 前置段——app 启动恢复进会话内时列表不可见、计数 0，直接走自足段 throw "no session to bind model"；停在项目列表同样炸。续库单跑与全量序列（bootstrap 后恢复进会话）均必炸。修法：函数开头加「composer 在且可用则直接返回；不可用且在会话内先点返回，再 goToProjects+点回归项目A」前置段。
2. annotate2 顶部未加 closeOverlays 静态 import（偏离任务字面）：其唯一使用点（自足绑模型段）整体迁入 lib 且在函数内部直调，加进来必是死 import，与同轮 C-2 删死代码原则冲突；动态 import 随段删除自然消失，问题③的不一致性已消解。
3. assertLastUserAttach 抽查通过：与原两份逐字一致（30×500ms 重试，返回 {matched,hasAttach,detail}）。
