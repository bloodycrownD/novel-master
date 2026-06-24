---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-06-24'
---
## 迭代划分（2026-06-23 确认）

| 迭代 | PRD 路径 | Feature |
|------|----------|---------|
| desktop-chat-workspace-polish | Iterations/desktop-chat-workspace-polish/prd.md | F2 F3 F4 |
| model-generation-params | Iterations/model-generation-params/prd.md | F1 |
| project-agent-config | Iterations/project-agent-config/prd.md | F5 |

## hide-message-open-slice-range（2026-06-24）
- Bug PRD: `Iterations/event-bus-compaction-conditions/bugs/hide-message-open-slice-range/prd.md`
- Bug SPEC: 同上目录 spec.md
- 根因: open startDepth 返回 anchor.seq~maxSeq 而非 slice min~max
- 修复: `resolve-hide-message-range.ts` 校验 assistant 后返回 minSeq~maxSeq

## mobile-compact-context-fix（2026-06-24）
- 独立 bug：关 AppModal 后 Alert 不弹（ConfirmModal）
- 非本 bug：压缩反馈 Toast、`[compact]` 调试日志
- 分支: `fix/mobile-compact-context-confirm`

## 术语与能力边界
- 工作区 scope：global / session / chat；工具卡片预览对齐 **聊天工作区（chat）**
- 「初始化」= 原 Desktop「从上级同步」
- 思考开关：按已保存模型、默认关；属生成参数，非 Agent/项目级
- 项目智能体：跟随（全局 currentAgentId）| 自定义（仅本项目，不进全局列表）
- F4 flush 过滤：仅减 transcript 噪音，磁盘已在 executeOp 生效
- **压缩上下文**：手动触发 `session.compaction.requested`；按事件配置执行（默认 hide-message depth≥6）；须二次确认，非直接隐藏

## desktop-workspace-ux-fixes（并行线）
- PRD: Iterations/desktop-workspace-ux-fixes/prd.md
- 与 polish 迭代独立；注意 ConversationPanel 合并冲突
