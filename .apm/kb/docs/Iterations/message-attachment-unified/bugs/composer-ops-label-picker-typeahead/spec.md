---
date: 2026-07-18
agile_trace: true
---

# composer-ops-label-picker-typeahead 实现规格（SPEC）

## 根因 / 方案摘要

**文案**

- 根因：`04edc592`（tag-ux）将 `formatAttachmentChipLabel` / 随后气泡 `formatMessageAttachmentLabel` 的 user_ops 改为 `` `改稿 · ${a.name}` ``；而 Core `name` 本就是 `formatUserOpsActionLabel` → `action:path`。
- 方案：UI 改回 `return a.name`；workplace 保留「规则 ·」。

**Typeahead**

- 根因：`insertTokensIntoComposer` 的 `gapAfter` 在文末为 `""`（与 `replaceActiveAtWithToken` 相反）；完整 `@/path` 无尾空格时 `findActiveAtQuery` 仍返回活跃查询。次因：有 `activeAt` 时未整段替换。
- 方案：双端对齐 typeahead——补尾空格；有 `activeAt` 时从 `activeAt.start` 替换到光标。

## 变更点清单

| 区域 | 变更 |
|------|------|
| 双端 `AttachmentDraftChips` | user_ops → `a.name` |
| Desktop `MessageAttachmentGroupCard` | user_ops → `a.name` |
| 双端 `ChatComposer.insertTokensIntoComposer` | 尾空格 + 替换 activeAt |
| Desktop/Mobile 相关单测 | 期望与契约用例 |

## 详细改动说明

### 文案

```ts
if (a.source === "user_ops") {
  return a.name; // write:/path 等
}
```

### 选择器插入

- `gapAfter = after.length === 0 || !/^\s/.test(after) ? " " : ""`
- `activeAt != null` → `start = activeAt.start`，`end = max(cursor, selectionEnd)`（Mobile：`end = cursor`）

## 测试策略

### 测试用例

| ID | 说明 |
|----|------|
| T-UI1 | user_ops 为 `write:/ops.md`，无「改稿 ·」 |
| T-HC5 | 气泡 user_ops 同左；workplace 仍「规则 ·」 |
| T-ATD-picker | `@/a.md` 无空格 → active；带尾空格 → null |

验证（worktree）：

- Desktop 15/15：`attachment-draft-chips` + `message-attachment-group-card` + `composer-at-path`
- Mobile 11/11：`attachment-draft-chips` + `composer-at-path`

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| 与 tag-ux「改稿 ·」旧验收冲突 | 本 bug 产品改口；以本 PRD 为准 |
| 尾空格进正文 | 与 typeahead 点选一致；扫描/trim 既有行为 |

回滚：revert `1a754c9d` + `e3f3ced9`。
