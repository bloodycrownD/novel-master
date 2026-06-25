---
createdAt: '2026-06-23 21:39:57'
updatedAt: '2026-06-24 00:00:00'
---
# desktop-chat-workspace-polish — SPEC 待确认

## 状态
- PRD 已与 SPEC 对齐（F4 = checkpoint 终态 diff flush）
- 阶段：spec 待用户确认后进入实现

## SPEC 路径
`Iterations/desktop-chat-workspace-polish/spec.md`

## 核心方案要点
- 阶段1：F3 更多菜单（ContextMenu）→ F2 工具卡片（vfsToolFilePath + openChatWorkspacePreview）
- 阶段2：F4 checkpoint 终态 diff 合成 actionXml（非 pending FIFO 过滤）；空目录/ rename 在 flush 合成层处理
- PRD F4 文案仍为 pending 过滤；SPEC 以 checkpoint diff 为准

## 待确认项
- F4 edit 回滚：SPEC 纳入内容相等跳过（比 PRD defer 更广）— 用户是否接受
- rename 首版仅单文件 1:1 内容配对
