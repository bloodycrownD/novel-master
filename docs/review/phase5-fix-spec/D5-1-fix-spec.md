# CR Fix Spec: novel-master 全局 CR 修复说明书

## 元信息
- repo: novel-master
- base_sha: 3166a96e7341a336177c1cb3d9b9d19b7303a003（Phase 5 起 HEAD，2026-08-05）
- prd_path: docs/（151 Iterations）
- review_round: Phase 5 / wave 5b / round 2（接 5a S 级 wave）
- dag_version: 继承 D3-2（28 条 / S 10 / A 18）
- 状态：fix-spec-ready（用户授权主代理按「可维护/性能/干净」三线拍板全部待决项；见尾部「决策记录」）
- 来源：docs/review/phase3-cross/D3-2-debt-register.md
- 路线对齐：docs/review/phase4-synthesis/D4-1-executive-summary.md（P0/P1/P2 波次）
- 本 wave 范围：D3-2 全部 S 级（wave 5a 已写入 S-1~S-8 + S-13 + S-16）+ 全部 A 级条目（#7, #9, #10, #11, #12, #14, #15, #17~#28，共 18 条）。
- 上 wave 待拍板转交：#7（热路径无缓存）按 D3-2 严重度归 A 级，本 wave 以 A-7 写入；如主代理后续判定升 S，可由 A-7 升级为 S-7，改法不变。

> 修复顺序遵循 D4-1：P0 止血（#3→#13→#16，#9 联动）→ P1 结构性（#1/#2/#4/#5/#6）→ P2 收尾（#8）。下文每条都标了对应 P 序与依赖。

---

## Must-fix（S 级，按 D4-1 波次排序）

### S-3 [S] CI 完全缺失——所有 S/A 级发现无法被自动捕捉（D3-2 #3）
- 维度：L10 + 所有角度（放大器）
- P 序：P0-1（最优先，所有其他修复的验证都依赖它）
- 文件：
  - `.github/workflows/`（当前只有 `release.yml`，无 PR/push 检查）
  - 新建 `.github/workflows/ci.yml`
  - 8 个无 lint 子包：`packages/tdbc-driver-*/`、`packages/sksp-*/`、`packages/cloud-sync-driver-s3/`、`packages/tokenizer-driver-*/`（各自缺 ESLint 配置）
  - `packages/core/package.json` 的 `@typescript-eslint` peerDep `<6.1.0` 上限
- 问题：D3-2 #3 指出，CI 零覆盖是根因中的根因——事务缺口、公共面污染、spec drift、静默吞错全靠人眼拦。8 个子包完全无 lint，`@typescript-eslint` peerDep `<6.1.0` 在 TS 升到 6.1 时会炸（当前 6.0.3 擦边）。来源：D1-10 S 级 + D2a-L10 模式 1+3。
- 改法：
  1. 新建 `.github/workflows/ci.yml`，触发 `on: [pull_request, push]`，矩阵至少跑 `pnpm install` → `pnpm lint` → `pnpm typecheck` → `pnpm test`。先按 monorepo 现有脚本名对齐（执行前回查 `package.json` 的 scripts，避免造不存在的命令）。
  2. 8 个无 lint 子包逐个补 ESLint 配置（继承 base 的 `createTsEslintConfig` 导出，不要手抄；与 #15 mobile 的规则洼地问题同源，配置方式保持一致），纳入根 `pnpm lint` 的 glob。
  3. 把 `packages/core/package.json` 里 `@typescript-eslint` 的 peerDep `<6.1.0` 上限放宽到与当前实际兼容版本（如 `<8` 或 `^7 || ^8`），解除延迟引爆地雷。改前先核实当前安装版本。
- 验收/测试：
  - 提一个 PR 触发 ci.yml，三条 job（lint/typecheck/test）全绿。
  - `pnpm lint` 的输出里能看到 8 个子包被扫描（不再静默跳过）。
  - 在 TS 6.1 环境下 `pnpm typecheck` 不因 peerDep 报错。
  - 需新增测试：无（CI 本身就是测试基建）。
- 依赖：无。是 #1/#5 等所有「需要跑测试验证」的条目的前置。
- 来源：D3-2 第 3 条 / D1-10 / D2a-L10。

### S-13 [S] undo_send 空 targetTree × 普通 chat 路径无 backfill = 删光会话文件（D3-2 #13）
- 维度：D2-chat-message（切片独家）
- P 序：P0-3（数据丢失级别，止血优先）
- 文件：
  - `packages/core/src/.../run-agent-turn.ts:283-307`（append+capture 链）
  - `packages/core/src/.../agent-runner.ts:450-478`（循环三步无事务）
  - `packages/core/src/.../rollback-import-baseline-checkpoint.*`（兜底只覆盖导入路径）
  - undo_send 的 reconcile 入口（targetTree 空时的删除逻辑，需回查精确路径）
- 问题：D3-2 #13 指出，普通 agent 聊天里 capture 失败会留下无 baseline 的消息，用户立刻 undo_send 时 targetTree 为空，reconcile 会删光整个会话工作区。rollback 系列的 baseline-checkpoint 兜底只覆盖了导入路径，普通 chat 路径没有 backfill。来源：D2-chat-message S1。
- 改法：
  1. 把「每条消息必有 baseline checkpoint」不变式上提到 `agent-runner.ts` 源头——在 `run-agent-turn.ts:283-307` 的 append+capture+append 链执行前先写 baseline checkpoint，保证任何一步失败都有可回滚点。这是治本，下游 rollback-* 系列打补丁的方式治标不治本。
  2. 作为止血护栏（与治本并行），在 undo_send 的 reconcile 入口加一道判断：当 targetTree 为空时**拒绝删除**并抛错或回退到最近 baseline，不让 reconcile 删光会话工作区。
  3. 把 `rollback-import-baseline-checkpoint` 的 backfill 路径从「仅导入」扩展到「所有产生消息的入口」（含普通 agent chat），与第 1 步的源头不变式对齐。
- 验收/测试：
  - 需新增测试（chat-message 模块）：构造普通 chat 路径下 capture 步骤 throw → 触发 undo_send → 断言会话工作区非空（baseline 存在）。
  - 需新增测试：targetTree 为空时 undo_send 报错或安全回退，断言工作区文件数不减少。
  - 需新增测试：导入路径原有的 baseline-checkpoint 行为不回归。
- 依赖：与 S-1 共享同一「源头不变式」，但 S-13 可独立先行止血（护栏部分不依赖 S-1）。S-3（CI）应先就位以便跑测试。
- 来源：D3-2 第 13 条 / D2-chat-message S1。

### S-16 [S] prompt normalize 漏抄 customAttach（D3-2 #16）
- 维度：D2-prompt（切片独家）
- P 序：P0-4（静默清空字段，影响 agent 行为）
- 文件：
  - `packages/core/src/.../normalizeAgentPromptLayoutDomain`（return 对象漏 `customAttach`，需回查精确文件路径与行号）
  - CHANGELOG 1.4.17（只修了 `prepare-user-messages` 提前跳过，没碰 normalize，作为对照）
- 问题：D3-2 #16 指出，`normalizeAgentPromptLayoutDomain` 的 return 漏了 `customAttach` 字段，导致 domain-shape 加载路径静默清空该字段。schema 是齐的、PRD 也对得上，只有走「存储→加载」路径才暴露。CHANGELOG 1.4.17 只修了 `prepare-user-messages` 的提前跳过，没碰 normalize。来源：D2-prompt S1。
- 改法：
  1. 在 `normalizeAgentPromptLayoutDomain` 的 return 对象里补上 `customAttach`，从输入透传（与其他字段如 `systemPrompt`/`tools` 的透传方式保持一致）。
  2. 排查 normalize 函数族里是否有其他同类 return 也漏了 `customAttach`（D2-prompt 提到的同类 normalize 都核一遍），一并补齐。
- 验收/测试：
  - 需新增测试（domain-shape round-trip）：构造含 `customAttach` 的 layout → 序列化存储 → 加载 → normalize → 断言 `customAttach` 字段值不丢。
  - 需新增测试：`customAttach` 为 undefined 时 normalize 行为不回归（保持原有默认语义）。
- 依赖：无。S-3 先就位更稳。
- 来源：D3-2 第 16 条 / D2-prompt S1。

### S-1 [S] 跨资源多步写无事务 + 无 failure path 回归测试（复合）（D3-2 #1）
- 维度：L4 + L5 + L7 + D2a-L4 + D2a-L7（5 角度交叉）
- P 序：P1-1（结构性根因）
- 文件：
  - `packages/core/src/.../run-agent-turn.ts`（append+capture+append 链）
  - `packages/core/src/.../provider.*` 的 `create/edit/delete`（跨 secretStore 多步写）
  - `packages/core/src/.../setMessageFloorAtMessage*`（四步写）
  - checkpoint 跨 context 改 ref_count 的路径
  - 新建 `packages/core/src/.../coordinated-write.*`（统一编排抽象，文件名待定）
  - 新建 `tests/helpers/failure-injection.ts`（共享失败注入 fixture）
- 问题：D3-2 #1 指出，仓库缺「跨资源写编排」抽象——同一逻辑操作拆成多步裸写，中间崩了留脏数据。rollback-* 系列 5 次打补丁都是治标（只修导入路径，普通 chat 路径还没修，与 #13 同源）。更严重的是这 5 条无事务路径全部没有「中间步骤失败→验证半套状态」的回归测试。来源：D3-1 冲突 #8 + D2a-L4 模式 1 + D2a-L7 模式 1 + D2-chat-message S1+S2 + D2-agent-tool L4/L5。
- 改法：
  1. 建立统一的跨资源写编排抽象（暂称 `CoordinatedWrite` / transaction coordinator），覆盖三类跨资源写：secretStore 域、kkv 域、append+capture+append 链。抽象要提供「注册步骤 + 失败时按注册逆序回滚」的能力，而不是让每个调用方各自写兜底。
  2. 把「每条消息必有 baseline checkpoint」上提到 agent-runner 源头（与 S-13 共享治本方案，S-13 是同一不变式在数据丢失场景的特例）。
  3. 把失败注入 fixture 做成共享 helper（`tests/helpers/failure-injection.ts`），提供「在第 N 步抛错」的能力，供所有无事务路径的回归测试复用。
  4. 三个具体路径迁移到编排抽象：`run-agent-turn` 的 append+capture+append 链、`provider.create/edit/delete`、`setMessageFloorAtMessage` 四步写。
- 验收/测试（每条无事务路径都要有 failure path 回归）：
  - 需新增测试：`run-agent-turn` capture 步骤注入 throw → 断言 baseline checkpoint 存在、会话可回滚（与 S-13 验收对齐）。
  - 需新增测试：`provider.create` 写 secretStore 中间步骤失败 → 断言不留半套凭据（双身份键一致）。
  - 需新增测试：`setMessageFloorAtMessage` 四步写中间失败 → 断言 ref_count 一致、checkpoint 跨 context 不留脏。
  - 编排抽象本身需单元测试（注册逆序回滚、嵌套场景）。
- 依赖：S-3（CI 要能跑测试）。与 S-13 同源（源头不变式），与 S-8（双轨制）可能合并部分抽象——执行时裁决是否共建。
- 来源：D3-2 第 1 条 / D3-1 冲突 #8 / D2a-L4 / D2a-L7 / D2-chat-message / D2-agent-tool。

### S-2 [S] 文档/PRD/ARCHITECTURE 系统性漂移（含反向危险项）（D3-2 #2）
- 维度：L11 + L8 + L3 + D2a-L11 + D2a-L8（5 角度交叉）
- P 序：P1-2（结构性，无强依赖可并行）
- 文件（9 处漂移）：
  - `docs/Iterations/sksp/spec.md` L248（**反向危险**——与 #9 联动）
  - `docs/Iterations/agent-prompt-abstract-block/prd.md`（被推翻）
  - `docs/Iterations/tool-system-v2/prd.md`（chat_grep 仍列必备，与 S-5 联动）
  - `packages/core/ARCHITECTURE.md` documented exception §2（失效未删）
  - `docs/Iterations/prompt-engine/spec.md`（偏离实现）
  - `docs/Iterations/message-rollback-remove-session-log/spec.md`（被架空）
  - 新建 `docs/Iterations/iterations.yaml`（取代链索引）
- 问题：D3-2 #2 指出，Iterations 目录平铺无 `supersedes:` / `superseded-by:` 元数据，PRD 定稿被推翻后无追踪。9 处漂移里最危险的是 SKSP env 空串语义的**反向漂移**——当前安全行为靠代码偏离 spec 撑着，按 spec 改回会让空 env 变量覆盖 DB。来源：D3-1 冲突 #1 + D2a-L11 模式 1+2+4 + D2a-L8 模式 3。
- 改法（**方向铁律：先确认实现方向正确，再把 spec 对齐到实现，绝不反向。反向危险项 spec 和代码必须同步改**）：
  1. 新建 `docs/Iterations/iterations.yaml`，为每个 iteration 加 `id / supersedes / superseded-by / status` 字段，先把 9 处已知漂移涉及的 iteration 录入，逐步覆盖全 151 个。
  2. SKSP env 反向危险项（与 #9 联动）：把 `sksp/spec.md` L248 改成收紧语义（空 env 不覆盖 DB），与当前实现的安全方向对齐。**这一步必须和代码确认同步**，不能只改 spec——归到 S-2 但执行时与 #9 一起做。
  3. 其余 8 处逐条对齐：`agent-prompt-abstract-block/prd.md` 加 `superseded-by`；`tool-system-v2/prd.md` 移除 chat_grep 必备条目（先与 S-5 确认 chat_grep 是否真撤）；`ARCHITECTURE.md` §2 删除失效 exception；`prompt-engine/spec.md` 对齐实现；`message-rollback-remove-session-log/spec.md` 加 `superseded-by`。
- 验收/测试：
  - `iterations.yaml` 覆盖 9 处漂移涉及的全部 iteration，每条漂移在 yaml 里有对应取代链。
  - 9 处漂移逐条核对，每条标 fixed（建议在 fix-spec 的 Closure 跟踪表里列）。
  - SKSP env 改动配套有 round-trip 测试（与 #9 共享验收）。
  - 需新增测试：无代码测试（纯文档对齐），但 SKSP env 部分依赖 #9 的代码验收。
- 依赖：与 #9（SKSP env 反向漂移，A→S 候选）联动——SKSP env 部分需要 #9 的代码改法一起落地。与 S-5 联动（chat_grep）。
- 待拍板：`tool-system-v2/prd.md` 里 chat_grep 是否真撤（影响 S-5 的清扫边界）——见「待拍板」。
- 来源：D3-2 第 2 条 / D3-1 冲突 #1 / D2a-L11 / D2a-L8。

### S-4 [S] driver 包独立性纸面化（D3-2 #4）
- 维度：L3 + L10 + D2a-L3 + D2a-L10（4 角度交叉）
- P 序：P1-3（结构性，无强依赖）
- 文件：
  - `packages/tdbc-driver-*/package.json`（core 放 dependencies 非 peer）
  - `packages/sksp-*/package.json`
  - `packages/cloud-sync-driver-s3/package.json`
  - `packages/tokenizer-driver-*/package.json`
  - `packages/core/package.json`（devDep 含 2 个下游 driver，形成 2 条 devDep 环）
  - mobile 装配点：直连 `createAndroidSecretStore` 绕过 SKSP registry 的代码（需回查精确路径）
  - mobile 测试：把 compaction evaluator stub 成 undefined 的代码（需回查）
- 问题：D3-2 #4 指出，7 个 driver 全部把 core 放 dependencies（双重安装风险）、core devDep 含 2 个下游 driver（2 条 devDep 环）、mobile 绕过 SKSP registry 直连、mobile 测试把 evaluator stub 成 undefined。独立性从未被独立安装或独立测试验证过。来源：D1-03 S 级 + D2a-L3 模式 4 + D2a-L10 模式 3。
- 改法：
  1. 把所有 driver 包 `package.json` 里的 `core` 从 `dependencies` 移到 `peerDependencies`（7 个 driver 全改），消除双重安装风险。
  2. 解 core devDep 环：把 core 测试里对 2 个下游 driver 的依赖迁移到独立测试包（或 mock 化），让 core 的 devDep 不再含下游 driver。
  3. mobile 装配改回走 SKSP registry，不再直连 `createAndroidSecretStore`（与 mobile 的可插拔设计意图对齐）。
  4. mobile 测试移除「evaluator stub 成 undefined」的短路，改成真实 evaluator 或符合协议的 stub。
- 验收/测试：
  - `pnpm install` 后各 driver 包可独立安装，无 core 重复安装（`pnpm why core` 在 driver 包内只看到 peer）。
  - `pnpm dedup` / 依赖图工具确认 core devDep 无环。
  - 需新增测试：driver 包独立构建（`pnpm --filter <driver> build` 不依赖 core 的 dev 安装）。
  - mobile 走 registry 路径的装配测试通过，evaluator 不再是 undefined。
- 依赖：S-3（CI/lint 要覆盖这些包）。与 #15（mobile 规则洼地）部分重叠——mobile 装配改动建议与 #15 一起规划。
- 来源：D3-2 第 4 条 / D1-03 / D2a-L3 / D2a-L10。

### S-5 [S] @deprecated / 死代码仍挂在公共面对外导出（跨 6 模块）（D3-2 #5）
- 维度：L8 + L9 + D2a-L8 + D2a-L9（4 角度交叉）
- P 序：P1-4（结构性，依赖 lint 能跑）
- 文件：
  - `packages/core/src/public/compaction.ts`（`estimateTokens` 死代码仍导出）
  - `packages/core/src/public/chat.ts`（377 行含 @deprecated）
  - `packages/core/src/public/agent.ts`（4 对 alias 残留）
  - `packages/core/src/infra/tokenizer/index.ts`（4 个 re-export 残留）
  - `packages/core/src/.../chat-grep-tool.ts`（@deprecated 但 PRD 仍列必备——与 S-2 联动）
  - 第 6 个模块：需回查（D3-2 列了 5 个具体文件 + 跨 6 模块，第 6 个模块的公共面残留需在执行时核实）
- 问题：D3-2 #5 指出，迭代重构后公共面退出不干净——新实现已上线，旧符号仍挂在 `public/*.ts` 或 `index.ts`。core 还在 0.0.0、没有兼容义务，dead alias 即使无消费者也必须撤。叠加 CI 不跑 lint/knip，这些残留永远不会被自动发现。来源：D2a-L8 模式 1 + D2a-L9 模式 1 + D1-09 + D2-compaction S1。
- 改法：
  1. 一次性清扫 6 个模块的公共面死代码：
     - `public/compaction.ts`：移除 `estimateTokens` 死代码导出（先 grep 全仓确认无消费者，含 apps 端）。
     - `public/chat.ts`：移除 377 行区域的 @deprecated 导出（逐个符号确认）。
     - `public/agent.ts`：移除 4 对 alias 残留。
     - `infra/tokenizer/index.ts`：移除 4 个 re-export 残留。
     - `chat-grep-tool.ts`：与 S-2 联动——`tool-system-v2/prd.md` 移除 chat_grep 必备后再撤 @deprecated；若拍板保留 chat_grep 则这条单独标注。
  2. 建公共面退出契约：新增 lint 规则（或 knip 配置），禁止 `index.ts` / `public/*.ts` re-export 带 `@deprecated` 的符号，让后续迭代不会再漏。
- 验收/测试：
  - knip / 自定义 lint 规则扫描公共面，无残留 @deprecated 导出（输出为空）。
  - 现有测试全绿（确认被撤符号无消费者依赖）。
  - 需新增测试：lint 规则本身有 fixture 测试（构造一个 @deprecated re-export，断言被拦）。
- 依赖：S-3（lint/knip 要能跑）。与 S-2 联动（chat_grep PRD）。knip 配置本身有 #28（未修复，126 个误判）——执行时需先收紧 knip 配置才能信任扫描结果。
- 来源：D3-2 第 5 条 / D2a-L8 / D2a-L9 / D1-09 / D2-compaction。

### S-6 [S] 异步副作用脱离调用方生命周期（fire-and-forget 泛滥）（D3-2 #6）
- 维度：L5 + D2-agent-tool + D2a-L5（3 角度交叉）
- P 序：P1-5（结构性；若 agent-subagent PRD 进实现则升 P0）
- 文件：
  - `packages/core/src/.../event-orchestrator.*`（`void emit().then()`）
  - `packages/core/src/.../wrapStreamForBus.*`（`queueMicrotask` 错序）
  - sub-agent 装配点（`publishRunLifecycle:false` + `agentActiveRefCount`，需回查精确路径）
- 问题：D3-2 #6 指出，events-reliability 把「message.received 脱离门控」锁成 intentional 是基于现有 sub-agent 用 `persistMessages:false`；但 `agent-subagent` PRD 的 task 工具是 `persistMessages:true`——子 session 会触发父进程 events DAG。这是时间炸弹。来源：D3-1 冲突 #8 + D2a-L5 模式 2 + D2-agent-tool A1。
- 改法：
  1. `event-orchestrator` 的 `void emit().then()` 改为纳入调用方生命周期——要么 await，要么挂到 run 的取消/完成信号上，不让 emit 的 promise 脱离调用方。
  2. `wrapStreamForBus` 的 `queueMicrotask` 错序改为确定性排序（显式序列化 / 调度队列），消除微任务交错导致的顺序非确定性。
  3. sub-agent 的 events 生命周期纳入父 run 的 `agentActiveRefCount`：当子 session 用 `persistMessages:true`（task 工具场景）时，父 run 的 active ref count 要正确反映子 session 的存活，`publishRunLifecycle` 与子 session 联动。
- 验收/测试：
  - 需新增测试：sub-agent task 工具（`persistMessages:true`）触发时，父 run 的 events DAG 正确门控（子 session 存活期间父不会被误判为 idle）。
  - 需新增测试：`queueMicrotask` 改造后多次运行事件顺序一致（确定性断言）。
  - 需新增测试：emit 失败时错误能被调用方捕获（不静默吞）。
- 依赖：无强依赖（S-3 先就位更稳）。若 `agent-subagent` PRD 已进实现，本条升 P0。
- 待拍板：events-reliability 把 message.received 脱离门控标为 intentional——本条的改法会调整这个 intentional 标记，需确认是否推翻原 intentional 决定（见「待拍板」）。
- 来源：D3-2 第 6 条 / D3-1 冲突 #8 / D2a-L5 / D2-agent-tool A1。

### S-8 [S] 数据层轻约束 + 应用层补丁的「双轨制」（D3-2 #8）
- 维度：L1 + D2a-L1 + D2a-L4（3 角度交叉）
- P 序：P2-1（结构性收尾）
- 文件：
  - vfs：双引用计数器（触发器 + 应用层）路径，需回查
  - chat-message：checkpoint 跨 context 改 ref_count 路径
  - provider：双身份键 + 手动逐表删路径
  - 新建统一完整性修复抽象（合并 repair/rename/backfill，文件名待定）
- 问题：D3-2 #8 指出，仓库在持久化层刻意只做轻约束（很少 FK、不外键级联），但应用层没补上配套的「统一事务编排 / 统一完整性修复」抽象。三个模块各自长出形态相近的兜底但互不复用。来源：D2a-L1 模式 1+2+4+7 + D1-01 双引用计数器。
- 改法：
  1. 按 D2a-L1 建议合并模式 1/2/4/7 的裁决——它们是同一架构层根因的四个切面。建立统一的「完整性修复 + 事务编排」抽象，合并 repair / rename / backfill 三类兜底。
  2. 三个模块（vfs / chat-message / provider）迁移到该抽象，不再各自演化兜底逻辑。
  3. 双引用计数器（触发器 + 应用层）裁决为单一来源——要么全交给触发器、要么全交给应用层，不再双轨。
- 验收/测试：
  - 新建抽象有单元测试（repair/rename/backfill 三类操作 + 失败回滚）。
  - 三模块迁移后原有兜底测试全绿（行为不回归）。
  - 需新增测试：双引用计数器裁决后，触发器路径与应用层路径不会重复计数。
- 依赖：与 S-1（跨资源事务编排）联动——两者可能共建同一个编排抽象，执行时裁决是否合并实现。建议 S-1 先行，S-8 复用其抽象。
- 来源：D3-2 第 8 条 / D2a-L1 / D1-01。

---

## Must-fix（A 级，按 D3-2 编号排序）

### A-7 [A] 热路径无缓存 / 重复计算（跨 4 条 parser/compiler 路径）（D3-2 #7）
- 维度：L2 + D2a-L2 + L7（3 角度交叉）
- P 序：P1-4（结构性质量；D3-2 标 A，本 wave 暂不升 S——见「待拍板」）
- 文件：
  - `packages/core/src/.../SqlTemplateParser.parse`（无 AST 缓存 + 每轮 `new Function` 重编译；需回查具体行号）
  - regex 编译产物缓存位点（需回查——D3-2 未列具体文件）
  - `packages/core/src/domain/vfs/logic/vfs-path-mapper.ts`（单链 3 次 normalize，需回查具体行）
  - tokenizer 序列化重复路径（需回查）
  - 新建公共 memoize helper（建议位置：`packages/core/src/common/memoize.ts`）
- 问题：D3-2 #7 指出，仓库里「memoize」是偶发习惯不是约定——唯一做对了的反例是 `session-api-prompt-token-cache`。AgentRunner 主循环每轮会跑几十次 `SqlTemplateParser.parse`，每次都重走 AST 构建 + `new Function` 编译，属热路径纯函数无缓存。来源：D1-02 F1 + D2a-L2 模式 1 + D1-07。
- 改法：
  1. `SqlTemplateParser.parse` 加 `Map<template, AstNode>` 缓存（key=模板字符串原文，value=编译后 AST/函数），缓存在模块作用域或挂在 parser 实例上，避免每轮 `new Function`。注意：cache key 必须能区分带绑定参数的模板，不能误复用。
  2. 抽公共 `memoize` helper（纯函数 + WeakMap/Map 自动选择），放到 `packages/core/src/common/memoize.ts`，供 sql-template / regex / tokenizer / vfs-path-mapper 复用。
  3. vfs-path-mapper 单链 3 次 normalize 收敛为「同输入只算一次」（参数级别 memoize 或先去重再 normalize）。
  4. 在 `packages/core/ARCHITECTURE.md` 或新建 `docs/dev/perf-conventions.md` 写明「AgentRunner 主循环里的纯函数必须 memoize」约定。
- 验收/测试：
  - `SqlTemplateParser.parse` 缓存命中率测试：同模板 N 次调用只编译一次（用 spy 断言 `new Function` 调用次数）。
  - 需新增性能基线测试：构造 10² 量级模板 × 每轮多次 parse，断言缓存开启后耗时显著下降。
  - memoize helper 单测（含引用类型 key、primitive key、缓存清除）。
  - D1-07 sql-template 现有测试覆盖回归。
- 依赖：无强依赖。
- 已决策：**不升 S**。热路径无缓存是单维度性能问题，非跨模块系统性根因，A 级足够。
- 来源：D3-2 第 7 条 / D1-02 F1 / D2a-L2 / D1-07。

### A-9 [A] SKSP env 空串语义反向漂移——独立安全维度增量（D3-2 #9）
- 维度：L6 + L8 + L11 + D2-provider-llm（4 角度交叉）
- P 序：P0-2（安全维度——与 S-2 文档维度联动，但本条负责独立的安全/运行时维度）
- 文件（独立于 S-2 的增量部分）：
  - 三端 SKSP env 解析代码：`apps/desktop/.../sksp env 读取`、`apps/mobile/.../sksp env 读取`、`apps/cli/src/runtime.ts:162` 附近（需回查 CLI 是否也读 env）
  - SKSP provider 读取入口（DB vs env 覆盖优先级裁决处）
- 问题：见 **S-2** 文档维度已覆盖 spec 反向漂移的修复方向。本条聚焦 S-2 未覆盖的独立安全维度——三端代码层对「空 env 字符串」的实际判定是否真正统一收紧。D3-2 #9 指出，spec 写宽松语义、实现做收紧语义，但「实现收紧」这一事实是否在**三端代码上一致成立**未做 parity 验证；任何一端若回退到「空串覆盖 DB」就会复现反向危险。来源：D3-1 冲突 #1 + D2-provider-llm S2 + S-2。
- 改法（增量部分，与 S-2 文档侧改动配套但独立验收）：
  1. 在三端 SKSP 读取入口统一抽出 `resolveSkspEnvOverride(env)` 纯函数：空串 / `undefined` / 缺失三种情况一律视为「不覆盖 DB」，仅当 env 值非空字符串时才覆盖。三端共用同一实现（mobile/desktop/cli 各自 import），不再各自写判定。
  2. 沿 SKSP get/set 链路补「env 覆盖优先级」单测：DB 有值 × env 空串 → 读 DB；DB 有值 × env 非空 → 读 env；DB 无值 × env 空串 → 走默认。
  3. CLI 侧（`runtime.ts:162` 附近）核查是否也走同一函数——若 CLI 现在硬编码 Windows（见 A-20），本条与 A-20 联动：先把 CLI 切到 `resolveSkspEnvOverride` + `getPlatformSkspName()`。
- 验收/测试：
  - 需新增测试：`resolveSkspEnvOverride` parity 套件（Node / RN / CLI 三端各跑一组相同 case）。
  - 与 S-2 共享 SKSP env round-trip 验收（见合并后 QA 节）。
  - 回归：三端 SKSP 既有 get/set 测试全绿。
- 依赖：**与 S-2 强联动**（文档侧 spec 对齐）——S-2 改 spec 收紧语义，本条改代码保证三端实现一致收紧。建议同步落地。与 A-20 联动（CLI 同源问题）。
- 来源：D3-2 第 9 条 / D3-1 冲突 #1 / D2-provider-llm S2。（spec 反向漂移见 S-2）

### A-10 [A] user-vfs-save-mapping 最坏 O(n³)（D3-2 #10）
- 维度：L2 + D2-vfs（2 角度交叉）
- P 序：P2-2（性能，非阻塞）
- 文件：
  - `packages/core/src/domain/vfs/.../diffRecursive`（朴素双循环递归；需回查具体路径）
  - 同模块 `expandAnchorHunk`（半径线性扫描）
  - 新建 Myers diff 实现（或引入轻量依赖，需与 ARCHITECTURE 外部依赖政策核对）
- 问题：D3-2 #10 指出，`diffRecursive` 朴素双循环 + `expandAnchorHunk` 半径线性扫描叠加递归，最坏 O(n³)。用户保存大文件（n=文件行数）时 UI 会卡。来源：D1-02 F2 + D2-vfs A1。
- 改法：
  1. 把 `diffRecursive` 的核心 diff 步骤替换为 Myers diff（按行）。可引入成熟轻量库或自实现（自实现需补完备测试）。决策点：引入依赖 vs 自实现——见「待拍板」。
  2. `expandAnchorHunk` 改为基于 Myers 输出的线性扩展（不再半径线性扫描），整体降到 O(n·d)（d=差异行数）。
  3. 保持现有对外 API 形态不变（mapping 结构不变），仅替换内部算法。
- 验收/测试：
  - 需新增性能基线测试：10⁴ 行文件随机改动若干行，断言 diff 耗时在可接受阈值内（具体阈值需回查现状后定）。
  - 行为等价性测试：原 `diffRecursive` 与新实现跑同一组用例，输出 mapping 完全一致。
  - 边界用例：空文件、纯新增、纯删除、整段移动。
- 依赖：无。建议在 S-8 抽象（vfs 完整性修复）落地后做，避免双线改 vfs。
- 已决策：**引入轻量成熟依赖**。自实现需长期维护算法正确性、测试负担大；引依赖让专业库负责算法正确性，团队只维护调用层，更可维护更干净。需核对 ARCHITECTURE 外部依赖政策，若政策禁止新增依赖再退回自实现 + 完备测试。
- 来源：D3-2 第 10 条 / D1-02 F2 / D2-vfs A1。

### A-11 [A] 构建 `--force` 禁用增量 × TS 项目引用未建立（D3-2 #11）
- 维度：L2 + D2a-L2 + L10（3 角度交叉）
- P 序：P1-5（结构性——影响全 monorepo 开发反馈环）
- 文件：
  - `packages/core/package.json` build 脚本（`tsc --build --force`）
  - 各包 `tsconfig.json`（无 `references`）
  - 根 `tsconfig.base.json`（如存在）
- 问题：D3-2 #11 指出，core 改一行 → 全仓所有包全量重编一遍。`--force` 让 `tsc --build` 每次都忽略 `.tsbuildinfo`；各包 tsconfig 没有 `references`，workspace 拓扑（pnpm/yarn workspace）和 TS 增量拓扑是两套独立系统，互不感知。来源：D1-02 F3+F4 + D2a-L2 模式 2。
- 改法（按顺序，每步独立验收）：
  1. **去 `--force`**：把 `packages/core/package.json` 的 build 脚本 `tsc --build --force` 改为 `tsc --build`。先验证 `.tsbuildinfo` 文件开始生成并被复用。
  2. **建 `references`**：在每个下游包的 `tsconfig.json` 加 `references: [{ path: "../core" }, ...]`，对齐 workspace 依赖拓扑。core 自身补 `composite: true`（若未设）。
  3. **验证增量生效**：core 改一行非导出实现 → 仅 core 重编，下游包跳过；改导出签名 → 受影响包重编，无关包跳过。
- 验收/测试：
  - 需新增「增量编译」基线测试（手动脚本即可）：clean build 计时 → 改 core 单行 → 再 build 计时，断言第二次仅重编 core。
  - 全量 build 产物与改前等价（产物 byte-level 或 shape-level 对比）。
  - S-3 CI 落地后，PR 流水线默认走增量 build，缓存命中可观测。
- 依赖：建议在 S-3 CI 落地后做，方便用 CI 验证增量。
- 来源：D3-2 第 11 条 / D1-02 F3+F4 / D2a-L2。

### A-12 [A] tokenizer 三端计数公式不一致 × compaction 判定依赖（D3-2 #12）
- 维度：L6 + D2-compaction + D2-provider-llm（3 角度交叉）
- P 序：P1-6（结构性——影响 compaction 判定准确性）
- 文件：
  - Node 侧：`countOpenAiStyleMessages`（含 role overhead）
  - RN 侧：手写 `encode().length + 3 + 3`（需回查具体文件）
  - WEB/SP 侧：回退 heuristic + `counterKind` 标识
  - compaction evaluator 入口（吃 token 计数触发阈值）
- 问题：D3-2 #12 指出，三端 token 计数公式不同：Node 含 role overhead，RN 用 `+3+3` 估算，WEB/SP 走 heuristic 但 `counterKind` 撒谎（标识与实际算法不匹配）。compaction 是「超阈值就触发」的硬开关，会吃到不准的计数；evaluator 没有降级兜底。来源：D1-06 A-4 + D2-compaction B1 + D2-provider-llm B2。
- 改法：
  1. 统一三端计数公式：抽公共 `countTokens(messages, kind)` 纯函数，三端共用。`counterKind` 改为反映**实际算法**（不再撒谎），WEB/SP heuristic 必须显式标 heuristic 而非冒充精确。
  2. 建立 parity 套件：同一组 messages 在三端跑，断言计数差异 ≤ 容差（容差需回查现状后定，RN 的 `+3+3` 是否能完全消除待验证）。
  3. compaction evaluator 加降级兜底：当 `counterKind === 'heuristic'` 或计数不可用时，触发保守阈值（提前触发 compaction，宁可早不可晚）。
- 验收/测试：
  - 需新增 parity 套件：Node / RN / WEB 三端各跑 20+ 用例，断言计数对齐。
  - compaction evaluator 降级测试：注入 heuristic 计数 → 断言保守阈值生效。
  - 回归：三端既有 tokenizer 测试全绿。
- 依赖：无强依赖。与 A-15（mobile 基线脱节）联动——mobile 的 jest 配置修好后才能跑 RN 侧 parity。
- 来源：D3-2 第 12 条 / D1-06 A-4 / D2-compaction B1 / D2-provider-llm B2。

### A-14 [A] agent tool policy 缺路径白名单与资源配额（D3-2 #14）
- 维度：L8 + D2-agent-tool（2 角度交叉）
- P 序：P0-3（安全越权）
- 文件：
  - `packages/core/src/.../agent/tool-policy` 或 `BuiltinToolContext` 定义处（需回查）
  - `Tool.inputSchema` 定义 + runner 二次校验位点
- 问题：D3-2 #14 指出，`BuiltinToolContext` 无 path 字段、`Tool.inputSchema` 只能验字符串、runner 不二次校验，agent 可越权写任意子树。path scope 完全无架构占位。来源：D1-08 A 级安全 + D2-agent-tool A4。
- 改法：
  1. `BuiltinToolContext` 加 `allowedPaths: string[]`（或 glob 模式）字段，由调用方（agent-runner / cli / desktop）注入会话级 path scope。
  2. `Tool.inputSchema` 扩展支持 path 字段语义校验（或单独建 `pathPolicy`），runner 在调 tool 前对入参里的路径做白名单二次校验——不在 `allowedPaths` 内的路径直接拒。
  3. 加资源配额占位（最大写入字节数 / 最大调用次数），先占位后细化，避免一次性吃太多。
- 验收/测试：
  - 需新增越权测试：构造 agent 试图写 `allowedPaths` 之外的路径，断言被拒。
  - path glob 匹配单测（含 `**` / 子树 / 软链逃逸边界）。
  - 资源配额超限测试（超字节数 → 拒）。
- 依赖：与 S-1 / S-8（事务编排）轻耦合——path policy 是独立维度，可先行。
- 来源：D3-2 第 14 条 / D1-08 A 级安全 / D2-agent-tool A4。

### A-15 [A] mobile 整条线脱离 base 配置（TS/ESLint/test runner/engines 四线全脱）（D3-2 #15）
- 维度：L10 + L6 + D2a-L10 + D2a-L6（4 角度交叉）
- P 序：P1-7（结构性质量——是 L9 在 mobile 死代码误判率更高的根因）
- 文件：
  - `apps/mobile/tsconfig*.json`（不继承 base）
  - `apps/mobile/.eslintrc.js` + ESLint 8 依赖（独立于 base ESLint 9 flat config）
  - `apps/mobile/jest.config.*`（用 jest，base 用 vitest 或其他；需回查 base runner）
  - `apps/mobile/package.json` engines（`>=22.11.0`，与 base 是否一致需核对）
  - `apps/desktop/` 手抄的 `sharedTsRules`（应改用导出）
- 问题：D3-2 #15 指出，mobile 是「规则洼地」：`noUnusedLocals/noUnusedParameters` 因不继承 base 完全失效，这是 L9 在 mobile 死代码误判率更高的结构性原因。desktop 手抄了一份 `sharedTsRules` 没用导出，双份维护漂移。来源：D1-10 + D2a-L10 模式 2 + D2a-L6 模式 2。
- 改法：
  1. mobile `tsconfig` 改为 `extends` 根 base tsconfig，覆盖差异项（如 RN 专属 JSX、jsxImportSource、target）。
  2. 把 desktop 手抄的 `sharedTsRules` 抽到独立导出（如 `config/ts-rules.shared.ts` 或 `tsconfig.rules.json`），mobile 与 desktop 都 `extends` / import，单一来源。
  3. ESLint 基线统一：mobile 迁移到 base 的 ESLint 9 flat config（或在 ARCHITECTURE 显式登记 mobile 仍走 ESLint 8 的例外，需主代理确认）。
  4. test runner 统一（mobile jest → 对齐 base runner）或显式登记例外。
  5. engines 字段对齐 base（核对 base engines 后统一）。
- 验收/测试：
  - mobile `tsc --noEmit` 通过 base 规则（`noUnusedLocals` 等生效）。
  - mobile ESLint 跑 base 规则后误判量显著下降（与 #28 联动验收）。
  - 需新增测试：`sharedTsRules` 改动后 desktop + mobile 行为等价。
- 依赖：与 #28（knip 配置）联动——mobile TS 规则修好后 knip 误判才能定论。与 A-12（tokenizer parity）联动——mobile jest 修好后 RN parity 可跑。
- 已决策：**迁移到 ESLint 9 flat config**。mobile 35766 行是最大规则洼地，一次性迁移痛苦换长期统一基线，干净优先。
- 来源：D3-2 第 15 条 / D1-10 / D2a-L10 / D2a-L6。

### A-17 [A] `./kkv` / `./session-kkv` 直接发布 service 层（D3-2 #17）
- 维度：L8 + L3（2 角度交叉）
- P 序：P2-3（公共面对齐）
- 文件：
  - `packages/core/package.json` exports 子路径 `./kkv` → `dist/service/*`
  - `packages/core/package.json` exports 子路径 `./session-kkv` → `dist/service/*`
- 问题：D3-2 #17 指出，24 个子路径中这 2 个直接走 `dist/service/` 发布 service 层实现目录，绕开源码两层 facade（service → public）。来源：D1-08 + D2a-L8 模式 2。
- 改法：
  1. 在 `packages/core/src/public/` 下补 `kkv.ts` / `session-kkv.ts` barrel（re-export service 层中被外部需要的那一部分），让 exports 指向 `dist/public/kkv.js` 等。
  2. 更新 `packages/core/package.json` exports，把这两个子路径的 target 从 `dist/service/*` 改为 `dist/public/*`。
  3. 核对下游消费方（apps/desktop、apps/mobile、apps/cli）的 import 路径是否仍可用，必要时同步改 import。
- 验收/测试：
  - 下游三个 app 的 build 通过，import 解析正常。
  - 需新增测试：exports 子路径解析（用 `packages/core` 作为外部消费者跑 import）。
  - 与 S-5 联动：公共面清理后，确认没有新暴露的 service 层符号。
- 依赖：与 S-5（公共面清扫）轻耦合，建议 S-5 后做或并行。
- 来源：D3-2 第 17 条 / D1-08 / D2a-L8。

### A-18 [A] 发版策略系统性落后（0.0.0 vs 1.4.17 + release.yml 漏发）（D3-2 #18）
- 维度：L8 + L10（2 角度交叉）
- P 序：P2-4（发版流程）
- 文件：
  - 11 个停 0.0.0 的包的 `package.json`（被 1.4.17 的 desktop/mobile 消费）
  - `.github/workflows/release.yml`（只发 mobile/desktop）
  - 根 `package.json` 或 changeset 配置（如存在）
- 问题：D3-2 #18 指出，semver 失效：11 个包停 0.0.0 但被 1.4.17 的端消费；8 个有 name 的包没有发版流程，release.yml 只发 mobile/desktop。来源：D1-08 发版策略 + D2a-L10 模式 3。
- 改法：
  1. **方案 A（明确无兼容义务）**：所有内部包统一锁 0.0.0，在 ARCHITECTURE 显式声明「内部包无 semver 义务，仅端发版」。release.yml 维持只发端。
  2. **方案 B（统一 bump）**：引入 changeset 或统一 bump 脚本，13 个包按统一节奏 bump，release.yml 补全所有 name 包的发布 job。
  3. 选定方案后写进 `docs/release.md`（或 ARCHITECTURE 同等章节）作为发版策略。
- 验收/测试：
  - 选定方案后，所有 13 个包的 version 字段一致（A 方案全 0.0.0 / B 方案有 changeset 记录）。
  - release.yml 跑 dry-run，断言发版范围与策略一致。
  - 文档同步：发版策略在 `docs/release.md` 落地。
- 依赖：无。
- 已决策：**方案 A（锁 0.0.0 + 显式声明）**。内部包无外部消费者，changeset 是额外流程开销；0.0.0 + ARCHITECTURE 显式声明「内部包无 semver 义务，仅端发版」最干净。
- 来源：D3-2 第 18 条 / D1-08 / D2a-L10。

### A-19 [A] abort 三分支语义不一致（partial/no-write/no-rollback）（D3-2 #19）
- 维度：L5 + D2-agent-tool（2 角度交叉）
- P 序：P0-4（运行时一致性——数据可见性）
- 文件：
  - `packages/core/src/.../agent-runner.ts` line 331（写 partial）
  - 同文件 line 474（不写）
  - 同文件 line 495 catch 分支（不回滚）
  - abort 检测点 7+ 处（需回查全部点位）
- 问题：D3-2 #19 指出，同一个「停止」操作因网络抖动命中不同分支产生不同结果：line 331 写 partial、line 474 不写、line 495 catch 不回滚。abort 检测点散落 7+ 处，没有统一语义。来源：D1-05 A 级 + D2-agent-tool L5。
- 改法：
  1. 统一 abort 语义：**方案 B——全部回滚到 turn 起点**（不留 partial）。abort 是用户已决定中止的操作，丢弃已生成内容合理；全回滚语义最干净，无需维护 partial flag 状态机。
  2. 抽公共 `handleAbort(reason, branch)` helper，7+ 检测点全部走它，不再各自处理。
  2. line 495 catch 分支补回滚到 turn 起点，不能什么都不做。
- 验收/测试：
  - 需新增测试：构造网络抖动命中三分支 × 触发 abort，断言三分支结果一致（同一 abort 后会话状态 byte-level 一致或语义一致）。
  - 7+ abort 检测点逐一注入 abort 信号，断言走同一 helper。
- 依赖：与 S-13（undo_send 删光）联动——abort 后会话状态一致性影响 undo_send 行为。建议 S-13 后做。
- 已决策：方案 B（全回滚）。语义干净优先于保留 partial。
- 来源：D3-2 第 19 条 / D1-05 A 级 / D2-agent-tool L5。

### A-20 [A] CLI 硬编码 Windows SKSP（macOS/Linux 跑 CLI 直接挂）（D3-2 #20）
- 维度：L6（单角度，D2 切片确认）
- P 序：P0-5（跨平台可用性）
- 文件：
  - `apps/cli/src/runtime.ts:162`（写死 `resolveSkspDriver("windows")`）
  - desktop 已抽的 `getPlatformSkspName()` 抽出处（需回查路径，应提到可被 CLI 复用的位置）
- 问题：D3-2 #20 指出，desktop 已抽 `getPlatformSkspName()` 但 CLI 没复用，CLI 写死 `"windows"`，macOS/Linux 跑 CLI 直接挂。来源：D1-06 A-1。
- 改法：
  1. 把 desktop 的 `getPlatformSkspName()` 上提到可被三端共用的位置（如 `packages/core/src/.../sksp/platform.ts`，避免 RN 抽象泄漏——核对不引入 node 专属 API）。
  2. `apps/cli/src/runtime.ts:162` 把 `resolveSkspDriver("windows")` 改为 `resolveSkspDriver(getPlatformSkspName())`。
  3. CLI 启动时若平台不支持（如该平台无 SKSP driver），抛明确错误而非静默走 windows。
- 验收/测试：
  - 需新增测试：mock `process.platform` 为 darwin/linux/win32，断言 CLI 选对应 driver。
  - 回归：desktop 既有 `getPlatformSkspName()` 测试全绿。
- 依赖：与 A-9（SKSP env 安全维度）联动——CLI 切到共用函数后，env 覆盖也走同一链路。
- 来源：D3-2 第 20 条 / D1-06 A-1。

### A-21 [A] cloud-sync push 无互斥 + 续租/中段/并发无测试（D3-2 #21）
- 维度：L5 + L7（2 角度交叉）
- P 序：P1-8（运行时——并发安全）
- 文件：
  - cloud-sync push 入口（仅采样一次 `isAgentActive`，需回查路径）
  - agent 启动入口（push 期间允许 agent 启动的位点）
  - 新建互斥锁抽象（建议挂在 S-1/S-8 共建的编排抽象上）
- 问题：D3-2 #21 指出，cloud-sync push 入口仅采样一次 `isAgentActive`，push 期间允许 agent 启动，本地侧无互斥；cloud-sync 续租/中段/并发场景无测试。来源：D1-05 B 级 + D1-07 cloud-sync 无测试。
- 改法：
  1. 在 cloud-sync push 与 agent 启动之间加进程内互斥锁（同一 session 维度）。push 持锁期间 agent 启动**排队**（带超时降级为拒绝）；agent 运行期间 push 排队。
  2. push 续租：长时间 push 定期检查锁状态，若被高优抢占则中止并标记。
  3. 补并发测试：push 进行中启动 agent、agent 运行中触发 push、push 续租超时、并发 push 请求。
- 验收/测试：
  - 需新增并发场景测试（4 个以上）：见改法第 3 点。
  - 互斥锁单测（持锁、释放、抢占）。
- 依赖：与 S-1（事务编排）/ S-8 联动——互斥锁可挂在统一编排抽象上。建议 S-1 先行。
- 已决策：**排队 + 超时降级拒绝**。排队不丢请求更友好，超时降级防死等。
- 来源：D3-2 第 21 条 / D1-05 B 级 / D1-07。

### A-22 [A] message-rollback resolveRollbackPlan 无护栏（D3-2 #22）
- 维度：L5 + D2-chat-message（2 角度交叉）
- P 序：P1-9（运行时——并发安全）
- 文件：
  - `packages/core/src/.../message-rollback/resolveRollbackPlan`（多次 await 读 + `conn.transaction` 写之间无护栏）
- 问题：D3-2 #22 指出，`resolveRollbackPlan` 多次 await 读与 `conn.transaction` 写之间无护栏，agent 可在间隙写入。spec 明示这是设计（不是疏忽），但缺护栏。来源：D1-05 B 级 + D2-chat-message B1。
- 改法：
  1. 加**乐观锁版本号**：读时记录版本号 → 写时校验版本号未变，冲突则重试。乐观锁不阻塞读路径，热路径友好；无需写锁状态机，可维护性更好。
  2. 加护栏后，原 spec 的「无护栏是设计」例外条款作废，无需在 ARCHITECTURE 登记例外。
- 验收/测试：
  - 需新增并发测试：resolveRollbackPlan 进行中注入 agent 写入，断言回滚计划不基于过期读。
  - 乐观锁版本号单测（版本不一致 → 拒并重试）。
- 依赖：与 S-13（undo_send 删光）联动——rollback 路径是 S-13 的下游。建议 S-13 先行。
- 已决策：乐观锁版本号。性能（不阻塞读）+ 干净（无锁状态机）双优。
- 来源：D3-2 第 22 条 / D1-05 B 级 / D2-chat-message B1。

### A-23 [A] SSE fetch vs XHR 两条路径不对齐（D3-2 #23）
- 维度：L6（单角度）
- P 序：P2-5（跨端一致性——streaming UI 表现）
- 文件：
  - fetch 路径：直接 `onChunk`（需回查文件）
  - XHR 路径：`createSseChunkEmitter`（byte pacing）
- 问题：D3-2 #23 指出，fetch 直接 `onChunk`，XHR 走 `createSseChunkEmitter` 做 byte pacing，两条路径 chunk 投递时序与分包粒度不同，影响 streaming UI 表现。来源：D1-06 A-2。
- 改法：
  1. 统一两条路径的分发语义：抽公共 `dispatchSseChunk(rawBytes, emitter)`，fetch 与 XHR 都走它，pacing 策略统一。
  2. 或建立 parity 套件：同一组 SSE 流输入两条路径，断言 chunk 序列与投递时序在容差内一致。
- 验收/测试：
  - 需新增 parity 套件：构造含分包/粘包/延迟到达的 SSE 流，fetch 与 XHR 各跑，断言最终 chunk 序列一致。
  - streaming UI 回归（手动验收）。
- 依赖：无。
- 来源：D3-2 第 23 条 / D1-06 A-2。

### A-24 [A] TDBC batch 嵌套事务行为分叉（SAVEPOINT vs skip）（D3-2 #24）
- 维度：L6（单角度）
- P 序：P1-10（跨端一致性——事务语义）
- 文件：
  - better-sqlite3 driver：`db.transaction()` 嵌套形成 SAVEPOINT
  - RN driver：`inTransaction` 时嵌套 batch 跳过（需回查路径）
- 问题：D3-2 #24 指出，better-sqlite3 经 `db.transaction()` 形成 SAVEPOINT，RN 在 `inTransaction` 时跳过嵌套，batch 部分失败时回滚范围不同。L4 不区分 SAVEPOINT 行为会漏判。来源：D1-06 A-3。
- 改法：
  1. 统一 batch 嵌套事务语义：**两端都走 SAVEPOINT**（RN 补 SAVEPOINT 支持）。SAVEPOINT 是 SQL 标准，部分失败能精确回滚到 savepoint，语义最清晰。
  2. 在 TDBC 公共接口层文档化嵌套事务行为，L4（跨端一致性）规则据此校验。
- 验收/测试：
  - 需新增跨端 parity 套件：构造 batch 部分失败用例，better-sqlite3 与 RN 各跑，断言回滚范围一致。
  - 现有 batch 测试回归。
- 依赖：无。
- 已决策：方案 A（两端都走 SAVEPOINT）。正确性 + 语义清晰优先。
- 来源：D3-2 第 24 条 / D1-06 A-3。

### A-25 [A] Android SKSP get() 漏 SELECT version 列（D3-2 #25）
- 维度：L6（单角度）
- P 序：P0-6（数据正确性——version 升级会读不到）
- 文件：
  - Android SKSP `get()` 查询语句（需回查路径，对照 mac/windows 同名查询）
- 问题：D3-2 #25 指出，Android SKSP `get()` 查询漏了 `version` 列，mac/windows 都查了，version 升到 2 时 Android 会读不到。来源：D1-06 A-6。
- 改法：
  1. Android SKSP `get()` 的 SELECT 补 `version` 列，与 mac/windows 查询对齐。
  2. 核对 Android SKSP `set()` / `upsert()` 是否也按 version 列处理（避免读得到写不进）。
- 验收/测试：
  - 需新增测试：Android SKSP version=2 时 `get()` 能读出正确 version。
  - 三端 SKSP `get()` parity 套件：version=1 / version=2 各跑。
- 依赖：与 A-9（SKSP env 安全维度）联动——同属 SKSP 三端对齐。建议合并到同一波执行。
- 来源：D3-2 第 25 条 / D1-06 A-6。

### A-26 [A] core/driver 对 RN 抽象泄漏（node:fs 静态 import）（D3-2 #26）
- 维度：L6 + L3（2 角度交叉）
- P 序：P1-11（抽象边界）
- 文件：
  - `cloud-sync-driver-s3` 顶层 `import "node:fs/promises"`（静态 import，需回查具体行）
  - mobile 维护的 5 份 shim + 全局 polyfill（Buffer/ReadableStream/DOMParser/Blob）
- 问题：D3-2 #26 指出，`cloud-sync-driver-s3` 静态 `import "node:fs/promises"`，逼得 mobile 维护 5 份 shim + 全局 polyfill，是对 RN 的抽象泄漏。来源：D1-06 A-7。
- 改法：
  1. **方案 B（抽象 FileSystemPort 接口）**：在 `cloud-sync-driver-s3` 定义 `FileSystemPort` 接口，由调用方注入实现（Node 注入 `node:fs`，mobile 注入 RN shim），不再静态依赖。依赖注入是正道，正交分离比 dynamic import 打补丁更干净，也更便于测试（mock FileSystemPort 即可）。
  2. mobile 端逐步移除多余的 shim + 全局 polyfill（核对无其他依赖后再删）。
- 验收/测试：
  - 需新增测试：mobile bundle 构建产物不含 `node:fs` 字符串（grep 验证）。
  - cloud-sync-driver-s3 功能回归（Node 端 + mobile 端各跑）。
- 依赖：与 S-4（driver 包独立性）联动——同属 driver 抽象边界。建议 S-4 后做或并行。
- 已决策：方案 B（FileSystemPort 接口）。正交分离 + 可测试性优于打补丁。
- 来源：D3-2 第 26 条 / D1-06 A-7。

### A-27 [A] schema 校验 vs service/runtime 校验不对齐（跨 5 模块）（D3-2 #27）
- 维度：L3 + D2a-L3（2 角度交叉）
- P 序：P1-12（结构性——数据入口失防）
- 文件：
  - agent：schema allow+deny 不闭合
  - compaction：`CompactionConditionsTrigger` 草稿残留
  - prompt：`validatePromptBlocks` 死路径
  - chat-message：`setMessageFloor` spec 承诺两步、代码四步
  - provider：`BUILTIN_PROVIDER_IDS` 改名不改类型
  - db-backup import / cloud-sync pull 路径（绕过 service upsert）
- 问题：D3-2 #27 指出，schema 是 wire 解析器，业务约束散落 service，db-backup import / cloud-sync pull 绕过 service upsert 的路径全部失防。来源：D2a-L3 模式 2。
- 改法：
  1. 每个 module 的 repository `rowToDefinition` 补 service 校验调用（不再只信 schema 解析）。
  2. 或建立统一的校验管道：所有数据入口（service upsert / db-backup import / cloud-sync pull）都走同一个 `validateDefinition(def)`。
  3. 逐条清理残留：`CompactionConditionsTrigger` 草稿删或补完；`validatePromptBlocks` 死路径删；`setMessageFloor` **改代码对齐 spec 的两步语义**；`BUILTIN_PROVIDER_IDS` 类型对齐改名。
- 验收/测试：
  - 需新增测试：db-backup import 走非法 def → 拒；cloud-sync pull 走非法 def → 拒。
  - 5 个模块逐条等价性测试。
- 依赖：与 S-5（死代码清扫）联动——`CompactionConditionsTrigger` 草稿残留 + `validatePromptBlocks` 死路径清扫归属本条。
- 已决策：**改代码对齐 spec 的两步**。两步语义更简单，四步是历史累积，简化比追认更干净。
- 来源：D3-2 第 27 条 / D2a-L3 模式 2。

### A-28 [A] knip 配置未修复（apps 端 126 个误判遮挡真实死代码）（D3-2 #28）
- 维度：L9（单角度）
- P 序：P0-7（高杠杆——修配置才能看到真实死代码，是 S-5 / A-15 的前置）
- 文件：
  - 根 `knip.json` / `.kniprc` / package.json knip 配置（需回查具体位置）
  - knip 的 entry / ignore 配置（不认 workspace 子路径 + `@/` 别名）
- 问题：D3-2 #28 指出，knip 的 entry/ignore 配置不认 workspace 子路径 + `@/` 别名，导致 74 desktop test + 17 mobile e2e + 35 mobile webview + 107 `@/` unresolved 全是误判，合计 126+ 个，遮挡真实死代码。apps 端真实死代码分布必须等 knip 配置修好重跑后才能定论。来源：D1-09 + D0-3 knip-scan。
- 改法：
  1. 修 knip 配置：entry/ignore 认 workspace 子路径（`apps/desktop/**`、`apps/mobile/**`），识别 `@/` 别名（指向 `tsconfig` paths）。
  2. 重跑 knip，把误判量降到 0（或仅剩有据可查的少量例外）。
  3. 输出真实死代码清单 → 转交 S-5（公共面清扫）执行。
- 验收/测试：
  - knip 重跑后误判量从 126+ 降到接近 0。
  - 真实死代码清单可执行（每条对应具体文件 + 符号）。
- 依赖：**S-5 强依赖本条**——S-5 的公共面扫描必须先有干净 knip 输出。建议本条最优先做（即便编号靠后）。
- 来源：D3-2 第 28 条 / D1-09 / D0-3 knip-scan。

---

## Spec deviations
- S-2 / #9 联动（SKSP env 反向漂移）：用户已授权修改业务 Iteration spec。改法方向是「spec 对齐到实现的安全方向」，不违背原始 spec 的安全意图。状态：**fixed**（用户授权主代理拍板）。
- S-2 `tool-system-v2/prd.md` 移除 chat_grep 必备：用户已拍板撤掉 chat_grep（代码已 @deprecated，干净优先）。状态：**fixed**（用户授权主代理拍板）。

## 决策记录（用户授权主代理按「可维护/性能/干净」三线拍板）

| # | 问题 | 决策 | 依据 |
|---|------|------|------|
| 1 | A-7 是否升 S | **不升** | 单维度性能问题，非跨模块系统性根因 |
| 2 | chat_grep 去留（S-2↔S-5） | **撤掉** | 代码已 @deprecated，干净优先；S-5 清扫 + S-2 改 PRD |
| 3 | events-reliability intentional 标记（S-6） | **推翻原 intentional** | 门控该一致，不能因历史标记豁免 |
| 4 | 是否允许改业务 Iteration spec（S-2/#9） | **允许** | 用户授权；spec 对齐到安全方向 |
| 5 | S-1 与 S-8 是否共建抽象 | **共建一个跨资源写编排抽象** | 根因同源，一套抽象比两套更可维护 |
| 6 | A-10 Myers diff 来源 | **引入轻量成熟依赖** | 专业库负责算法正确性，团队只维护调用层；ARCHITECTURE 依赖政策冲突时退回自实现 |
| 7 | A-15 mobile 迁 ESLint 9 | **迁移** | 35766 行规则洼地，一次性痛苦换长期统一基线 |
| 8 | A-18 发版策略 | **方案 A（锁 0.0.0 + 显式声明）** | 内部包无外部消费者，changeset 是额外开销 |
| 9 | A-19 abort 语义 | **方案 B（全回滚）** | 语义最干净，无需 partial flag 状态机 |
| 10 | A-21 push/agent 冲突 | **排队 + 超时降级拒绝** | 排队不丢请求，超时防死等 |
| 11 | A-22 rollback 护栏 | **乐观锁版本号** | 不阻塞读 + 无锁状态机，性能和干净双优 |
| 12 | A-24 TDBC 嵌套事务 | **两端都走 SAVEPOINT** | SQL 标准，部分失败精确回滚，语义最清晰 |
| 13 | A-26 node:fs 解耦 | **方案 B（FileSystemPort 接口）** | 正交分离 + 可测试性优于 dynamic import 打补丁 |
| 14 | A-27 setMessageFloor | **改代码对齐 spec 两步** | 两步比四步简单，简化比追认干净 |
| 15 | A-7 是否升 S（重复） | **不升**（同 #1） | — |

## 已豁免（用户确认不修）
- 无。

## 合并后 QA（manual_user）
- S-13：手动验收普通 chat 路径 undo_send 不删光会话（构造 capture 失败场景）。
- S-16：手动验收含 customAttach 的 agent prompt 经存储加载后字段不丢。
- S-2/#9：手动验收 SKSP env 空串时 DB 不被覆盖（三端各验一次）。

## K 节建议（下游执行时闭合）
- knip 配置（#28）需先收紧，否则 S-5 的公共面扫描会被 126 个误判干扰。
- S-3 CI 落地后，所有改动的 PR 都应触发完整 lint/typecheck/test。
- 文档同步：S-2 的 `iterations.yaml` 建立后，后续迭代必须填写取代链（建议加进 CONTRIBUTING 或等价文档）。
- lint/format 残留：S-5 新增的公共面退出 lint 规则、S-4 的 package.json 改动都需过 prettier。
