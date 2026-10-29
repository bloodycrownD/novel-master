---
date: 2026-10-29
---

# config-forms 迁出 core（表单层两端本地化，stored-config-validity 留守）技术规格（SPEC）

## 设计目标

把 `packages/core/src/config-forms` 拆解迁移：

- **表单层**（agent 编辑器状态变换、工具目录、tab 匹配、显示名分配、UI 文案）从 core 迁出，**mobile 与 desktop 各持一份本地副本**，接受冗余、接受两端独立演化——这是用户明确的取向：UI 层双端拆分优于跨端共享。
- **stored-config-validity**（落库配置健康判定：zod 解码评估、失效码、schema 版本常量）**留在 core**，判定逻辑单源，避免同一份落库数据两端判定漂移；仅位置从 `config-forms/` 挪到 `domain/agent/stored-config-validity/`，子路径改为 `@novel-master/core/stored-config-validity`。
- 顺带清死代码：`shared/application-model-id.ts`（零生产消费者）、`shared/depth-slice.ts`（纯转发、零该路径消费者）、mobile jest / core tsconfig.test 里的 dangling `config-forms/events` 映射。

**需求来源**：用户口述（2026-10-29）——「配置表单希望从 core 移除，迁移到 mobile 与 desktop；之前复用是为了统一和简化，但实际 UI 层 desktop 和 mobile 最好拆分开，可以接受冗余的两份代码」。范围分叉（stored-config-validity 去留）已由用户单问拍板：**留 core**。

## 总体方案

config-forms 是「表单状态 ↔ 领域模型」翻译层 + 硬编码中文文案，**不自包含**：它依赖 core 的 domain 符号（`AgentDefinition`、prompt layout 校验/归一、`isSavedModelUuidFormat` 等）。因此：

1. 迁出后的两端副本仍从 **core 公开子路径** import domain 依赖；缺口的 3 个符号先补进 `public/prompt.ts`（见 Step 1）。
2. 副本落位：
   - mobile：`apps/mobile/src/config-forms/`，import 走 `@/config-forms/*`（tsconfig paths + jest mapper `^@/(.*)$` + Metro `resolveMobilePathAlias` 三链路均已存在，零登记）。
   - desktop：`apps/desktop/shared/config-forms/`（与 `shared/logic` 平级）。**不能放 `shared/logic`**——X1 结构测试（`apps/desktop/test/shared-logic-x1.test.ts`）断言 `shared/logic` 里指向 core 的语句只允许 `export`（再导出），出现 `import` 即红。新目录被自动覆盖：renderer 侧 `tsconfig.renderer.json` 的 `@shared/*` paths + `vite.config.ts` 的 `@shared` 前缀别名 + 主进程 `tsconfig.json` 的 `include: ["src/main/**/*", "shared/**/*"]` glob，均无需登记。
3. core 侧删除 `src/config-forms` 全目录，`stored-config-validity` 整体（types / labels / assess / build-default，含 base `AGENT_LIST_LABELS`）迁 `domain/agent/stored-config-validity/`，`package.json` exports 删 4 条 config-forms 子路径、增 `./stored-config-validity`。
4. 双端副本为**逐字迁移**（含测试），允许后续各自演化；本次不做子集裁剪（两端全量持有，便于 diff 对照）。

## 最终项目结构

```
packages/core/src/
  domain/agent/stored-config-validity/     # 迁入：types.ts labels.ts assess-agent-definition-wire.ts build-default-agent-definition.ts index.ts
  public/prompt.ts                          # 补导出：normalizeAgentPromptLayoutDomain / DEFAULT_SKILLS_INDEX_PREFIX / layoutHasCustomAttach
  config-forms/                             # 整目录删除
apps/mobile/src/
  config-forms/                             # 新：agent-editor-state.ts agent-tool-catalog.ts agent-mode-tab.ts allocate-agent-display-name.ts ui-labels.ts index.ts（内部相对导入 extensionless）
apps/desktop/shared/
  config-forms/                             # 新：同五文件 + index.ts（内部相对导入保留 .js 后缀，满足主进程 NodeNext）
  logic/config-forms-{agent,shared,stored-config-validity}.ts   # 三个转发壳删除
```

## 变更点清单

### core
| 文件 | 动作 |
|---|---|
| `src/public/prompt.ts` | 增 `normalizeAgentPromptLayoutDomain`、`DEFAULT_SKILLS_INDEX_PREFIX`、`layoutHasCustomAttach` 三条再导出 |
| `src/config-forms/**` | 删除（stored-config-validity 迁走，其余消亡） |
| `src/domain/agent/stored-config-validity/**` | 新建（自 config-forms 迁入；`labels.ts` 并入 base `AGENT_LIST_LABELS`，原 `shared/ui-labels.ts` 的 `API_KEY_STATUS_LABELS` 随表单层去两端副本，不留在 core） |
| `package.json` | exports：删 `./config-forms`、`./config-forms/agent`、`./config-forms/shared`、`./config-forms/stored-config-validity`；增 `./stored-config-validity`（types/import 指 dist/domain/agent/stored-config-validity/index） |
| `tsconfig.test.json` | 同步子路径映射：删 4+1（含 dangling events），增 1 |
| `test/config-forms/**` | `stored-config-validity.test.ts` 改 import 新路径留 core；`agent-editor-state` / `agent-tool-catalog` / `agent-mode-tab` / `allocate-agent-display-name` 四个测试文件随表单层迁两端（core 删除）；`ui-labels.test.ts`（断言根 barrel 再导出身份）拆解消亡——`API_KEY_STATUS_LABELS` 断言迁两端副本测试，base `AGENT_LIST_LABELS` 断言并入 stored-config-validity 测试 |
| `test/prompt/workplace-layout-c0.test.ts`、`test/prompt/normalize-agent-prompt-layout.test.ts` | import 源路径 `../../src/config-forms/...` → `../../src/domain/agent/stored-config-validity/index.js` |
| `test/package-exports/public-no-config-forms.test.ts` | 保留 public/* 禁 import 断言；**新增**「`src/config-forms` 目录不存在」断言（防复活） |
| `test/package-exports/duplicate-export-consistency.test.ts` | `cfShared`（config-forms/shared）引用改为直接对 `../../src/domain/depth/logic/depth-slice.js` 源断言 |

### mobile
| 文件 | 动作 |
|---|---|
| `src/config-forms/**` | 新建五文件 + index（依赖改 `@novel-master/core/{agent,prompt,provider}`；内部相对导入 extensionless，从众 mobile 现状） |
| 12 个 src 文件（agent 编辑器族、AgentsSettingsScreen、ApiKeyStatusTag、agent-create 等） | `@novel-master/core/config-forms/agent|shared` → `@/config-forms/agent|ui-labels`；`.../stored-config-validity` → `@novel-master/core/stored-config-validity` |
| `jest.config.js` | moduleNameMapper：删 `config-forms` 根/agent/shared/stored 4 条 + dangling events 条；增 `^@novel-master/core/stored-config-validity$` → dist 新路径 |
| `__tests__/` | 新增 4 个表单层测试（jest 语法转译，`node:assert` 保留）；`mobile-prompt-token-counter.test.ts` 里 `parseApplicationModelId` 的 inline jest.mock 清理（符号已删） |
| `__tests__/agent-editor-form-delete-confirm.test.ts` 等 4 个既有测试 | `.../stored-config-validity` specifier 同步 |

### desktop
| 文件 | 动作 |
|---|---|
| `shared/config-forms/**` | 新建五文件 + index（依赖改 `@novel-master/core/{agent,prompt,provider}`；内部相对导入保留 `.js` 后缀） |
| `shared/logic/config-forms-{agent,shared,stored-config-validity}.ts` | 三个转发壳删除 |
| renderer 5 文件（AgentEditorView / AgentWorkplaceBlockCard / SettingsViews / ToolPolicyPicker / settings-ui） | `@shared/logic/config-forms-*` → `@shared/config-forms/{agent,ui-labels}`；stored 部分改 `@shared/logic` 之外的既有通道——stored 留 core，renderer 侧继续经 `shared/logic` 新壳或直接改从 `@shared/config-forms` 不可行，**维持一个薄壳 `shared/logic/stored-config-validity.ts` 再导出 core 新子路径**（X1 合法：export-only） |
| `src/main/ipc/handlers/agent-registry.ts`、`stored-config-health-dto.ts` | `@novel-master/core/config-forms/agent` → `../../../../shared/config-forms/agent.js`（相对路径先例：`shared/ipc-types.js`）；`.../stored-config-validity` → `@novel-master/core/stored-config-validity` |
| 3 个 test 文件 | import specifier 同步；新增 4 个表单层 node:test 副本 |

> desktop stored 说明：`buildDefaultAgentDefinitionPreservingName`、`STORED_CONFIG_LABELS`、`storedConfigInvalidReason`、`AGENT_LIST_LABELS`、`assessAgentDefinitionWire`、`StoredConfigHealth` 全部继续来自 core 新子路径；renderer 侧仅换壳指向，行为零变化。

## 详细实现步骤

分支：`feat/config-forms-migration`（自 main 切出）。提交序列与各 commit 门禁范围：

- Step 1 — phase-core-prep — blocking: yes — qa: auto：`public/prompt.ts` 补 3 导出；core typecheck + `test/package-exports/` 快照更新后全绿。
- Step 2 — phase-core-move — blocking: yes — qa: auto：stored-config-validity 迁 `domain/agent/`；删 `src/config-forms` 全目录；package.json / tsconfig.test 同步；core 测试改造（清单见上）+ 删 tsbuildinfo 全量重建 dist（教训：clean 不清 tsbuildinfo 会静默半构建）。**此 commit 后 apps 暂时编译红，属预期中间态**；门禁只跑 core 套件。
- Step 3 — phase-mobile-copy — blocking: yes — qa: auto：`src/config-forms/` 落盘；12 个 src 文件 + 4 个既有测试改 specifier；jest mapper 换血；4 个测试文件 jest 转译落 `__tests__/`；mobile 两套 tsc + 相关 jest 套件绿。
- Step 4 — phase-desktop-copy — blocking: yes — qa: auto：`shared/config-forms/` 落盘；删 3 壳、新建 1 个 stored 薄壳；renderer 5 文件 + main 2 文件 + 3 个测试改 specifier；4 个 node:test 副本；`npm run lint`（X1）+ typecheck + 654 套件 + **vite build 实证 `.js` 后缀相对导入在 renderer 打包可解析**。
- Step 5 — phase-gates — blocking: yes — qa: auto：分支头全量——core 全套（豁免 2 条既存红：T-S5 DST、C2-3 copy）、desktop 全套、mobile 全套 jest（豁免 7 条既存 presentation dist 红）+ 两套 tsc + `build:webview`（确认 webview bundle 无 config-forms 拉入——探索证实 allowlist 本就不含它，跑构建即守卫）。
- Step 6 — phase-docs — blocking: no — qa: auto：`packages/core/docs/public-api.md` 的 config-forms 行改 stored-config-validity；`docs/apm/memory/20260928-subagent-stream-config-brainstorm.md` 的「agent 字段四处改」规则更新为「mobile/desktop 两副本各改一处 + core schema 一处」；CHANGELOG `[Unreleased]` 一条。
- Step 7 — phase-device — blocking: no — qa: manual_user：desktop 打包冒烟（agent 编辑器开合、表单回填、工具选择器 11 项）；mobile 真机 agent 编辑器表单回放 + 失效配置卡片文案。合并后用户验收。

## 测试策略

复用 core 既有 1370 行表单层测试作为**行为等价基准**：同一批用例在两端副本各跑一遍（desktop 沿 node:test 原文；mobile 转 jest），断言逐字保留——迁移是搬运不是重写，任何差异即红。

### 测试用例

- T-CF1 — blocking: yes — core：`@novel-master/core/prompt` 可 import 三新符号（public 快照测试），映射 Step 1。
- T-CF2 — blocking: yes — core：`src/config-forms` 目录不存在断言红绿可变（守卫测试删除目录后绿、手工建目录后红），映射 Step 2。
- T-CF3 — blocking: yes — core：`@novel-master/core/stored-config-validity` 子路径解析 + assess/labels 行为（原 stored-config-validity.test 迁径），映射 Step 2/5。
- T-CF4 — blocking: yes — mobile：`@/config-forms/agent` 在 tsc 与 jest 双链路解析且 4 个转译测试全绿，映射 Step 3。
- T-CF5 — blocking: yes — desktop：renderer `@shared/config-forms/*` 类型可解析 + vite build 产物含副本代码 + X1 lint/结构测试全绿，映射 Step 4。
- T-CF6 — blocking: yes — 两端：agent-editor-state 全量行为用例（原 core 1190 行套）各自全绿，映射 Step 3/4。
- T-CF7 — blocking: yes — 全仓：grep 断言 `config-forms` 零残留（src/jest mapper/tsconfig.test/package.json/allowlist），映射 Step 5。
- T-CF8 — blocking: no — qa: manual_user — 双端 UI 冒烟（Step 7）。

## 兼容性与迁移说明

- **无运行时行为变化**：所有变换函数逐字迁移；两端副本与 core 留守件的外部行为与迁移前一致。
- **import 面变化**（编译期）：`@novel-master/core/config-forms/*` 消费方共 mobile 12 src + 4 test、desktop 2 main + 3 薄壳 + 3 test，全部在本迭代改写；无第三方消费者。
- **落库兼容**：stored-config-validity 位置移动不改判定与版本常量；`CURRENT_AGENT_SCHEMA_VERSION=1`、`CURRENT_EVENTS_SCHEMA_VERSION=2` 原值随行。
- **git blame**：表单层文件历史断线（`git log --follow` 可续），与 core/common 归并同款已知代价。

## 风险与回滚方案

| 风险 | 缓解 |
|---|---|
| vite 对 `shared/config-forms` 内 `.js` 后缀相对导入的解析（TS importer 约定）未在本仓实证 | Step 4 门禁显式跑 vite build；不通则 fallback：副本内部导入改 extensionless + 主进程 `tsconfig.json` 对 shared 开 `rewriteRelativeImportExtensions`（TS 5.7+，仅重写产物不动源码） |
| core-move commit 后、两端改写前的中间态 apps 红 | 分支内连续提交，Step 5 在分支头收口全量门禁；不合并到 main 直到全绿 |
| 双副本漂移（已接受成本） | Step 6 更新 memory 规则；后续两端可各自演化，需要对照时 diff 两目录 |
| `application-model-id` 删除波及 mobile-prompt-token-counter.test 的 inline mock | Step 3 同步清理该 mock；该符号零生产消费者已由探索证实 |
| webview bundle 误拉 config-forms | 探索证实 allowlist 从未含它且 webview 无此依赖；Step 5 跑 `build:webview` 守卫 |

回滚：整个迁移在独立分支按 commit 序列提交，任何一步不可收口即 `git revert` 对应 commit；core 子路径恢复（还原 package.json + 目录）即回到迁移前状态，无数据迁移、无存储格式变化。
