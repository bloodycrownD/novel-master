# D3-2：债务登记表

## 元信息
- 来源：D1-01~11（11 份横扫）+ D2-vfs/chat-message/provider-llm/agent-tool/compaction/prompt（6 份切片）+ D2a-L1~L11（11 份跨模块模式）+ D3-1 冲突矩阵（9 条冲突）
- 总条目数：28
- S 级：10 / A 级：18
- 打分维度：影响面（1-3）× 严重度（1-3）× 被点名次数（1-3），总分 3-9

---

## 债务清单（按优先级排序）

### #1 [总分 9] 跨资源多步写无事务 + 无 failure path 回归测试（复合）
- 模块：agent-runner / chat-message / provider-llm / vfs
- 角度：L4 + L5 + L7 + D2a-L4 + D2a-L7（5 角度交叉）
- 严重度：S
- 影响面：3（系统级——跨 4 个核心模块）
- 被点名：3（5 个角度独立命中）
- 位置：`run-agent-turn.ts` append+capture+append 链、`provider.create/edit/delete` 跨 secretStore、`setMessageFloorAtMessage` 四步写、checkpoint 跨 context 改 ref_count
- 问题：仓库缺「跨资源写编排」抽象——同一逻辑操作拆成多步裸写，中间崩了留脏数据。rollback-* 系列 5 次打补丁都是治标（只修导入路径，普通 chat 路径还没修）。更严重的是，这 5 条无事务路径全部没有「中间步骤失败→验证半套状态」的回归测试。
- 建议：建立统一的跨资源事务协调器（或至少「每条消息必有 baseline checkpoint」的不变式）；失败注入 fixture 要做成共享 helper
- 来源：D3-1 冲突 #8 + D2a-L4 模式 1 + D2a-L7 模式 1 + D2-chat-message S1+S2 + D2-agent-tool L4/L5 命中

### #2 [总分 9] 文档/PRD/ARCHITECTURE 系统性漂移（含反向危险项）
- 模块：provider-llm / agent-tool / compaction / prompt / chat-message / vfs
- 角度：L11 + L8 + L3 + D2a-L11 + D2a-L8（5 角度交叉）
- 严重度：S
- 影响面：3（系统级——跨 6 个模块 9 处 PRD 被推翻）
- 被点名：3（5 个角度独立命中）
- 位置：`sksp/spec.md` L248（反向危险）、`agent-prompt-abstract-block/prd.md`（被推翻）、`tool-system-v2/prd.md`（chat_grep 仍列必备）、`ARCHITECTURE.md` documented exception §2（失效未删）、`prompt-engine/spec.md`（偏离）、`message-rollback-remove-session-log/spec.md`（被架空）
- 问题：Iterations 目录平铺无 `supersedes:` / `superseded-by:` 元数据，PRD 定稿被推翻后无追踪。最危险的是 SKSP env 空串语义反向漂移——当前安全行为靠代码偏离 spec 撑，按 spec 改回会更不安全。
- 建议：建立 `iterations.yaml` 跟踪取代链；整改时必须先确认实现方向正确，再把 spec 对齐到实现，绝不能反过来
- 来源：D3-1 冲突 #1 + D2a-L11 模式 1+2+4 + D2a-L8 模式 3

### #3 [总分 9] CI 完全缺失——所有 S/A 级发现无法被自动捕捉
- 模块：全仓库
- 角度：L10 + 所有其他角度（放大器）
- 严重度：S
- 影响面：3（系统级）
- 被点名：3（L10 + D2a-L10 + 被 D2a-L7 模式 1/4 引用 + 被 D2a-L8 模式 4 引用）
- 位置：`.github/workflows/` 只有 `release.yml`，无 PR/push 检查
- 问题：CI 零覆盖是根因中的根因——事务缺口、公共面污染、spec drift、静默吞错这些全靠人眼拦。8 个子包完全无 lint，`@typescript-eslint` peerDep `<6.1.0` 是延迟引爆地雷。
- 建议：先补 PR/push 的 lint+typecheck+test CI；8 个无 lint 子包优先纳入
- 来源：D1-10 S 级 + D2a-L10 模式 1+3

### #4 [总分 8] driver 包独立性是纸面上的——描述可插拔、实际硬编码、各自演化
- 模块：tdbc-driver-* / sksp-* / cloud-sync-driver-s3 / tokenizer-driver-*
- 角度：L3 + L10 + D2a-L3 + D2a-L10（4 角度交叉）
- 严重度：S
- 影响面：3（8 个包 + 3 个 app）
- 被点名：3（4 个角度）
- 位置：所有 `packages/tdbc-driver-*/package.json`（core 放 dependencies 非 peer）、`packages/core/package.json` devDep（含下游 driver 形成环）、mobile 直连 `createAndroidSecretStore` 绕过 registry
- 问题：7 个 driver 全部把 core 放 dependencies（双重安装风险）、core devDep 含 2 个下游 driver（2 条 devDep 环）、mobile 绕过 SKSP registry 直连、mobile 测试把 evaluator stub 成 undefined。独立性从未被独立安装或独立测试验证过。
- 建议：driver → core 改 peerDependencies；解 core devDep 环（测试迁移到独立测试包）；mobile 改回 registry 装配
- 来源：D1-03 S 级 + D2a-L3 模式 4 + D2a-L10 模式 3

### #5 [总分 8] @deprecated / 死代码仍挂在公共面对外导出（跨 6 模块）
- 模块：compaction / agent-tool / chat / provider-llm / vfs / prompt
- 角度：L8 + L9 + D2a-L8 + D2a-L9（4 角度交叉）
- 严重度：S
- 影响面：3（6 个模块）
- 被点名：3（4 个角度）
- 位置：`public/compaction.ts`（estimateTokens 死代码仍导出）、`public/chat.ts`（377 行含 @deprecated）、`public/agent.ts`（4 对 alias 残留）、`infra/tokenizer/index.ts`（4 个 re-export 残留）、`chat-grep-tool.ts`（@deprecated 但 PRD 仍列必备）
- 问题：迭代重构后公共面退出不干净——新实现已上线，旧符号仍挂在 `public/*.ts` 或 `index.ts`。core 还在 0.0.0、没有兼容义务，dead alias 即使无消费者也必须撤。
- 建议：建公共面退出契约——lint 禁 `index.ts` / `public/*.ts` re-export 带 `@deprecated` 的符号；一次性清扫 6 个模块
- 来源：D2a-L8 模式 1 + D2a-L9 模式 1 + D1-09 + D2-compaction S1

### #6 [总分 8] 异步副作用脱离调用方生命周期（fire-and-forget 泛滥）
- 模块：events / agent-runner / cloud-sync / 未来 sub-agent
- 角度：L5 + D2-agent-tool + D2a-L5（3 角度交叉）
- 严重度：S
- 影响面：3（事件系统是全局基础设施）
- 被点名：3（3 个角度）
- 位置：`event-orchestrator` 的 `void emit().then()`、`wrapStreamForBus` 的 `queueMicrotask` 错序、sub-agent `publishRunLifecycle:false` + `agentActiveRefCount` 失效
- 问题：events-reliability 把「message.received 脱离门控」锁成 intentional 是基于现有 sub-agent 用 `persistMessages:false`；但 `agent-subagent` PRD 的 task 工具是 `persistMessages:true`——子 session 会触发父进程 events DAG。时间炸弹。
- 建议：sub-agent 的 events 生命周期必须纳入父 run 的 agentActiveRefCount；queueMicrotask 错序要改确定性排序
- 来源：D3-1 冲突 #8 + D2a-L5 模式 2 + D2-agent-tool A1

### #7 [总分 8] 热路径无缓存 / 重复计算（跨 4 条 parser/compiler 路径）
- 模块：sql-template / regex / tokenizer / vfs-path-mapper
- 角度：L2 + D2a-L2 + L7（3 角度交叉）
- 严重度：A（升 S 候选：sql-template 在 agent 每轮跑几十次）
- 影响面：2（跨 4 个 parser/compiler 路径）
- 被点名：3（3 个角度）
- 位置：`SqlTemplateParser.parse`（无 AST 缓存 + `new Function` 重编译）、regex 编译产物缓存未核实、vfs-path-mapper 单链 3 次 normalize、tokenizer 序列化重复
- 问题：仓库里「memoize」是偶发习惯不是约定——唯一做对了的反例是 `session-api-prompt-token-cache`。缺统一的「AgentRunner 主循环里的纯函数应当 memoize」约定 + 公共 helper。
- 建议：加 `Map<template, AstNode>` 缓存；建 memoize 公共 helper + 约定文档
- 来源：D1-02 F1 + D2a-L2 模式 1 + D1-07 sql-template 无测试

### #8 [总分 7] 数据层轻约束 + 应用层补丁的「双轨制」
- 模块：vfs / chat-message / provider-llm
- 角度：L1 + D2a-L1 + D2a-L4（3 角度交叉）
- 严重度：S
- 影响面：3（系统级——持久化层的全局模式）
- 被点名：3（3 个角度）
- 位置：vfs 双引用计数器（触发器 + 应用层）、chat-message checkpoint 跨 context 改 ref_count、provider 双身份键 + 手动逐表删
- 问题：仓库在持久化层刻意只做轻约束（很少 FK、不外键级联），但应用层没补上配套的「统一事务编排 / 统一完整性修复」抽象。三个模块各自长出形态相近的兜底但互不复用。
- 建议：D2a-L1 建议模式 1/2/4/7 合并裁决——它们是同一架构层根因的四个切面
- 来源：D2a-L1 模式 1+2+4+7 + D1-01 双引用计数器

### #9 [总分 7] SKSP env 空串语义反向漂移（按 spec 整改会更不安全）
- 模块：provider-llm
- 角度：L6 + L8 + L11 + D2-provider-llm（4 角度交叉）
- 严重度：A（反向危险——升 S 候选）
- 影响面：1（单模块，但影响所有三端的安全行为）
- 被点名：3（4 个角度）
- 位置：`sksp/spec.md` L248 vs 实现代码
- 问题：spec 写的是空 env 不覆盖 DB（宽松），实现做的是空 env 覆盖 DB 但被代码收紧（安全）。按 spec 改回会让空 env 变量覆盖 DB。
- 建议：Phase 5 fix-spec 必须把 spec 和代码**同步**改成收紧语义——先改 spec 到实现的安全方向，再确保代码与 spec 一致
- 来源：D3-1 冲突 #1 + D2-provider-llm S2

### #10 [总分 7] user-vfs-save-mapping 最坏 O(n³)
- 模块：vfs
- 角度：L2 + D2-vfs（2 角度交叉）
- 严重度：A
- 影响面：1（单模块，但影响用户每次保存大文件）
- 被点名：2
- 位置：`diffRecursive` 朴素双循环递归 + `expandAnchorHunk` 半径线性扫描
- 问题：n=文件行数，用户编辑大文件保存时会卡。建议换 Myers diff。
- 建议：替换为 Myers diff 算法；加 10⁴ 行 diff 性能基线测试
- 来源：D1-02 F2 + D2-vfs A1

### #11 [总分 7] 构建 `--force` 禁用增量 × TS 项目引用未建立 × 跨包辐射
- 模块：core + 所有下游包
- 角度：L2 + D2a-L2 + L10（3 角度交叉）
- 严重度：A
- 影响面：3（全 monorepo）
- 被点名：3
- 位置：`packages/core/package.json` build 脚本 `tsc --build --force`、各包 tsconfig 无 `references`
- 问题：core 改一行 → 全仓所有包全量重编一遍。workspace 拓扑和 TS 增量拓扑是两套独立系统。
- 建议：先去 `--force` → 再建 `references` → 验证 `.tsbuildinfo` 生效
- 来源：D1-02 F3+F4 + D2a-L2 模式 2

### #12 [总分 6] tokenizer 三端计数公式不一致 × compaction 判定依赖
- 模块：tokenizer / compaction / provider
- 角度：L6 + D2-compaction + D2-provider-llm（3 角度交叉）
- 严重度：A
- 影响面：2（影响 compaction 判定准确性）
- 被点名：3
- 位置：Node 走 `countOpenAiStyleMessages`（含 role overhead），RN 手写 `encode().length + 3 + 3`；WEB/SP 回退 heuristic 但 `counterKind` 撒谎
- 问题：compaction 是「超阈值就触发」的硬开关，会吃到不准的计数；evaluator 没有降级兜底
- 建议：统一三端计数公式或建立 parity 套件；compaction evaluator 加降级兜底
- 来源：D1-06 A-4 + D2-compaction B1 + D2-provider-llm B2

### #13 [总分 6] undo_send 空 targetTree × 普通 chat 路径无 backfill = 删光会话文件
- 模块：chat-message
- 角度：D2-chat-message（切片独家发现）
- 严重度：S
- 影响面：1（单模块，但是数据丢失级别）
- 被点名：1
- 位置：`run-agent-turn.ts:283-307` 的 append+capture 与 `agent-runner.ts:450-478` 的循环三步无事务 + `rollback-import-baseline-checkpoint` 兜底只覆盖导入路径
- 问题：普通 agent 聊天里 capture 失败留下无 baseline 的消息，用户立刻 undo_send → targetTree 空 → reconcile 删光会话工作区
- 建议：每条消息必有 baseline checkpoint 的不变式要上提到 agent-runner 源头，不是在 rollback 下游打补丁
- 来源：D2-chat-message S1

### #14 [总分 6] agent tool policy 缺路径白名单与资源配额
- 模块：agent-tool
- 角度：L8 + D2-agent-tool（2 角度交叉）
- 严重度：A
- 影响面：1（单模块，但是安全越权）
- 被点名：2
- 位置：`BuiltinToolContext` 无 path 字段、`Tool.inputSchema` 只能验字符串、runner 不二次校验
- 问题：agent 可越权写任意子树。path scope 完全无架构占位。
- 建议：加 `allowedPaths` 维度；BuiltinToolContext 加 path scope 字段
- 来源：D1-08 A 级安全 + D2-agent-tool A4

### #15 [总分 6] mobile 整条线脱离 base 配置（TS/ESLint/test runner/engines 四线全脱）
- 模块：apps/mobile + mobile 相关包
- 角度：L10 + L6 + D2a-L10 + D2a-L6（4 角度交叉）
- 严重度：A
- 影响面：2（mobile 35766 行 = 全仓库最大端）
- 被点名：3
- 位置：mobile `tsconfig` 不继承 base、mobile 用 ESLint 8 + `.eslintrc.js`、mobile 用 jest、mobile engines >=22.11.0
- 问题：mobile 是「规则洼地」——`noUnusedLocals/noUnusedParameters` 因不继承 base 完全失效（这是 L9 在 mobile 死代码误判率更高的结构性原因）。desktop 手抄了一份 `sharedTsRules` 没用导出。
- 建议：统一 TS/ESLint 基线；mobile 继承 base + 覆盖差异项
- 来源：D1-10 + D2a-L10 模式 2 + D2a-L6 模式 2

### #16 [总分 6] prompt normalize 漏抄 customAttach
- 模块：prompt
- 角度：D2-prompt（切片独家发现）
- 严重度：S
- 影响面：1（单模块，但影响 agent prompt 组装）
- 被点名：1
- 位置：`normalizeAgentPromptLayoutDomain` return 漏了 `customAttach`
- 问题：domain-shape 加载路径静默清空字段。schema 齐的、PRD 对得上，必须叠「存储加载」路径才看得出来。CHANGELOG 1.4.17 只修了 prepare-user-messages 的提前跳过，没碰 normalize。
- 建议：补上 `customAttach` 字段；加 domain-shape round-trip 测试
- 来源：D2-prompt S1

### #17 [总分 5] `./kkv` / `./session-kkv` 直接发布 service 层（绕开两层 facade）
- 模块：core 包导出面
- 角度：L8 + L3（2 角度交叉）
- 严重度：A
- 影响面：1
- 被点名：2
- 位置：`packages/core/package.json` exports 的 `./kkv` → `dist/service/*`、`./session-kkv` → `dist/service/*`
- 问题：24 个子路径中 2 个走 `dist/service/` 直接发布 service 层实现目录，绕开源码两层 facade。
- 建议：走 `dist/public/` 或新建 `dist/public/kkv.ts` barrel
- 来源：D1-08 + D2a-L8 模式 2

### #18 [总分 5] 发版策略系统性落后（0.0.0 vs 1.4.17 + release.yml 漏发）
- 模块：全 monorepo
- 角度：L8 + L10（2 角度交叉）
- 严重度：A
- 影响面：2（13 个包）
- 被点名：2
- 位置：11 个包停 0.0.0 被 1.4.17 的 desktop/mobile 消费；release.yml 只发 mobile/desktop
- 问题：semver 失效；8 个有 name 的包没有发版流程
- 建议：统一版本策略；要么全 0.0.0（明确「无兼容义务」）要么统一 bump
- 来源：D1-08 发版策略 + D2a-L10 模式 3

### #19 [总分 5] abort 三分支语义不一致（partial/no-write/no-rollback）
- 模块：agent-runner
- 角度：L5 + D2-agent-tool（2 角度交叉）
- 严重度：A
- 影响面：1
- 被点名：2
- 位置：`agent-runner.ts` line 331 写 partial、line 474 不写、line 495 catch 不回滚
- 问题：同一个「停止」操作因网络抖动命中不同分支产生不同结果。abort 检测点 7+ 处。
- 建议：统一 abort 语义——要么全写 partial + 标记 abort flag，要么全回滚
- 来源：D1-05 A 级 + D2-agent-tool L5 命中

### #20 [总分 5] CLI 硬编码 Windows SKSP（macOS/Linux 跑 CLI 直接挂）
- 模块：apps/cli
- 角度：L6（单角度认定，D2 切片确认）
- 严重度：A
- 影响面：1
- 被点名：1
- 位置：`apps/cli/src/runtime.ts:162` 写死 `resolveSkspDriver("windows")`
- 问题：desktop 已抽 `getPlatformSkspName()` 但 CLI 没复用。macOS/Linux 跑 CLI 直接挂。
- 建议：CLI 复用 desktop 的 `getPlatformSkspName()`
- 来源：D1-06 A-1

### #21 [总分 4] cloud-sync push 无互斥 + 续租/中段/并发无测试
- 模块：cloud-sync
- 角度：L5 + L7（2 角度交叉）
- 严重度：A
- 影响面：1
- 被点名：2
- 位置：cloud-sync push 入口仅采样一次 `isAgentActive`，push 期间允许 agent 启动
- 问题：本地侧无互斥；cloud-sync 续租/中段/并发场景无测试
- 建议：push/agent 互斥锁；补并发测试
- 来源：D1-05 B 级 + D1-07 cloud-sync 无测试

### #22 [总分 4] message-rollback resolveRollbackPlan 无护栏
- 模块：chat-message
- 角度：L5 + D2-chat-message（2 角度交叉）
- 严重度：A
- 影响面：1
- 被点名：2
- 位置：`resolveRollbackPlan` 多次 await 读与 `conn.transaction` 写之间无护栏
- 问题：agent 可在间隙写入。spec 明示是设计（不是疏忽），但缺护栏。
- 建议：加 session 级写锁或乐观锁版本号
- 来源：D1-05 B 级 + D2-chat-message B1

### #23 [总分 4] SSE fetch vs XHR 两条路径不对齐
- 模块：provider-llm / 跨端
- 角度：L6（单角度）
- 严重度：A
- 影响面：1
- 被点名：1
- 位置：fetch 直接 `onChunk`，XHR 走 `createSseChunkEmitter` 做 byte pacing
- 问题：chunk 投递时序与分包粒度不同，影响 streaming UI 表现
- 建议：统一两条路径的分发语义或建立 parity 套件
- 来源：D1-06 A-2

### #24 [总分 4] TDBC batch 嵌套事务行为分叉（SAVEPOINT vs skip）
- 模块：tdbc / 跨端
- 角度：L6（单角度）
- 严重度：A
- 影响面：1
- 被点名：1
- 位置：better-sqlite3 经 `db.transaction()` 形成 SAVEPOINT；RN 在 `inTransaction` 时跳过
- 问题：batch 部分失败时回滚范围不同。L4 不区分 SAVEPOINT 行为会漏判。
- 建议：统一 batch 嵌套事务语义
- 来源：D1-06 A-3

### #25 [总分 4] Android SKSP get() 漏 SELECT version 列
- 模块：sksp-android
- 角度：L6（单角度）
- 严重度：A
- 影响面：1
- 被点名：1
- 位置：Android SKSP `get()` 查询漏了 `version` 列
- 问题：version 升到 2 时会读不到。mac/windows 都查了，Android 滞后。
- 建议：补 `version` 列到 SELECT
- 来源：D1-06 A-6

### #26 [总分 4] core/driver 对 RN 抽象泄漏（node:fs 静态 import）
- 模块：cloud-sync-driver-s3
- 角度：L6 + L3（2 角度交叉）
- 严重度：A
- 影响面：1
- 被点名：2
- 位置：`cloud-sync-driver-s3` 静态 `import "node:fs/promises"`
- 问题：逼得 mobile 维护 5 份 shim + 全局 polyfill Buffer/ReadableStream/DOMParser/Blob
- 建议：改 dynamic import 或抽象文件系统接口
- 来源：D1-06 A-7

### #27 [总分 4] schema 校验 vs service/runtime 校验不对齐（跨 5 模块）
- 模块：agent / compaction / prompt / chat-message / provider
- 角度：L3 + D2a-L3（2 角度交叉）
- 严重度：A
- 影响面：2（跨 5 个模块）
- 被点名：2
- 位置：agent schema allow+deny 不闭合、compaction `CompactionConditionsTrigger` 草稿残留、prompt `validatePromptBlocks` 死路径、chat-message setMessageFloor spec 承诺两步代码四步、provider BUILTIN_PROVIDER_IDS 改名不改类型
- 问题：schema 是 wire 解析器，业务约束散落 service。db-backup import / cloud-sync pull 绕过 service upsert 的路径全部失防。
- 建议：repository 的 rowToDefinition 补 service 校验；或建立统一的校验管道
- 来源：D2a-L3 模式 2

### #28 [总分 3] knip 配置未修复（apps 端 126 个误判遮挡真实死代码）
- 模块：全仓库 knip 配置
- 角度：L9（单角度）
- 严重度：A（高杠杆——修配置才能看到真实死代码）
- 影响面：1
- 被点名：1
- 位置：knip 的 entry/ignore 配置不认 workspace 子路径 + `@/` 别名
- 问题：74 desktop test + 17 mobile e2e + 35 mobile webview + 107 `@/` unresolved 全是误判。apps 端真实死代码分布必须等 knip 配置修好重跑后才能定论。
- 建议：修 knip 配置（认 workspace 子路径 + `@/` 别名）→ 重跑 → 看真实死代码
- 来源：D1-09 + D0-3 knip-scan

---

## 按模块汇总

| 模块 | S 级数 | A 级数 | 最高优先级条目 |
|------|--------|--------|---------------|
| agent-runner / agent-tool | 2 | 3 | #1 跨资源无事务 + #6 异步副作用 + #14 tool policy |
| chat-message | 2 | 2 | #1 跨资源无事务 + #13 删光会话文件 |
| provider-llm | 1 | 3 | #9 SKSP env 反向漂移 + #1 跨 secretStore 无事务 |
| vfs | 1 | 2 | #8 双轨制 + #10 O(n³) diff |
| compaction | 0 | 2 | #12 tokenizer 不一致影响判定 + #4 driver 独立性 |
| prompt | 1 | 1 | #16 normalize 漏抄 customAttach |
| 全仓库（跨模块） | 4 | 2 | #2 文档漂移 + #3 CI 缺失 + #4 driver 独立性 + #5 死代码公共面 |

## 按角度汇总

| 角度 | 命中模块数 | 最常命中的问题类型 |
|------|-----------|-------------------|
| L1 数据模型 | 6 | 双轨制 + 跨 context 无 FK + N+1 |
| L2 算法 | 4 | 无缓存重复计算 + O(n³) diff + 构建增量失效 |
| L3 架构 | 5 | driver peerDep + schema vs runtime 不对齐 + 跨 context type-only |
| L4 错误处理 | 4 | 跨资源无事务 + cause 链断裂 |
| L5 并发 | 5 | abort 语义不一致 + fire-and-forget + 跨 await 无护栏 |
| L6 跨端 | 6 | 三端实现不对齐 + mobile 漏接 + RN 抽象泄漏 |
| L7 测试 | 4 | failure path 裸奔 + 运行器分裂 |
| L8 API/安全 | 5 | 死代码公共面 + service 层直发 + 发版落后 |
| L9 死代码 | 3 | @deprecated 残留 + knip 误判 |
| L10 基建 | 全仓库 | CI 缺失 + 工具链分裂 + 子包无 lint |
| L11 文档 | 6 | PRD 被推翻无追踪 + spec 描述已撤销能力 |

## 系统性问题（被 3+ 角度或 3+ 模块命中的模式）

这些不是单个 bug，是设计层面的系统性缺陷——正是「局部最优害全局」的根因。

**一、跨资源写编排抽象缺失。** 仓库有事务纪律（`runInTransactionOrConn` 在 vfs/message-checkpoint 认真用着），但只覆盖同一 SQLite 连接内的多表写。一旦跨 secretStore、跨 kkv 域、跨 append+capture+append 链，就没有统一协调器了。四个核心模块各自长出形态相近的兜底（`renameSkspSecrets` / `backfillBaselineCheckpoints` / `repairRefCounts`），互不复用，且各自只覆盖了自己的入口。rollback-* 系列 5 次打补丁都是给上游 agent-runner 的孤儿打兜底，而不是把不变式上提到源头。这是 #1 + #8 + #13 三条债务的共同根因。

**二、文档/规范与实现之间的追踪断裂。** Iterations 目录平铺、无 `supersedes:` / `superseded-by:` 元数据——PRD 定稿被推翻后无追踪链。表现是跨 6 个模块 9 处文档漂移，其中最危险的是 SKSP env 空串语义反向漂移（按 spec 整改会更不安全）。这不是个别作者的疏忽，是迭代管理机制的系统性缺陷。这是 #2 + #9 两条债务的共同根因。

**三、driver 独立性从未被验证。** 从包描述（dependencies 而非 peer）、到基建（8 包无 lint）、到运行时装配（mobile 绕过 registry）、到测试（evaluator stub undefined）——driver 的「可插拔」是纸面设计，实际是硬编码 + 各自演化。独立性从未被独立安装或独立测试验证。这是 #4 + #15 + #26 三条债务的共同根因。

**四、公共面退出不干净。** 六个模块的迭代重构都留下了「新实现已上线、旧符号仍挂在公共面」的残留。core 还在 0.0.0 没有兼容义务，dead alias 必须撤——但没人撤。叠加 CI 不跑 lint/knip，这些残留永远不会被自动发现。这是 #5 + #3 两条债务的交叉。

**五、mobile 是规则洼地。** TS/ESLint/test runner/engines 四条线全脱离 base，`noUnusedLocals/noUnusedParameters` 完全失效。35766 行的代码在零静态检查下演化，是 mobile 侧各种「漏接」「绕路」「不一致」的结构性土壤。这是 #15 + #12 + 多条 L6 发现的共同根因。
