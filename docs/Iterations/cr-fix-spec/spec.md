---
date: 2026-08-05
---

# CR Fix-Spec 技术规格（SPEC）

## 设计目标

本 SPEC 是 `docs/review/phase5-fix-spec/D5-1-fix-spec.md`（28 条 must-fix，已 fix-spec-ready）的开发执行规格。需求来源不是单个 PRD，而是一次跨 6 个 Phase、4 轮交叉评审产出的全局 CR 债务清单。

**三条决策主线**（用户授权拍板，见 fix-spec「决策记录」）：可维护、性能、干净。

**硬约束**：本 SPEC 按依赖拓扑分波次执行；每个 Phase 内部的 Step 是 blocking 的硬门槛，跨 Phase 的依赖关系决定先后顺序。

## 总体方案

### 波次编排：P0 止血 → P1 结构 → P2 收尾

28 条债务按 D4-1 的波次 + 探索报告新增的依赖链重新编排为 5 个执行 Phase。每个 Phase 内部可以并行（不同 Step 触达文件不重叠），跨 Phase 严格按依赖链。

| Phase | 主题 | 含条目 | 前置 Phase |
|-------|------|--------|------------|
| phase-ci-foundation | CI 落地 + knip 修复 + typecheck 脚本 | S-3 / A-28 | 无 |
| phase-data-safety | 数据安全止血（customAttach / undo_send / SKSP 三端 / Android / abort） | S-16 / S-13 / A-9 / A-20 / A-25 / A-19 | phase-ci-foundation |
| phase-structure-core | 跨资源编排 + 完整性修复 + 文档追踪 + driver 独立性 + 死代码 + events | S-1 / S-8 / S-2 / S-4 / S-5 / S-6 / A-14 / A-21 / A-22 / A-27 | phase-data-safety |
| phase-infra-alignment | mobile 基线 + TS 增量 + tokenizer parity + 发版 + 公共面 | A-11 / A-15 / A-12 / A-17 / A-18 | phase-ci-foundation |
| phase-polish | 性能 + 算法 + SSE parity + driver 抽象 | A-7 / A-10 / A-23 / A-24 / A-26 | phase-structure-core |

### 关键架构决策（来自 fix-spec 决策记录）

- **S-1 + S-8 共建一个跨资源写编排抽象**（`CoordinatedWrite`）——根因同源，一套比两套可维护
- **A-10 引入轻量成熟 diff 依赖**——团队只维护调用层，不维护算法
- **A-26 走 FileSystemPort 接口**——正交分离优于 dynamic import 打补丁
- **A-19 全回滚到 turn 起点**——语义最干净，无需 partial flag 状态机
- **A-22 乐观锁版本号**——不阻塞读 + 无锁状态机
- **A-24 两端都走 SAVEPOINT**——SQL 标准，精确回滚
- **A-18 锁 0.0.0 + 显式声明**——内部包无 semver 义务

## 最终项目结构

新增文件（按 Phase 归类）：

```
packages/core/src/
  common/
    memoize.ts                                    # A-7 公共 memoize helper
  service/
    coordinated-write.ts                          # S-1/S-8 共建的跨资源写编排抽象
    coordinated-write.test.ts
    sksp-integrity.ts                             # S-8 完整性修复抽象（repair/rename/backfill 合一）
infra/sksp/
    logic/
      platform.ts                                 # A-20 getPlatformSkspName() 上提
      env-override.ts                             # A-9 resolveSkspEnvOverride 三端共用
  public/
    kkv.ts                                        # A-17 barrel 补全
    session-kkv.ts                                # A-17 barrel 补全
infra/llm-protocol/
    logic/
      dispatch-sse-chunk.ts                       # A-23 统一分发
test/
  helpers/
    failure-injection.ts                          # S-1 共享失败注入 fixture
  infra/sksp/
    env-secret-store-parity.test.ts               # A-9 三端 parity
    sksp-get-version-parity.test.ts               # A-25 三端 version parity
  coordinated-write/
    failure-path.test.ts                          # S-1 无事务路径回归
    provider-write-failure.test.ts
    set-message-floor-failure.test.ts

packages/cloud-sync-driver-s3/src/
  ports/
    file-system.port.ts                           # A-26 FileSystemPort 接口

packages/tdbc-conformance/
  src/
    nested-batch-parity.spec.ts                   # A-24 跨端 parity

.github/workflows/
  ci.yml                                          # S-3 CI 流水线

docs/
  Iterations/
    iterations.yaml                               # S-2 取代链索引
  release.md                                      # A-18 发版策略
  dev/
    perf-conventions.md                           # A-7 性能约定
```

## 变更点清单

### Phase 1：phase-ci-foundation（S-3 + A-28）

探索报告关键修正：
- **S-3 的 `@typescript-eslint` peerDep `<6.1.0` 上限不存在**——`packages/core/package.json` 无 `peerDependencies` 字段，这条 **no-op**，在 Closure 标「spec 与现状不符」
- **knip 配置压根不存在**（不是「坏掉」），A-28 是从 0 写一份 `knip.json`
- **包管理器是 npm 不是 pnpm**——`package-lock.json` + `pnpm-lock.yaml` 两份 lock 都在，但所有自动化跑 npm。ci.yml 用 npm 对齐 release.yml
- **根和各包都没有 `typecheck` 脚本**——ci.yml 要跑 typecheck 得先加脚本
- **缺 lint 的子包实际是 9 个**（含 `tdbc-conformance`），不是 8 个

### Phase 2：phase-data-safety（S-16 + S-13 + A-9 + A-20 + A-25 + A-19）

探索报告关键修正：
- **abort 检测点实际是 9 处**（不是 PRD 写的 7+）：L176/183/192/208/222/254/331/402/474 + catch L495
- **CLI 根本没注册 mac 驱动**——`apps/cli/package.json` deps 缺 `@novel-master/sksp-mac`，A-20 改时必须同步加
- **`getPlatformSkspName()` 抬到 core 的 RN 兼容性待确认**——`process.platform` 在 RN 下是否 shim 了（`apps/mobile/src/polyfills.ts`），需先核再决定是抽到 core 还是显式注入
- **A-19 全回滚需要 turn 起点快照**——当前代码没有显式 turn marker，需依赖 `messageCheckpoint` 或新增 turn-snapshot

### Phase 3：phase-structure-core（S-1 + S-8 + S-2 + S-4 + S-5 + S-6 + A-14 + A-21 + A-22 + A-27）

探索报告关键修正：
- **`setMessageFloorAtMessage` 实际是 4 步裸写**（hideRange + showRange + 2× clearDomain），spec 决策「改代码对齐两步」的具体两步语义需回查 `Iterations/message-set-floor/spec.md`
- **`resolveRollbackPlan` 乐观锁版本号来源未定**——`chat_message` 没 version 列，需 schema 设计决策（加列 or 用 seq+checkpoint 组合）
- **S-5 撤 `resolveApplicationModelId` alias 会破三个 app**——`apps/desktop`、`apps/mobile` 多处仍在消费，必须先迁移下游到 `resolveSavedModelId`
- **S-8 双引用计数器实际用途不同**（blob 回收 vs revision GC），注释明示「并存不矛盾」——裁决时不能强行合一，应裁决「同类计数器」的兜底逻辑合并，而非两套不同用途的计数器
- **A-22「无护栏是设计」spec 在 `Iterations/chat-user-rollback-redo/spec.md` L18-19**——加乐观锁后需同步清该 spec 条款
- **provider identity worktree 状态**——`.worktree/agent-subagent` 里 `BUILTIN_PROVIDER_KEYS` 改名已完成，主线未合并；A-27 的 builtin id 改名需确认是否等 worktree 合并

### Phase 4：phase-infra-alignment（A-11 + A-15 + A-12 + A-17 + A-18）

探索报告关键修正：
- **references 字段大部分 driver 包已经建好了**——缺的是 `apps/cli` 和 `apps/mobile` 这两个口子，不是「各包都没有」
- **mobile webview tsconfig 是独立一套**（`tsconfig.webview-boot.json` 不 extends RN 那份），A-15 改 mobile tsconfig extends base 时要小心 base 的 `module: NodeNext` 会和 RN 的 `bundler` 模式打架
- **mobile test runner 迁到 `tsx --test` 风险大**——RN 项目 Jest 是社区默认，迁了会丢 RN mock 能力；建议走 fix-spec 的「显式登记例外」退路
- **desktop 已经有两种风格**：cli 复用 `createTsEslintConfig`、desktop 手抄 `sharedTsRules`——统一时直接让 desktop 改 import

### Phase 5：phase-polish（A-7 + A-10 + A-23 + A-24 + A-26）

探索报告关键修正：
- **`expandAnchorHunk` 未在主仓 src/ 直接 grep 命中**——A-10 改法依赖该函数定位，需读 `user-vfs-save-mapping.ts` 完整下半段确认
- **A-23 两条路径并存是文件头注释明示的有意设计**——统一时要更新注释
- **A-24 嵌套事务实际触发面**：`restoreProviderTableSnapshot` 走 `conn.batch`（会被外层 `conn.transaction` 包），better-sqlite3 走 SAVEPOINT、rn 不走——生产路径确实会踩到

## 详细实现步骤

### Phase 1：phase-ci-foundation

- Step 1 — phase-ci-foundation — blocking: yes — qa: auto：新建 `.github/workflows/ci.yml`，触发 `on: [pull_request, push]`，矩阵跑 `npm ci` → `npm run lint --workspaces --if-present` → `npm run typecheck --workspaces --if-present` → `npm run test --workspaces --if-present`。包管理器用 **npm**（与 release.yml 对齐），**不**用 pnpm
- Step 2 — phase-ci-foundation — blocking: yes — qa: auto：根 `package.json` 新增 `"typecheck": "npm run typecheck --workspaces --if-present"` 转发脚本；各包（core/desktop/cli/mobile）加 `"typecheck": "tsc --noEmit -p tsconfig.json"`（mobile 用 `tsconfig.build.json`）
- Step 3 — phase-ci-foundation — blocking: yes — qa: auto：9 个无 lint 子包逐个补 `eslint.config.mjs`（用 `createTsEslintConfig(import.meta.dirname)` 导出，对齐 cli 的做法）+ 各自 `package.json` 加 `"lint": "eslint src test"` 脚本
- Step 4 — phase-ci-foundation — blocking: yes — qa: auto：从 0 新建根 `knip.json`，entry 显式登记：desktop 测试入口（`apps/desktop/test/**/*.test.ts` + `apps/desktop/scripts/run-tests.mjs`）、mobile wdio 入口（`apps/mobile/e2e/wdio.conf.ts` + `apps/mobile/e2e/specs/**`）、mobile webview bundler 入口（`apps/mobile/scripts/build-webview.mjs` + `apps/mobile/src/web/*/webview/**`）；paths 认 desktop renderer 的 `@/` 别名（需先确认 `@/` 在哪定义——可能在 vite.config 或 `tsconfig.renderer.json`）
- Step 5 — phase-ci-foundation — blocking: no — qa: auto：删除根 `pnpm-lock.yaml`（消除包管理器二义性），仅保留 `package-lock.json`
- Step 6 — phase-ci-foundation — blocking: no — qa: auto：重跑 knip，把误判量从 126+ 降到接近 0；输出真实死代码清单 → 交 S-5 执行

### Phase 2：phase-data-safety

- Step 7 — phase-data-safety — blocking: yes — qa: auto：**S-16**：`packages/core/src/domain/prompt/logic/normalize-agent-prompt-layout.ts` L58-67 的 return 对象补 `customAttach` 透传（从输入透传，与 `systemPrompt`/`tools` 方式一致）；排查 normalize 函数族其他同类 return
- Step 8 — phase-data-safety — blocking: yes — qa: auto：**S-13 护栏**：`packages/core/src/service/message-checkpoint/impl/message-rollback.service.ts` 的 undo_send 分支（L189-209），当 targetTree 为空时拒绝删除并抛错或回退到最近 baseline
- Step 9 — phase-data-safety — blocking: yes — qa: auto：**S-13 治本**：把「每条消息必有 baseline checkpoint」不变式上提到 `agent-runner.ts` 源头——在 `run-agent-turn.ts:283-307` 的 append+capture+append 链执行前先写 baseline checkpoint（当前普通纯文本 chat 路径不写 baseline）
- Step 10 — phase-data-safety — blocking: yes — qa: auto：**S-13 扩展**：`backfill-baseline-checkpoints.ts` 的 backfill 路径从「仅导入」扩展到「所有产生消息的入口」（含普通 agent chat）
- Step 11 — phase-data-safety — blocking: yes — qa: auto：**A-9**：在 `packages/core/src/infra/sksp/logic/` 新建 `env-override.ts`，抽 `resolveSkspEnvOverride(name, env)` 纯函数（空串/空白/undefined 一律视为不覆盖 DB）；三端 SKSP 读取入口统一 import 该函数
- Step 12 — phase-data-safety — blocking: yes — qa: auto：**A-20**：先确认 `process.platform` 在 RN 下是否 shim（读 `apps/mobile/src/polyfills.ts`）；若 shim 了，新建 `packages/core/src/infra/sksp/logic/platform.ts` 上提 `getPlatformSkspName()`；若没 shim，走显式注入（caller 传 platform 字符串）
- Step 13 — phase-data-safety — blocking: yes — qa: auto：**A-20 续**：`apps/cli/src/runtime.ts:162` 从 `resolveSkspDriver("windows")` 改为 `resolveSkspDriver(getPlatformSkspName())`；`apps/cli/package.json` deps 加 `@novel-master/sksp-mac`；CLI 启动时若平台无 SKSP driver 抛明确错误
- Step 14 — phase-data-safety — blocking: yes — qa: auto：**A-25**：`packages/sksp-android/src/android-secret-store.ts` L55 的 SELECT 补 `version` 列，与 mac/windows 对齐；核对 `set()`/`upsert()` 是否也按 version 列处理
- Step 15 — phase-data-safety — blocking: yes — qa: auto：**A-19**：`agent-runner.ts` 抽 `handleAbort(reason, branch)` helper，9 处检测点（L176/183/192/208/222/254/331/402/474）+ catch L495 全部走它；L331 partial 写入和 L495 catch 改为回滚到 turn 起点（依赖 messageCheckpoint 或新增 turn-snapshot）
- Step 16 — phase-data-safety — blocking: yes — qa: manual_user：**S-2 SKSP 部分**：`docs/Iterations/sksp/spec.md` L248 改成收紧语义（空 env 不覆盖 DB），与实现 L17 对齐；消除 spec 内部 `has()` L252 与 `get()` L248 的矛盾

### Phase 3：phase-structure-core

- Step 17 — phase-structure-core — blocking: yes — qa: auto：**S-1 抽象**：新建 `packages/core/src/service/coordinated-write.ts`，提供「注册步骤 + 失败时按注册逆序回滚」能力，覆盖三类跨资源写：secretStore 域、kkv 域、append+capture+append 链
- Step 18 — phase-structure-core — blocking: yes — qa: auto：**S-1 迁移**：三个路径迁移到编排抽象——`run-agent-turn.ts` 的 append+capture+append 链、`provider.service.ts` 的 create/edit/delete、`message-transcript-effects.service.ts` 的 `setMessageFloorAtMessage`（4 步塞事务，先回查 `Iterations/message-set-floor/spec.md` 确认两步语义）
- Step 19 — phase-structure-core — blocking: yes — qa: auto：**S-1 测试基建**：新建 `packages/core/test/helpers/failure-injection.ts`，提供「在第 N 步抛错」能力
- Step 20 — phase-structure-core — blocking: yes — qa: auto：**S-8**：新建完整性修复抽象（`repair/rename/backfill` 合一）；三个模块（vfs/chat-message/provider）迁移；双引用计数器裁决——注意 blob 回收（触发器）和 revision GC（应用层）用途不同，裁决「同类计数器的兜底逻辑合并」，**不**强行合一两套不同用途的计数器
- Step 21 — phase-structure-core — blocking: no — qa: auto：**S-2 文档**：新建 `docs/Iterations/iterations.yaml`，为每个 iteration 加 `id / supersedes / superseded-by / status`；先把 9 处已知漂移涉及的 iteration 录入，逐步覆盖全 151 个
- Step 22 — phase-structure-core — blocking: no — qa: auto：**S-2 续**：逐条对齐 8 处漂移——`tool-system-v2/prd.md` 移除 chat_grep 必备（6 处）、`ARCHITECTURE.md` L56-63 删除失效 exception（逐条核 6 条）、`prompt-engine/spec.md` L201/L245 对齐、`agent-prompt-abstract-block/prd.md` 加 superseded-by、`message-rollback-remove-session-log/spec.md` 加 superseded-by
- Step 23 — phase-structure-core — blocking: yes — qa: auto：**S-4**：7 个 driver 包 `package.json` 的 core 从 `dependencies` 移到 `peerDependencies`；解 core devDep 环（core 测试对 2 个下游 driver 的依赖迁移到独立测试包或 mock 化）；mobile 装配改回走 SKSP registry；mobile 测试移除 evaluator stub undefined
- Step 24 — phase-structure-core — blocking: yes — qa: auto：**S-5 前置**：先迁移 `apps/desktop`、`apps/mobile` 对 `resolveApplicationModelId` 的消费点到 `resolveSavedModelId`（不裸撤 alias，会破三个 app）
- Step 25 — phase-structure-core — blocking: yes — qa: auto：**S-5 清扫**：6 模块公共面死代码一次性清扫——`public/compaction.ts` 移除 `estimateTokens`、`public/agent.ts` 移除 4 对 alias（前置完成后）、`public/chat.ts` L147-154 deprecated 段、`infra/tokenizer/index.ts` re-export 残留（结合 knip 报告）、`chat-grep-tool.ts` 撤（S-2 PRD 改完后）
- Step 26 — phase-structure-core — blocking: yes — qa: auto：**S-5 契约**：新增 lint 规则，禁止 `index.ts`/`public/*.ts` re-export 带 `@deprecated` 的符号
- Step 27 — phase-structure-core — blocking: yes — qa: auto：**S-6**：`event-orchestrator.service.ts` L66-98 的 `void emit().then()` 改为纳入调用方生命周期（await 或挂到 run 的取消/完成信号）；`wrapStreamForBus` 的 `queueMicrotask` 改为确定性排序；sub-agent events 生命周期纳入父 run 的 `agentActiveRefCount`；同步改 `agent-runner-stream-bus.test.ts` 的 intentional 断言
- Step 28 — phase-structure-core — blocking: yes — qa: auto：**A-14**：`BuiltinToolContext` 加 `allowedPaths?: string[]`（先定语义层级——VFS 内绝对路径还是相对 session root）；`ToolRunner.call()` L93 后补 path 白名单二次校验；加资源配额占位；三端 runtime + 测试桩补字段注入
- Step 29 — phase-structure-core — blocking: yes — qa: auto：**A-21**：`cloud-sync-coordinator.ts` 的 `push` 入口加进程内互斥锁（session 维度），push 持锁期间 agent 启动排队（带超时降级拒绝）；push 续租检查锁状态；先定位 agent 启动入口（扫 `createAgentRunner` 调用方）确定锁挂在 core 还是 apps runtime
- Step 30 — phase-structure-core — blocking: yes — qa: auto：**A-22**：`message-rollback.service.ts` 的 `resolveRollbackPlan` 加乐观锁版本号——先做 schema 设计决策（加 version 列 or 用 seq+checkpoint 组合）；读时记版本号，写时校验，冲突则重试；同步清 `Iterations/chat-user-rollback-redo/spec.md` L18-19 的「无护栏是设计」条款 + `ARCHITECTURE.md` 对应 exception
- Step 31 — phase-structure-core — blocking: yes — qa: auto：**A-27**：`provider-table-snapshot.ts` 的 `restoreProviderTableSnapshot` 改为走 service upsert 或统一 `validateDefinition`（不再 raw INSERT）；各 module repository 的 row→def 映射补 service 校验；清理残留（`CompactionConditionsTrigger` 草稿、`validatePromptBlocks` 死路径、`setMessageFloor` 改代码两步、`BUILTIN_PROVIDER_IDS` 改名——先确认 provider identity worktree 状态）

### Phase 4：phase-infra-alignment

- Step 32 — phase-infra-alignment — blocking: no — qa: auto：**A-11**：`packages/core/package.json` build 去掉 `--force`；`apps/cli/tsconfig.json` 加 references（core + sksp-windows + sksp-mac + tdbc-better-sqlite3 + tokenizer-node）；`apps/mobile/tsconfig*.json` 加 references（与 A-15 一起做）
- Step 33 — phase-infra-alignment — blocking: no — qa: auto：**A-15 tsconfig**：`apps/mobile/tsconfig.json` 改为 `extends: "../../tsconfig.base.json"`，覆盖差异项（target/module/moduleResolution/jsx/jsxImportSource/lib/types）；注意 webview tsconfig 是独立一套，不能一刀切 extends base（base 的 `module: NodeNext` 会和 RN 的 `bundler` 打架）
- Step 34 — phase-infra-alignment — blocking: no — qa: auto：**A-15 ESLint**：把 `sharedTsRules` 抽成共享导出（`eslint.config.base.mjs` named export 或新建 `eslint.rules.shared.mjs`）；desktop 改为 import 共享规则；mobile `.eslintrc.js` 迁移到 `eslint.config.mjs`（ESLint 9 flat config），devDep 升 `eslint ^9.x`
- Step 35 — phase-infra-alignment — blocking: no — qa: auto：**A-15 test runner**：mobile test runner 走「显式登记例外」退路（不强行迁到 `tsx --test`，RN 项目 Jest 是社区默认，迁了会丢 RN mock 能力）；在 ARCHITECTURE 登记 mobile 仍走 jest 的例外
- Step 36 — phase-infra-alignment — blocking: no — qa: auto：**A-12**：抽公共 `countTokens(messages, kind)` 纯函数，三端共用；`counterKind` 改为反映实际算法（RN 的 `+3+3` 标 heuristic 而非冒充精确）；compaction evaluator 加降级兜底（heuristic 时触发保守阈值）
- Step 37 — phase-infra-alignment — blocking: no — qa: auto：**A-17**：新建 `packages/core/src/public/kkv.ts` + `session-kkv.ts` barrel；`packages/core/package.json` exports 的 `./kkv` 和 `./session-kkv` target 从 `dist/service/*` 改为 `dist/public/*`；核对下游 import 路径
- Step 38 — phase-infra-alignment — blocking: no — qa: auto：**A-18**：所有内部包统一锁 0.0.0；`packages/core/ARCHITECTURE.md` 追加「内部包无 semver 义务，仅端发版」声明；新建 `docs/release.md` 落地发版策略

### Phase 5：phase-polish

- Step 39 — phase-polish — blocking: no — qa: auto：**A-7**：新建 `packages/core/src/common/memoize.ts`（纯函数 + WeakMap/Map 自动选择）；`SqlTemplateParser.parse` 加 `Map<template, AstNode>` 缓存；`expression.ts` 的 `new Function` 加缓存；`vfs-path-mapper.ts` 单链 3 次 normalize 收敛为一次；在 `docs/dev/perf-conventions.md` 写明「AgentRunner 主循环纯函数必须 memoize」约定
- Step 40 — phase-polish — blocking: no — qa: auto：**A-10**：先读 `user-vfs-save-mapping.ts` 完整下半段定位 `expandAnchorHunk`；核对 ARCHITECTURE 外部依赖政策后引入轻量 Myers diff 库；`diffRecursive` 核心替换为 Myers；`expandAnchorHunk` 改为基于 Myers 输出的线性扩展；保持 mapping 结构不变
- Step 41 — phase-polish — blocking: no — qa: auto：**A-23**：抽公共 `dispatchSseChunk(rawBytes, emitter)`，fetch 与 XHR 都走它；更新文件头注释（原注释明示有意分叉，改后要同步）
- Step 42 — phase-polish — blocking: no — qa: auto：**A-24**：`packages/tdbc-driver-rn/src/connection.ts` 的 `batchDirect` 在 `inTransaction` 时改走 SAVEPOINT；确认 `tdbc-driver-better-sqlite3` 的 `batchSync` 嵌套行为；新建 `tdbc-conformance` 跨端 parity 套件
- Step 43 — phase-polish — blocking: no — qa: auto：**A-26**：`packages/cloud-sync-driver-s3/src/ports/` 新建 `file-system.port.ts` 定义 `FileSystemPort` 接口；`create-s3-object-storage.ts` L9 删静态 `import "node:fs/promises"`，改 `FileSystemPort` 注入（Node 注入 `node:fs`，mobile 注入 RN shim）；mobile 端逐步移除多余 shim + 全局 polyfill（先 bundle 产物 grep 验证无其他依赖）

## 测试策略

### 测试原则

- 每个 Phase 的 Step 都有对应测试用例
- blocking Step 的测试必须全绿才能进下一 Phase
- 探索报告新增的回归测试（9 处 abort 检测点、provider 多步写失败、SKSP 三端 parity 等）全部纳入

### 测试用例

- T-CI1 — blocking: yes — Step 1/2：提一个 PR 触发 ci.yml，lint/typecheck/test 三 job 全绿（对应 S-3）
- T-CI2 — blocking: yes — Step 3：`npm run lint` 输出里 9 个子包被扫描（对应 S-3）
- T-CI3 — blocking: no — Step 4/6：knip 重跑后误判量从 126+ 降到接近 0（对应 A-28）
- T-DS1 — blocking: yes — Step 7：domain-shape round-trip 测试——含 customAttach 的 layout 序列化存储→加载→normalize→断言字段不丢（对应 S-16）
- T-DS2 — blocking: yes — Step 8：targetTree 为空时 undo_send 报错或安全回退，断言工作区文件数不减少（对应 S-13 护栏）
- T-DS3 — blocking: yes — Step 9/10：普通 chat 路径下 capture 步骤 throw → 触发 undo_send → 断言会话工作区非空（对应 S-13 治本）
- T-DS4 — blocking: yes — Step 11：`resolveSkspEnvOverride` parity 套件——undefined/""/"  "/非空 四态，三端各跑（对应 A-9）
- T-DS5 — blocking: yes — Step 12/13：`getPlatformSkspName()` × `process.platform` mock 测试（darwin/linux/win32）（对应 A-20）
- T-DS6 — blocking: yes — Step 14：Android SKSP version=2 时 `get()` 能读出正确 version（对应 A-25）
- T-DS7 — blocking: yes — Step 15：abort 三分支注入测试——构造网络抖动命中 9 处检测点 + catch，断言同一 abort 后会话状态一致（对应 A-19）
- T-SC1 — blocking: yes — Step 17/18：`run-agent-turn` capture 步骤注入 throw → 断言 baseline checkpoint 存在、会话可回滚（对应 S-1）
- T-SC2 — blocking: yes — Step 17/18：`provider.create` 写 secretStore 中间步骤失败 → 断言不留半套凭据（对应 S-1）
- T-SC3 — blocking: yes — Step 17/18：`setMessageFloorAtMessage` 中间失败 → 断言 ref_count 一致（对应 S-1）
- T-SC4 — blocking: yes — Step 17：编排抽象本身单元测试（注册逆序回滚、嵌套场景）
- T-SC5 — blocking: yes — Step 20：双引用计数器裁决后，触发器路径与应用层路径不会重复计数（对应 S-8）
- T-SC6 — blocking: yes — Step 25/26：knip/自定义 lint 扫描公共面，无残留 @deprecated 导出（对应 S-5）
- T-SC7 — blocking: yes — Step 27：sub-agent task 工具（persistMessages:true）触发时，父 run events DAG 正确门控（对应 S-6）
- T-SC8 — blocking: yes — Step 27：`queueMicrotask` 改造后多次运行事件顺序一致（对应 S-6）
- T-SC9 — blocking: yes — Step 28：agent 试图写 allowedPaths 之外的路径，断言被拒（对应 A-14）
- T-SC10 — blocking: yes — Step 29：push 进行中启动 agent、agent 运行中触发 push、push 续租超时、并发 push（对应 A-21）
- T-SC11 — blocking: yes — Step 30：resolveRollbackPlan 进行中注入 agent 写入，断言回滚计划不基于过期读（对应 A-22）
- T-SC12 — blocking: yes — Step 31：db-backup import 走非法 def → 拒；cloud-sync pull 走非法 def → 拒（对应 A-27）
- T-IA1 — blocking: no — Step 32：core 改一行非导出实现 → 仅 core 重编，下游包跳过（对应 A-11）
- T-IA2 — blocking: no — Step 33/34：mobile `tsc --noEmit` 通过 base 规则（noUnusedLocals 等生效）（对应 A-15）
- T-IA3 — blocking: no — Step 36：tokenizer parity 套件——Node/RN/WEB 三端各跑 20+ 用例，断言计数对齐（对应 A-12）
- T-IA4 — blocking: no — Step 37：exports 子路径解析测试（对应 A-17）
- T-P1 — blocking: no — Step 39：`SqlTemplateParser.parse` 缓存命中率测试——同模板 N 次调用只编译一次（对应 A-7）
- T-P2 — blocking: no — Step 40：10⁴ 行文件随机改动，diff 耗时在可接受阈值内；原 `diffRecursive` 与新实现跑同一组用例输出一致（对应 A-10）
- T-P3 — blocking: no — Step 41：parity 套件——含分包/粘包/延迟到达的 SSE 流，fetch 与 XHR 各跑，断言 chunk 序列一致（对应 A-23）
- T-P4 — blocking: no — Step 42：跨端 parity——batch 部分失败用例，better-sqlite3 与 RN 各跑，断言回滚范围一致（对应 A-24）
- T-P5 — blocking: no — Step 43：mobile bundle 构建产物不含 `node:fs` 字符串（grep 验证）（对应 A-26）
- T-QA1 — blocking: no — qa: manual_user — Step 8/15：手动验收普通 chat 路径 undo_send 不删光会话（构造 capture 失败场景）
- T-QA2 — blocking: no — qa: manual_user — Step 7：手动验收含 customAttach 的 agent prompt 经存储加载后字段不丢
- T-QA3 — blocking: no — qa: manual_user — Step 11：手动验收 SKSP env 空串时 DB 不被覆盖（三端各验一次）

## 风险与回滚方案

### 高风险项

1. **A-19 全回滚的 turn 起点定义**：当前代码没有显式 turn marker，回滚依赖 `messageCheckpoint` 或新增 turn-snapshot。若 messageCheckpoint 不足以界定 turn 边界，需先做 schema 设计（加 turn_id 列）。回滚方案：若无法干净回滚到 turn 起点，退回方案 A（partial + abort flag）作为过渡。

2. **A-22 乐观锁版本号 schema 设计**：`chat_message` 没 version 列，乐观锁要加新列（schema migration）或用 seq+checkpoint 组合。加列是 schema 变更，需 migration 脚本 + 回滚 migration。回滚方案：若 schema 变更风险大，退回写锁（session 级互斥）。

3. **S-5 撤 `resolveApplicationModelId` alias 的下游迁移**：desktop/mobile 多处仍在消费，迁移本身是一次跨 app 改动。回滚方案：若下游迁移未完成，保留 alias 但加 `@deprecated` JSDoc + lint warning，延后撤除。

4. **A-15 mobile tsconfig extends base 的 webview 冲突**：base 的 `module: NodeNext` / `moduleResolution: NodeNext` 会和 RN 的 `bundler` 模式打架。回滚方案：若 mobile RN 编译挂，mobile tsconfig 在 extends 后显式覆盖 `module`/`moduleResolution` 回 `bundler`。

5. **S-8 双引用计数器裁决边界**：blob 回收（触发器）和 revision GC（应用层）用途不同，注释明示「并存不矛盾」。若强行合一会引入新问题。回滚方案：仅合并「同类计数器的兜底逻辑」，不动两套不同用途的计数器本身。

6. **provider identity worktree 状态**：`.worktree/agent-subagent` 里 `BUILTIN_PROVIDER_KEYS` 改名已完成，主线未合并。A-27 的 builtin id 改名若与 worktree 撞改，需先确认合并顺序。回滚方案：若 worktree 即将合并，A-27 的 builtin id 部分延后到 worktree 合并后。

### 回滚原则

- 每个 Phase 独立可回滚——若某 Phase 的 blocking Step 测试不绿，不进下一 Phase
- schema 变更（A-22 version 列、A-19 turn snapshot）必须有对应的 down migration
- 公共面撤除（S-5 alias）必须先迁移下游，下游迁移本身是独立 commit
