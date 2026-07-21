---
date: 2026-07-21
---

# 剩余大债收敛（X1 / X2 / E2）技术规格（SPEC）

## 设计目标

落实 `Iterations/post-1.3.14-large-debt-remediation/prd.md`：

1. Desktop **renderer** 源码零 `@novel-master/core*`（含纯函数/类型/文案）；eslint 门禁挡回归。
2. X2 四处高 ROI 纯逻辑单源于 **core**（样板：`resolveComposerSendIntent`）；双端只留壳。
3. E2：既有直读可渐进；**新** CT `ui` 组件禁止值导入 `state`。初始 allowlist = `{StreamTail, RowList, MessageRow}`；门禁拦白名单外新直读；Step 21 可 props 化并缩小白名单（不挡 X1 门禁）。
4. 行为零回归；不新建独立 shared npm 包（除非后续证明 re-export 不可接受）。

**需求来源**：`requirement_path = Iterations/post-1.3.14-large-debt-remediation/prd.md`  
**前置**：`post-1.3.14-code-review`（债清单）、`desktop-app`（禁 renderer→core）、`implementation-simplification`（必要 IPC hop）。

## 总体方案

### 架构原则

| 原则 | 定案 |
|------|------|
| 纯逻辑单源 | 继续放在 `@novel-master/core`（`domain/chat/logic/*` + `public/chat` 等） |
| Mobile | **维持**直连 `@novel-master/core/*`（PRD 不改） |
| Desktop renderer | **禁止**字面 `from '@novel-master/core'` / `from '@novel-master/core/…'`；经 `apps/desktop/shared/logic/*`（或 `shared/chat.ts` 等）**具名薄再导出**消费 |
| shared 再导出纪律 | **禁止** `export * from '@novel-master/core…'`；仅 allowlist 具名导出；**禁止** service 工厂 / DB / runtime 进 shared |
| 门禁粒度 | eslint `no-restricted-imports` **仅** `renderer/**/*.{ts,tsx}`；patterns 钉死 `@novel-master/core` 与 `@novel-master/core/*`。main/IPC 测**允许**直连 core；renderer 向测改 `@shared` 或另列 glob，**勿**把整个 `test/**` 与 renderer 同禁 |
| assess | **废止** renderer 本地 `assess*Wire` / `resolveAgentDefinitionFromStorage`；main IPC 返回已评估 discriminated union；去掉 ipc-types「供 renderer assess」注释 |
| 假扁平化 | 禁止把 SQLite/service 工厂塞进 renderer 或 `@shared` |

### X1×X2 顺序（必须同迭代）

```text
phase-x2-*（单点进 core + Mobile 改接线）
  → phase-x1-shared-export（Desktop @shared 再导出面）
  → phase-x1-migrate-renderer（34 文件改 import；Settings assess→IPC）
  → phase-x1-eslint-gate（开启禁令；契约测）
  → phase-e2-*（纪律 + 可选 props；不挡上一门禁）
```

若先开 eslint 再迁出 → 全红。若先禁直连却无 `@shared` 出口 → Desktop 易再抄一份，X2 回潮。

### stored-config-validity 张力

旧 SPEC 允许 renderer `assess`；本迭代 **关闭例外**：`AgentEditorView` / `ProjectAgentConfigView` / `EventsConfigView` / `SettingsViews` 改为消费 IPC 已评估结果（agent-registry list 路径已有样板；**agent get / projects getAgentConfig / events get** 补齐 assessed DTO）。

### Assess IPC DTO（钉死）

与 core `StoredConfigHealth<T>` + 既有 `StoredConfigInvalidDto` 对齐；`value` 为可 IPC 序列化的 **plain object**（禁 class / Map / 函数 / 含不可克隆句柄）。

```ts
/** ipc-types：与 StoredConfigHealth 同构的 discriminated union */
export type StoredConfigHealthDto<TValue extends object> =
  | { readonly status: 'valid'; readonly value: TValue }
  | ({ readonly status: 'invalid' } & StoredConfigInvalidDto);
// StoredConfigInvalidDto = { code; message; storedSchemaVersion? }
```

覆盖通道（均返回上述 union，不再只回 raw `wire` 供 renderer assess）：

| 通道 | 响应形 |
|------|--------|
| `agent-registry` get（必要时 list 已有 `invalid` 保持兼容） | `StoredConfigHealthDto<AgentDefinitionPlain>`（字段名可用 `health` 包裹或顶层 status——实现时与 invoke 一致，但 **必须**含 `status`/`value`/`invalid` 信息） |
| `projects/getAgentConfig`（必要时 `updateAgentConfig` 回读同形） | `mode` + custom 时附 assessed `definition` health（`value`/`invalid`/`health` 齐全） |
| `events-config` get | assessed `StoredConfigHealthDto<EventsConfigPlain>`（废止「仅 wire + 供 renderer assess」） |

Renderer **不得**再调用 `assessAgentDefinitionWire` / `assessEventsConfigWire` / `resolveAgentDefinitionFromStorage`。

## 最终项目结构

```text
packages/core/src/domain/chat/logic/
  composer-send-intent.ts          # 已有
  composer-chip-attachment.ts      # NEW：isComposerStatusAttachment / partition*
  composer-at-path.ts              # NEW：共享纯函数（无 mention）
  chat-annotate-draft-store.ts     # NEW：进程内 session Map API
  annotate-highlight.ts            # NEW：group/parse/sort/findAllOccurrences
packages/core/src/public/chat.ts   # 再导出上列

apps/desktop/shared/logic/         # NEW：具名薄 re-export（禁止 export *；无业务复制；无 service 工厂）
  chat.ts / agent.ts / prompt.ts / provider.ts / workplace.ts
  vfs.ts / format.ts / events.ts / config-forms-*.ts / root.ts
apps/desktop/shared/ipc-types.ts   # StoredConfigHealthDto；agent/projects/events get 对齐；删「供 renderer assess」
apps/desktop/src/main/ipc/handlers/
  agent-registry.ts / projects.ts / events-config-handlers.ts  # assess 后返回 DTO
apps/desktop/renderer/**           # 改从 @shared/logic 或 @shared/ipc-types 导入
apps/desktop/eslint.config.mjs     # 仅 renderer/**/*.{ts,tsx} 禁 @novel-master/core 与 @novel-master/core/*

apps/mobile/...                    # store/at-path/chips/highlight 改调 core；mention/DOM 壳本地
apps/mobile/.../ui/                # E2 初始 allowlist: StreamTail / RowList / MessageRow
scripts/check-renderer-no-core.mjs # 可选契约门禁（与 eslint 二选一或并存）
scripts/check-ct-ui-no-state.mjs   # E2：白名单外禁值导入 state
```

更新 `annotate-draft.schema.ts` 注释：允许 **进程内** store API；仍禁止写入 `composer_draft_json`。

### `@shared/logic` 再导出 allowlist（按 renderer 现有 import）

禁止 `export * from '@novel-master/core…'`。下列为 **可**具名转发的子路径/符号集合（实现可按文件拆分；新增符号须先扩本表）：

| 源（core） | 代表性符号（非穷尽实现清单，以迁出时 rg 为准） |
|------------|--------------------------------------------------|
| `@novel-master/core`（root） | `resolveToolResultOk` 等 **纯函数**；禁 service/runtime |
| `@novel-master/core/chat` | chip/at-path/annotate/send-intent/transcript/rollback 等纯函数与类型 |
| `@novel-master/core/agent` | `shouldApplyTranscriptReload` 等纯函数；类型改走 ipc-types 优先 |
| `@novel-master/core/prompt` | `ALLOWED_DYNAMIC_ROOT_MACROS` 等常量 |
| `@novel-master/core/provider` | `mergeSamplingWithDefaults` 等 |
| `@novel-master/core/workplace` | `DEFAULT_WORKPLACE_DIR_RULE`、树标签纯函数 |
| `@novel-master/core/vfs` | `formatVfsErrorForUser` 等 |
| `@novel-master/core/format` | `deriveRegexGroupId`、stream metrics 纯函数 |
| `@novel-master/core/events` | 事件配置相关 **类型/常量**（经 shared；运行时 decode 不进 renderer） |
| `@novel-master/core/config-forms/agent` | 表单状态机/目录/文案常量（`BUILTIN_TOOL_CATALOG`、`PROMPT_REGION_LABELS` 等） |
| `@novel-master/core/config-forms/events` | `matchDepth` / `validateDepthSlice` / 表单 helpers（非 assess） |
| `@novel-master/core/config-forms/shared` | `REGEX_UI_LABELS`、`API_KEY_STATUS_LABELS`、`SESSION_FS_LABELS` |
| `@novel-master/core/config-forms/stored-config-validity` | **仅**仍需的 labels / `buildDefaultAgentDefinitionPreservingName` 等非 assess 出口；**禁止**再导出 `assess*Wire` / `resolveAgentDefinitionFromStorage` 给 renderer |

**明确禁止进 shared**：任何 `*Service` / `create*` runtime 工厂、SQLite/DB、agent runner、KKV 读写。

## 变更点清单

| 区域 | 变更 |
|------|------|
| Core X2 | 新增 4 logic 模块 + public 导出 + 单测；schema 注释 |
| Mobile X2 | 删重复实现，改 import core；拆 `composer-at-path-mention.ts` |
| Desktop shared | `shared/logic/*` **具名** re-export（allowlist）；ipc-types `StoredConfigHealthDto`；handlers assess |
| Desktop renderer | ~34 文件改 import；renderer 向测改 `@shared`（或单列 glob） |
| Desktop eslint | `no-restricted-imports` **仅** `renderer/**/*.{ts,tsx}`；patterns=`@novel-master/core`、`@novel-master/core/*` |
| E2 | 初始 allowlist `{StreamTail,RowList,MessageRow}`；门禁拦白名单外新直读；可选渐进 props 缩小白名单 |
| 文档 | `desktop-app` / `ipc-hop-rationale`：「禁一切」对齐本 SPEC |

## 详细实现步骤

### phase-x2-chips — blocking: yes — qa: auto

- Step 1 — phase-x2-chips — blocking: yes — qa: auto：新增 `composer-chip-attachment.ts`（structural `{source, action?}`），导出 `isComposerStatusAttachment` / `partitionComposerChipAttachments`；`public/chat` 导出；core 单测从双端 chips 测迁并。
- Step 2 — phase-x2-chips — blocking: yes — qa: auto：Desktop/Mobile `AttachmentDraftChips` + Desktop `rollback-composer` 改调单点；删本地判定副本。

### phase-x2-at-path — blocking: yes — qa: auto

- Step 3 — phase-x2-at-path — blocking: yes — qa: auto：新增 core `composer-at-path.ts`（`formatComposerAtPathToken` / `findActiveAtQuery` / `replaceActiveAtWithToken` / `filterAtPathTypeaheadCandidates` / `atPathTokensFromPickerSelection` / `countScannedAtPathAttachments`）。
- Step 4 — phase-x2-at-path — blocking: yes — qa: auto：双端共享段改调 core；Mobile mention 专属迁 `composer-at-path-mention.ts`（禁止进 core）。

### phase-x2-annotate-store — blocking: yes — qa: auto

- Step 5 — phase-x2-annotate-store — blocking: yes — qa: auto：新增 `chat-annotate-draft-store.ts`（现双端 API 全集）；chip 投影返回 domain `MessageAttachment`；更新 schema 注释。
- Step 6 — phase-x2-annotate-store — blocking: yes — qa: auto：Desktop/Mobile 改调；Desktop 壳层映射 Dto；主测迁 core；双端留薄接线烟测。

### phase-x2-highlight — blocking: yes — qa: auto

- Step 7 — phase-x2-highlight — blocking: yes — qa: auto：新增 `annotate-highlight.ts`（`groupAnnotateIdsByOriginalText` 采 Mobile 更严空 id 规则、`parseAnnotateIdsAttr`、`sortAnnotateTextsLongestFirst`、`findAllOccurrences`）。
- Step 8 — phase-x2-highlight — blocking: yes — qa: auto：`preview-annotate` / `annotate-marks` 的 `apply*` wrap 留壳；纯算法改调 core；补 core 测。

### phase-x1-shared-export — blocking: yes — qa: auto

- Step 9 — phase-x1-shared-export — blocking: yes — qa: auto：建立 `apps/desktop/shared/logic/*`，按上表 allowlist **具名**再导出 X2+既有 chat/agent/format/workplace/prompt/provider/vfs/config-forms/root（`resolveToolResultOk`）纯函数与常量；**禁止** `export *`；**禁止** service 工厂。
- Step 10 — phase-x1-shared-export — blocking: yes — qa: auto：类型优先用 `ipc-types` DTO / 既有生成镜像；避免 renderer type-only 直连 core。

### phase-x1-assess-ipc — blocking: yes — qa: auto

- Step 11 — phase-x1-assess-ipc — blocking: yes — qa: auto：
  - `agent-registry` get（及必要 list）返回 assessed `value` + `invalid`/`health`（`StoredConfigHealthDto`）；
  - **`projects/getAgentConfig`**（必要时 **`projects/updateAgentConfig` 回读同形**）返回 assessed `value`/`invalid`/`health`；
  - `events-config` get 附 assessed health；
  - 更新 invoke/client/`ipc-types`（删「供 renderer assess」注释）。
- Step 12 — phase-x1-assess-ipc — blocking: yes — qa: auto：
  - 四处 Settings 视图删除 `assess*Wire` / **`resolveAgentDefinitionFromStorage`**（含 **`ProjectAgentConfigView`**）直连；改消费 IPC；
  - 文案/默认模板常量经 `@shared/logic`；
  - **Events 恢复默认定案**：`restoreDefaultAndSave` / `clearAndSaveDefault` 在 set（或 clear+set）成功后 **重新 `events get`**，用 IPC 返回的 health 更新 UI；**禁止**本地 `assessEventsConfigWire(DEFAULT_EVENTS_CONFIG)`。

### phase-x1-migrate-renderer — blocking: yes — qa: auto

- Step 13 — phase-x1-migrate-renderer — blocking: yes — qa: auto：迁完 Chat/hooks/workspace/Preview 共 ~20 文件 import → `@shared/logic` / `@shared`。
- Step 14 — phase-x1-migrate-renderer — blocking: yes — qa: auto：迁完 Settings ~14 文件（含 config-forms 表单状态机经 shared re-export）。
- Step 15 — phase-x1-migrate-renderer — blocking: yes — qa: auto：`rg`/`eslint` 预检：`apps/desktop/renderer` 对 `@novel-master/core` **零命中**；renderer 向测试同步改 `@shared`（main/IPC 测保持可直连 core）。

### phase-x1-eslint-gate — blocking: yes — qa: auto

- Step 16 — phase-x1-eslint-gate — blocking: yes — qa: auto：`eslint.config.mjs` **仅**对 `renderer/**/*.{ts,tsx}` 启用 `no-restricted-imports`；patterns **钉死** `@novel-master/core` 与 `@novel-master/core/*`。**显式**：main / IPC handler 测允许 core。renderer 向测改 `@shared`，或另加**单列** glob（不得把整个 `apps/desktop/test/**` 与 renderer 同禁）。
- Step 17 — phase-x1-eslint-gate — blocking: yes — qa: auto：可选 `scripts/check-renderer-no-core.mjs` + 根/`desktop` script；文档改 `desktop-app` / `ipc-hop-rationale` 为「禁一切」。
- Step 18 — phase-x1-eslint-gate — blocking: no — qa: auto：若无 PR CI，在 SPEC 实现注写明「本地 lint 为门禁；PR CI 另开」；不阻塞本迭代合入除非团队要求同 PR 加 `ci.yml`。

### phase-e2-discipline — blocking: yes — qa: auto

- Step 19 — phase-e2-discipline — blocking: yes — qa: auto：文档钉死 E2 策略（对齐 PRD「新组件禁 / 既有渐进」）：
  - **初始 allowlist（值导入 `state`）** = `{StreamTail, RowList, MessageRow}`（路径：`ui/stream/StreamTail.tsx`、`ui/render/RowList.tsx`、`ui/render/MessageRow.tsx`；含 StreamTail 内 `StreamBodyHost`）；
  - type-only `import type { … } from '…/state'` **允许**（不占白名单）；
  - **新** `ui/**` 组件禁止值导入 `state`。
- Step 20 — phase-e2-discipline — blocking: yes — qa: auto：契约测或 gate 脚本扫 `webview/ui/**`：仅 allowlist 内文件可值导入 `state`；**白名单外新直读 → 失败**。
- Step 21 — phase-e2-discipline — blocking: no — qa: auto：渐进：`MessageRow`/`RowList`（及后续）改为 props 下发展开态/flags/rows，并从 allowlist **缩小**（不挡 Step 16）。

### phase-verify — blocking: yes — qa: auto|manual_user

- Step 22 — phase-verify — blocking: yes — qa: auto：跑下方 T- 矩阵（core/desktop/mobile 相关套件）全绿。
- Step 23 — phase-verify — blocking: no — qa: manual_user：Chat 主路径烟测（发消息、仅 chip、`@path`、批注、回滚）无可见回归。

## 测试策略

### 测试用例

| ID | blocking | 映射 Step | 内容 |
|----|----------|-----------|------|
| T-X2-1 | yes | 1–2 | core chip 判定：排除 attach/userAttach；partition 稳定 |
| T-X2-2 | yes | 3–4 | core at-path：token/query/replace/typeahead；mention 不进 core |
| T-X2-3 | yes | 5–6 | store：CRUD/clear/异会话；chip 投影字段；`resetForTests` |
| T-X2-4 | yes | 7–8 | highlight：group 跳过空 id；parse/sort/findAll |
| T-X1-1 | yes | 11–12 | IPC：agent get / **projects getAgentConfig** / events get 返回 `StoredConfigHealthDto`；renderer 无 assess / `resolveAgentDefinitionFromStorage`；Events 恢复路径为 set 后 re-get |
| T-X1-2 | yes | 13–15 | `renderer/**` 无 `@novel-master/core` 字面（契约或 eslint）；shared 无 `export * from '@novel-master/core` |
| T-X1-3 | yes | 16–17 | 故意在 renderer 加 `@novel-master/core` 或 `@novel-master/core/chat` import 时 eslint/gate 失败；main/IPC 测仍可 import core |
| T-E2-1 | yes | 19–20 | ui 非 `{StreamTail,RowList,MessageRow}` 文件无值 `import { state }` |
| T-R-1 | yes | 22 | 既有：`composer-send-intent`、`composer-at-path`、`attachment-draft-chips`、`chat-annotate-draft`、`preview-annotate`/`annotate-marks`、`chat-composer.integration`（desktop）、mobile 对应测绿 |
| T-R-2 | no | 23 | manual_user 烟测清单 |

**命令锚点**：`npm run test:fast -w @novel-master/core -- <paths>`；`npm test -w @novel-master/desktop`；`npm test -w @novel-master/mobile`；`npm run lint -w @novel-master/desktop`。

## 兼容性与迁移

- **无 DB migration**。
- Desktop：行为不变；开发者改 import 路径；Settings 改消费 IPC health。
- Mobile：仅模块路径变化；mention/高亮 class 名可保留。
- highlight `group*` 统一跳过空 id：微行为对齐 Mobile，用 T-X2-4 锁定。
- 旧「renderer assess」文档/注释删除，避免回潮。

## 风险与回滚方案

| 风险 | 缓解 | 回滚 |
|------|------|------|
| Settings config-forms 体量大导致拖延 | phase 可分 PR，但 **未清零前不开 eslint**；或同 PR 迁完再开 gate | 回退迁移 commit；勿半开禁令 |
| `@shared` re-export 仍打包 core 被质疑「假禁」 | SPEC 明确：禁的是 **字面依赖与层边界**；不追求 renderer bundle 零 core 字节 | — |
| shared `export *` 泄漏 service | allowlist + 禁止 `export *` + 审查 | 删泄漏导出 |
| 多窗口共享 annotate Map | 维持现单例语义；测用 `resetForTests` | — |
| E2 props 化破坏流式岛 | 初始白名单含 StreamTail；先纪律后门禁；props 时缩小白名单 | 仅回退 RowList/MessageRow 改动 |
| Mobile Jest `@/` 映射导致部分 integration 未起 | 不作为本迭代阻塞；已知基建债另开 | — |

**回滚**：按 phase 逆序 revert；优先关 eslint 规则再回代码，避免主分支长期红。

## Context Bundle（供实现）

```yaml
iteration_name: post-1.3.14-large-debt-remediation
requirement_path: Iterations/post-1.3.14-large-debt-remediation/prd.md
spec_path: Iterations/post-1.3.14-large-debt-remediation/spec.md
explore_summary: |
  renderer 34 文件直连 core；无双端 shared 包；出口=core 单源+desktop shared 具名再导出（禁 export *）；
  X2 四处可进 core；E2 初始 allowlist=StreamTail+RowList+MessageRow，门禁拦白名单外新直读；
  eslint 仅 renderer/**/*.{ts,tsx}，patterns=@novel-master/core 与 @novel-master/core/*；
  main/IPC 测允许 core；assess 经 IPC StoredConfigHealthDto（agent/projects/events get）。
impact_files:
  - packages/core/src/domain/chat/logic/*
  - packages/core/src/public/chat.ts
  - apps/desktop/shared/**
  - apps/desktop/renderer/** (~34)
  - apps/desktop/eslint.config.mjs
  - apps/desktop/src/main/ipc/handlers/agent-registry.ts
  - apps/desktop/src/main/ipc/handlers/projects.ts
  - apps/desktop/src/main/ipc/handlers/events-config-handlers.ts
  - apps/mobile chat/storage/annotate-marks/composer-at-path
  - apps/mobile/.../webview/ui/** (E2 gate)
constraints:
  - Mobile keeps direct core imports
  - No DB/service factories in renderer or @shared
  - Ban literal @novel-master/core and @novel-master/core/* in renderer sources only
  - No export * from @novel-master/core in shared/logic
  - X2 before eslint gate
  - E2 initial allowlist: StreamTail, RowList, MessageRow
  - Events restore: set then re-get IPC health (no local assess)
blocking_steps: [1-17, 19-20, 22]
```
