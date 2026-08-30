# verify-parallel 节点独立复跑验证（agent-run-parallel-and-notify）

## 2026-08-30 请求

用户要求以非实现者身份，在 worktree `/home/bloodycrown/Dev/novel-master/.woktree/parallel-notify`（分支 feat/agent-run-parallel-and-notify，HEAD 应为 014a5f6）独立复跑验证：

1. `apps/mobile` 下 `npx jest` 全量（重点 agent-run-manager / agent-finished-notification / ChatComposer / use-agent-run-lifecycle）
2. `npm run build && npm run typecheck`
3. `git log --oneline main..HEAD` 与 `git diff main..HEAD --stat` 核对提交与改动范围（useSessionStream/ChatTabProvider 应零改动）
4. 抽查 spec 六项关键契约：门禁两信号、受理同步 increment、onSettled 签名、前台不发通知、dispose 顺序、useAgentRunLifecycle 的 activeRunId/acceptRunEvent 区域

约束：不修改任何代码/文档，只跑命令与读代码检查。

## 2026-08-30 请求（r2：fix 后增量复跑）

用户要求以非实现者身份，在同一 worktree（fix 后 HEAD 应为 ce289b4）复跑验证 fix 增量：

1. `apps/mobile` 下 `npx jest` 全量（重点 agent-activity / agent-run-manager / db-backup 相关套件）
2. `npm run typecheck`
3. `git log --oneline 014a5f6..HEAD` 与 `git diff 014a5f6..HEAD --stat` 核对 fix 增量只触碰 agent-run-manager.service.ts、agent-activity.test.ts、db-backup.service.test.ts、manager 相关测试、memory 文件
4. 抽查 must-fix 2 修复逻辑：agent-run-manager.service.ts 的 .catch 段，确认「entry 仍是本次且 runId == null 才兜底 onError」覆盖事件先到/throw 先到两种时序

约束：worktree 内只跑命令与检查，禁止修改任何文件。

## 2026-08-30 请求（r2 之后：cr-func-parallel-r2 readonly 功能小检）

用户要求在 worktree `/home/bloodycrown/Dev/novel-master/.woktree/parallel-notify`（readonly）做 fix 增量的功能小检，节点 cr-func-parallel-r2，范围 5 文件：agent-run-manager.service.ts（.catch 双 toast 修复）、__tests__/agent-activity.test.ts（T-P7 用例组）、__tests__/agent-run-manager.service.test.ts（双 toast 两条）、__tests__/db-backup.service.test.ts（import 守卫）。

检查项：A）两条 must-fix 是否实质闭合（对照代码与测试实测）；T-P7 用例断言是否真覆盖「单一归属」；G）verify r2 证据链；spec_deviations 有无新引入未登记偏离。返回矩阵对照、must-fix 闭合判定、spec_deviations、func-ready 结论。

约束：全程只读，禁止修改 worktree 内任何文件；检索只用终端 grep -rln + sed -n。
