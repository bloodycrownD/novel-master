# D0-2：文档索引 & 模块候选定稿

## 元信息
- 总 Iterations 数：**151**
- 全部含 prd.md + spec.md（少数只有 prd 或 spec，5 个有 cr-fix-spec.md）
- 来源：`docs/Iterations/` 全量扫描

---

## 1. Iterations 主题归类

按涉及的 bounded context 分组。「摇摆度」= 该主题下的 Iteration 数量。

### 摇摆度极高（10+ 迭代）

**vfs / worktree（17 迭代）—— 摇摆度最高**

```
VFS, vfs-directory-nodes, vfs-move-and-frontmatter-bugfix, vfs-revision-storage-optimize,
vfs-tool-error-diagnostics, vfs-unified-root, vfs-user-ops-unified-tool-turn, vfs-version-redesign,
vfs-zip-io-agent-tool-policy, vfs-zip-native-compression, virtual-worktree,
worktree-engine-convergence, worktree-vfs-ui-refresh-fix, chat-project-vfs,
workspace-chat-vfs-upgrade, mobile-worktree-vfs-perf, remove-mobile-vfs-zip-native
```

vfs 经历了版本重设计、存储优化、zip 原生压缩的加入和移除、worktree 改名、unified root 等多次大改。结合 D0-1 的 3 张表 + 3 个 god module + 5 512 行代码——**vfs 是全仓库复杂度和摇摆度的双重冠军**。

**mobile UI / stream / webview（30+ 迭代）**

```
mobile-app, mobile-app-scaffold, mobile-fix, mobile-fix-v2, mobile-bugfix,
mobile-llm-streaming, mobile-sse-stream-resilience, mobile-stream-display-pacing,
mobile-stream-end-flicker, mobile-stream-tail-waiting-ui, mobile-stream-text-path-fix,
mobile-chat-stability-fixes, mobile-chat-composer-annotate-ux, mobile-chat-conversation-back,
mobile-chat-thinking-and-vfs-sort, mobile-compact-context-fix, mobile-cloud-sync-rn-compat,
mobile-message-edit-multiline, mobile-message-edit-visibility, mobile-native-chat-list,
mobile-overlay-navigation-stuck, mobile-prototype-session-drawer, mobile-stability-db-migration,
mobile-ui-vfs-defaults, mobile-user-ops-logging-project-workspace-back, mobile-vfs-markdown-webview,
mobile-webview-boot-bundler, mobile-webview-boot-resources, mobile-webview-chat-transcript,
mobile-webview-preact-htm, mobile-workspace-rename-menu, mobile-agent-nav-refactor,
mobile-agent-prompt-block-name-keyboard, mobile-android-e2e-appium, mobile-form-footer-hit-area,
regex-mobile-prototype, thinking-default-high（部分）
```

mobile 的迭代数量碾压其他主题。但要注意：大量 mobile-* 迭代是 UI/UX 调整而非 core 逻辑变更。对 core 的 CR 来说，mobile 迭代主要用于**理解端侧如何消费 core**（L6 跨端一致性角度），而非 core 自身的设计意图。

**agent 相关（14 迭代）**

```
agent-system, agent-config-shape, agent-model-decouple, agent-prompt-abstract-block,
agent-prompt-save-and-vfs-ua-bugfix, agent-resilience-mobile-yaml, agent-stream-tool-ux,
agent-vfs-tool-suite, agent-worktree-block-ui, agent-chat-ux-bugfix, agent-config-and-compaction,
agent-config-extra-info-and-workplace-cleanup, project-agent-config, mobile-agent-*
```

agent 系统经历了 config shape 变更、model 解耦、prompt abstract block、resilience 加固等。agent domain 代码 752 行不算大，但迭代密度高，说明 agent 的职责边界一直在调整。

### 摇摆度高（5-9 迭代）

**message + rollback（13 迭代）—— 事务核心区**

```
message-checkpoint-v2, message-visibility, message-set-floor, message-delete-worktree-narrow-refresh,
message-worktree-refresh-tighten, message-attachment-unified, message-rollback-execution-redesign,
message-rollback-remove-session-log, rollback-failure-degraded-fallback,
rollback-import-baseline-checkpoint, rollback-mkdir-idempotent, rollback-revision-head-backfill,
chat-rollback-vfs-tool-fixes, chat-user-rollback-redo, chat-history-search
```

message 和 rollback 是同一个事务领域的两面——checkpoint 创建 + rollback 执行。**5 个 rollback-* 迭代**说明 rollback 逻辑被反复修过：执行重设计、移除 session log、失败降级、import 基线、mkdir 幂等、revision head 回填。这是 L4 错误处理角度的核心战场。

**compaction（5 迭代）—— 触发条件反复调**

```
compaction-agent-update, global-compaction-policy, event-bus-compaction-conditions,
agent-config-and-compaction, mobile-compact-context-fix
```

compaction 触发条件从 agent 内移到全局策略、再到事件总线驱动。代码只有 195 行，但 5 个迭代都在调触发逻辑——典型「小代码大复杂度」。

**provider / model（10 迭代）**

```
provider-identity, provider-model, saved-model-identity, opencode-builtin-provider,
llm-protocol-anthropic-gemini-parity, model-aware-token-counting, model-context-settings,
model-generation-params, thinking-default-high, thinking-level
```

provider 经历了 identity 重构、saved-model 身份、opencode 内置 provider、三协议 parity。model 相关的 token 计数、context settings、generation params、thinking level 是参数调优的痕迹。

**prompt（4 迭代）**

```
prompt-block-lifecycle, prompt-engine, prompt-llm-input-parity, hide-vfs-turn-prompt-char-count
```

prompt 引擎、block 生命周期、LLM input parity。prompt-llm-input-parity 直接关系到跨协议一致性。

**tool（5 迭代）**

```
tool-system, tool-system-v2, tool-result-block-ok, agent-vfs-tool-suite, vfs-zip-io-agent-tool-policy
```

tool 系统从 v1 升级到 v2，加了 result block ok 规范、vfs tool 策略。

### 摇摆度中等（2-4 迭代）

| 主题 | 迭代 |
|------|------|
| 架构 / 重构 | core-package-structure, core-architecture-style, implementation-simplification, codebase-audit-remediation, core-test-fixture-sharing, core-explore-remediation, post-1.3.14-code-review, post-1.3.14-large-debt-remediation |
| regex | regex-system, regex-mobile-prototype |
| session/存储 | storage-schema-alignment, persistent-state-and-preferences, stored-config-validity, global-config-system |
| desktop | desktop-app, desktop-main-shell, desktop-chat-workspace-polish, desktop-ui-polish, desktop-ux-bug-fixes, desktop-workspace-ux-fixes, macos-desktop-startup-fix |
| 配置 | config-forms-merge-into-core, agent-config-shape, project-agent-config, global-config-system |
| cloud-sync | cross-device-cloud-sync, mobile-cloud-sync-rn-compat |
| 基础设施 | TDBC, tdbc-driver-rn-native-entry, SqlTemplateParser, nmtp, sksp, sksp-mac |

### 摇摆度低（1 迭代）

about-and-update-check, content-blocks, prototype-optimization, ui-optimization, UI优化, user-ops-operation-log, annotate-*, character-card-import 等单次迭代。

---

## 2. 模块摇摆度打分

综合三个维度：**Iteration 摇摆度**（涉及该模块的 Iter 数）× **代码量权重** × **架构复杂度权重**（分层违规/god module/循环）。

| 模块 | Iter 摇摆 | 代码量 | 架构复杂度 | 总分 | 入选 |
|------|----------|--------|----------|------|------|
| **vfs** | 17 × 1.5（大代码）× 1.3（god module + 3 表）= **33** | 极高 | 极高 | 33 | ✅ 切片 |
| **chat + message + rollback** | 13+10 = 23 × 1.5 × 1.2 = **41** | 极高 | 高 | 41 | ✅ 切片（合并） |
| **compaction-conditions** | 5 × 1.0 × 1.3（触发逻辑反复改）= **6.5** | 小 | 高 | 6.5 | ✅ 切片 |
| **provider + llm-protocol** | 10 × 1.5 × 1.3（god module adapter.port）= **19.5** | 高 | 高 | 19.5 | ✅ 切片（合并） |
| **agent + tool** | 14+5 = 19 × 1.2 × 1.0 = **22.8** | 中 | 中 | 22.8 | ✅ 切片（合并） |
| **prompt** | 4 × 1.0 × 1.0 = **4** | 中 | 中（依赖 chat） | 4 | ✅ 切片 |
| **events + events-config** | 3 × 1.0 × 1.2（DAG）= **3.6** | 小 | 中 | 3.6 | 横扫-only |
| **regex** | 2 × 1.0 × 1.0 = **2**（但测试极稀，加权 1.5）= **3** | 小 | 中 | 3 | 横扫-only |
| **workplace** | 3 × 1.0 × 1.0 = **3** | 中 | 低 | 3 | 横扫-only |
| **session-kkv / kkv / persistent-*** | 3 × 1.0 × 1.0 = **3** | 小 | 低 | 3 | 横扫-only |
| **cloud-sync** | 2 × 1.0 × 1.0 = **2**（测试稀加权 1.5）= **3** | 中 | 中 | 3 | 横扫-only |
| **sksp** | 2 × 1.0 × 1.0 = **2** | 小 | 中（安全） | 2 | 横扫-only |
| **tdbc / sql-template / tokenizer / nmtp** | 各 1-2 | 中 | 低-中 | 1-2 | 横扫-only |

---

## 3. 模块清单定稿

### 切片入选（6 个，合并后）

按摇摆度和代码量综合，**合并强耦合的 context**后取 Top 6 做完整切片：

| 切片编号 | 模块组合 | 包含 context | 理由 |
|---------|---------|-------------|------|
| **D2-vfs** | vfs（+ content-store + revision） | domain/vfs, service/vfs, bootstrap/vfs | 摇摆度冠军，3 表 3 god module，17 迭代 |
| **D2-chat-message** | chat + message-checkpoint + rollback | domain/chat, domain/message-checkpoint, service/chat, service/message-checkpoint | 双巨头之一，事务核心，rollback 反复改 |
| **D2-provider-llm** | provider + llm-protocol | domain/provider, infra/llm-protocol, service/provider | 三协议 parity，god module adapter.port，token 计数 |
| **D2-agent-tool** | agent + tool | domain/agent, domain/tool, service/agent | 14+5 迭代，config shape 反复改，tool v1→v2 |
| **D2-compaction** | compaction-conditions | domain/compaction-conditions, service/compaction-conditions | 小代码大复杂度，触发逻辑 5 次改 |
| **D2-prompt** | prompt + prompt-template | domain/prompt, service/prompt, infra/prompt-template | 依赖 chat，LLM input parity，跨协议 |

### 横扫-only（不入切片，但被 L1-L8 扫过）

events, events-config, regex, workplace, session-kkv, kkv, persistent-preferences, persistent-state, depth, format, character-card, cloud-sync, sksp, tdbc, sql-template, tokenizer, nmtp, db-backup, serialization, feature-flags, session-fs

这些模块会在 phase1 的角度横扫中被覆盖，但不做独立切片——因为它们的摇摆度低、代码量小，或职责单一不值得单独深挖。

### 合并理由

- **chat + message + rollback 合并**：这三个是同一个事务领域。message-checkpoint 的创建是为了 rollback，rollback 操作 message。分开切片会产生大量重复的交叉引用。
- **provider + llm-protocol 合并**：provider domain 和 llm-protocol infra 是同一个能力栈的两面——provider 定义用哪个 LLM，llm-protocol 实现怎么调。三协议 parity 问题必须两者一起看。
- **agent + tool 合并**：tool 系统的主要消费者是 agent，tool v1→v2 的演进和 agent 的 config shape 变更高度耦合。

---

## 4. 角度 × 迭代映射

每个角度该读哪些 Iteration（按优先级）。这是各 lens 指导文档的参考。

### L1 数据模型 & 持久化

**高优先：**
- `storage-schema-alignment` — schema 对齐总设计
- `vfs-version-redesign` + `vfs-revision-storage-optimize` + `vfs-entry-id-redesign-v1`（迁移） — vfs 表结构三次大改
- `message-checkpoint-v2` — checkpoint 表结构
- `vfs-content-blob-zlib-v1`（迁移） — content blob 压缩
- `rename-worktree-tables-to-workplace-v1`（迁移） — worktree→workplace 改名
- `session-agent-config-v2`（迁移） — session agent config 升级
- `persistent-state-and-preferences` + `stored-config-validity` — 持久化偏好

**中优先：** `agent-config-shape`, `global-config-system`, `saved-model-identity`, `provider-identity`, `message-attachment-unified`, `kkv`, `session-kkv`

### L2 算法 & 复杂度

**高优先：**
- `compaction-agent-update` + `global-compaction-policy` + `event-bus-compaction-conditions` — compaction 触发算法
- `model-aware-token-counting` + `token-counting` — token 计数算法
- `regex-system` — 正则引擎
- `prompt-engine` + `prompt-block-lifecycle` — prompt 组装算法
- `vfs-revision-storage-optimize` — revision diff/合并算法

**中优先：** `message-rollback-execution-redesign`, `SqlTemplateParser`, `depth`, `worktree-engine-convergence`, `agent-prompt-abstract-block`

### L3 架构 & 依赖

**高优先：**
- `core-package-structure` + `core-architecture-style` — 当前分层来源（必读 ARCHITECTURE.md）
- `agent-model-decouple` — context 拆分案例
- `implementation-simplification` — 简化删除
- `codebase-audit-remediation` + `core-explore-remediation` — 审计整改
- `config-forms-merge-into-core` — 包结构调整
- `post-1.3.14-large-debt-remediation` — 大债清理

**中优先：** `core-test-fixture-sharing`, `tool-system-v2`, `worktree-engine-convergence`, `agent-system`, `vfs-unified-root`

### L4 错误处理 & 事务

**高优先（rollback 五件套 + 事务）：**
- `message-rollback-execution-redesign` — rollback 执行重设计（核心）
- `rollback-failure-degraded-fallback` — rollback 失败降级
- `rollback-import-baseline-checkpoint` — 导入基线
- `rollback-mkdir-idempotent` — mkdir 幂等
- `rollback-revision-head-backfill` — revision head 回填
- `message-rollback-remove-session-log` — 移除 session log
- `message-checkpoint-v2` — checkpoint 事务设计
- `agent-resilience-mobile-yaml` — agent 韧性

**中优先：** `vfs-tool-error-diagnostics`, `chat-rollback-vfs-tool-fixes`, `mobile-stability-db-migration`, `import-export-navigation-fix`, `mobile-sse-stream-resilience`

### L5 并发 & 异步

**高优先：**
- `mobile-llm-streaming` — RN SSE 流式
- `mobile-sse-stream-resilience` — SSE 韧性
- `llm-protocol-anthropic-gemini-parity` — 三协议流式 parity
- `event-bus-compaction-conditions` — 事件驱动 compaction（触发并发）
- `event-config-dag` — 事件 DAG（顺序依赖）
- `chat-tool-turn-phase-ui` — tool turn 异步状态机

**中优先：** `mobile-stream-display-pacing`, `mobile-stream-end-flicker`, `mobile-stream-tail-waiting-ui`, `mobile-stream-text-path-fix`, `cross-device-cloud-sync`, `chat-send-render-refactor`, `agent-stream-tool-ux`

### L6 跨端一致性

**高优先：**
- `llm-protocol-anthropic-gemini-parity` — 三协议 parity
- `prompt-llm-input-parity` — prompt 输入 parity
- `mobile-llm-streaming` — RN SSE vs Node SSE
- `mobile-cloud-sync-rn-compat` — RN 同步兼容
- `cross-device-cloud-sync` — 跨设备同步
- `nmtp` — tokenizer 协议
- `tdbc-driver-rn-native-entry` — RN TDBC driver
- `remove-mobile-vfs-zip-native` — 平台差异收敛案例
- `vfs-zip-native-compression` — 平台差异案例

**中优先：** `opencode-builtin-provider`, `provider-identity`, `saved-model-identity`, `thinking-level`, `thinking-default-high`, `model-context-settings`, `model-generation-params`, `mobile-android-e2e-appium`, `sksp`, `sksp-mac`, `vfs-zip-io-agent-tool-policy`

### L7 测试 & 可测性

**高优先：**
- `core-test-fixture-sharing` — fixture 共享设计（必读）
- `mobile-android-e2e-appium` — mobile e2e 策略
- `post-1.3.14-code-review` — 之前 CR 的测试发现
- `codebase-audit-remediation` — 审计整改（可能含测试整改）

**中优先：** `tdbc-driver-rn-native-entry`, `core-explore-remediation`

### L8 API 稳定性 & 安全

**高优先：**
- `sksp` + `sksp-mac` — 密钥存储设计（安全核心）
- `provider-identity` + `saved-model-identity` — provider 身份认证
- `tool-system-v2` — tool 权限边界
- `vfs-zip-io-agent-tool-policy` — vfs tool 策略（权限边界）
- `stored-config-validity` — 配置校验
- `core-package-structure` — 公共面边界定义

**中优先：** `opencode-builtin-provider`, `agent-config-shape`, `global-config-system`, `persistent-state-and-preferences`, `character-card-import`, `import-export-navigation-fix`, `chat-workspace-agent-sync`

---

## 5. 定稿观察（叙述式）

151 个迭代目录揭示了几个关键模式。

**第一个模式：vfs 是全仓库的复杂度黑洞。** 17 个相关迭代、3 张表、3 个 god module、5 512 行代码——vfs 几乎经历了所有类型的设计变更：版本重设计、存储优化、zip 压缩加入又移除、worktree 改名、unified root、entry id 重设计。这说明 vfs 的抽象一直在演化，当前版本未必是终态。phase2 的 D2-vfs 切片会是工作量最大的一份。

**第二个模式：rollback 是事务正确性的反复修补区。** 5 个 rollback-* 迭代全是修补：执行重设计、失败降级、幂等保证、head 回填。这不是「设计 rollback」的痕迹，是「rollback 不断出 bug 然后补」的痕迹。L4 错误处理角度必须把 rollback 当头号目标。

**第三个模式：compaction 是「小代码大复杂度」的极端案例。** 195 行代码，5 个迭代全在调触发条件。触发逻辑从 agent 内置移到全局策略、再到事件总线驱动——每次都是架构层级的调整。这种小代码高迭代密度，往往意味着触发条件的语义没定义清楚，每次改都是在打补丁。

**第四个模式：mobile 的迭代数量是 core 健康度的反向指标。** 30+ mobile-* 迭代里大量是 UI/UX 调整和 bugfix（stability-fixes、overlay-navigation-stuck、form-footer-hit-area）。这些不是 core 设计问题，是 mobile 端消费 core 时的适配问题——但这恰恰说明 core 的抽象可能在某些点上不够干净，导致 mobile 要反复打补丁。L6 跨端角度要透过这些 mobile bug 找 core 抽象的泄漏点。

**第五个模式：架构纪律的维持是有意识的。** `core-package-structure`、`core-architecture-style`、`codebase-audit-remediation`、`post-1.3.14-large-debt-remediation`、`implementation-simplification` 这几个迭代的存在，说明团队有意识地维持架构健康——D0-1 扫描出的零违规不是偶然，是持续维护的结果。

定稿结论：**6 个切片**（vfs、chat-message、provider-llm、agent-tool、compaction、prompt），**21 个横扫-only** 模块。这个划分会让 phase2 的工作量集中在真正高摇摆度的地方，而不是平均用力。
