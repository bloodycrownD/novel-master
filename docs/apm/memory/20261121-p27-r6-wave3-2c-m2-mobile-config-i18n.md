# p27 R6 波 3-2c 片 M2：mobile 配置域 i18n 迁移（2026-11-21）

## 做了什么

mobile 配置域 UI 文案迁移到 `coreT({key: "ui.*"})` descriptor 通道，29 个源文件 + 1 个 throw-audit 基线登记更新。键面（packages/core/src/i18n keys.ts 1127 键）不碰，注册面不碰，只做组件替换。

- Agent 域 4 文件：AgentEditorForm、AgentList、AgentPickerModal、useAgentEditorFormState
- Provider 域：ProviderForm、ModelPickerModal、FetchModelsSheet、ProvidersScreen、ProviderCreateScreen、ProviderDetailScreen
- 采样/聊天配置：ModelSamplingScreen、ChatConfigScreen
- Skills 域 6 文件：SkillPanelScreen、SkillsSettingsScreen、NewSkillModal、SkillInfoEditModal、SkillPicker、SkillDetailScreen
- SmartSort 2 文件：SmartSortRulesScreen、SmartSortRuleEditorScreen
- Prompt 域 8 文件：PromptEditorScreen、RealPromptScreen、components/prompt 6 组件
- AgentsSettingsScreen（清单内 1 处 create_failed，易漏）

## 关键经验

### 契约测试锁字面量 → 回退保留原中文（5 处）

mobile 有源码契约测试直接 `expect(src).toMatch(/中文/)`，迁移后字面量消失即红。stash 对照证实为本片引入后按 D1 先例回退：

1. `SkillInfoEditModal.tsx`：`{builtin ? '技能名（内置技能不可改名）' : '技能名'}`——skill-info-edit-modal-contract.test.ts:50 锁
2. `NewSkillModal.tsx` 技能名标签「技能名（即目录名，可在管理页重命名）」——同测试 :80 锁
3. `SkillsSettingsScreen.tsx` 行菜单 `label: '编辑信息'`——同测试 :62 锁（manageSrc 断言 `'编辑信息'` 带引号形式）
4. `ProviderDetailScreen.tsx` SegmentedControl 两个 tab `{value: 'config', label: '服务商配置'}` / `{value: 'models', label: '模型管理'}`——provider-detail-tabs.test.ts:29/:30 锁

这些留待波 3c 统一对齐正则（把测试断言也改成 coreT 形态）后再迁。

### nm-style 在 worktree 的两个坑

1. **`nm-style check --changed` 在 worktree 扫 0 文件**（git diff 语义在 worktree 失效）——必须 `git diff --name-only` 显式传文件清单，且**从仓库根执行**（从 apps/mobile 执行时相对路径解析不到）。全局 npm 装的 nm-style 入口坏（nvm 路径下 MODULE_NOT_FOUND），用 `./node_modules/.bin/nm-style`。
2. **throw-audit 基线键 = throw 语句原文**（空白归一）。ProviderForm 两处 throw 的 message 从中文字面量改成 `coreT({key})` 后，`scripts/throw-audit-baseline.json` 的站点键失配 → gate 报 2 处 VIOLATION-B 未登记。修法：更新基线 JSON 里这两个键为新原文（disposition/reason 照旧、line 同步），gate 回 PASS。这是工具登记面不是 i18n 注册面，允许更新。

### 迁移形态备忘（承接 3-2b M1）

- descriptor 必包：`coreT({key: "ui.x.y"})`，纯字符串直通回显不查 catalog；插值 `coreT({key, params: {...}})`。
- 模块常量级 coreT 调用合法（AgentList TAB_HINTS、SmartSort CAPTURE_KIND_OPTIONS、STATUS_LABEL、DISPLAY_LABEL、LOST_RESULT_TEXT 都是模块顶层 coreT 化）。但**单处引用的常量会被 nm-style 判 INLINE_CANDIDATE**——PromptEditorScreen 的 `DEFAULT_FORM_TITLE` 从字符串改成 `() => coreT(...)` 后被报「只有一处引用，内联」，最终直接内联进 title 表达式消除。教训：单处引用就别立常量，直接内联 coreT。
- composed 拼接句（builtin_prefix + description、section_hint_plain 前置 modelSubtitle、turn_aria 的 action 三元）用标签键取回再拼；数据值（role 名、实体名）不迁。
- 裸 JSX 文本（`<Text>已关闭</Text>`、Alert text、placeholder 属性）都要迁，自动反查脚本只抓引号串，裸 JSX 要手工对。

### comm 校验法（复用 M1）

`grep -rhoE 'coreT\(\{key: "[^"]+"' | sort -u` 与 keys.ts 提取键 comm -23。本片全 mobile src 430 键全部合法，零自立键。

## MISS 清单（键面无 → 保留中文，待键面补立后迁）

- 「操作失败」有键（ui.common.op_failed）；「禁用」（SmartSortRulesScreen 批量按钮）无 ui.common.disable
- 「已保存规则」「启用规则」「请先填写正则表达式」「正则无效：」「未保存的更改」「有未保存的更改」「智能数字」帮助段（title+body）——SmartSort 域
- 「已保存模型设置」「已恢复默认采样参数」——sampling 域两 toast
- 「加载技能失败」×3（SkillPanel/SkillDetail/SkillsSettings）
- 「请先选择项目与会话」——RealPromptScreen
- NewSkillModal 校验四句（描述不能为空/请选择所属项目/ZIP 根目录缺少 SKILL.md/目标域已存在同名技能）
- useAgentEditorFormState「未找到 Agent：${agentId}」、AgentEditorForm「有未保存的更改」
- TemplatePushButton「推送」按钮（有 push_failed/push_done 但无单独「推送」）
- ProviderForm「请至少修改一项」+ 3 个 dev-facing throw（Headers/Header/自定义参数 JSON 对象，已登记 BOUNDARY）+「连接」「认证」section 标题
- ProviderDetailScreen ManageHeader「已保存模型」
- SkillsSettingsScreen 删除确认 frame「。确定删除…？」与尾句「删除会清理整目录与对应禁用记录。」

## 验证结果

- comm 校验：430/430 合法
- typecheck 三段（tsconfig.build / src/web / e2e）：全绿
- npm test：2382/2384，2 红为分支既有（transcript-labels + chat-conversation-webview），stash 对照证实
- nm-style 显式 29 文件 + stash 基线比对：hygiene 34=34 零新增（仅 useAgentEditorFormState 行号 +1 漂移）；throw-audit gate PASS（基线更新 2 键）；PromptEditorScreen INLINE_CANDIDATE 内联消除
- 残留自检：33 处真实文案（去注释），全部为契约锁回退（5 处）或键面 MISS（28 处）
