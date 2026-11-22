# p27 R6 波 3-2b 片 D1：desktop 壳/导航/聊天/会话段 i18n 迁移（2026-11-21）

分支 p27-backlog，commit `5e12975ab`。27 文件 229 处 coreT 迁移，键面 1127 个 ui.* 已立（波 3-1/3-2a），本片只做组件替换不碰注册面。

## 按键域分列（266 个键引用 / 229 行）

ui.chat 59、ui.common 52、ui.nav 46、ui.transcript 29、ui.session 16、ui.prompt 16、ui.stats 14、ui.project 12、ui.vfs 9、ui.skills 8、ui.runtime 1、label.transcript 4。

## 形态要点

- coreT 必须 descriptor 形态 `coreT({key: "ui.x.y", params: {...}})`——裸字符串是 literal passthrough 不查 catalog。
- `err instanceof Error ? err.message : coreT(...)` fallback 三元保持结构只换字面量。
- composed 句拆标签键拼（如 ToolCallCard open_hint = open_hint + open_kind.*；AppChrome pane_toggle_aria 带 label 参数）。
- 模块级常量（ROLE_LABELS）import 时求值 coreT 安全（catalog 构建期内嵌同步可用）。
- ChatComposer「未选择模型」是 modelLabel 比对协议哨兵，非 UI 文案，不迁。

## 重要发现：源码契约测试锁（波 3c 处理）

`test/session-detail-drawer.test.ts` 与 `test/workspace-zip-menu.test.ts` 用 readFileSync + 正则锁死源码中文字面量，迁移即红。涉及 11 串 13 处：

- drawer：`showToast("智能体信息加载失败")`（精确调用形态）、badge 三态 `metaLoadFailed ? "智能体信息加载失败" : "加载中…"`、点击卡提示三元（含「智能体信息加载中，请稍候再试。」）、「智能体已删除 · 点击重选」、「智能体锁定」、「当前智能体已锁定模型，会话内无法覆盖。」、「查看提示词」、「压缩上下文」（×2 含 ConfirmModal title）、`noneLabel="清除会话覆盖（使用智能体锁定模型）"`
- App.tsx：`'已导出 ZIP' : '已导出文件'` 两句锚（T-DM5，另锁 `exportFilePathForTarget(target) == null` 形态）

对应键 ui.session.* / ui.vfs.exported_* 均已立在 catalog（desktop 未消费、mobile 已消费）。处置：按「绝不碰测试文件」纪律回退保持原字面量、测试 774 全绿；后续对齐测试正则可参照 mobile 先例 commit `263f5d68e`（源码契约正则对齐收编后形态、断言意图不变）。

## 验证数字（stash 对照法）

- 主 typecheck 绿。
- renderer typecheck 294 条与 stash 干净基线**逐字节一致**（4 处仅因 import 行下移 1 行），本片零新增。注意：任务书披露基线 79 TS6307 + 1 TS2345 与实际 294 不符，是分支漂移；ratchet `typecheck:renderer:ratchet` RED（now 174 / baseline 178，79 new identities）与 stash 基线输出**逐字节一致**，同为分支既有欠账，涉及的 79 组全在 src/main 引用与 test 文件、1 组 SettingsViews.tsx，均非本片文件。
- npm test 774/774 PASS（回退 13 处测试锁字面量后转绿）。
- nm-style check PASS；dup FIND 3 组全在 apps/mobile + packages/core（并行片文件，desktop 零新增）；gate bare PASS。

## 漏键清单（键面无键，待波 3c 补）

1. SessionDetailDrawer.tsx:313 「已重命名会话」
2. SessionDetailDrawer.tsx:404 aria「查看会话技能」
3. SessionDetailDrawer.tsx:494 aria「切换大模型（已锁定）」（ui.session.switch_model 只有未锁分支可用）
4. MetricsDetailPopover.tsx:192 「会话累计」
5. settings-nav.ts:52/58 「关于」×2（ui.nav.about 是整句「关于 Novel Master」，无纯「关于」键）
6. 任务书误写：「已删除辅助文件」不在 App.tsx，实际在 renderer/features/skills/SkillDetailView.tsx:237（不在本片清单，未动）

## 残留豁免（UI 串口径）

测试锁回退 13 处（见上）+ 漏键 6 处 + 非文案 3 处（ChatComposer 哨兵 ×2 + console.error 一处）+ JSX/行注释若干不计。

## 其他

- `renderer/state/nav-workspace.ts` 有 6 处 UI 文案（会话工作区/聊天工作区/文件浏览器/工作区/项目/子智能体会话）不在本片清单，未动，待后续片收编。
- desktop 测试裸跑 `node --test test/workspace-zip-menu.test.ts` 会因 `@/` 别名不解析报 ERR_MODULE_NOT_FOUND，须走 npm test（run-tests.mjs）harness。
