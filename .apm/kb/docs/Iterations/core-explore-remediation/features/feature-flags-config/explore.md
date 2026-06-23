# 代码审查：`feature-flags` 域（`packages/core`）

**日期：** 2026-06-21  
**审查者：** Agent（explore pass）  
**范围：** `packages/core/src/domain/feature-flags/**`、相关测试，以及 `packages/core` 内对 `feature-flags` 的引用

---

## 执行摘要

`feature-flags` 域是一个**最小脚手架**：一个文件、一个开关（`userVfsUnifiedToolTurn`）、十六行代码。实现干净、纯函数、与邻近域模块一致，但**尚未成为可用的回滚机制**。所有调用点均无参调用 `isUserVfsUnifiedToolTurnEnabled()`，因此该开关**始终为 `true`**，可选参数 `configured` 在生产环境中未被使用。

**结论：** 作为临时默认开启的开关可接受，但**相对 vfs-user-ops-unified-tool-turn 规范仍不完整**。无阻塞性风格问题；可维护性与正确性缺口集中在：缺少配置接入、公共导出位置不当、缺少开关切换测试。

| 领域            | 评级   | 说明                                              |
|-----------------|--------|---------------------------------------------------|
| 代码风格        | 良好   | 符合域层约定                                      |
| 可维护性        | 一般   | 单开关尚可；导出面与 API 形态偏弱                 |
| 正确性          | 部分   | 默认开启行为正确；切换路径未生效                  |
| 测试覆盖        | 薄弱   | 无直接测试；无 `false` 分支覆盖                   |

---

## 清单

### 域文件

| 文件 | 行数 | 导出 |
|------|------|------|
| `src/domain/feature-flags/user-vfs-unified-tool-turn.ts` | 16 | `DEFAULT_USER_VFS_UNIFIED_TOOL_TURN`、`isUserVfsUnifiedToolTurnEnabled` |

### `packages/core/test/**/feature*` 下的测试

**无。** 无文件匹配 `test/**/feature*`。

相关测试存在于其他位置，但未引用或演练 feature-flag 模块：

| 测试文件 | 关系 |
|----------|------|
| `test/service/agent/run-agent-turn.test.ts` | 演练 `flushPendingUserVfsTurnsWithTrailingUserReorder` 与 flush 顺序；假定开关为开（默认） |
| `test/chat/user-vfs-turn.service.test.ts` | 演练 `UserVfsTurnService` 的 flush/merge；无 flag 引用 |

### `packages/core` 引用图

```
domain/feature-flags/user-vfs-unified-tool-turn.ts
  ├── public/provider.ts          (re-export)
  └── service/agent/logic/run-agent-turn.ts   (consumer)
```

`packages/core` 下无其他文件引用该模块。

### 下游消费者（范围外，供上下文）

| 位置 | 引用路径 |
|------|----------|
| `apps/desktop/src/main/ipc/handlers/vfs.ts` | `@novel-master/core/provider` |
| `apps/mobile/src/components/vfs/VfsFileManager.tsx` | `@novel-master/core/provider` |
| `apps/mobile/src/screens/stack/FileEditorScreen.tsx` | `@novel-master/core/provider` |
| `apps/mobile/test-utils/core-shim.ts` | 从 `dist/domain/feature-flags/...` 深引用 |

CLI **未**引用该开关。

---

## 源码审查

### `user-vfs-unified-tool-turn.ts`

```typescript
/** 关闭时恢复直写 VFS IPC + vfs markDirty + 旧 transcript 行为。 */
export const DEFAULT_USER_VFS_UNIFIED_TOOL_TURN = true;

/** 读取是否启用统一 tool turn；未配置时使用默认值。 */
export function isUserVfsUnifiedToolTurnEnabled(
  configured?: boolean,
): boolean {
  return configured ?? DEFAULT_USER_VFS_UNIFIED_TOOL_TURN;
}
```

**优点**

- 纯函数，无副作用，易于测试。
- `@module` JSDoc 与中文注释与相邻域文件（如 `run-agent-turn.ts`、chat/VFS 模块）一致。
- 默认开启符合规范意图：统一 tool turn 为新的规范路径。
- 空值合并（`??`）仅将 `undefined`/`null` 视为「未设置」；若传入显式 `false` 会正确关闭开关。

**缺点**

- `configured?: boolean` 参数文档化了未来接入，但在 monorepo 中**零调用点使用**。
- 无 env 变量、KKV 键或 `userVfsUnifiedToolTurn` 的设置 schema（规范 §739、§875 要求此项）。
- 域根目录一开关一文件难以扩展；尚无 `index.ts`、注册表或共享类型（N=1 时可接受，但需记录）。

---

## 代码风格

| 检查项 | 状态 |
|--------|------|
| 命名（`is*Enabled`、`DEFAULT_*`） | 通过 |
| 模块标签 / 文件位置 | 通过 — `domain/feature-flags/` 作为顶层域合理 |
| 副作用 / I/O | 通过 — 无 |
| 类型安全 | 通过 — 返回类型显式 |
| 注释质量 | 通过 — 模块头文档化了回滚行为 |

无风格违规。该模块质量与其他小型域辅助函数（如 `depth-from-tail.ts`、provider model 中的默认常量）相当。

---

## 可维护性

### 1. 公共导出位置（`provider.ts`）

该开关从 `@novel-master/core/provider` 再导出，与 LLM provider 类型、sampling 默认值、token 计数器并列。**语义不匹配：** 消费者是 VFS IPC 处理器与移动端文件 UI，而非 provider 配置。

**更合适的归属（按契合度排序）：**

1. `@novel-master/core/vfs` — 开关控制会话级 VFS write/mkdir/delete/rename 路由。
2. `@novel-master/core/agent` — `runAgentTurn` 是 flush 顺序的核心消费者。
3. 若开关增多，可增设专用 `@novel-master/core/feature-flags` 公共入口。

当前 placement 迫使 desktop/mobile 为无关 VFS 行为引用 `provider`，模糊依赖意图，并会在后续重构中造成困惑。

### 2. API 形态 vs 使用模式

调用点统一为：

```typescript
isUserVfsUnifiedToolTurnEnabled()
```

带参形式暗示依赖注入或设置查询，但无任何处提供 `configured`。两种解读：

- **占位 API** — 短期可接受，但未使用参数易误导；读者可能寻找并不存在的配置。
- **未完成 rollout** — 规范承诺可切换；实现停在编译期默认值。

建议尽快接入配置，或在接入前简化为常量再导出（避免「假」参数）。

### 3. 域文件夹成熟度

`feature-flags/` 仅含一个文件。单开关时可接受；若出现更多开关，可考虑：

- `feature-flags/index.ts` barrel
- 共享 `FeatureFlagReader` 端口或 `readFeatureFlag(name, default)` 辅助函数
- 同位单元测试：`test/domain/feature-flags/user-vfs-unified-tool-turn.test.ts`

### 4. 跨层一致性

`run-agent-turn.ts` 从 `@/domain/feature-flags/...`（内部别名）引用。应用从 `@novel-master/core/provider` 引用。**符号**使用一致，**公共模块**不一致 — 再次表明导出面需清理。

---

## 正确性

### 观测行为（默认开启）

无参调用 `isUserVfsUnifiedToolTurnEnabled()` → 返回 `true`。

| 消费者 | 启用时的行为 |
|--------|--------------|
| `runAgentTurn` | 若存在 `runtime.userVfsTurn`，在追加 user message 前调用 `flushPendingUserVfsTurnsWithTrailingUserReorder` |
| Desktop VFS IPC（write/mkdir/delete/rename） | 会话 scope 经 `executeSessionUserVfsOp` + `buildUserVfs*Op` 路由 |
| Mobile VfsFileManager / FileEditorScreen | 会话保存走统一 tool turn 路径，而非直接 `vfs.write` |

与统一 tool-turn 设计在 happy path 上一致。

### 缺失行为（回滚 / 关闭）

关闭时，规范要求：

> 关闭则恢复直写 VFS IPC + vfs markDirty + 旧 transcript 行为

**当前该路径不可达**，因为：

1. 无运行时配置传入 `configured: false`。
2. 无 env 变量（对比：`isLlmFetchDebugEnabled` 读取 `NM_DEBUG_LLM_FETCH` 与 `globalThis` — core 中已有模式）。
3. `run-agent-turn.test.ts` 从未断言关闭开关时 flush **被跳过**。

### 辅助函数本身的正确性

就签名而言，辅助逻辑**正确**：`configured ?? DEFAULT` 是合适写法。十六行内无边界 bug。

### 集成正确性缺口

因 `runAgentTurn` 中 flush 仅由开关 + `userVfsTurn != null` 门控，未来关闭开关需跨层协调：

- Core agent turn（跳过 flush）
- Desktop IPC（直写 VFS）
- Mobile UI（直写 VFS）

各站点已调用同一函数 — 良好 — 但接入配置后须收到**相同**配置值。在 `isUserVfsUnifiedToolTurnEnabled()` 内单一 env/KKV 源读取可强制一致；由各 app 传入 `configured` 易漂移。

---

## 测试覆盖

| 场景 | 是否覆盖 |
|------|----------|
| 默认值为 `true` | 仅隐式（无断言） |
| `configured: true` | 否 |
| `configured: false` | 否 |
| 关闭时 `runAgentTurn` 跳过 flush | 否 |
| 关闭时 desktop/mobile 回退直写 VFS | 否（应用层；超出 core 范围） |

**现有相关测试（间接）：**

- `run-agent-turn.test.ts` — flush-before-append 顺序、trailing-user 重排、flush 失败恢复。在开关隐式**开启**下运行；验证编排而非 flag 模块。
- `user-vfs-turn.service.test.ts` — 服务层 flush/merge；与 flag 无关。

**建议最小测试：**

```typescript
// test/domain/feature-flags/user-vfs-unified-tool-turn.test.ts
assert.equal(DEFAULT_USER_VFS_UNIFIED_TOOL_TURN, true);
assert.equal(isUserVfsUnifiedToolTurnEnabled(), true);
assert.equal(isUserVfsUnifiedToolTurnEnabled(true), true);
assert.equal(isUserVfsUnifiedToolTurnEnabled(false), false);
```

可选集成测试：mock/stub `isUserVfsUnifiedToolTurnEnabled`，或接入配置后传入，断言关闭时 `runAgentTurn` 不调用 flush。

---

## 与 core 内类似模式对比

| 模式 | 位置 | 配置来源 |
|------|------|----------|
| `isLlmFetchDebugEnabled()` | `infra/llm-protocol/logic/debug-fetch.ts` | `process.env`、`globalThis` |
| `isUserVfsUnifiedToolTurnEnabled(configured?)` | `domain/feature-flags/...` | **无**（参数未使用） |
| 域默认值 | 如 `DEFAULT_WORKTREE_DIR_RULE` | 静态常量 |

该 feature flag 今日更接近**静态默认常量**而非真 feature flag。规范中的 `userVfsUnifiedToolTurn` 名称暗示运行时切换，尚未实现。

---

## 发现项（按优先级）

### P1 — 功能缺口：开关未接入

**问题：** 规范要求通过 `userVfsUnifiedToolTurn` 回滚；实现始终启用统一路径。  
**风险：** 生产环境无法在不重新部署/改代码的情况下关闭统一 tool turn。  
**建议：** 在辅助函数内从 env（`NM_USER_VFS_UNIFIED_TOOL_TURN=0`）、KKV 或 app 设置读取（优先 core 内单一来源）。保持 `DEFAULT_USER_VFS_UNIFIED_TOOL_TURN = true`。

### P2 — 误导性公共导出（`provider`）

**问题：** VFS/agent 功能从 provider bundle 导出。  
**风险：** 错误心智模型，VFS 处理器引用 awkward。  
**建议：** 将再导出移至 `public/vfs.ts` 或新增 `public/feature-flags.ts` 导出路径；必要时 deprecate provider 再导出。

### P3 — flag 模块无单元测试

**问题：** 零直接测试；无 `false` 分支。  
**风险：** 辅助函数或未来配置接入回归未被发现。  
**建议：** 新增 `test/domain/feature-flags/user-vfs-unified-tool-turn.test.ts`。

### P4 — `runAgentTurn` 无关闭 flush 路径测试

**问题：** 编排测试假定开关开启。  
**风险：** 关闭开关仍可能 flush 或静默破坏顺序。  
**建议：** 增加开关关闭时断言不调用 flush 的测试。

### P5 — 未使用的 API 参数

**问题：** `configured?: boolean` 从未传入。  
**风险：** 死 API 面；误以为可按调用覆盖。  
**建议：** 端到端接入，或暂移除参数，仅导出 `DEFAULT_*` + 内部 reader。

### P6 — 文件夹规模（信息性）

**问题：** `feature-flags/` 域仅一文件、无 barrel。  
**风险：** 今日低；无约定可能蔓延。  
**建议：** 在域 README 文档化约定，或等第二个开关再补 index + 测试布局。

---

## 建议

### 短期（低工作量）

1. 为辅助函数增加单元测试（上述四条断言）。
2. 在模块 JSDoc 中说明配置**尚未接入**，并列出计划来源（env/KKV）。
3. 从 `@novel-master/core/vfs`（或新入口）再导出并更新 desktop/mobile 引用；若担心破坏引用，可暂时保留 provider 再导出并加 `@deprecated` 注释。

### 中期（对齐规范）

1. 在 `isUserVfsUnifiedToolTurnEnabled()` 内实现配置读取，遵循 `debug-fetch.ts` 模式，例如：

   ```typescript
   export function isUserVfsUnifiedToolTurnEnabled(
     configured?: boolean,
   ): boolean {
     if (configured !== undefined) return configured;
     if (process.env.NM_USER_VFS_UNIFIED_TOOL_TURN === "0") return false;
     return DEFAULT_USER_VFS_UNIFIED_TOOL_TURN;
   }
   ```

2. 增加 `run-agent-turn` 测试：env/参数关闭开关时验证跳过 flush。
3. 在发布/回滚 runbook 中提及该开关（规范 §875）。

### 长期（若开关增多）

1. `domain/feature-flags/index.ts` + 类型化开关名。
2. 可选 `FeatureFlagsPort` 供测试注入配置。
3. 避免在各无关 public barrel 散落 `isXEnabled()`。

---

## 结论

`feature-flags` 域**小、可读、风格良好**，但功能上是**带回滚文档的默认常量**，而非完成的 feature flag。`run-agent-turn.ts` 中的 core 集成在启用路径上正确。主要缺口为**缺少配置接入**、**provider 导出不匹配**、**缺少直接与负路径测试**。

默认开启的统一 tool turn 今日无需改动即可工作。在将其视为生产回滚杠杆前，应实现 P1–P4。

---

## 附录：完整引用列表

### 实现

- `packages/core/src/domain/feature-flags/user-vfs-unified-tool-turn.ts`

### Core 消费者 / 导出

- `packages/core/src/public/provider.ts`（再导出）
- `packages/core/src/service/agent/logic/run-agent-turn.ts:195`

### 相关测试（无 flag 引用）

- `packages/core/test/service/agent/run-agent-turn.test.ts`
- `packages/core/test/chat/user-vfs-turn.service.test.ts`

### 规范引用

- `.apm/kb/docs/Iterations/vfs-user-ops-unified-tool-turn/spec.md` — §739、§845、§875（`userVfsUnifiedToolTurn`）
