---
date: 2026-11-18 10:30
title: p22 public-surface-ownership spec 执行（core 公开面归属收口）
keywords: public-surface-ownership, error-channel-slim worktree, exports 子路径, re-export 归属, check-public-ownership
abstract: 在 D:/worktree/error-channel-slim（分支 feat/error-channel-slim）执行 p22-public-ownership spec：层A 给 tokenizer/llm-protocol 加直映 exports 并删 61 个转手 re-export，层B 删 16 个指向已有出口的 re-export，层C 39 个业务域符号照裁决表撤/留/移；另加归属检测器脚本与 apps/cli 摘除 workspaces。
---

user:
看下 D:\worktree\error-channel-slim\docs\Iterations\public-surface-ownership\spec.md 这个 spec，你看着执行吧。

assistant:
好，spec 已读完。要点：目标仓是 error-channel-slim worktree（基线 ac4d0dcbd，spec commit b860791ab），要做 core 公开面归属收口——层A 给 infra/tokenizer、infra/llm-protocol 加直映 exports 后删 61 个 re-export（含 infra/tokenizer/index.ts:74 的 Interrupt/Outcome 污染源，归宿是 @novel-master/core/errors）；层B 删 16 个指向已有直映出口的 re-export；层C 39 个符号照裁决表处置（留17/撤17/移5）。步骤 0 先把 apps/cli 从 workspaces 摘除。全部改动只有加 exports 条目、删 re-export 行、改 import 路径三种，一行实现不许动。开始按步骤 0-6 执行。

assistant:
全量执行完毕，tag p22-public-ownership，验收 10 条全过：typecheck 14 workspace 绿、core 3537 用例绿、desktop/mobile 全绿、check-style 三段 PASS、dup-gate 新增 0（顺带消除 47+31 组重复）、检测器 exit 0、跨域 116→0、总数 586→493、exports 32→34。消费者迁移 143 个文件由 5 个并行子代理按精确文件清单完成。

关键结论（写进了 docs/Iterations/public-surface-ownership/report.md）：
1. spec 层C 有三条「零消费」判断实测不成立：resolveVfsToolFilePath 有 desktop/mobile 双端消费，改为保留在 chat 门面并进检测器例外表；CHARACTER_CARD 两个常量与 createTemplatePullService 的消费方是 core 测试，照撤、测试改走 src 内部路径。
2. RollbackOptions 本就在 message-checkpoint 导出，撤 session-fs 侧后净减 1，所以总数精确落在 493。
3. 新增子路径要三处接线才不红：core tsconfig.test.json paths、mobile jest moduleNameMapper、mobile 三个测试的 jest.mock/require 路径——tsx/jest 都不会自动读 package.json exports 的新子路径，token 缓存会出 src/dist 双实例假红。
