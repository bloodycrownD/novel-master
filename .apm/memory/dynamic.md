---
createdAt: '2026-06-23 21:39:57'
updatedAt: '2026-06-29 12:00:00'
---
# hide-vfs-turn-prompt-char-count — PRD + SPEC 已落盘

## 状态
待用户确认 spec 后进入实现

## 文档
| 文档 | 路径 |
|------|------|
| PRD | `.apm/kb/docs/Iterations/hide-vfs-turn-prompt-char-count/prd.md` |
| SPEC | `.apm/kb/docs/Iterations/hide-vfs-turn-prompt-char-count/spec.md` |

## 现状摘要（探索结论）
- **缺陷 A**：`matchUserVfsTurnAt` 在 hidden 时返回 null，transcript 仍展示 hidden 消息但 user ops 拆成两条普通气泡；Mobile WebView + Desktop 共用 Core。
- **缺陷 B**：`PromptPreviewSegmentCard` 折叠时预览与 `· N 字` 共用 `numberOfLines={2}`，超长 worktree 首行挤掉字数；Android 复现；与展开正文无关。

## 已澄清（用户确认）
- hide 问题为 hide **期间**形态问题；hidden 只是状态，不应拆卡片
- 字数为折叠时展示不全，非展开正文问题
- Bug B 仅 Android 测试；A 双端均需修

## 下一步
用户确认 spec → 按 spec 实现（Core ForDisplay + PromptPreviewSegmentCard UI）
