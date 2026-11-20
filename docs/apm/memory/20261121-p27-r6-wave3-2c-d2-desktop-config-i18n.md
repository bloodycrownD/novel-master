# p27 R6 波 3-2c 片 D2：desktop 配置视图 i18n 迁移（2026-11-21）

任务：对号表已立键（keys.ts ui.* 1127 键），本片只做组件替换、绝不碰注册面。
范围：desktop 智能体/服务商/采样/聊天配置/技能/提示词配置视图 14 文件。
前序先例：片 D1（`20261121-p27-r6-wave3-2b-d1-desktop-shell-i18n.md`），RealPromptPanel /
PromptLeafCard / SessionSkillPanel / SkillTypeahead 四文件 D1 已迁完，本片复核残留全为注释、无需再动。

## 形态要点（沿 D1）

- `coreT({key: "ui.x.y", params: {...}})`，键必须包 descriptor——纯字符串直通回显不查 catalog。
- fallback 三元保持结构只换字面量；composed 拼接句用标签键拼；数据默认值（如 `"—"`）不迁。
- shared 内部用 `../logic/core-i18n.js` 相对路径，renderer 用 `@shared/logic/core-i18n`。

## 文件与迁移概要（14 文件，约 160 处）

- shared/config-forms/agent-editor-state.ts：TOOL_MODE_OPTIONS / MODE_OPTIONS / ROLE_LABELS /
  WORKPLACE_* / PROMPT_REGION_LABELS 常量全量键化；blockTypeLabel→`ui.common.text`；校验 3 条 +
  WORKPLACE_ASSISTANT_TEXT_REQUIRED_MESSAGE。
- shared/config-forms/ui-labels.ts：set/notSet/needsRepair/maxSteps(n) 键化；AGENT_LIST_LABELS
  生产零消费（SettingsViews 走 stored-config-validity），仅测试消费。
- shared/config-forms/agent-tool-catalog.ts：11 条工具 description。
- renderer/settings/AgentEditorView.tsx（~40 处）：title→ui.nav.agent_settings；edit_title 组合
  `params:{name, dirty: dirty ? ui.agent.unsaved_suffix : ""}`；builtin_tools_hint `params:{count:11}`。
- ToolPolicyPicker.tsx / AddModelModal.tsx（7）/ FetchModelsModal.tsx（12）/ settings-ui.tsx（2）/
  skill-ui.ts（3 域标签）/ SkillDetailView.tsx（~25）/ SkillsManageView.tsx（~18）/ ModelSamplingView.tsx
  （~15）/ SamplingForm.tsx（温度×3、max_output×3）/ WorkspaceSettingsView.tsx（~12）。

## 对号表外借键（波 3c 待裁决）

- skillsTag「技能」用 `ui.nav.skills`（同文复用，语义偏差）。

## 源码契约测试锁回退（保留原字面量，波 3c 对齐测试后迁）

回退 3 文件 5 处断言（测试 readFileSync+正则锁死精确串）：
1. AgentEditorView.tsx builtin desc「内置智能体，不可编辑——…」← settings-agents-tabs.test.ts
2. SkillsManageView.tsx menuItems 四项标签（编辑/编辑信息/导出 ZIP/删除）←
   skills-manage-export-menu.test.ts + skill-zip-import.test.tsx
3. WorkspaceSettingsView.tsx 两行流式开关 label+desc ← workspace-settings-subagent-stream.test.ts

## 漏键清单（键面无此键，保留字面量待波 3c 补键）

1. AgentEditorView.tsx:446「缺少 agentId」
2. AgentEditorView.tsx:525「无法加载智能体配置」
3. SkillDetailView.tsx「已删除辅助文件」（D1 已知）
4. SkillDetailView.tsx「相对路径（支持子目录…）」label
5. SkillDetailView.tsx「未保存的更改」title
6. ModelSamplingView.tsx「缺少模型」
7. ModelSamplingView.tsx「已更新模型名称」
8. ModelSamplingView.tsx「已保存模型设置」
9. ModelSamplingView.tsx「已恢复默认采样参数」
10. AgentEditorView.tsx builtin desc + SkillsManageView 菜单 + WorkspaceSettings 流式开关
    （并入上面契约锁回退处，不单独计键）

## 清单外发现（不动，移交）

- AgentWorkplaceBlockCard.tsx:56「助手确认语（只读）。」有键 ui.agent.assistant_text_readonly_hint，
  但文件不在本片清单，未迁。

## 验证结果（全部零新增）

- 主 tsconfig typecheck 绿；renderer typecheck 294 条与 stash 基线归一化比对（剥行号列号+消息文本）
  identities identical、code counts identical。
- `npm test` 774/774（首次 769/5，5 红全为上述契约锁，回退后全绿）。
- nm-style 显式 14 文件扫描与 stash 基线逐项一致：hygiene=15、dup(+3/-1)、oop=INFO(2) 均既有欠账。
- throw-audit：D2 单独存在 PASS（未登记 0）。工作区共存并行片 mobile M2 的 13 文件，其中
  ProviderForm.tsx:91/94 两条 throw 换 coreT 键后基线 JSON（scripts/throw-audit-baseline.json）
  未同步 → 全仓扫描报 blockers=2，经 mobile-only stash 对照证实归属 mobile 片待办，与 D2 无关。
- 禁 emit 构建未跑（纪律），desktop main 构建未触发。

## commit

`refactor(i18n): p27 R6 波 3-2c D2 desktop 配置视图迁移`（hash 见 git log），
git add 精确 14 源文件 + 本记忆文件，未混入 mobile M2 任何改动。
