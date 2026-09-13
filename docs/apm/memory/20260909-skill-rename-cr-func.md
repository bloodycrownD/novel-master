---
date: 2026-09-09 23:33
title: 技能重命名功能 cr-func 只读评审（export-link-skill-mgmt 波次）
keywords: [cr-func, skill-rename, updateSkillInfo, withSkillFrontMatterValues, export-link-skill-mgmt]
abstract: 对 skill-rename-description 特性做 readonly 功能评审：矩阵对照 Step 1~7 与 T-S1~S6 全部落地；三处 spec 偏差（再导出位置、tx 建 scoped vfs、错误码解包）均判定可接受；结论 func-ready yes。
---

# 技能重命名功能 cr-func 只读评审

## 2026-09-09 23:33 · cr-func-skill-rename（readonly 功能小检）

user:

> readonly 功能小检。节点：cr-func-skill-rename，仓库 .worktree/export-link-skill-mgmt（分支 export-link-skill-mgmt），Spec docs/Iterations/export-link-skill-mgmt-2026-09/features/skill-rename-description/spec.md。检查 A（步骤矩阵 Step 1~7 + blocking 测试 T-S1~S6 逐条对照）、G（verify 证据链可信）、spec_deviations（再导出位置、事务内 tx 建 scoped vfs、错误码解包三处）。禁止修改任何文件。返回矩阵对照、must-fix、spec_deviations、func-ready 结论。

assistant:

> 逐条核完：Step 1~7 与 T-S1~S6 全部真实落地（core 单源函数 7 用例、服务测试 ①~⑨ 含 T-S3 折入 ① 的 version 连续断言、desktop handler 直调 2 用例含错误码透传、mobile/desktop 契约与静态渲染、NewSkillModal 源码断言）。IPC 五处齐（channel/类型/handler/registry/invoke+client 解构导出）。单源回收 grep 零第二实现（desktop 经 @shared/logic/skills、mobile 经 skill-ui 再导出）。三处偏差均判可接受：①再导出位置从 spec 表格的 skill-ui.ts 移到 shared/logic/skills.ts（语义等价且贴合既有 import 面）；②事务内直接 createScopedVfsService(tx) 替代 spec 的 runInTransactionOrConn 复用原 conn（避免外层事务持 mutex 导致 vfs 内层事务互等死锁，净效果同为 tx 直通）；③新增 TdbcError.cause 解包还原 SkillError（两 driver 事务 catch 均会把非 TdbcError 包装为 SQLITE_ERROR 且保留 cause，T-S2③/T-S4 全链断言验证）。负清单 renameByName 用 UPDATE OR IGNORE + DELETE 旧行，撞主键时合并不丢信息。ContextMenu disabled 支持 +7 行与 jest moduleNameMapper +6 行均属本 feature 需要。verify 证据链可信：desktop 23 用例数精确吻合，core/mobile 数字在跑测文件子集范围内、blocking 用例逐条可指认。无 must-fix，func-ready: yes。
