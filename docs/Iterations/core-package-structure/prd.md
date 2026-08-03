# Core 包目录结构规整 PRD

## 背景

`packages/core` 已具备清晰的四层骨架（`bootstrap` / `domain` / `service` / `infra` / `errors`），且多数带持久化的 domain 模块（如 `chat`、`provider`、`kkv`）已采用 `model/` + `repositories/` 的统一形态。

但随迭代增加，部分模块（`agent`、`compaction`、`worktree`、`regex`、`prompt`、`tool`）在**模块内部**出现目录与命名不一致：errors 归属分裂、schema 位置不统一、行为文件堆在根目录、service 层混入本属 domain 的纯函数等。新人仅凭文件树难以判断「新文件该放哪」，维护成本上升。

本需求不涉及新业务功能，目标是**收束项目自有目录契约**，使结构可预期、可审查、可扩展。

## 目标（含成功指标）

- 为 `packages/core` 建立并落地**统一的 domain / service 模块模板**，写入项目文档，供后续迭代默认遵守。
- 完成现有例外模块的**文件迁移与命名对齐**，使各 bounded context 在文件树层面视觉与职责一致。
- **零行为变更**：重构仅涉及路径、命名与 export 调整；对外能力不变。

成功指标（可量化）：

- `packages/core` 内 **100%** 的 domain 模块符合文档定义的模块模板（或文档中明确标注的合法例外及理由）。
- 所有**可对包外捕获的业务错误类型**均位于 `errors/`（infra 内部专用错误可保留在 `infra/`，但须在文档中说明）。
- 全量 `packages/core` 测试通过；`apps/cli` 及 monorepo 内引用 `@novel-master/core` 的包编译通过。
- 结构规整相关 PR 可通过「文件树对照清单」一次性 review，无需逐文件猜测归属。

## 用户与场景

- **Core 包维护者**：新增 bounded context 或行为文件时，有明确放置规则，避免各模块各自为政。
- **贡献者 / Reviewer**：PR 审查时可对照统一模板，快速判断目录是否合理。
- **上层应用开发者（CLI、mobile 等）**：公开 API（`index.ts` export）保持稳定或提供明确迁移说明；不因内部搬文件导致隐性破坏。

## 范围

### 包含范围

1. **Convention 文档**
   - 在知识库或 `packages/core` 可发现位置写入「模块模板」：domain / service / errors / bootstrap 各层职责与标准目录树。
   - 明确 schema 放置规则（全项目二选一并统一）、port 命名与位置、行为文件（rules / logic / validate）归类规则。

2. **errors 收拢**
   - 将 `domain/agent/agent-errors.ts`、`domain/tool/tool-errors.ts` 迁入 `errors/`，按 config / runtime 分文件命名（与现有 `agent-config-errors.ts` 等对齐）。
   - 更新所有 import 与 `index.ts` export。

3. **schema 位置统一**
   - 消除「schema 在模块根」与「schema 在 `model/`」并存；全项目采用同一规则（以多数 CRUD 模块可扩展性为准，在 spec 阶段定稿）。

4. **domain 模块内部规整**
   - `compaction/`：引入 `model/`，类型与 context DTO 迁入；保留 `action/`、`triggers/`。
   - `worktree/`、`regex/`：根目录散落的行为文件归入约定子目录（如 `logic/` 或按职责分子目录）。
   - `agent/`：根目录行为文件按模板归类（如 `rules/`）；`session/` 保留，文档说明与 `chat/session` 实体区别。
   - `prompt/`、`tool/`：对齐最小模块模板（`model/` + 行为子目录）。

5. **层边界修正（文件树体现）**
   - 将 `service/compaction/token-estimate.ts` 迁至 `domain/compaction/`（或文档认可的 domain 位置）。
   - 消除 domain → service 的错误依赖方向（以迁移后 import 图为准）。

6. **命名微调（仅结构相关）**
   - 统一 `validate-*` 与 `*-validate` 风格；impl 前缀（`default-*` / `sqlite-*` / `db-*`）在 spec 中定一条规则并执行。

7. **公开 API 与引用更新**
   - 更新 `packages/core/src/index.ts` 及 monorepo 内直接 deep import 的调用方路径。
   - 破坏性路径变更须在 PR / 变更说明中列出对照表。

### 不包含范围

- 新业务功能、Agent / Compaction / Chat 等行为逻辑变更。
- 将 SQLite repository 实现从 `domain/*/repositories/impl/` 整体迁至 `infra/`（本期维持现有 pragmatic 布局，仅在文档中说明）。
- Java/Spring 式全面依赖注入 / port 化（如为 `DefaultCompactionAction` 对 `infra/prompt-template` 的引用强行抽象 port）；**domain → infra 自然依赖视为合法，不在本期范围**。
- CLI 新命令、用户可见功能、数据库 schema 变更。
- mobile / RN 专项适配。

## 核心需求（3-7 条）

1. **模块模板文档化**  
   维护者可在一份文档中看到 domain / service 标准树、合法例外及 examples，无需口口相传。

2. **errors 单一入口**  
   包级可捕获错误集中在 `errors/`；domain 内不再保留 `*-errors.ts`（tool / agent runtime 除外已迁出）。

3. **schema 与 model 规则全项目一致**  
   任意 module 的新增 schema 文件位置可预测，不再出现同层两种惯例。

4. **例外模块对齐主流形态**  
   `compaction`、`agent`、`worktree`、`regex`、`prompt`、`tool` 在文件树上与 `chat` / `provider` 等同理可读。

5. **依赖方向与目录一致**  
   domain 模块不得依赖 service；纯函数与估算类工具归属 domain，体现在目录而非仅 comment。

6. **零行为回归**  
   搬迁后测试与类型检查通过；对外 export 能力不减少（路径变更除外且需文档化）。

7. **可审查的验收清单**  
   提供模块对照表，Reviewer 可逐模块勾选是否合规。

## 验收标准

- **Convention 文档**
  - Given 维护者打开本迭代产出的结构规范文档
  - When 对照任意 domain 模块（如 `compaction`、`worktree`）
  - Then 能明确该模块每个子目录的职责，且模块符合模板或文档记录的合法例外

- **errors 收拢**
  - Given 重构完成后的文件树
  - When 在 `packages/core/src/domain` 下搜索 `*-errors.ts`
  - Then 结果为 0 个文件
  - And `errors/` 包含原 `agent-errors`、`tool-errors` 的对外类型与工厂函数
  - And `index.ts` 仍 export 相应错误类型

- **compaction 结构**
  - Given `domain/compaction/`
  - When 查看目录
  - Then 存在 `model/` 且 `compaction-policy.ts` 等核心类型位于其中
  - And `action/`、`triggers/` 保留
  - And 不存在 `service/compaction/token-estimate.ts`（已迁至 domain）

- **worktree / regex 根目录收敛**
  - Given `domain/worktree/` 与 `domain/regex/`
  - When 统计模块根目录下 `.ts` 文件（不含 schema）
  - Then 每个模块根目录仅保留 schema 及文档允许的 port 文件；其余行为文件位于约定子目录

- **schema 统一**
  - Given 全项目 domain 模块列表
  - When 检查所有 `*.schema.ts` 路径
  - Then 100% 符合 spec 选定的一种放置规则（根目录 **或** `model/`，无第三种）

- **依赖方向**
  - Given 静态 import 分析（或 CI 规则 / 人工 grep）
  - When 检查 `domain/**` 对 `service/**` 的 import
  - Then 结果为 0（本迭代引入的违规全部消除）

- **回归**
  - Given 重构分支
  - When 执行 `packages/core` 全量测试及 monorepo typecheck
  - Then 全部通过
  - And 无新增 skipped / todo 测试掩盖失败

- **引用更新**
  - Given monorepo 内所有 `@novel-master/core` 及 deep import 引用
  - When 编译 CLI 与依赖 core 的包
  - Then 无 unresolved module 错误
  - And 变更说明含旧路径 → 新路径对照（若有 breaking deep import）
