---
date: 2026-07-18
agile_trace: true
---

# composer-at-token-tag-ux 实现规格（SPEC）

## 根因 / 方案摘要

**根因（非「attach chip 回填」回归）**

1. Composer 仅渲染 `ComposerStatusChips`；`source:attach` 不渲染。用户所见 chip 多为 workplace/user_ops，且原 `formatAttachmentChipLabel` 对 workplace 输出 `📄path`，与旧文件引用 chip 同形。
2. Desktop `ComposerAtPathInput` 已接高亮，但 CSS 仅改字色，tag 感不足；Mobile 无高亮层。
3. `replaceComposerStatusAttachments` 仍会保留 existing attach（数据层死路径），与「draft attach 恒空」合同不一致。

**方案**

- 状态 chip 文案改为 `规则 ·` / `改稿 ·` 前缀。
- Desktop 强化 `.chat-composer__at-token` inline tag，并同步 scroll。
- Mobile 新增 `ComposerAtPathInput`（透明 TextInput + 分段着色）。
- `replaceComposerStatusAttachments` 只返回投影，丢弃 attach。

## 变更点清单

| 区域 | 变更 |
|------|------|
| 双端 `AttachmentDraftChips` | `formatAttachmentChipLabel` 文案 |
| Desktop `shell.css` + `ComposerAtPathInput` | tag 样式；scroll 同步 |
| Mobile `ComposerAtPathInput` + `ChatComposer` | 分段高亮接入 |
| Core `project-composer-status-attachments` | replace 不再保留 attach |
| 单测 | T-UI1 / Step5 / replace 用例 |

## 详细改动说明

### 状态 chip

- workplace：`规则 · ${path}`（目录 path 带尾 `/`）
- user_ops：`改稿 · ${name}`

### Desktop tag

- `background-color: var(--primary-muted)`、圆角、padding；负 margin 降低 caret 错位
- textarea `onScroll` → highlight 层同 scrollTop/Left

### Mobile tag

- `segmentComposerAtPathHighlight(text)` 纯函数分段 → `Text` 嵌套着色
- value 仍为纯字符串

### replace API

```ts
replaceComposerStatusAttachments(_existing, statusProjected) => [...statusProjected]
```

## 测试策略

### 测试用例

| ID | 说明 |
|----|------|
| T-UI1 | workplace/user_ops 新文案 |
| Step5 | 高亮 HTML 含 class；value 无 span |
| Mobile segment | 分段纯函数 |
| replace | 投影替换后无 attach |

针对性命令（worktree）：

- `apps/desktop`：`npm test -- test/attachment-draft-chips.test.ts test/composer-at-path.test.ts`
- `apps/mobile`：`npm test -- --testPathPattern="attachment-draft-chips|composer-at-path" --no-coverage`
- `packages/core`：`npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test test/chat/project-composer-status-attachments.test.ts`

## 风险与回滚方案

| 风险 | 缓解 |
|------|------|
| Desktop padding 导致 caret 错位 | 负 margin + 手工 smoke |
| Mobile IME / 光标与高亮层不同步 | 对齐 Desktop 叠层；问题则回退纯 TextInput |
| 消息气泡附件卡仍用同类 label | 属消息展示；本 bug 不改气泡结构，仅共享文案函数时状态更清晰 |

回滚：revert 分支 `fix/composer-at-token-tag-ux` 四枚功能 commit + 本文档 commit。
