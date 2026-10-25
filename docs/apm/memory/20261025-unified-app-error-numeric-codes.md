---
date: 2026-10-25 01:36
title: 第一步已落地：AppError + 数字错误码注册表，AgentError 已迁移（其余错误类未动）
keywords: AppError, ErrorCode, 数字错误码, 错误收敛, 统一日志, Either, details, 迁移
abstract: 用户提出不同 error 各继承 Error、各有字符串 code 没必要，建议统一枚举 code（数字 + desc）并收敛到单一错误类。第一步已落地：新增 errors/app-error.ts（ErrorCodes 注册表 + AppError&lt;K&gt; + isAppError + AppErrorWire），首个码 AGENT_DOOM_LOOP=1001；删除 agent-runtime-errors.ts，doom-loop 改用 AppError；公共导出、allowlist 快照、CLI/mobile 的 instanceof 与测试同步；新增 7 条注册表/类守卫测试。其余 15 个错误类按用户要求未动。
---

user:
这个 code 也改一下吧，现在是不同 error 有不同 code，而且都是继承 error，其实没啥必要。我觉得如果用统一的枚举 code，枚举有数字 code 和 desc 两个属性，这样未来所有的 error 都能收敛到一个类，我觉得这样更方便些，日志处理也能统一，你怎么看？

assistant:
倾向赞成，但补了两个关键约束：

1. **不要只留数字**：数字码适合日志/统计（稳定、紧凑、可 grep），但抛出点和日志里纯数字不可读。建议「可读 key + 稳定数字」双轨——抛出点写 `AppError("VFS_NOT_FOUND", ...)`，实例同时带 `key` / `code`（数字）/ `desc`（短标签），日志输出 `[2001 VFS_NOT_FOUND] ...`，`name` 也设成 key，栈里直接认得出。
2. **enum 放不下两个属性**：用 `as const` 定义表一次写完 `{code, desc}`，再从表派生出 `ErrorKey` / 数字类型；数字枚举 + 单独 desc 表会变成两处维护，容易漂。守卫测试必须锁「key 唯一、数字唯一且永不复用、desc 非空、按域分段」（1xxx agent / 2xxx vfs / 3xxx tool / 4xxx provider / 5xxx chat / 6xxx skill / 7xxx compaction+smart-sort / 8xxx config+preferences / 9xxx infra）。

单类形状：`AppError<K extends ErrorKey>`，构造收 `key / message / details / cause`，静态 desc 只当日志标签、不替代运行期 message；`details` 先 `Record<string, unknown>`，需要时再按 key 做类型映射；`toJSON()` 统一成 `{key, code, desc, message, details}`，正好喂 IPC 与日志。

迁移建议分三步，不一把梭：
① 落 `ErrorCodes` 注册表 + `AppError` + 唯一性守卫测试，零调用点改动；
② 让 16 个 `XxxError` 先 `extends AppError`，保留各自的 code key、details 类型与 `isXxxError` 守卫——这一步就能让日志/序列化拿到统一 `instanceof AppError`，风险最低；
③ 随「所有 error 进 Either」逐域落地，把子类替换成直接 `AppError`，最后删掉每域的 error 文件与守卫。

提醒成本：16 个错误文件、CLI/mobile 的 instanceof 与格式化、IPC 错误形状、既有测试都会碰；步骤②机械但面广，步骤③是长尾。未动代码，等用户拍板从哪步开始。

user:
只做第一步就好，然后把AgentError先改了，其他不动，我们一点点改。不用着急

assistant:
按「只做第一步 + 先迁 AgentError」落地：

新增 `packages/core/src/errors/app-error.ts`：
- `ErrorCodes` 用 `as const satisfies` 定义表，首个码 `AGENT_DOOM_LOOP: {code: 1001, desc: "doom loop detected"}`；号段约定写在文件头（1xxx agent…9xxx infra），数字一经发布不复用/不改号。
- `AppError<K extends ErrorKey>`：构造 `(key, message?, details?, options?: ErrorOptions)`，`name` 设成 key，`code/desc` 从注册表取，message 缺省用 desc 兜底；`toJSON()` 输出 `{key, code, desc, message, details}`；`isAppError(e, key?)` 做收窄。
- 参数列表全部单行，遵守新风格。

迁移 AgentError：删除 `agent-runtime-errors.ts`（六个 code 里只有 DOOM_LOOP 有生产者，其余随之退场）；`doom-loop.ts` 改用 `new AppError("AGENT_DOOM_LOOP", ...)`、返回类型 `Result<void, AppError>`；`public/agent.ts` 导出改为 `AppError` / `ErrorCodes` / `isAppError` + 类型 `ErrorKey` / `ErrorNumber`，allowlist 快照同步；CLI `cli-errors.ts`、mobile `format-error.ts` / `core-shim.ts` / `format-error.test.ts`、`agent-runner.test.ts` 两处断言（改成 `instanceof AppError && key === "AGENT_DOOM_LOOP"`）同步；`agent-run-result.ts` 注释与 `ARCHITECTURE.md` 的命名表/方向说明一并更新。

新增 `test/errors/app-error.test.ts` 7 条：code 正整数且落域段、数字全局唯一、desc 非空、key→code/desc 映射与 desc 兜底、message/details/cause 保留、toJSON 形状、isAppError 收窄与 key 校验。

验证：core typecheck 过、改动文件 lint 0 问题（仅既有 `_branch` warning）、`test/agent` 203/203、`test/errors` + 公开 allowlist 33/33、CLI typecheck 过、mobile `format-error` 16/16、dist 已重建。其余 15 个错误类按用户要求未动。
