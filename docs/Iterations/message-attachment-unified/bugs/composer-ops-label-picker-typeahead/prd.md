---
date: 2026-07-18
dependency: Iterations/message-attachment-unified/prd.md
---

# composer-ops-label-picker-typeahead Bug PRD

## 背景

`composer-at-token-tag-ux` 曾给 user_ops 状态 chip 加上「改稿 ·」前缀；产品未认可该文案，要求恢复为原有的 `动作:路径`（附件 `name` 原样，如 `write:/path`）。另：文件选择器确认插入 `@path` 后，输入区仍弹出 `@` 搜索 typeahead，体验错误。

## 现象描述

1. Composer 改稿状态 chip 显示为 `改稿 · write:/xxx.md`，而非 `write:/xxx.md`。
2. 用 `@` 文件选择器选中文件并确认后，搜索候选列表仍打开。

## 复现步骤

**文案**

1. 产生 user_ops 状态（改稿未发送）。
2. 观察 Composer 状态 chip 文案。

**Typeahead**

1. 打开 Composer，点 `@` 打开文件选择器（或先手输 `@` 再开选择器）。
2. 选中文件并确认。
3. 观察输入区上方是否仍出现文件搜索提示。

## 预期行为

- user_ops chip（及 Desktop 气泡同名字段）显示 `name` 原样：`动作:路径`。
- workplace 仍可用「规则 ·」与 `@path` 区分。
- 选择器确认插入完整 `@path` 后，typeahead 关闭（与手输 typeahead 点选一致）。

## 实际行为（修复前）

- user_ops 被套上「改稿 ·」前缀。
- 选择器在文末插入 `@/path` 时不补尾空格，且未替换未完成的 `@…`，`findActiveAtQuery` 仍判定为活跃查询 → typeahead 保持打开。

## 影响范围

Desktop / Mobile Composer 状态 chip；Desktop 消息附件卡文案；双端选择器插入路径。

## 验收标准

- [ ] user_ops chip 文案为 `write:/path` 等形式，**不含**「改稿 ·」。
- [ ] workplace chip 仍为「规则 · /path」。
- [ ] 选择器确认后 typeahead 关闭；正文完整 `@path` 后带尾空格（与 typeahead 点选一致）。
- [ ] 曾手输未完成 `@…` 再开选择器确认时，该段被替换为选中的 `@path`，不残留碎片。

## 回归测试要点

- Desktop：`attachment-draft-chips`、`message-attachment-group-card`、`composer-at-path`
- Mobile：`attachment-draft-chips`、`composer-at-path`
