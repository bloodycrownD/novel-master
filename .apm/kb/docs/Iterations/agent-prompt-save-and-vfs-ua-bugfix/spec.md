---
date: 2026-06-17
---

# 智能体保存校验与 VFS UA 简化 Bugfix 技术规格（SPEC）

## 设计目标

在 [PRD](./prd.md) 约束下完成两项修复。**允许新增文件或 API，但必须同步删除已无用的代码路径，净效果是简化而非堆叠。**

1. **Bug1**：三区全关空 layout 可保存；开启区仍要求有效来源。
2. **Bug2**：flush 由 4 条改为 **UA 2 条**；**仅 UA** 折叠工具卡片；旧四段**不折叠**，当普通消息。

### 代码卫生原则（实现与评审硬性要求）

| 原则 | 说明 |
|------|------|
| **有加有删** | 每引入新文件、新函数或新分支，须在同期删除替代掉的旧逻辑；不得保留并行两套路径 |
| **净简化** | 本需求合并后，VFS UA 相关 Core 代码行数应**净减少**（删除 ≥ 新增） |
| **无 legacy 分支** | 不为旧四段写 `if (legacy)` / 双读 / `SpanLegacy`；旧消息自然走普通渲染 |
| **新文件可选** | 若拆分能减耦（如常量、落库包裹），可新建；禁止「新文件 + 旧文件逻辑都留着」 |
| **死代码当场清** | 断引用后同 PR 删除源文件与测试，不标「后续另 PR」 |

**定案**

| 项 | 取值 |
|----|------|
| ACK 文案 | `收到通知`（`user-vfs-turn-constants.ts` 或 `user-vfs-turn-view.ts` 二选一，**单点定义**） |
| U 条 kind | `user_vfs_action` |
| A 条 kind | `user_vfs_ack` |
| `USER_VFS_TURN_SPAN` | **2**（原 4 改为 2，不保留 legacy 常量） |
| system-message 包裹 | `wrapUserVfsActionsForStorage()`（可放在 constants 同文件或 service 顶部私有函数） |
| checkpoint 锚点 | U 条 id |
| 历史 UAUA | **无专用代码**；逐条走现有普通消息渲染 |

---

## 总体方案

### Bug1（不变）

```text
hasAnyPromptRegionEnabled? 否 → 允许空 layout
                         是 → hasEffectivePromptSource? 否 → 报错
→ validateAgentPromptLayout
```

### Bug2（精简）

```text
flush: merge(actionsXml only) → append U + append A → checkpoint(U)
识别: matchUserVfsTurnAt 仅匹配 UA(2)（改写原函数，删除四段逻辑）
UI:   匹配成功 → user_vfs_turn；否则普通消息（含全部旧四段）
merge: 仅输出 actionsXml（删除 toolUses/toolResults 生成，减死代码）
```

---

## 变更点清单

### Bug1

| 文件 | 变更 |
|------|------|
| `agent-editor-state.ts` | `hasAnyPromptRegionEnabled`、`hasEffectivePromptSource`、`countEffectiveFormPromptSources`；改 `buildAgentDefinitionFromForm` |
| `AgentEditorView.tsx` | 删除守卫改用 `countEffectiveFormPromptSources` |
| `agent-editor-state.test.ts` | 全关空 layout 成功；system 开空失败 |

### Bug2

| 文件 | 变更 |
|------|------|
| `user-vfs-turn.service.ts` | flush 2 条；内联 `wrapSystemMessage`；删 tool_use/tool_result/bridge append |
| `merge-pending-vfs-turns.ts` | 返回类型改为 `{ actionsXml: string }`；删除 `actionXmlToToolUses` / `compressUserVfsToolUses` 调用 |
| `user-vfs-turn-view.ts` | `USER_VFS_TURN_SPAN = 2`；`matchUserVfsTurnAt` 只认 UA；`buildUserVfsTurnView` 收 2 元组；toolUses 一律 `deriveToolUsesFromVfsActions` |
| `message-metadata.ts` | 增加 `user_vfs_ack` |
| `normalize-for-llm-export.ts` | `VFS_SEMANTIC_KINDS` 加 `user_vfs_ack` |
| `user-vfs-turn.port.ts` | 注释改为 2 条 UA |
| `message-blocks.ts`（Mobile） | 仍调 `matchUserVfsTurnAt`，span 自然为 2 |
| `message-blocks.ts`（Desktop） | 引入与 Mobile 相同的 UA 折叠（当前无折叠，新 UA 需要） |
| `user-vfs-turn.service.test.ts` | 4 条 → 2 条；checkpoint 锚 U |
| `merge-pending-vfs-turns.test.ts` | 只断言 actionsXml |
| `user-vfs-turn-view.test.ts` | 删除四段用例；新增 UA 两段用例 |
| `normalize-for-llm-export.test.ts` | 删「U-A-U-A 四条不拆分」；加 UA 两条用例 |
| `render-prompt.test.ts` | 四段用例改 UA 两段 |

### 必须删除（与新增配对，本 PR 内完成）

| 删除项 | 原因 |
|--------|------|
| `compress-user-vfs-tool-uses.ts` **整文件** | merge 不再生成 toolUses，唯一调用方消失 |
| `compress-user-vfs-tool-uses.test.ts` **整文件** | 同上 |
| `merge-pending-vfs-turns.ts` 内 `actionXmlToToolUses` / `compressUserVfsToolUses` 导入与 ~30 行生成逻辑 | 收窄为仅 `actionsXml` |
| `user-vfs-turn-view.ts` 四段 `matchUserVfsTurnAt` 分支 | 改为 UA 两段 |
| `toolUsesFromMessage` / `toolResultsFromMessage` 私有函数 | view 一律 `deriveToolUsesFromVfsActions` |
| `user-vfs-turn.service.ts` 中间两条 append + `TOOL_TURN_BRIDGE_TEXT` 引用 | flush 仅 2 条 |
| 四段相关测试用例（view / service / render-prompt / normalize-for-llm-export / merge） | 替换为 UA 用例，不保留旧用例副本 |
| Desktop `AgentEditorView` 对 `countMinimumPromptSources` + `countFormPromptSources` 双计数删块路径 | 统一 `countEffectiveFormPromptSources` |

**不引入**

- `matchUserVfsTurnSpanAt`、legacy variant、四段 span 常量

**明确不改（职责不同，非冗余）**

- `append-tool-turn-bridge.ts`（maxSteps `【done】`，与 VFS ack 无关）
- pending / `build-user-vfs-turn-op` 裸 XML

---

## 详细实现步骤

### Phase A — Bug1

与前一版 SPEC 相同：`agent-editor-state.ts` + `AgentEditorView.tsx` + 测试。不重复展开。

### Phase B — Bug2 Core

#### B1. 精简 `mergePendingVfsTurns`

```typescript
export type MergedPendingVfsTurn = { readonly actionsXml: string };

export function mergePendingVfsTurns(pending: readonly UserVfsPendingEntry[]): MergedPendingVfsTurn {
  return { actionsXml: pending.map((e) => e.actionXml).join("\n") };
}
```

更新所有 `MergedPendingVfsTurn` 消费方（仅 service + 测试）。

#### B2. 改写 `flushPendingUserVfsTurns`

```typescript
const { actionsXml } = mergePendingVfsTurns(pending);
const text = `<system-message>\n${actionsXml.trim()}\n</system-message>`;

const actionUser = await messages.append("user", { blocks: [{ type: "text", text }] }, {
  raw: { metadata: { source: "user", synthetic: true, kind: "user_vfs_action" } },
});

await messages.append("assistant", {
  blocks: [{ type: "text", text: USER_VFS_TURN_ACK_TEXT }],
}, { raw: { metadata: { synthetic: true, kind: "user_vfs_ack" } } });

await messageCheckpoint.capture(sessionId, projectId, actionUser.id);
```

`USER_VFS_TURN_ACK_TEXT` 与 `wrapUserVfsActionsForStorage` **单点定义**（推荐新建 `user-vfs-turn-constants.ts` 集中落库常量与包裹，同时从 service/view 删掉内联重复）。

#### B3. 改写 `user-vfs-turn-view.ts`

```typescript
export const USER_VFS_TURN_ACK_TEXT = "收到通知" as const;
export const USER_VFS_TURN_SPAN = 2 as const;

/** 从 startIndex 起是否为完整 UA 两段（均未 hidden）。 */
export function matchUserVfsTurnAt(
  messages: readonly ChatMessage[],
  startIndex: number,
): readonly [ChatMessage, ChatMessage] | null;

/** 从已匹配的 UA 两段构建 UI 视图。 */
export function buildUserVfsTurnView(
  turn: readonly [ChatMessage, ChatMessage],
): UserVfsTurnView;
```

**UA 匹配条件**

| m0 user | m1 assistant |
|---------|--------------|
| `kind === "user_vfs_action"` | `kind === "user_vfs_ack"` |
| 含 `<user-vfs-action` | 纯 text，`text === USER_VFS_TURN_ACK_TEXT`，无 tool_use |

**`buildUserVfsTurnView`**

- `actions` ← `parseAllUserVfsActionsFromText(m0)`
- `toolUses` ← `deriveToolUsesFromVfsActions(actions)`（不再读 assistant tool_use 块）
- `toolResults` ← 每条 tool 合成 `{ content: "ok", ok: true }`
- `bridgeText` ← m1 文本

删除四段 tuple、`toolUsesFromMessage` / `toolResultsFromMessage` 在 view 构建中的使用（若仅四段用可删私有函数）。

#### B4. LLM export

- `VFS_SEMANTIC_KINDS` += `user_vfs_ack`
- UA 两条不 merge；条数保持 2
- **不再**为旧四段写专用 export 规则；库中旧消息按既有 plain/tool 消息路径导出

#### B5. 测试调整

| 文件 | 动作 |
|------|------|
| `user-vfs-turn.service.test.ts` | `flush 落库 4 条` → `2 条`；burst 同理 |
| `user-vfs-turn-view.test.ts` | 删 `识别完整 U-A-U-A 四段`；加 UA 两段 |
| `merge-pending-vfs-turns.test.ts` | 删 tool_use/result 断言 |
| `normalize-for-llm-export.test.ts` | 删四段专用用例 |
| `render-prompt.test.ts` | 四段展示用例 → UA 两段 |

---

### Phase C — UI

#### C1. Mobile `message-blocks.ts`

逻辑不变，仅依赖 Core 新 `matchUserVfsTurnAt`（2 段）与 `USER_VFS_TURN_SPAN === 2`。

旧四段会话：首条可能带 `user_vfs_action` 但 m1 非 `user_vfs_ack` → **匹配失败** → 逐条普通渲染（user 行或 tool 行）。

#### C2. Desktop `message-blocks.ts`

新增与 Mobile 相同的 `matchUserVfsTurnAt` 分支，产出 `user_vfs_turn` 供 `ToolCallGroupCard`。旧四段不匹配 UA → 保持现有逐条渲染。

#### C3. WebView

`buildTranscriptRows` 已消费 `user_vfs_turn` + `deriveToolUsesFromVfsActions`，随 Core view 改动即可，**不改 DOM**。

---

## 测试策略

### 验收用例

#### Bug1

| ID | Then |
|----|------|
| B1-1 | 三区全关空 layout → 保存成功 |
| B1-2 | system 开空 → 失败 |
| B1-5 | Desktop 三区全关可删光并保存 |

#### Bug2

| ID | Then |
|----|------|
| B2-1 | flush → 2 条，无 tool_use/tool_result |
| B2-2 | U 含 system-message |
| B2-3 | A = 收到通知，kind=user_vfs_ack |
| B2-4 | 新 UA → 单 `user_vfs_turn` 卡片 |
| B2-5 | 旧四段 fixture → **不**产出 `user_vfs_turn`；逐条普通 item |
| B2-7 | export 新 UA → 2 条，无 synthetic tool |
| B2-8 | checkpoint 锚 U |

### 命令

```bash
npm test --workspace=@novel-master/core -- --test-path-pattern="agent-editor-state|user-vfs-turn|merge-pending|normalize-for-llm|render-prompt"
npm test --workspace=@novel-master/mobile -- message-blocks
npm run build
```

---

## 风险与回滚

| 风险 | 说明 |
|------|------|
| 旧会话无工具组卡片 | 已接受；无代码缓解 |
| LLM 理解 VFS | 回归新 UA 对话 |
| merge 接口收窄 | 仅 service 消费，改动面小 |

回滚：revert `user-vfs-turn.service.ts` flush 与 `merge-pending-vfs-turns.ts`；恢复 `USER_VFS_TURN_SPAN = 4` 与四段 match（不推荐）。

---

## 实现 DAG（精简）

```text
impl-bug1-core ──┬── test-bug1 ──┐
impl-bug1-desktop┘               │
impl-bug2-core ──── test-bug2 ───┼── review ── verify-build
impl-bug2-ui ────────────────────┘
```

- `impl-bug2-core` 由同一子代理完成（view + service + merge + **删除 compress 文件**），避免半成品。
- **评审门槛**：对照上表「必须删除」清单逐项勾选；若有新增文件，说明删除了哪些旧逻辑；**禁止** legacy 分支。
