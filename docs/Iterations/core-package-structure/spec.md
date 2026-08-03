# Core 包目录结构规整 — 技术规格（SPEC）

> **迭代目录名**：`core-package-structure`  
> **需求文档**：[`prd.md`](./prd.md)  
> **状态**：SPEC 已确认（`logic/` / `ports/` / `ChatAgentSession`→service 接受；factory 统一 `sqlite-*` 命名）

## 设计目标

1. **收束模块模板**：每个 `domain/<ctx>/` 遵循同一目录契约，新人可凭文件树判断新文件归属。
2. **errors 单一入口**：包级可捕获业务错误全部在 `errors/`；`domain/` 内不再出现 `*-errors.ts`。
3. **schema 位置统一**：全部 `*.schema.ts` 与对应类型同处 `model/`（与 `provider` 现有惯例对齐）。
4. **根目录瘦身**：行为/校验/纯函数归入 `logic/`；非 repo 的 port 归入 `ports/`；特性子目录（`action/`、`triggers/`、`content/`、`session/`、`builtin/`）保留。
5. **依赖方向修正**：`domain/**` 不得 import `service/**`；通过 port 下沉或 adapter 上移到 service 解决。
6. **零行为变更**：仅路径、命名、import、export 源路径调整；公开 API 符号名不变（`index.ts` 继续 export 同名类型/函数）。

---

## 代码探索摘要

| 发现 | 现状 | 本 SPEC 处置 |
|------|------|--------------|
| domain 内 errors | `agent-errors.ts`、`tool-errors.ts` | 迁至 `errors/agent-runtime-errors.ts`、`errors/tool-errors.ts` |
| schema 分裂 | 3 个在模块根、2 个在 `provider/model/` | 全部迁入各模块 `model/*.schema.ts` |
| domain→service 依赖 | 4 处（见下表） | port 下沉 / adapter 上移 |
| token-estimate | `service/compaction/token-estimate.ts` | `domain/compaction/logic/token-estimate.ts` |
| validate 命名 | `prompt-blocks-validate.ts` | 重命名为 `logic/validate-prompt-blocks.ts` |
| impl 命名 | `db-compaction-agent-resolver.ts` | 重命名为 `sqlite-compaction-agent-resolver.ts`；factory **`createSqliteCompactionAgentResolver`**（替换 `createDbCompactionAgentResolver`） |
| CLI deep import | 无（均走 `@novel-master/core`） | 仅需更新 `index.ts` 内部路径 |
| core test deep import | 4 处 tool/agent errors | 随 errors 迁移更新 |
| `apps/cli` | `ChatAgentSession` 来自 package export | export 源改指向 service impl |

**domain → service 违规清单（必须清零）**：

| 文件 | 依赖 | 方案 |
|------|------|------|
| `compaction/triggers/token-threshold.trigger.ts` | `service/compaction/token-estimate` | 迁 token-estimate 至 domain |
| `compaction/compaction-context.ts` | `CompactionAgentResolver`、`ModelRequestService` | port 下沉至 `domain/compaction/ports/` |
| `regex/resolve-active-regex-rules.ts` | `RegexConfigService` | 新增 `domain/regex/ports/active-regex-rules.port.ts` |
| `agent/session/impl/chat-agent-session.ts` | `MessageService` | **整文件**迁至 `service/agent/impl/chat-agent-session.ts` |

**合法保留（文档说明，本期不修改）**：

- `infra/sksp/sksp-error.ts`、`infra/sql-template/errors.ts`、`infra/tdbc/errors.ts` — infra 内部错误。
- `domain/*/repositories/impl/sqlite-*.ts` — pragmatic 布局，见下文「架构决策 §3」。
- `domain/compaction/action/default-compaction-action.ts` 对 `infra/prompt-template`、`infra/date-format` 的依赖 — 见 §2，**合法自然依赖**，不 refactor。
- `provider/model/model-sampling-profile-from-json.ts` — wire 编解码 helper，与 schema 同目录，记为 **`model/` 合法例外**。
- `service/prompt/render-prompt.ts` — 单文件应用服务，无 `impl/`，记为 **service 合法例外**。

### 架构决策与依赖边界

以下三点来自结构 review；**是否合理**与**本 SPEC 是否覆盖**一并说明。

#### §1 domain → service：`TokenThresholdTrigger` / `token-estimate`

| | |
|---|---|
| **现状** | `token-threshold.trigger.ts` import `service/compaction/token-estimate.js` |
| **是否合理** | **不合理**。domain 不得依赖 service；`estimateTokens` 是无 I/O 的纯函数，语义属于 compaction 领域。 |
| **落点** | **`domain/compaction/logic/token-estimate.ts`**（**不是** `infra/`：`chars/4` 是 compaction 触发策略的业务启发式，不是通用基础设施）。 |
| **本 SPEC** | **本期实施**：搬迁 + 更新 trigger import；纳入 domain→service 清零验收。 |

#### §2 domain → infra：`DefaultCompactionAction` / macro-render、date-format

| | |
|---|---|
| **现状** | `default-compaction-action.ts` 直接 import `infra/prompt-template/macro-render`、`infra/date-format` 等 |
| **是否合理** | **合理（本项目约定）**。TS monorepo 未采用 Java/Spring 式构造器注入；追求「目录清晰 + 自然依赖」即可，不必为纯 DDD 强行 port 化。`infra/` 模块**无业务文件名**，提供宏渲染、时间格式化等**技术能力**，domain 直接依赖属于正常向下引用。 |
| **与 §1 的区别** | §1 是 domain 依赖 **service（用例编排层）**，层次倒挂、职责混淆，必须修。§2 是 domain 依赖 **infra（技术设施）**，方向正确。 |
| **落点** | **维持现状**；在 `ARCHITECTURE.md` 写明：**domain 可 import infra**；**domain 不得 import service**。 |
| **本 SPEC** | **不**新增 port、**不**列后续 decouple 迭代；仅文档化。若将来需单测 mock 或替换实现，再局部引入窄 port，非默认要求。 |

#### §3 SQLite repository 实现在 `domain/*/repositories/impl/`

| | |
|---|---|
| **现状** | `sqlite-*.repository.ts` 与领域模块同目录，而非 `infra/persistence/` |
| **是否合理** | **合理（本项目惯例）**。经典 Hexagonal 会把 adapter 放 infra；此处选择 **防腐在 port、实现跟 bounded context 走**，与 `chat` / `provider` 一致，降低跨层跳转、便于 module 内聚。 |
| **落点** | **维持现状**；模板中明确 `repositories/impl/sqlite-*.repository.ts` 为标准形态。 |
| **本 SPEC** | **写入 ARCHITECTURE.md** 为正式约定；不搬迁 repo impl。 |

**依赖方向总表（本期目标）**：

本项目采用 **自然依赖** 规范，而非 Java 式全面反转注入：

| 方向 | 目标 | 说明 |
|------|------|------|
| domain → service | **0** | 本期修复；service 编排 domain，不可反向 |
| domain → infra | **允许** | 技术能力直接引用；`infra/` 不含业务概念文件名 |
| domain → domain | **允许** | 跨 bounded context 引用类型/逻辑，避免循环 |
| service → domain | **允许** | 应用层编排 |
| service → infra | **允许** | adapter、serialization 等 |
| infra → domain | **允许** | protocol adapter 使用领域类型 |
| infra → service | **禁止** | 设施层不感知用例 |

---

## 总体方案

### 分层契约（写入 `packages/core/ARCHITECTURE.md`）

```text
packages/core/src/
├── bootstrap/       # DDL + seed；按 bounded context 分子目录
├── domain/<ctx>/    # 类型、schema、纯逻辑、port、repo；可依赖 infra、其他 domain
├── service/<ctx>/   # 用例编排、factory、持久化 adapter；依赖 domain + infra
├── errors/          # 包级可捕获业务错误（按 ctx 分文件）
├── infra/           # 无业务文件名的技术能力（domain/service 均可依赖）
└── index.ts         # 公开 API 门面（内部路径可变，符号名稳定）
```

### Domain 模块标准模板

```text
domain/<ctx>/
├── model/                  # *.ts 类型 + *.schema.ts（schema 只放此处）
├── repositories/           # 可选；有 SQL 持久化时
│   ├── *.port.ts
│   └── impl/sqlite-*.repository.ts
├── ports/                  # 可选；非 repo 的领域 port
├── logic/                  # 纯函数：validate、compile、rules、estimate…
├── <feature>/              # 可选；action/ triggers/ content/ session/ builtin/
└── （模块根无 .ts 文件）
```

**命名规则**：

| 种类 | 规则 | 示例 |
|------|------|------|
| 校验 | `logic/validate-<entity>.ts` | `validate-agent-definition.ts` |
| 规则/检测 | `logic/<noun>.ts` 或 `logic/<verb>-<noun>.ts` | `doom-loop.ts`、`apply-regex-rules.ts` |
| Repo port | `repositories/<entity>.port.ts` | `message.port.ts` |
| Repo impl | `repositories/impl/sqlite-<entity>.repository.ts` | 统一 `sqlite-*`，禁止 `db-*` 文件名 |
| 默认实现 | `action/default-<name>.ts` 或 `impl/default-*.ts` | 保持 `default-compaction-action.ts` |
| Service factory | `create-<storage>-<role>.ts` 或 `impl/` 内 `createSqlite*` | `createSqliteCompactionAgentResolver` |
| 错误 | `errors/<ctx>-errors.ts` 或 `<ctx>-runtime-errors.ts` | `agent-runtime-errors.ts` |

### Service 模块标准模板

```text
service/<ctx>/
├── *.port.ts
├── create-<ctx>-*.ts
└── impl/*.service.ts | *.ts    # ChatAgentSession 等 adapter 放 impl/
```

---

## 最终项目结构

以下为 **`packages/core/src/` 重构完成后的目标文件树**（`bootstrap/`、`infra/` 不变；仅列出有变动的 `domain/`、`errors/`、`service/` 及 `ARCHITECTURE.md`）。

```text
packages/core/
├── ARCHITECTURE.md                          # 新增：分层与模块模板
└── src/
    ├── index.ts                             # 仅改内部 re-export 路径
    │
    ├── errors/
    │   ├── agent-config-errors.ts           # 不变
    │   ├── agent-runtime-errors.ts          # 迁自 domain/agent/agent-errors.ts
    │   ├── chat-errors.ts
    │   ├── compaction-policy-errors.ts
    │   ├── config-decode-errors.ts
    │   ├── kkv-errors.ts
    │   ├── preferences-errors.ts
    │   ├── prompt-errors.ts
    │   ├── provider-errors.ts
    │   ├── regex-errors.ts
    │   ├── tool-errors.ts                   # 迁自 domain/tool/tool-errors.ts
    │   └── vfs-errors.ts
    │
    ├── domain/
    │   ├── agent/
    │   │   ├── logic/
    │   │   │   ├── doom-loop.ts
    │   │   │   ├── resolve-application-model-id.ts
    │   │   │   └── validate-agent-definition.ts
    │   │   ├── model/
    │   │   │   ├── agent-definition.ts
    │   │   │   ├── agent-definition.schema.ts    # 自根目录迁入
    │   │   │   └── agent-run-result.ts
    │   │   ├── repositories/
    │   │   │   ├── agent-definition.port.ts
    │   │   │   └── impl/
    │   │   │       └── sqlite-agent-definition.repository.ts
    │   │   └── session/
    │   │       ├── agent-session.port.ts
    │   │       └── impl/
    │   │           └── in-memory-agent-session.ts   # ChatAgentSession 迁出
    │   │
    │   ├── chat/
    │   │   ├── content/                     # 不变（特性目录）
    │   │   │   ├── format-message-cli.ts
    │   │   │   ├── message-body-text.ts
    │   │   │   ├── parse-message-content.ts
    │   │   │   └── text-blocks.ts
    │   │   ├── logic/
    │   │   │   └── message-visible-floor.ts
    │   │   ├── model/
    │   │   │   ├── content-block.ts
    │   │   │   ├── message.ts
    │   │   │   ├── project.ts
    │   │   │   └── session.ts
    │   │   └── repositories/
    │   │       ├── message.port.ts
    │   │       ├── project.port.ts
    │   │       ├── session.port.ts
    │   │       └── impl/
    │   │           ├── sqlite-message.repository.ts
    │   │           ├── sqlite-project.repository.ts
    │   │           └── sqlite-session.repository.ts
    │   │
    │   ├── compaction/
    │   │   ├── action/
    │   │   │   └── default-compaction-action.ts
    │   │   ├── logic/
    │   │   │   └── token-estimate.ts              # 自 service 迁入
    │   │   ├── model/
    │   │   │   ├── compaction-context.ts
    │   │   │   ├── compaction-model-context.ts
    │   │   │   ├── compaction-policy.ts
    │   │   │   └── compaction-policy.schema.ts
    │   │   ├── ports/
    │   │   │   ├── compaction-action.port.ts
    │   │   │   ├── compaction-agent-resolver.port.ts   # 自 service 迁入
    │   │   │   ├── compaction-model-request.port.ts    # 新增窄 port
    │   │   │   └── compaction-trigger.port.ts
    │   │   └── triggers/
    │   │       ├── composite-trigger.ts
    │   │       ├── floor-threshold.trigger.ts
    │   │       └── token-threshold.trigger.ts
    │   │
    │   ├── kkv/                             # 已合规，不变
    │   │   ├── model/kkv-entry.ts
    │   │   └── repositories/…
    │   │
    │   ├── prompt/
    │   │   ├── logic/
    │   │   │   ├── load-prompt-blocks-from-yaml.ts
    │   │   │   ├── message-body.ts
    │   │   │   └── validate-prompt-blocks.ts         # 原 prompt-blocks-validate.ts
    │   │   └── model/
    │   │       └── prompt-block.ts
    │   │
    │   ├── provider/
    │   │   ├── logic/
    │   │   │   └── application-model-id.ts
    │   │   ├── model/
    │   │   │   ├── model-sampling-params.ts
    │   │   │   ├── model-sampling-params.schema.ts
    │   │   │   ├── model-sampling-profile.ts
    │   │   │   ├── model-sampling-profile.schema.ts
    │   │   │   ├── model-sampling-profile-from-json.ts   # 合法例外
    │   │   │   ├── model-suggestion.ts
    │   │   │   ├── provider.ts
    │   │   │   └── saved-model.ts
    │   │   └── repositories/…
    │   │
    │   ├── regex/
    │   │   ├── logic/
    │   │   │   ├── apply-regex-rules.ts
    │   │   │   ├── compile-regex-rule.ts
    │   │   │   ├── resolve-active-regex-rules.ts
    │   │   │   └── validate-regex-rule.ts
    │   │   ├── model/
    │   │   │   ├── regex-group.ts
    │   │   │   ├── regex-rule.ts
    │   │   │   └── regex-rule.schema.ts              # 自根目录迁入
    │   │   ├── ports/
    │   │   │   └── active-regex-rules.port.ts        # 新增
    │   │   └── repositories/…
    │   │
    │   ├── session-fs/                      # 已合规，不变
    │   ├── tool/
    │   │   ├── builtin/vfs-tools.ts
    │   │   ├── logic/
    │   │   │   ├── tool-registry.ts
    │   │   │   └── tool-runner.ts
    │   │   └── model/tool.ts
    │   │
    │   ├── vfs/
    │   │   ├── logic/
    │   │   │   ├── vfs-path-mapper.ts
    │   │   │   └── vfs-tree-copy.ts
    │   │   ├── model/…
    │   │   └── repositories/…
    │   │
    │   └── worktree/
    │       ├── logic/
    │       │   ├── front-matter.ts
    │       │   ├── worktree-display.ts
    │       │   ├── worktree-eval.ts
    │       │   ├── worktree-labels.ts
    │       │   ├── worktree-path-map.ts
    │       │   ├── worktree-scope.ts
    │       │   └── worktree-tree.ts
    │       ├── model/worktree-types.ts
    │       └── repositories/…
    │
    └── service/
        ├── agent/
        │   ├── agent.port.ts
        │   ├── agent-registry.port.ts
        │   ├── create-agent-registry-service.ts
        │   ├── create-agent-runner.ts
        │   └── impl/
        │       ├── agent-registry.service.ts
        │       ├── agent-runner.ts
        │       └── chat-agent-session.ts             # 自 domain 迁入
        │
        ├── compaction/
        │   ├── compaction-pipeline.port.ts
        │   ├── compaction-policy-store.port.ts
        │   ├── create-compaction-pipeline.ts
        │   ├── create-compaction-policy-store.ts
        │   └── impl/
        │       ├── compaction-policy-store.service.ts
        │       └── sqlite-compaction-agent-resolver.ts  # 原 db-compaction-agent-resolver.ts
        │
        ├── chat/ …                            # 不变
        ├── kkv/ …                           # 不变
        ├── persistent-preferences/ …
        ├── persistent-state/ …
        ├── prompt/
        │   └── render-prompt.ts             # 合法例外：单文件 service
        ├── provider/ …
        ├── regex/ …
        ├── session-fs/ …
        ├── template/ …
        ├── vfs/ …
        └── worktree/ …
```

**`bootstrap/`、`infra/`**：文件树不变。

---

## 变更点清单

### A. 新增

| 路径 | 说明 |
|------|------|
| `packages/core/ARCHITECTURE.md` | 分层契约 + 模块模板 + 合法例外 |
| `errors/agent-runtime-errors.ts` | 自 `domain/agent/agent-errors.ts` |
| `errors/tool-errors.ts` | 自 `domain/tool/tool-errors.ts`（内容搬迁） |
| `domain/compaction/ports/compaction-model-request.port.ts` | 窄接口，供 `CompactionContext` 使用 |
| `domain/compaction/ports/compaction-agent-resolver.port.ts` | 自 service 迁入 |
| `domain/regex/ports/active-regex-rules.port.ts` | 替代对 `RegexConfigService` 的直接依赖 |

### B. 搬迁 / 重命名（旧 → 新）

| 旧路径 | 新路径 |
|--------|--------|
| `domain/agent/agent-errors.ts` | `errors/agent-runtime-errors.ts` |
| `domain/tool/tool-errors.ts` | `errors/tool-errors.ts` |
| `domain/agent/agent-definition.schema.ts` | `domain/agent/model/agent-definition.schema.ts` |
| `domain/agent/doom-loop.ts` | `domain/agent/logic/doom-loop.ts` |
| `domain/agent/resolve-application-model-id.ts` | `domain/agent/logic/resolve-application-model-id.ts` |
| `domain/agent/validate-agent-definition.ts` | `domain/agent/logic/validate-agent-definition.ts` |
| `domain/agent/session/impl/chat-agent-session.ts` | `service/agent/impl/chat-agent-session.ts` |
| `domain/chat/message-visible-floor.ts` | `domain/chat/logic/message-visible-floor.ts` |
| `domain/compaction/compaction-policy.ts` | `domain/compaction/model/compaction-policy.ts` |
| `domain/compaction/compaction-policy.schema.ts` | `domain/compaction/model/compaction-policy.schema.ts` |
| `domain/compaction/compaction-context.ts` | `domain/compaction/model/compaction-context.ts` |
| `domain/compaction/compaction-model-context.ts` | `domain/compaction/model/compaction-model-context.ts` |
| `domain/compaction/compaction-action.port.ts` | `domain/compaction/ports/compaction-action.port.ts` |
| `domain/compaction/compaction-trigger.port.ts` | `domain/compaction/ports/compaction-trigger.port.ts` |
| `service/compaction/token-estimate.ts` | `domain/compaction/logic/token-estimate.ts` |
| `service/compaction/compaction-agent-resolver.port.ts` | `domain/compaction/ports/compaction-agent-resolver.port.ts` |
| `service/compaction/impl/db-compaction-agent-resolver.ts` | `service/compaction/impl/sqlite-compaction-agent-resolver.ts` |
| `domain/prompt/prompt-blocks-validate.ts` | `domain/prompt/logic/validate-prompt-blocks.ts` |
| `domain/prompt/load-prompt-blocks-from-yaml.ts` | `domain/prompt/logic/load-prompt-blocks-from-yaml.ts` |
| `domain/prompt/message-body.ts` | `domain/prompt/logic/message-body.ts` |
| `domain/provider/application-model-id.ts` | `domain/provider/logic/application-model-id.ts` |
| `domain/regex/regex-rule.schema.ts` | `domain/regex/model/regex-rule.schema.ts` |
| `domain/regex/apply-regex-rules.ts` | `domain/regex/logic/apply-regex-rules.ts` |
| `domain/regex/compile-regex-rule.ts` | `domain/regex/logic/compile-regex-rule.ts` |
| `domain/regex/resolve-active-regex-rules.ts` | `domain/regex/logic/resolve-active-regex-rules.ts` |
| `domain/regex/validate-regex-rule.ts` | `domain/regex/logic/validate-regex-rule.ts` |
| `domain/tool/tool-registry.ts` | `domain/tool/logic/tool-registry.ts` |
| `domain/tool/tool-runner.ts` | `domain/tool/logic/tool-runner.ts` |
| `domain/vfs/vfs-path-mapper.ts` | `domain/vfs/logic/vfs-path-mapper.ts` |
| `domain/vfs/vfs-tree-copy.ts` | `domain/vfs/logic/vfs-tree-copy.ts` |
| `domain/worktree/front-matter.ts` | `domain/worktree/logic/front-matter.ts` |
| `domain/worktree/worktree-*.ts`（6 个） | `domain/worktree/logic/worktree-*.ts` |
| `test/prompt/prompt-blocks-validate.test.ts` | `test/prompt/validate-prompt-blocks.test.ts`（可选，与源文件对齐） |

### C. 删除

- 搬迁完成后的旧路径空文件（git mv 即可，无 orphan）。

### D. 新增 port 接口（类型层，零行为变更）

**`CompactionModelRequest`**（`domain/compaction/ports/compaction-model-request.port.ts`）：

```typescript
/** Compaction summary 所需的 LLM 请求能力（窄 port）。 */
export interface CompactionModelRequest {
  request(
    applicationModelId: string,
    userContent: string,
    options?: { readonly stream?: false; readonly tools?: undefined },
  ): Promise<{ readonly assistantText: string }>;
}
```

`ModelRequestService` 在 service 层 structurally satisfies；`CompactionContext.modelRequests` 改为此类型。

**`ActiveRegexRulesSource`**（`domain/regex/ports/active-regex-rules.port.ts`）：

```typescript
export interface ActiveRegexRulesSource {
  getGroup(id: string): Promise<RegexGroup>;
  listCompiledRulesForGroup(groupId: string): Promise<CompiledRegexRule[]>;
}
```

`resolveActiveCompiledRules(config: ActiveRegexRulesSource, …)` 替换原 `RegexConfigService` 参数类型。

### E. 公开 API（`index.ts`）策略

| 符号 | 策略 |
|------|------|
| `AgentError`、`ToolError` | export 源改 `errors/*`，符号不变 |
| `validatePromptBlocks`、`validatePromptBlocksFromMap` | export 源改 `logic/validate-prompt-blocks.ts`，符号不变 |
| `ChatAgentSession` | export 源改 `service/agent/impl/chat-agent-session.ts` |
| `CompactionAgentResolver` | export 源改 `domain/compaction/ports/...` |
| `createSqliteCompactionAgentResolver` | 替代 `createDbCompactionAgentResolver`；自 `sqlite-compaction-agent-resolver.ts` export |
| `estimateTokens` | export 源改 `domain/compaction/logic/token-estimate.ts` |
| 其余 domain 类型/schema | 仅 `index.ts` 内部路径更新 |

**Breaking（包级符号，需同步调用方）**：

| 旧符号 | 新符号 |
|--------|--------|
| `createDbCompactionAgentResolver` | `createSqliteCompactionAgentResolver` |

**Breaking（deep import）**：monorepo 内 `../../src/domain/...` 路径随搬迁更新；其余 `@novel-master/core` 符号除上表外保持不变。

---

## 详细实现步骤

### 步骤 0：基线

1. 当前分支跑通：`npm test -w @novel-master/core`、`npm run build -w @novel-master/core`（或 repo 等效命令）。
2. 记录基线：`rg 'from "@/service/' packages/core/src/domain` 应得 4 处（本 SPEC 目标为 0）。

### 步骤 1：文档

1. 新增 `packages/core/ARCHITECTURE.md`（分层图 + domain/service 模板 + 合法例外 + 命名表）。
2. 本 SPEC 链接 PRD 与 ARCHITECTURE。

### 步骤 2：errors 收拢

1. `git mv` agent/tool errors → `errors/`。
2. 更新 `doom-loop.ts`、`tool-runner.ts`、`tool-registry.ts` 等 import。
3. 更新 `index.ts`、4 个 test 文件的 deep import。

**验证**：`rg '\*-errors\.ts' packages/core/src/domain` → 0；core tests 绿。

### 步骤 3：schema → model/

1. 迁移 `agent-definition.schema.ts`、`compaction-policy.schema.ts`、`regex-rule.schema.ts`。
2. 批量更新 import（repository、service、index、CLI 经 core export 的无须改）。

**验证**：`find domain -name '*.schema.ts'` 全部在 `*/model/` 下。

### 步骤 4：logic/ + ports/ 批量搬迁

按模块顺序（减少冲突）：`vfs` → `worktree` → `chat` → `provider` → `prompt` → `tool` → `regex` → `agent` → `compaction`。

每个模块：

1. 创建 `logic/`（及 `ports/` 如需要）。
2. `git mv` 文件。
3. 更新模块内相对 import。
4. 跑该模块相关 test。

**prompt 重命名**：`prompt-blocks-validate.ts` → `validate-prompt-blocks.ts`；保留 `validatePromptBlocks` 别名 export。

### 步骤 5：层边界修正

1. 新增 `CompactionModelRequest`、`ActiveRegexRulesSource` port。
2. 更新 `compaction-context.ts`、`resolve-active-regex-rules.ts` 参数类型。
3. `git mv` `token-estimate.ts` → domain。
4. `git mv` `ChatAgentSession` → `service/agent/impl/`。
5. `git mv` `compaction-agent-resolver.port.ts` → domain；更新 service impl import。
6. 重命名 `db-compaction-agent-resolver.ts` → `sqlite-compaction-agent-resolver.ts`；函数 **`createSqliteCompactionAgentResolver`**；更新 `apps/cli/src/runtime.ts` 等调用方。

**验证**：

```bash
rg 'from "@/service/' packages/core/src/domain   # 0 matches
rg 'domain/agent/agent-errors|domain/tool/tool-errors' packages/core  # 0 matches
```

### 步骤 6：index.ts 与全仓库引用

1. 更新 `packages/core/src/index.ts` 全部内部路径。
2. `rg '@novel-master/core' apps packages --glob '!**/node_modules/**'` 确认无 deep path 依赖。
3. 更新 `packages/core/test/**` 中 deep import。

### 步骤 7：全量回归

1. `npm test -w @novel-master/core`
2. monorepo typecheck / CLI build
3. 手工对照 PRD 验收清单逐项勾选

---

## 测试策略

### 原则

- **不新增业务测试**；依赖现有 76+ core tests 作回归网。
- 搬迁阶段**每完成一个模块**跑相关 test 子集，最后全量。

### 测试用例

| # | 场景 | 命令 / 断言 | 期望 |
|---|------|-------------|------|
| T1 | domain 无 errors | `rg --glob '*.ts' 'errors\.ts' packages/core/src/domain` | 0 |
| T2 | schema 全在 model | `Get-ChildItem -Recurse -Filter *.schema.ts domain` | 路径均含 `\model\` |
| T3 | domain 不依赖 service | `rg 'from "@/service/' packages/core/src/domain` | 0 |
| T4 | errors 回归 | `npm test -w @novel-master/core -- test/tool test/agent` | pass |
| T5 | compaction 回归 | `npm test -w @novel-master/core -- test/compaction` | pass |
| T6 | regex 回归 | `npm test -w @novel-master/core -- test/regex` | pass |
| T7 | prompt 回归 | `npm test -w @novel-master/core -- test/prompt` | pass |
| T8 | worktree 回归 | `npm test -w @novel-master/core -- test/worktree` | pass |
| T9 | CLI 集成 | `npm test -w apps/cli`（或 cli 相关 test） | pass；`ChatAgentSession`、`createSqliteCompactionAgentResolver` 可从 core import |
| T10 | 全量 | `npm test -w @novel-master/core` | pass |

---

## 风险与回滚方案

| 风险 | 影响 | 缓解 |
|------|------|------|
| 大批量 `git mv` 导致 merge 冲突 | 与其他并行分支冲突 | 单 PR、少并行大改；按模块 commit |
| import 遗漏 | 编译失败 | 步骤 6 全仓库 rg；CI typecheck |
| port 窄化导致类型不兼容 | TS 编译 error | structurally assign；必要时 `satisfies` 在 factory 处断言 |
| `ChatAgentSession` 迁 service 语义争议 | Review 讨论 | ARCHITECTURE 明确：持久化 adapter 属 service |
| deep import 外部消费者 | 库外用户编译失败 | 本 monorepo 无 deep import；release note 列路径对照 |

**回滚**：单 PR revert 即可；无 DB / 配置迁移；无运行时行为变更。

---

## 模块合规对照表（Review 用）

| 模块 | model/ | repositories/ | logic/ | ports/ | 模块根 .ts | 状态 |
|------|--------|---------------|--------|--------|------------|------|
| agent | ✓ | ✓ | ✓ | — | 0 | 目标 |
| chat | ✓ | ✓ | ✓ | — | 0 | 目标 |
| compaction | ✓ | — | ✓ | ✓ | 0 | 目标 |
| kkv | ✓ | ✓ | — | — | 0 | 已合规 |
| prompt | ✓ | — | ✓ | — | 0 | 目标 |
| provider | ✓ | ✓ | ✓ | — | 0 | 目标 |
| regex | ✓ | ✓ | ✓ | ✓ | 0 | 目标 |
| session-fs | ✓ | ✓ | — | — | 0 | 已合规 |
| tool | ✓ | — | ✓ | — | 0 | 目标 |
| vfs | ✓ | ✓ | ✓ | — | 0 | 目标 |
| worktree | ✓ | ✓ | ✓ | — | 0 | 目标 |

---

## 确认记录

| 项 | 结论 |
|----|------|
| `logic/` / `ports/` 模块模板 | 接受 |
| `ChatAgentSession` 迁至 `service/agent/impl/` | 接受 |
| compaction resolver 命名 | 统一 `sqlite-*` + `createSqliteCompactionAgentResolver` |
| §1 token-estimate | 本期迁至 domain |
| §2 domain → infra | **合法自然依赖**；不 port 化、不列后续迭代 |
| §3 SQLite repo 在 domain | 合理，维持并写入 ARCHITECTURE |

**可进入编码。**
