---
date: 2026-06-24
---

# hide-message-open-slice-range Bug 修复规格（SPEC）

## 根因分析

`messageIdsInSlice` 正确选出 depth≥`startDepth` 的消息（如 10 条可见、`startDepth:6` → depth 6～9 共 4 条）。

`resolveHideMessageRange` 在 **仅 `startDepth`、无 `endDepth`** 分支中，assistant 锚点校验通过后返回：

```typescript
return { fromSeq: anchor.seq, toSeq: maxSeq };
```

其中 `maxSeq` 为切片内 **最大 seq**（靠近「新消息」一侧的边界），`anchor.seq` 常为 depth=`startDepth` 附近 assistant。更旧侧（seq 更小、depth 更大）的同切片消息 **seq < anchor.seq**，不在 `[anchor.seq, maxSeq]` 内，故未隐藏。

与 `event-bus-compaction-conditions/prd.md` 验收（depth 6～9 **全部** hidden）及 `depth-slice.test.ts` 语义冲突。

## 修复方案

- **开放式 slice**（`startDepth != null && endDepth == null`）：
  1. 保留 assistant 存在性校验（depth=`startDepth` 为 user 时向更旧侧找首个 assistant；无 assistant → `null`）
  2. 校验通过后返回 **`{ fromSeq: minSeq, toSeq: maxSeq }`**（切片内完整 seq 闭区间）
- **有界 slice** 或仅 `endDepth`：逻辑不变，仍为 min～max

## 变更点清单

| 文件 | 变更 |
|------|------|
| `packages/core/src/domain/depth/logic/resolve-hide-message-range.ts` | 开放式 slice 返回 minSeq～maxSeq |
| `packages/core/test/depth/resolve-hide-message-range.test.ts` | 更新期望 + PRD 对齐用例 |

## 详细改动说明

```70:70:packages/core/src/domain/depth/logic/resolve-hide-message-range.ts
  return { fromSeq: minSeq, toSeq: maxSeq };
```

模块注释改为「解析 open-ended depth slice 的 seq 隐藏范围」，不再声称「从锚点 seq 起」。

## 测试策略

### 测试用例

| ID | 文件 | 断言 |
|----|------|------|
| T1 | `resolve-hide-message-range.test.ts` | 10 条 + startDepth 6 → fromSeq=1, toSeq=4 |
| T2 | 同上 | depth6=user → 校验 assistant 后仍 min～max |
| T3 | `depth-slice.test.ts` | 切片命中条数不变 |
| T4 | `hide-message.handler.test.ts` | 集成 hide 范围与 range 一致（CI） |

### 验证命令

```bash
cd packages/core
npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test \
  test/depth/depth-slice.test.ts \
  test/depth/resolve-hide-message-range.test.ts
```

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 压缩一次隐藏更多历史 | 符合 PRD；用户可见 hidden 变灰条数增加属预期 |
| 依赖旧错误窄区间的测试 | 已更新 core 单测 |

**回滚**：恢复 `fromSeq: anchor.seq` 一行（不推荐）。

## 提交

- `2f5bb4b4` fix(core): open-ended hide-message 返回 slice 全量 min~max seq
- `f892b216` test(core): 对齐 open-ended hide-message 范围期望与 PRD 用例
