---
date: 2026-06-17
---

# 存储配置有效性（Stored Config Validity）技术规格（SPEC）

> **PRD**：[prd.md](./prd.md)  
> **调研基线**：`main` @ 2026-06-17（`packages/core` bootstrap、`config-forms/events`、`config-forms/agent`、Mobile/Desktop 设置页）

## 设计目标

1. **单一有效性契约**：智能体 wire、事件 wire 在 core 层统一 `assess` 为 `valid | invalid`，UI 不再分散 try/catch + lenient 编辑。
2. **失效即阻断编辑**：无效配置只展示失效面板与恢复操作，不提供「未知 action 占位」「带病保存」路径。
3. **智能体恢复语义**：编辑页支持 **删除** 或 **用默认模板覆盖（保留 `agentId` 与显示名称）**。
4. **Bootstrap 瘦身**：删除 `bootstrapNovelMaster` 中全部历史一次性 migrate，仅保留 `CREATE TABLE IF NOT EXISTS` DDL 与 `seedBuiltinProviders`。
5. **不改动运行时语义**：合法事件配置的 DAG orchestrator 行为不变；压缩条件 store 自动迁移不在本迭代范围。

## 现状代码探索结论

| 区域 | 现状 | 问题 |
|------|------|------|
| 事件 UI | `loadEventsConfigForEditor` 宽松解析 + `UnknownActionDraft` 占位；`EventsConfigScreen` / `EventsConfigView` 另有 `loadError` 恢复卡与 `unknownBanner` 双轨 | 分支重复，与 PRD「直接重置」冲突 |
| 事件 IPC | Desktop `handleEventsGetConfig` 已返回 `{ wire, config \| null }` | Renderer 仍自行 lenient load，未消费统一 health |
| 智能体列表 | Mobile `AgentList`、Desktop `agent-registry` IPC 对 `get` 失败填 `decodeError` | 可行但未复用 assess；文案不统一 |
| 智能体编辑 | Mobile `AgentEditorForm`、Desktop `AgentEditorView` 已有 `loadError` + **仅删除** | 缺 **覆盖默认（保留名称）** |
| 事件 store | `DefaultEventsConfigStore.getRawWire()` / `getConfig()` strict decode | 无 `assess` 封装 |
| 智能体 repo | `SqliteAgentDefinitionRepository.get` 内 strict `decode` | 列表为探活反复 decode；无 raw wire 读取 API |
| Bootstrap | `novel-master-bootstrap.ts` 串联 15+ migrate（列增删、KKV purge、数据回填） | 用户确认可删除；极旧未升级库不再支持 |

## 总体方案

### 1) Core：`StoredConfigHealth` 与 assess 函数

新增模块 `packages/core/src/config-forms/stored-config-validity/`（对外子入口 `@novel-master/core/config-forms/stored-config-validity`）。

```typescript
/** 失效原因分类（用户可见文案由 labels 映射）。 */
export type StoredConfigInvalidCode =
  | "outdated_version"
  | "broken_wire"
  | "removed_feature";

export type StoredConfigHealth<T> =
  | { readonly status: "valid"; readonly value: T }
  | {
      readonly status: "invalid";
      readonly code: StoredConfigInvalidCode;
      readonly message: string; // 技术细节，次要展示
      readonly storedSchemaVersion?: number;
    };

export const CURRENT_EVENTS_SCHEMA_VERSION = 2 as const;
export const CURRENT_AGENT_SCHEMA_VERSION = 1 as const;
```

**`assessEventsConfigWire(raw: unknown): StoredConfigHealth<EventsConfig>`**

1. `raw` 非 object → `invalid(broken_wire)`  
2. `schemaVersion !== 2` → `invalid(outdated_version)`（含缺失、`1`、其它数字）  
3. **v1 形态探测**（无有效 v2 时）：`events` 下任一事件值为 `{ parallel: ... }` 或 `{ sequential: ... }` → `invalid(outdated_version)`  
4. `decode(raw, eventsConfigSchema)` 成功 → `valid`  
5. decode 失败且错误含 `refresh-macros` / `unknown action` → `invalid(removed_feature)`  
6. 其它 decode 失败 → `invalid(broken_wire)`

**`assessAgentDefinitionWire(raw: unknown): StoredConfigHealth<AgentDefinition>`**

1. `decode(raw, agentDefinitionSchema)` 成功 → `valid`  
2. 失败：根据 `AgentConfigError` / message 关键词映射 `code`（`prompts.blocks`、`preferredModelId` 等 → `removed_feature`；其余 → `broken_wire`）

**`buildDefaultAgentDefinitionPreservingName(name: string): AgentDefinition`**

- 使用现有 `createDefaultAgentEditorPrompts()` + `layoutFromFormInput()` + `runtime: { maxSteps: 20 }`  
- **保留** 传入 `name`（trim 后非空，否则 fallback `agentId` 由调用方处理）

**`STORED_CONFIG_LABELS`**

- 统一失效标题、说明、按钮文案（事件重置 / 智能体删除 / 覆盖默认）  
- 扩展 `AGENT_LIST_LABELS`：`invalid` 标签文案与 `needsRepair` 对齐或合并为 `configInvalid`

### 2) 数据访问层补充

**`AgentDefinitionRepository` 新增：**

```typescript
/** 读取 prompts_json 解析后的 wire 对象，行不存在返回 null。 */
getRawWire(agentId: string): Promise<unknown | null>;
```

`SqliteAgentDefinitionRepository` 实现：`JSON.parse(prompts_json)`，**不** decode。

**`EventsConfigStore` 新增（或 core 纯函数 + store 薄封装）：**

```typescript
assessStored(): Promise<StoredConfigHealth<EventsConfig>>;
```

实现：`getRaw` → 若无配置则对 `encode(DEFAULT_EVENTS_CONFIG, ...)` assess（应 valid）→ 否则 `assessEventsConfigWire(parsed)`。

> `getConfig()` / `getRawWire()` **保持** strict 行为供 runtime/CLI；UI 编辑路径改走 `assessStored`。

### 3) 移除 lenient 事件编辑路径

**删除或内联废弃：**

- `UnknownActionDraft`、`isUnknownActionDraft`、`loadEventsConfigForEditor` 的 unknown 分支  
- `event-config-editor-load.ts` 可 **删除整文件**，`normalizeHideMessageAction` 迁至 `event-config-state.ts` 或 `assess` 邻域  
- `EventBlockDraft.actions` 类型改为 `readonly EventActionNode[]`（去掉 `EventActionDraft` union）  
- `validate-event-config-blocks.ts` 移除 unknown 分支  
- `EventConfigBlocks.tsx` / `EventsConfigView.tsx` 移除 unknown 渲染与 `unknownActionHint` 卡片逻辑（`unknownActionHint` 可删或仅测试保留）

**有效配置加载：**

```text
assessStored() → valid → configToEventBlocks(value)
              → invalid → 仅失效面板（不 set blocks）
```

### 4) UI：失效面板（Mobile + Desktop）

共用 `STORED_CONFIG_LABELS`，两端布局可不同但 **主标题 + 三个主操作语义** 一致。

#### 事件配置

| 状态 | UI |
|------|-----|
| `valid` | 现有事件块编辑器 + 保存/导入导出 |
| `invalid` | 全页失效面板；**不渲染** `EventBlockEditor` |

操作（与现 Mobile `handleRecoverRestoreAndSave` / `handleRecoverClearAndSave` 对齐）：

- **恢复默认并保存**：`setConfig(DEFAULT_EVENTS_CONFIG)`  
- **清空旧配置并保存默认**：`clearConfig()` + `setConfig(DEFAULT_EVENTS_CONFIG)`

移除：`unknownBanner`、`removeAllUnknownActions`、unknown toast。

Desktop `EventsConfigView`：删除 `collectUnknownWireKeys`；`load` 改用 `assessEventsConfigWire(res.data.wire)`（wire 来自 IPC，不在 renderer 再宽松解析）。

#### 智能体列表

| 状态 | UI |
|------|-----|
| `valid` | 现有行展示 + 进入编辑 |
| `invalid` | 标签「配置已失效」（或 `needsRepair`）+ **删除**；允许进入编辑页 |

列表实现改为：`getRawWire(id)` → `assessAgentDefinitionWire`（**不** `get` 抛错）。

Desktop IPC `handleAgentRegistryList`：返回 `invalid?: { code, message }`（可保留 `decodeError` 字段作别名一版，SPEC 实现时统一为 `invalid` 并更新 `ipc-types`）。

#### 智能体编辑

| 状态 | UI |
|------|-----|
| `valid` | 现有 `AgentEditorForm` / `AgentEditorView` |
| `invalid` | 失效面板：**返回**、**删除 Agent**、**用默认模板覆盖并保存** |

覆盖默认流程：

```text
getRawWire → 从 wire 尽力读取 name（JSON.parse 后 string 字段，失败用 agentId）
→ buildDefaultAgentDefinitionPreservingName(name)
→ agentRegistry.upsert(agentId, def, { registeredToolNames })
→ 重新 load → valid 表单
```

Mobile 在现有 `FormErrorCard` 上增加第三按钮；Desktop 在 `settings-error-panel` 增加 secondary 按钮。

### 5) Bootstrap migrate 全量移除

**从 `bootstrapNovelMaster` 移除的调用（及对应源文件删除）：**

| 文件 | 说明 |
|------|------|
| `bootstrap/agent/migrate-drop-agent-definition-legacy-columns.ts` | DROP agent 废列 |
| `bootstrap/session-fs/migrate-drop-legacy-session-fs.ts` | DROP 旧表 |
| `bootstrap/chat/migrate-chat-message-hidden.ts` | ADD hidden |
| `bootstrap/chat/migrate-chat-session-user-vfs-pending.ts` | ADD user_vfs_pending_json |
| `bootstrap/vfs/migrate-vfs-entry-kind.ts` | ADD entry_kind |
| `bootstrap/vfs/migrate-vfs-head-version.ts` | ADD head_version |
| `bootstrap/vfs/migrate-vfs-revision.ts` | revision baseline |
| `bootstrap/worktree/migrate-worktree-fill-policy.ts` | fill_policy 回填 |
| `bootstrap/preferences/migrate-client-ui-behavior-prefs.ts` | prefs 搬迁 |
| `bootstrap/preferences/migrate-purge-global-config-kkv.ts` | KKV purge |
| `bootstrap/preferences/migrate-purge-removed-preference-keys.ts` | KKV purge |
| `bootstrap/provider/migrate-model-context-settings.ts` | 三函数：purge KKV / DROP table / ADD settings_json |
| `novel-master-bootstrap.ts` 内联 `migrateDropProviderDefaultModelId` | DROP default_model_id |
| `novel-master-bootstrap.ts` 内联 `migrateRegexRuleDepthColumns` | RENAME depth 列 |

**保留：**

```typescript
export async function bootstrapNovelMaster(conn) {
  await conn.transaction(async (tx) => {
    for (const sql of NOVEL_MASTER_SCHEMA_STATEMENTS) {
      await tx.execute(sql);
    }
    await seedBuiltinProviders(tx);
  });
}
```

**文档注释**更新：`novel-master-bootstrap.ts` 文件头改为「仅 DDL + seed；不升级历史库」。

**支持边界（实现注释 + PRD 已写）**：从未经中间版本 bootstrap 的极旧 `.sqlite` 可能缺列导致运行期 SQL 失败——**不在本迭代处理**，用户需新建工作区或先旧版打开一次。

### 6) CLI 与其它消费者

- **CLI** `nm events show/set`：维持 strict decode 报错，不新增交互（PRD 不包含）。  
- **Event orchestrator**：继续 `eventsConfig.getConfig()` strict；无效配置时 emit 失败行为不变。  
- **压缩条件 store**：**不修改** `DefaultCompactionConditionsStore` v2→v3 读时迁移。

## 最终项目结构

```text
packages/core/src/config-forms/stored-config-validity/
  types.ts
  labels.ts
  assess-events-config-wire.ts
  assess-agent-definition-wire.ts
  build-default-agent-definition.ts
  index.ts

packages/core/src/config-forms/events/
  event-config-state.ts          # 去掉 EventActionDraft / unknown
  validate-event-config-blocks.ts
  # event-config-editor-load.ts  删除

packages/core/src/domain/agent/repositories/
  agent-definition.port.ts       # +getRawWire
  impl/sqlite-agent-definition.repository.ts

packages/core/src/service/events-config/
  events-config-store.port.ts    # +assessStored
  impl/events-config-store.service.ts

packages/core/src/bootstrap/
  novel-master-bootstrap.ts      # 仅 DDL + seed
  # migrate-*.ts                 全部删除

apps/mobile/
  screens/stack/EventsConfigScreen.tsx
  components/events/EventConfigBlocks.tsx
  components/agent/AgentList.tsx
  components/agent/AgentEditorForm.tsx

apps/desktop/
  src/main/ipc/handlers/agent-registry.ts
  src/main/ipc/handlers/events.ts
  shared/ipc-types.ts
  renderer/features/settings/EventsConfigView.tsx
  renderer/features/settings/AgentEditorView.tsx
  renderer/features/settings/SettingsViews.tsx
```

**package.json exports 新增：**

```json
"./config-forms/stored-config-validity": {
  "types": "./dist/config-forms/stored-config-validity/index.d.ts",
  "import": "./dist/config-forms/stored-config-validity/index.js"
}
```

`packages/core/src/config-forms/index.ts` 视情况 re-export 或仅子路径导出。

## 变更点清单

| ID | 变更 | 文件/模块 |
|----|------|-----------|
| C1 | 新增 `StoredConfigHealth` 类型与常量 | `stored-config-validity/*` |
| C2 | `assessEventsConfigWire` / `assessAgentDefinitionWire` | 同上 |
| C3 | 统一文案 `STORED_CONFIG_LABELS` | `labels.ts` + 复用 `ui-labels` |
| C4 | `buildDefaultAgentDefinitionPreservingName` | `build-default-agent-definition.ts` |
| C5 | Repository `getRawWire` | agent sqlite repo + port |
| C6 | `EventsConfigStore.assessStored` | events store |
| C7 | 删除 lenient 事件加载与 unknown UI | events config-forms + mobile/desktop events UI |
| C8 | 事件失效全页面板（去掉 unknown 分支） | EventsConfigScreen / EventsConfigView |
| C9 | 智能体列表改 assess + 标签 | AgentList + agent-registry IPC |
| C10 | 智能体编辑失效面板 + 覆盖默认 | AgentEditorForm + AgentEditorView |
| C11 | 删除全部 bootstrap migrate | `bootstrap/**/migrate-*.ts` + bootstrap 测试 |
| C12 | IPC 类型：`invalid` 字段（可选弃用 `decodeError`） | `ipc-types.ts` |
| C13 | core 单测 + 更新 config-forms 测试 | `packages/core/test/**` |

## 详细实现步骤

### Step 1 — Core 契约（无 UI）

1. 创建 `stored-config-validity` 模块与 export。  
2. 实现 `assessEventsConfigWire`、`assessAgentDefinitionWire`、`buildDefaultAgentDefinitionPreservingName`、`STORED_CONFIG_LABELS`。  
3. 单测覆盖 PRD E1/E3/A1 样例 wire。

### Step 2 — 数据层

1. `AgentDefinitionRepository.getRawWire` + sqlite 实现。  
2. `EventsConfigStore.assessStored` 实现。  
3. 单测：store + repo 与 assess 集成。

### Step 3 — 事件 config-forms 收敛

1. 删除 `event-config-editor-load.ts`；迁移 `normalizeHideMessageAction` 到 `event-config-state.ts`。  
2. `EventBlockDraft.actions: EventActionNode[]`；简化 `eventBlocksToConfig` / `validate-event-config-blocks`。  
3. 更新 `config-forms/events/index.ts` 导出；删除 `unknownActionHint` 或保留仅用于错误 message 格式化（不再用于 UI 卡片）。

### Step 4 — Mobile UI

1. `EventsConfigScreen`：`assessStored` 驱动；invalid 仅失效面板；删除 unknown 相关 state/UI。  
2. `EventConfigBlocks`：移除 `isUnknownActionDraft` 分支。  
3. `AgentList`：`getRawWire` + assess；`invalid` 展示。  
4. `AgentEditorForm`：load 用 assess；失效面板三按钮（返回/删除/覆盖默认）。

### Step 5 — Desktop UI + IPC

1. `handleAgentRegistryList`：assess raw wire；DTO `invalid` 字段。  
2. `AgentEditorView`：覆盖默认按钮 + assess load。  
3. `SettingsViews` 列表行：消费 `invalid` 替代 `decodeError`（或映射）。  
4. `EventsConfigView`：与 Mobile 对齐 assess + 失效面板。  
5. `handleEventsGetConfig`：可选返回 `health` 字段，或 renderer 本地 `assessEventsConfigWire(wire)`（优先 **renderer 调 core assess**，减少 IPC 膨胀）。

### Step 6 — Bootstrap 清理

1. 删除所有 `migrate-*.ts` 与 bootstrap 内联 migrate 函数。  
2. 精简 `bootstrapNovelMaster` 为 DDL + seed。  
3. 删除/改写 bootstrap 迁移测试；新增 `bootstrap-ddl-smoke.test.ts`（空库 bootstrap 后关键表存在）。  
4. 更新 `vfs-schema.ts` 等文件头注释，去掉 migrate 引用。

### Step 7 — 回归与文档

1. 跑 core / desktop / mobile 相关测试与 build。  
2. PRD 风险节已覆盖发布说明，无需额外 README（除非 CHANGELOG 条目）。

## 测试策略

### 单元测试（core）

| 用例 ID | 描述 |
|---------|------|
| T-E1 | v1 `parallel` wire → `invalid(outdated_version)` |
| T-E2 | v2 合法 DAG → `valid` |
| T-E3 | v2 含 `refresh-macros` → `invalid(removed_feature)` |
| T-E4 | 非 object / 缺 events → `invalid(broken_wire)` |
| T-A1 | `prompts.blocks` agent wire → `invalid(removed_feature)` |
| T-A2 | 合法 agent v1 → `valid` |
| T-A3 | `buildDefaultAgentDefinitionPreservingName` 保留 name、默认 prompts |
| T-B1 | 空库 `bootstrapNovelMaster` 后 `agent_definition`/`chat_session`/`vfs_entry` 表存在 |
| T-B2 | 删除 migrate 后不再存在 `migrate-drop-agent` 等模块 import |

### 集成 / 应用测试

| 用例 ID | 描述 |
|---------|------|
| T-IPC1 | Desktop agent list：一条坏 wire + 一条好 wire |
| T-IPC2 | Desktop events get：invalid wire 时 `config === null` 且 wire 原样返回 |

### 手工验收（映射 PRD）

- E1–E4、A1–A4、B1–B4、R1–R2 按 PRD 清单在 Mobile + Desktop 各走一遍。

### 删除的测试

- `packages/core/test/bootstrap/phase3-migrations.test.ts`（整文件删除或仅保留 DDL smoke 若合并）  
- `chat-message-hidden-migration.test.ts`  
- `migrate-client-ui-behavior-prefs.test.ts`  
- `model-context-settings-migration.test.ts`  
- `packages/core/test/config-forms/event-config-editor-load.test.ts`（改为 assess 测试）

## 风险与回滚方案

| 风险 | 缓解 / 回滚 |
|------|-------------|
| 极旧 DB 缺列导致启动后 SQL 失败 | 发布说明声明；用户新建工作区或先用上一版 App 打开一次；回滚 = 恢复 migrate 提交 |
| 误删仍需要的 migrate | 本 SPEC 按 PRD 全删；若线上反馈，从 git 恢复指定 migrate 文件 |
| 覆盖默认误覆盖用户名称 | 覆盖前仅从 raw wire 读 `name` 字段；无则保留 `agentId` 作显示名 |
| Desktop/Mobile 文案不一致 | 强制 `STORED_CONFIG_LABELS` 单源 |
| Orchestrator 读到无效 events | 行为与现 strict decode 一致；用户须在设置页重置 |

**功能回滚**：恢复 `loadEventsConfigForEditor` 与 migrate 文件（独立 revert commit）；`StoredConfigHealth` API 可保留不破坏调用方。

## 实现波次建议（subagent-inline-loop）

```text
wave-0: Step 1–2（core assess + repo/store）+ 单测
wave-1: Step 3（config-forms 收敛）
wave-2: Step 4 + Step 5（Mobile / Desktop UI + IPC）— 可拆两个子代理并行，不同目录
wave-3: Step 6（bootstrap 清理）— 与 wave-2 串行，避免 bootstrap 测试与 UI 并行冲突
wave-4: 评审 + 全量验证
```

**分支**：`feature/stored-config-validity`
