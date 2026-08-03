---
date: 2026-07-18
dependency: Iterations/message-attachment-unified/prd.md
---

# composer-at-token-tag-ux Bug PRD

## 背景

Feature `composer-at-token-prompt-dedup` 已约定：文件引用只认输入框里的 `@路径`（彩色/可见），不再使用可叉 attach chip；状态类信息（规则变更、改稿）仍用不可叉 chip。交付后用户反馈观感与验收不符。

## 现象描述

1. 使用 `@` 引用后，输入区仍出现「像文件附件一样的 chip」。
2. 输入框内的 `@路径` 看起来不是 tag，也没有足够明显的特殊颜色（尤其 Mobile 几乎无差异）。

## 复现步骤

1. 打开 Composer，用 `@` 选择器或手输搜索插入文件路径。
2. 观察输入框正文与上方 chip 行。
3. （可选）在有规则差集时对比状态 chip 文案是否易与旧 attach chip 混淆。

## 预期行为

- 文件引用：**不**以 attach chip 出现；只以输入框内可见的 `@路径` tag（着色 + 底色等）表达。
- 状态 chip（规则 / 改稿）保留，但文案须与文件引用区分，避免被误认为「@ 又回填了 chip」。
- 落库 / 草稿正文仍为纯字符串，不含 HTML。

## 实际行为

- Composer 已无 attach chip 渲染路径；用户所见多为状态 chip（原 `📄path` 文案与旧 attach 同形）或消息气泡附件卡。
- Desktop 仅有 primary 字色高亮，不像 tag；Mobile 为普通单色 TextInput。

## 影响范围

Desktop / Mobile Composer 输入与状态 chip 文案；Core `replaceComposerStatusAttachments` 数据层收紧（不再保留 draft attach）。

## 验收标准

- [ ] 双端输入框内 `@路径` 有可见 tag 观感（字色 + muted 底/等价）。
- [ ] 状态 chip 文案含「规则 ·」/「改稿 ·」等区分，不再使用易混淆的裸 `📄path`。
- [ ] 选择器 / typeahead / 回填仍不产生文件引用 attach chip。
- [ ] 正文 value / 落库仍为纯 `@/path` 字符串。

## 回归测试要点

- Desktop：`attachment-draft-chips`、`composer-at-path`（含 Step5 高亮契约）
- Mobile：同名 Jest 用例（含分段高亮纯函数）
- Core：`replaceComposerStatusAttachments` 不保留 attach
