---
date: 2026-06-21
dependency: []
---

# Feature Flag 配置接入（feature-flags-config）技术规格（SPEC）

> **PRD**：[prd.md](./prd.md)  
> **调研基线**：`main` @ 2026-06-21（`domain/feature-flags`、`PersistentPreferences`、Desktop/Mobile/CLI runtime、vfs-user-ops-unified-tool-turn 规范）

## 设计目标

1. 将 `userVfsUnifiedToolTurn` 从**编译期默认常量**变为**可配置、可回滚**的 feature flag，默认仍为 `true`。
2. 持久化配置走 **`nm-preferences`**（与 `chat.llmStream` 同模式），env 提供**同步紧急 override**。
3. 保持现有 consumer **同步**调用 `isUserVfsUnifiedToolTurnEnabled()` 不变，通过 **module 级快照** 桥接 async preferences。
4. 补齐 **关闭路径** 测试，使规范 §875 回滚承诺可验证。
5. 修正公共导出面：flag 不再挂在 `@novel-master/core/provider`。

## 现状代码探索结论

| 区域 | 现状 | 问题 |
|------|------|------|
| `user-vfs-unified-tool-turn.ts` | `configured ?? DEFAULT`（16 行） | 无配置源；生产恒 `true` |
| `run-agent-turn.ts:195` | `isUserVfsUnifiedToolTurnEnabled() && runtime.userVfsTurn` 门控 flush | 关闭分支未测试 |
| Desktop `vfs.ts` | session scope + flag on → `executeSessionUserVfsOp`；off → 直写 | off 分支不可达 |
| Mobile `VfsFileManager` / `FileEditorScreen` | 同上 | 同上 |
| `public/provider.ts` | re-export flag 符号 | 语义不匹配（VFS 行为非 provider 配置） |
| `PersistentPreferences` | `session-fs.versionCheck`、`chat.llmStream` | 无 vfs flag key |
| 测试 | 无 `test/**/feature*` | 无 `false` 分支覆盖 |
| 类似模式 | `isLlmFetchDebugEnabled()` 读 env + `globalThis` | 可参考 env override，但产品配置应走 preferences |

### Consumer 引用图（实施前）

```
domain/feature-flags/user-vfs-unified-tool-turn.ts
  ├── public/provider.ts          (re-export, 待迁移)
  ├── service/agent/logic/run-agent-turn.ts
  ├── apps/desktop/.../vfs.ts
  └── apps/mobile/... (VfsFileManager, FileEditorScreen)
```

---

## 总体方案

### 1) Preference key 与 typed API

**文件**：`packages/core/src/service/persistent-preferences/impl/preference-keys.ts`

```typescript
/** User VFS unified tool turn (default true). Rollback disables flush + routes direct VFS. */
export const PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN = "vfs.userVfsUnifiedToolTurn";
```

**端口**（`persistent-preferences.port.ts`）新增：

```typescript
getUserVfsUnifiedToolTurn(): Promise<boolean>;   // default true
setUserVfsUnifiedToolTurn(enabled: boolean): Promise<void>;
resetUserVfsUnifiedToolTurn(): Promise<void>;
```

**实现**（`persistent-preferences.service.ts`）：与 `getLlmStreamEnabled` 相同模式，`getBooleanPref(key, true)`。

### 2) Domain 读取链（同步）

**文件**：`packages/core/src/domain/feature-flags/user-vfs-unified-tool-turn.ts`

```typescript
export const DEFAULT_USER_VFS_UNIFIED_TOOL_TURN = true;

/** Module snapshot set by runtime after preferences load (undefined = not refreshed yet). */
let preferenceSnapshot: boolean | undefined;

/** Called once per runtime init (and in tests). */
export function refreshUserVfsUnifiedToolTurnSnapshot(enabled: boolean): void {
  preferenceSnapshot = enabled;
}

/** Test helper — clears snapshot to simulate cold start. */
export function resetUserVfsUnifiedToolTurnSnapshotForTests(): void {
  preferenceSnapshot = undefined;
}

export function isUserVfsUnifiedToolTurnEnabled(
  configured?: boolean,
): boolean {
  if (configured !== undefined) return configured;
  if (process.env.NM_USER_VFS_UNIFIED_TOOL_TURN === "0") return false;
  if (preferenceSnapshot !== undefined) return preferenceSnapshot;
  return DEFAULT_USER_VFS_UNIFIED_TOOL_TURN;
}
```

**优先级（冻结）**：

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | `configured` 显式参数 | 单测 / 临时 DI；生产 consumer **不传** |
| 2 | `NM_USER_VFS_UNIFIED_TOOL_TURN=0` | 紧急关闭；`=1` 不强制开 |
| 3 | `preferenceSnapshot` | runtime `refresh*` 写入 |
| 4 | `DEFAULT_USER_VFS_UNIFIED_TOOL_TURN` | `true` |

**JSDoc** 须注明：产品配置经 `PersistentPreferences` + runtime refresh；env 仅运维 override。

### 3) Runtime bootstrap 接线

各客户端在 `create*Runtime` 中，`preferences` 创建后：

```typescript
import {
  refreshUserVfsUnifiedToolTurnSnapshot,
} from "@novel-master/core/vfs"; // 或 feature-flags 子入口

const enabled = await preferences.getUserVfsUnifiedToolTurn();
refreshUserVfsUnifiedToolTurnSnapshot(enabled);
```

| 客户端 | 文件（预期） |
|--------|--------------|
| CLI | `apps/cli/src/runtime.ts` |
| Desktop | `apps/desktop/src/main/runtime/create-desktop-runtime.ts` |
| Mobile | mobile runtime factory（与 `createPersistentPreferences` 同文件） |

**即时生效**：本迭代 **不要求** preferences 变更后 live refresh；重启 app / CLI 进程即可。后续 UI 设置页可在 set 后同步调用 `refresh*`（非本迭代）。

### 4) CLI `nm preferences`

扩展 `apps/cli/src/preferences-cmd/commands.ts`（或等价路由）：

- `set/get/reset vfs.userVfsUnifiedToolTurn`
- `list` 展示新 key
- 非法值拒绝（与现有 boolean pref 一致）

E2E：`apps/cli/test/preferences-e2e.test.ts` 增加与 `chat.llmStream` 平行的用例。

### 5) 公共导出迁移

**新增**（二选一，推荐 A）：

| 方案 | 路径 | 导出 |
|------|------|------|
| **A（推荐）** | `packages/core/src/public/feature-flags.ts` + `package.json` `"./feature-flags"` | `DEFAULT_*`, `isUserVfsUnifiedToolTurnEnabled`, `refreshUserVfsUnifiedToolTurnSnapshot` |
| B | `public/vfs.ts` 追加 | 与 VFS 工具并列 |

**从 `public/provider.ts` 移除** re-export，改为：

```typescript
/** @deprecated Import from `@novel-master/core/feature-flags` instead. */
export { ... } from "../domain/feature-flags/user-vfs-unified-tool-turn.js";
```

**更新 import**：

- `apps/desktop/src/main/ipc/handlers/vfs.ts`
- `apps/mobile/src/components/vfs/VfsFileManager.tsx`
- `apps/mobile/src/screens/stack/FileEditorScreen.tsx`
- `apps/mobile/test-utils/core-shim.ts`

`packages/core/test/package-exports*.test.ts`：若存在 provider 导出断言，同步调整。

### 6) 关闭路径行为（回滚契约）

与 [vfs-user-ops-unified-tool-turn/spec.md §875](../../../vfs-user-ops-unified-tool-turn/spec.md) 对齐：

| 层 | flag = true（现状） | flag = false（回滚） |
|----|---------------------|----------------------|
| `runAgentTurn` | flush pending user VFS turns | **跳过** flush |
| Desktop session VFS write/mkdir/delete/rename | `executeSessionUserVfsOp` | 直写 `vfs.*`（现有 else 分支） |
| Mobile session 保存/目录操作 | `userVfsTurn` 路径 | 直写 VFS（现有 else 分支） |
| transcript | U-A-U-A 四条 | 旧 markDirty + 直写行为 |
| checkpoint | flush 后 capture | 不经 user VFS flush 路径 |

**不改动** consumer 分支结构 — 仅使 `isUserVfsUnifiedToolTurnEnabled()` 可返回 `false`。

---

## 实现步骤

1. **Preferences**：key 常量 + port/impl 三方法 + 单测 round-trip。
2. **Domain flag**：快照 API + env + 更新 JSDoc；domain 单测四条断言 + env 用例。
3. **Runtime refresh**：CLI → Desktop → Mobile 顺序接线；各 runtime 启动后 assert 快照已设置（可选 debug log）。
4. **CLI preferences** 命令 + e2e。
5. **Public export**：新增 `feature-flags` 子入口；迁移 app imports；provider deprecated 再导出。
6. **集成测试**：`run-agent-turn.test.ts` 新增「flag off → flush 未调用」用例（通过 `configured: false` 或 env + 快照 false）。
7. **文档**：本 SPEC 状态更新；vfs runbook 增加一行回滚命令示例。

---

## 测试策略

### 单测（必须）

| 模块 | 用例 |
|------|------|
| `user-vfs-unified-tool-turn.ts` | 默认 `true`；`configured: false`；env `=0`；snapshot `false`；snapshot 未设回退默认 |
| `persistent-preferences` | get/set/reset `vfs.userVfsUnifiedToolTurn`；损坏值抛 `PreferencesError` |
| `preferences CLI e2e` | set/get/reset 新 key |

### Service 集成（必须）

| 模块 | 用例 |
|------|------|
| `run-agent-turn` | mock `userVfsTurn` + pending；`isUserVfsUnifiedToolTurnEnabled(false)` 或 env off → **断言 flush 函数未被调用** |
| 现有 flush 套件 | flag 默认 on → **全部保持通过** |

### 本迭代不要求

| 项 | 原因 |
|----|------|
| Desktop/Mobile E2E 直写 VFS | 应用层；手工 smoke 即可 |
| preferences 热更新 | 重启可接受 |
| 第二个 feature flag | 超出范围 |

### 建议测试代码（domain 最小集）

```typescript
assert.equal(DEFAULT_USER_VFS_UNIFIED_TOOL_TURN, true);
assert.equal(isUserVfsUnifiedToolTurnEnabled(), true);
assert.equal(isUserVfsUnifiedToolTurnEnabled(true), true);
assert.equal(isUserVfsUnifiedToolTurnEnabled(false), false);
```

---

## 文件变更清单

| 操作 | 路径 |
|------|------|
| 修改 | `domain/feature-flags/user-vfs-unified-tool-turn.ts` |
| 修改 | `service/persistent-preferences/**` |
| 新增 | `public/feature-flags.ts` + `package.json` export |
| 修改 | `public/provider.ts`（deprecated re-export） |
| 修改 | `apps/cli/src/runtime.ts`、`preferences-cmd/**` |
| 修改 | `apps/desktop/src/main/runtime/create-desktop-runtime.ts` |
| 修改 | Mobile runtime factory |
| 修改 | Desktop/Mobile VFS consumer imports |
| 新增 | `test/domain/feature-flags/user-vfs-unified-tool-turn.test.ts` |
| 修改 | `test/service/agent/run-agent-turn.test.ts` |
| 修改 | `test/persistent-preferences/persistent-preferences.test.ts` |
| 修改 | `apps/cli/test/preferences-e2e.test.ts` |

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| runtime 未 refresh 快照 → 始终默认 `true` | 各 runtime 创建后**必须** await refresh；可加 dev-only assert |
| env 与 preferences 冲突 | 冻结优先级：env `=0` 仅强制关，不强制开 |
| 关闭 flag 后会话 pending 列残留 | 文档说明：回滚不自动清空 pending；运维可选手动清理（非本迭代自动化） |
| export 迁移破坏外部引用 | provider 保留 deprecated 再导出一个版本 |

### 回滚 runbook（实施后）

```bash
# 方式 1：preferences（需重启 CLI/app）
nm preferences set vfs.userVfsUnifiedToolTurn false --db <path>

# 方式 2：env 紧急 override（同步生效）
export NM_USER_VFS_UNIFIED_TOOL_TURN=0
```

恢复默认：`nm preferences reset vfs.userVfsUnifiedToolTurn` 或 unset env。

---

## 与相关迭代关系

| 迭代 | 关系 |
|------|------|
| `vfs-user-ops-unified-tool-turn` | 本 SPEC **落地** §739/§875 承诺的 flag；不重复 U-A-U-A 实现 |
| `chat-user-vfs-turn` | 互补：该 feature 处理 flush 语义；本 feature 提供**关闭 flush 的开关** |
| `public-api-boundaries` | 本 feature 仅迁移本 flag 导出；全量 export 收敛仍属彼 feature |
| `persistent-state-and-preferences` | 复用现有 `nm-preferences` 模式，无新 module |

---

**状态**：PRD + SPEC 待用户确认后进入实现。
