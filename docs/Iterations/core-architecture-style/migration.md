---
date: 2026-06-21
---

# Core 架构与代码风格优化 — 迁移指南

> **SPEC**：[spec.md](./spec.md)  
> **分支**：`feature/core-architecture-style`  
> **策略**：硬破坏 — 本迭代 **不保留** deprecated re-export；合并前 apps 须已完成迁移。

---

## 概述

本迭代收窄 `@novel-master/core` 的 public 子入口边界：删除 `./front-matter`、新增 `./message-checkpoint`，并从 `./prompt`、`./provider`、`./session-fs` 移除非 canonical 符号。monorepo 内 apps 已在 Step 6 同步改 import；外部消费方请按下表迁移。

---

## 子路径变更

| 变更 | 旧路径 | 新路径 / 说明 |
|------|--------|---------------|
| **删除** | `@novel-master/core/front-matter` | 改用 `@novel-master/core/worktree` |
| **新增** | — | `@novel-master/core/message-checkpoint` |
| **收窄** | `@novel-master/core/session-fs` | 仅 SessionFs 门面与错误；checkpoint 符号迁至 message-checkpoint |
| **收窄** | `@novel-master/core/prompt` | 仅 prompt 组装/校验/LLM 导出；无 config-forms、无遗留 PromptBlock 类型 |
| **收窄** | `@novel-master/core/provider` | 无 feature-flags、无 `registerTokenizerDriver` |

Public 子入口总数：**12**（见 [public-api.md](../../../../packages/core/docs/public-api.md)）。

---

## 符号对照表

### Front matter 解析

| 已删除 | Canonical |
|--------|-----------|
| `@novel-master/core/front-matter` | `@novel-master/core/worktree` |

| 符号 | 旧 import | 新 import |
|------|-----------|-----------|
| `parseMarkdownFrontMatter` | `@novel-master/core/front-matter` | `@novel-master/core/worktree` |
| `splitMarkdownFrontMatter` | `@novel-master/core/front-matter` | `@novel-master/core/worktree` |
| `MarkdownFrontMatterSplit`（type） | `@novel-master/core/front-matter` | `@novel-master/core/worktree` |

### Agent 编辑器块操作（config-forms）

| 已删除 | Canonical |
|--------|-----------|
| `@novel-master/core/prompt` 的 editor-state 符号 | `@novel-master/core/config-forms/agent` |

| 符号 | 旧 import | 新 import |
|------|-----------|-----------|
| `movePersistBlock` | `@novel-master/core/prompt` | `@novel-master/core/config-forms/agent` |
| `updatePersistWorktreeRole` | `@novel-master/core/prompt` | `@novel-master/core/config-forms/agent` |
| `normalizePersistBlock` | `@novel-master/core/prompt` | `@novel-master/core/config-forms/agent` |

其余 editor-state 符号（`splitPersistBlocksForEditor`、`definitionToForm` 等）请直接从 `@novel-master/core/config-forms/agent` 导入；此前未从 `./prompt` re-export 的符号路径不变。

### Message checkpoint 与回滚

| 已删除 | Canonical |
|--------|-----------|
| `@novel-master/core/session-fs` 的 checkpoint 符号 | `@novel-master/core/message-checkpoint` |

| 符号 | 旧 import | 新 import |
|------|-----------|-----------|
| `createMessageCheckpointService` | `@novel-master/core/session-fs` | `@novel-master/core/message-checkpoint` |
| `createMessageRollbackService` | `@novel-master/core/session-fs` | `@novel-master/core/message-checkpoint` |
| `MessageCheckpointService`（type） | `@novel-master/core/session-fs` | `@novel-master/core/message-checkpoint` |
| `MessageRollbackService`（type） | `@novel-master/core/session-fs` | `@novel-master/core/message-checkpoint` |
| `RollbackOptions`（type） | `@novel-master/core/session-fs` | `@novel-master/core/message-checkpoint` |

**仍从 `./session-fs` 导入（未变）：** `createSessionFsService`、`SessionFsService`、`SessionFsError`、`isSessionFsError`、`isRollbackVfsDegradableError` 及 `sessionFsRollback*` 错误工厂。

### Feature flags（user VFS unified tool turn）

| 已删除 | Canonical |
|--------|-----------|
| `@novel-master/core/provider` 的 feature-flags 符号 | `@novel-master/core/feature-flags` |

| 符号 | 旧 import | 新 import |
|------|-----------|-----------|
| `DEFAULT_USER_VFS_UNIFIED_TOOL_TURN` | `@novel-master/core/provider` | `@novel-master/core/feature-flags` |
| `isUserVfsUnifiedToolTurnEnabled` | `@novel-master/core/provider` | `@novel-master/core/feature-flags` |
| `refreshUserVfsUnifiedToolTurnSnapshot` | `@novel-master/core/provider` | `@novel-master/core/feature-flags` |

### Tokenizer 驱动注册

| 已删除 | Canonical |
|--------|-----------|
| `@novel-master/core/provider` 的 `registerTokenizerDriver` | `@novel-master/core/nmtp` |

| 符号 | 旧 import | 新 import |
|------|-----------|-----------|
| `registerTokenizerDriver` | `@novel-master/core/provider` | `@novel-master/core/nmtp` |

**说明：** `getTokenizerDriver`、`resolveTokenizerDriver`、`clearTokenizerDrivers` 仍从 `@novel-master/core/provider` 导出（tokenizer 运行时 API）；仅 **驱动注册** 入口迁至 `./nmtp`。

### 遗留 PromptBlock 类型

| 已删除 | 说明 |
|--------|------|
| `@novel-master/core/prompt` 的 `PromptBlock`、`PromptBlockRole`、`PromptBlockLifecycle` | 非 public；core 内部使用 `@/domain/prompt/model/prompt-block.js` |

**仍从 `./prompt` 导入（未变）：** `AgentPromptLayout`、`PersistPromptBlock`、`DynamicPromptBlock`、`PersistTextPromptBlock`、`PersistWorktreePromptBlock` 及 prompt 组装/校验/LLM 导出 API。

### 已删除函数（零引用）

| 符号 | 说明 |
|------|------|
| `shouldIncludePromptTextBlock` | 已从 codebase 删除；无迁移路径 |

---

## 迁移示例

```typescript
// ❌ 旧
import { parseMarkdownFrontMatter } from "@novel-master/core/front-matter";
import { movePersistBlock } from "@novel-master/core/prompt";
import { createMessageCheckpointService } from "@novel-master/core/session-fs";
import { isUserVfsUnifiedToolTurnEnabled } from "@novel-master/core/provider";
import { registerTokenizerDriver } from "@novel-master/core/provider";

// ✅ 新
import { parseMarkdownFrontMatter } from "@novel-master/core/worktree";
import { movePersistBlock } from "@novel-master/core/config-forms/agent";
import { createMessageCheckpointService } from "@novel-master/core/message-checkpoint";
import { isUserVfsUnifiedToolTurnEnabled } from "@novel-master/core/feature-flags";
import { registerTokenizerDriver } from "@novel-master/core/nmtp";
```

---

## 验证清单

合并前建议执行：

```bash
# Core 全量
npm run build -w @novel-master/core
cd packages/core && npm run test:fast

# Apps 编译
npm run build -w @novel-master/cli
npm run build -w @novel-master/desktop
npm run build -w @novel-master/mobile
```

Grep 确认无残留：

```bash
# 应零匹配（monorepo apps/packages）
rg "@novel-master/core/front-matter" apps packages
rg "from ['\"]@novel-master/core/prompt['\"].*movePersistBlock" apps
rg "createMessageCheckpointService.*session-fs" apps
```

契约测试：`test/package-exports/public-subpath-allowlist.test.ts` 含 `message-checkpoint`、无 `front-matter`；`KNOWN_LEAKS` 为空。

---

## 回滚

优先 `git revert` 整个 merge commit。部分回滚按 SPEC Step 1–9 **逆序** revert 单个 commit。
