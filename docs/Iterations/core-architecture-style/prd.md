---
date: 2026-06-21
dependency:
  - Iterations/core-explore-remediation/readme.md
  - Iterations/core-explore-remediation/features/public-api-boundaries/prd.md
---

# Core 架构与代码风格优化 PRD

## 背景

`core-explore-remediation` 已于 `main` @ `bea00caa` 合入，关闭 17 项 P0/P1 **正确性与可靠性**缺口（`test:fast` 995/995）。Post-merge 验证 CR 显示：**功能主路径已达标**，但 **架构边界、代码风格与 quality-backlog 技术债**仍大量留存。

与本次迭代直接相关的现状：

| 类别 | 现状 | 来源 |
|------|------|------|
| **代码风格** | `hide-message.handler.ts` 逐行空行格式回归；部分模块 JSDoc/注释中英混用；prompt 校验错误语言不一致 | post-merge CR、explore-depth |
| **Public API** | P1 allowlist 守卫已落地；P2 未做：`prompt→config-forms` 仍列 `KNOWN_LEAKS`；`provider` 宽 export；`front-matter` 零消费决策未定 | public-api-boundaries PRD P2/P3 |
| **模块架构债** | prompt 遗留 `PromptBlock` / wire 双份；tool fs 变更逻辑三处重复；regex update depth 与 create 不同源；events-config KKV 裸 `JSON.parse` | quality-backlog explore ×6 |
| **跨切面** | orchestrator 冗余 deps；KKV 损坏处理跨模块不一致；tokenizer Desktop 回退路径偏离主路径 | post-merge CR |

用户确认：**本迭代聚焦架构与代码风格**（非新一轮正确性 P0）；**单波次交付**；**硬破坏可接受**（可拆 public 子入口、改部分 API 签名，须 migration 说明）；改动范围 **packages/core + CLI/Desktop/Mobile**（import 同步迁移 + 构建验证）。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 统一代码风格与可读性 | 消除已知格式回归（hide-message handler 等）；新增/修改公开 API 注释语言策略一致（团队约定见 SPEC） |
| 收敛 Public API 边界 | `KNOWN_LEAKS` 清零或仅剩有明确迁移截止日的条目；canonical 路径文档与实现一致；allowlist 快照更新并通过 CI |
| 降低模块内架构债 | quality-backlog 六域中 **至少 4 域** 核心债项关闭（见核心需求）；无新增重复 export 路径 |
| 硬破坏可控迁移 | 提供 migration 摘要（路径对照表）；monorepo **CLI + Desktop + Mobile** `build` 通过 |
| 回归安全 | `packages/core` `npm run test:fast` 0 failures；涉及 apps 改动的模块有对应 smoke/build 验证 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Core 维护者 | 重构 domain/service 时边界清晰、无 triple-copy 逻辑；public 面无隐式 config-forms 泄漏 |
| CLI / Desktop / Mobile 开发者 | 按 canonical 路径 import；deprecated 路径有 IDE/JSDoc 提示 |
| 代码审查者 | diff 无无意义格式噪音；模块职责与分层一致 |
| 发布负责人 | public API 变更可对照 migration 与 allowlist 快照 |

## 范围

### 包含范围

**A. 代码风格卫生**

- 修复 `hide-message.handler.ts` 及同类格式回归（恢复紧凑换行、无逻辑变更）
- 统一 **公开 API** 文档注释语言策略（与 SPEC 约定一致）
- 清理确认无引用的 dead code（如 prompt 遗留 `PromptBlock` 导出链，须 grep + 测试证明）
- orchestrator / event 模块冗余 deps、死字段清理（行为不变或文档化 intentional）

**B. Public API P2/P3（public-api-boundaries 延续）**

- `public/prompt`：config-forms re-export 标注 `@deprecated` 或迁出；消费方改 canonical `@novel-master/core/config-forms/agent`
- `front-matter`：基于 monorepo 消费扫描做 **移除 export 或保留+文档** 决策并落地
- `provider` 宽 export：拆分或收窄（如 llm-protocol / tokenizer 注册 canonical 到 `./nmtp`）；**允许**新增/调整子入口
- 更新 `packages/core/docs/public-api.md` 与 allowlist 快照
- **同步修改** `apps/cli`、`apps/desktop`、`apps/mobile` 中受影响的 import

**C. quality-backlog 架构债（模块级 refactor）**

优先关闭下列 **核心债**（实现细节见后续 SPEC，本 PRD 只列业务意图）：

| 域 | 核心债（须关闭） |
|----|------------------|
| **prompt** | wire 序列化单源；遗留 flat-block 模型隔离或删除；`public/prompt` 与 config-forms 解耦 |
| **tool** | fs 变更路径解析抽取为共享 logic，消除 tool-runner / fs-command / mutates-workspace 三处重复 |
| **regex** | update/create depth normalize 同源（消除 kebab-case update 静默 no-op） |
| **events-config** | 损坏 KKV 读取 fail-fast，对齐 compaction-conditions 错误语义 |
| **tokenizer** | Desktop token 回退路径与 `serializePromptLlmInput` 对齐（apps + core 交界） |
| **tdbc-sql-template** | `${}` 误用 CI/lint 禁令或等价 guard（安全类架构约束） |

**D. 交付形态**

- **单分支、单波次** PR 合入 `main`
- 附带 **Migration 摘要**（旧 import → 新 import；删除的 export 列表）

### 不包含范围

- 新一轮 **正确性 P0**（如 chat-vfs `head_version` 精确回滚、flush capture 失败 UX）——除非 refactor 自然顺带修复且零额外 scope
- **quality-backlog** 中纯性能项（compaction token 缓存、SqlTemplateParser AST 缓存、regex identity 微优化）——可记录 follow-up
- **bootstrap DDL / FK 引入**、**chat_grep ReDoS 超时**（独立安全迭代）
- **UI 产品行为**（events `endDepth` 只读展示、template pull markDirty）——属产品迭代
- **Web 端**、**Electron 打包脚本**、**CI 流水线**结构性改造（除 lint 规则新增）
- 本 PRD **不包含**接口设计、库表、任务拆分——由 `design-proposal` SPEC 承接

## 核心需求

1. **风格基线恢复：** 消除 post-merge CR 已识别的格式回归；公开 API 注释策略统一；无「仅 diff 噪音」的提交块。
2. **Public API 硬收敛：** 完成 public-api-boundaries P2/P3 中 **prompt 泄漏、front-matter 决策、provider 宽 export** 的落地；`KNOWN_LEAKS` 不再包含 `prompt.ts`（或仅剩有截止日的过渡项）。
3. **Canonical import 迁移：** CLI、Desktop、Mobile 全部改用文档约定的 canonical 路径；deprecated re-export 保留 **至多一个** minor 周期（SPEC 定具体版本策略）。
4. **Prompt 架构单源：** agent wire 序列化与校验辅助函数 **单一实现源**；遗留 PromptBlock 面无生产引用。
5. **Tool 路径解析单源：** mutating path / fs command path 解析 **一处 logic**，三处调用方改为 import。
6. **Regex depth 一致性：** update 与 create 共享 depth normalize，**UI/API 更新 kebab-case depth 不再静默失败**。
7. **KKV 读取语义一致：** events-config（及 SPEC 列出的同类 store）损坏 JSON 抛出结构化错误，**禁止**裸 `JSON.parse` 未捕获上抛。
8. **Migration 可执行：** 提供路径对照与 breaking 清单；reviewer 可据此验证 apps 改动完整。

## 验收标准

### 构建与测试

- **T1** Given `main` 合入本迭代分支，When 在 repo 根执行 `npm run build -w @novel-master/core` 且 `cd packages/core && npm run test:fast`，Then 退出码 0，0 failures。
- **T2** Given apps 改动范围，When 分别执行 CLI / Desktop / Mobile 项目约定 build 命令（SPEC 列明），Then 退出码 0。

### 代码风格

- **T3** Given `hide-message.handler.ts`，When `git diff` 对比合入前，Then 无逐行空行格式回归；逻辑与合入前行为一致（既有 handler 测试全绿）。
- **T4** Given 本迭代新增或修改的 **公开 export**，When 审查 JSDoc/注释，Then 符合 SPEC 语言策略（无乱码 mojibake）。

### Public API

- **T5** Given `test/package-exports/public-no-config-forms.test.ts`，When 运行 fast 套件，Then `KNOWN_LEAKS` 为空或不包含 `prompt.ts`。
- **T6** Given `packages/core/docs/public-api.md`，When 对照 `package.json` exports 与 allowlist 快照，Then 子入口列表、canonical 表、deprecated 表 **三者一致**。
- **T7** Given monorepo grep 针对已删除 export 符号，When 在 `apps/` 下搜索，Then 0 处引用旧路径（deprecated 过渡路径除外且须有过渡说明）。

### 架构债（quality-backlog）

- **T8** Given regex rule **update** 请求含 kebab-case depth 字段，When 经 schema 校验路径，Then 与 create 路径等价 normalize，**不得**静默 no-op。
- **T9** Given tool 并行 mutating 路径解析，When 比较 tool-runner / fs-command / shared logic，Then 三处调用 **同一** domain logic 模块（无复制粘贴分支）。
- **T10** Given prompt wire 序列化入口，When grep `persistBlockToWire` / 等价函数，Then 仅 **一处** canonical 实现，其余为 re-export 或删除。
- **T11** Given events-config store 中损坏 JSON，When `getConfig()`，Then 抛出 **结构化**配置错误（非裸 SyntaxError 冒泡）；有对应单测。
- **T12** Given Desktop token 回退路径（若本迭代触及），When 与 CLI compaction 路径对比，Then 使用同一 `serializePromptLlmInput`（或 SPEC 定义的等价入口）。

### Migration

- **T13** Given 本迭代 PR 描述或 `Migration` 小节，When reviewer 对照 apps import diff，Then 每条 breaking 变更均有 **旧→新** 路径说明。

## 约束与依赖

| 项 | 说明 |
|----|------|
| 前置 | `core-explore-remediation` 已合 `main` |
| 相关 PRD | `public-api-boundaries` P2/P3 为本迭代 B 部分延续 |
| 硬破坏 | 允许拆 public 子入口、改签名；**必须** apps 同步 + migration 文档 |
| 单波次 | 不分 phase PR；内部 commit 可按逻辑块拆分 |
| SPEC | 本 PRD 确认后进入 `design-proposal` 产出 `spec.md` 与任务 DAG |

## 风险与待确认项

| 风险 | 缓解 |
|------|------|
| 单 PR 体量过大、审查困难 | 按模块分 commit；SPEC 提供 file-level 变更清单 |
| 硬破坏遗漏 apps 引用 | T7 + monorepo build 门禁 |
| prompt/tool 重构引入行为回归 | 保留/扩展既有单测；禁止删除无替代覆盖的测试 |
| front-matter 移除影响未知消费方 | 合入前全 repo grep；若有 mobile 消费则改 canonical 路径而非直接删 |

## 里程碑（可选）

| 阶段 | 内容 | 产出 |
|------|------|------|
| 1 | 用户确认 PRD | 本文档 |
| 2 | design-proposal | `spec.md` + 文件级变更计划 |
| 3 | 单分支实现 | core + apps + migration |
| 4 | CR + merge | `main` 全绿 |
