---
createdAt: '2026-06-23 21:39:57'
updatedAt: '2026-06-29 14:00:00'
---
# hide-vfs-turn-prompt-char-count — 实现完成，待手工验收

## 状态
merge-ready（自动化验证通过；M1–M4 / D1 待设备手工）

## 分支
`fix/hide-vfs-turn-prompt-char-count`

## 提交
- `7f1ceaa6` fix(chat): hidden 时保留 user ops 卡片并修复提示词折叠字数
- docs 提交（PRD/SPEC）

## 验证
- core: user-vfs-turn-view.test.ts 通过
- mobile: message-blocks.test.ts 25/25 通过
- desktop vite build 通过
- 全仓 `npm run build`：mobile 因既有 Buffer 类型错误失败（与本次无关）

## 下一步
- Android 手工 M1–M4
- Desktop 手工 D1
- 可选：开 PR 合入 main
