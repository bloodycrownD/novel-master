---
date: 2026-08-22 00:10
title: pms-integration 分支整体 CR 与修复批次
keywords: code-review-loop, code-dev-loop, cr-fix-spec, ZIP 保留名, 桥残骸, iosTranslateY, 乐观锁, func-ready
abstract: feat/pms-integration（base 409ceca）四 scope 整体 CR 出 8 条 must-fix（含 D-1 P0 ZIP 绕过保留名），修复批次六笔提交全部闭合，344 用例全绿 + 三端 typecheck 0 错，cr-func func-ready；剩真机 QA。
---

user:
（@code-review-loop）对合并到主仓的 feature 分支进行整体 CR。

assistant:
四个 review-scope 并行（A 协议线 / B 工具线 / C mobile UI 线 / D 内置技能线）→ spec-fix 落盘 `docs/Iterations/pms-integration-cr/cr-fix-spec.md` → review-full（顺跑 core 202 用例全绿）。must-fix 8 条：D-1 P0（双端 NewSkillModal 的 ZIP imported 分支绕过 writeSkillFile 的保留名门，压缩包可带 agent-config/SKILL.md 覆盖内置技能）；A-1/D-2 P1（edadb49 把已删的 done 桥 ipc-types 两段带回——spec-fix 曾误报整链带回，主代理 grep+diff 复核修正）；C-1 P1（ToolPolicyPicker iOS 键盘避让退化，hook translateY 仅 Android）；MF-8 P1（mobile ZIP 重写分支漏传乐观锁，edadb49 只修了 desktop）；C-2/D-3/D-4/B-nit1 P2（DirectoryRuleSheet 缺 flexShrink、empty-state 硬编码 filter、agent-tool get 不 trim / update by-agentId 无判空、seed 指南正文表述）。B 线唯一 scope-ready。

user:
（@code-dev-loop）开发吧。

assistant:
修复批次六笔全闭合（HEAD 749261a）：
- b810fb0（A-1 桥残骸清零，主代理 trivial）。
- c182d30 + 87951c0（D-1 P0：保留名门抽公有 `assertSkillNameNotReservedForCreate` 上 SkillService 接口，desktop 新增 SKILLS_ASSERT_CREATE_NAME 通道五处接线，双端 ZIP 落盘前拦截、被拒中文提示不落盘；MF-8：mobile 重写分支先 readSkillFile 拿 version，writeSkillFile 传 expectedVersion）。
- 47e1610（C-1 选定方案 b：hook 加 iosTranslateY 选项默认 false、Android 不受影响，ToolPolicyPicker 传 true；C-2 DirectoryRuleSheet styles.form 补 flexShrink:1；配套 hook 三态用例 + tool-policy-picker 源码契约 + directory-rule-sheet 契约测试）。
- 4b58658（D-3 改 import BUILTIN_SKILL_NAMES「除内置名单外为空」；D-4 get by-name 先 trim；B-nit1 update by-agentId 先 getRawWire 判空再 upsert）。
- 749261a（deviations 收尾：过时注释 + writeSkillFile 带 expectedVersion 正向用例，主代理 trivial）。
验证：core 281 + desktop 16 + mobile 47 = 344 用例 0 失败，三端 typecheck 0 错；红线 grep（TOOL_TURN_BRIDGE 系）代码区零命中（唯一命中是 mobile 集成测试的「已移除」注记注释，属豁免）。cr-func func-ready（8/8 矩阵闭合、四项抽查过、deviations 全收）。
事故：D1MF8 节点又遇编辑器旧缓冲把 b810fb0 已删的桥三段旧代码写回磁盘（第三次同型事故），子代理用 python 精确删除三段 + git diff 复核处置——关键状态须用终端 grep/文件复写实锤后再编辑；用户侧务必 reload 编辑器缓冲（防护规则已入 RULE.md）。
剩余：合并后真机 QA（键盘四面板 iOS 重点 ToolPolicyPicker、mermaid C4 清晰度、agent-config 首启种入/删除拦截/编辑保存、ZIP 导入改名）；可选遗留：CHANGELOG 补 fetch-models 与 drive-by 条目、skill 工具 write 的 description 口径、seed 失败观测口径、git prune、旧 asar 清理。

user:
（@apm-usage）更新记忆。

assistant:
按 apm-usage 规范整理本次会话记忆：删 7 个纯 impl 节点报告与 1 个重复 mermaid 调研（有价值经验已并入主题文件），5 个主题文件补 front matter 与 user/assistant 轮次，`pms-integration-cr-fix-spec.md` 更名 `20260821-pms-integration-cr.md`；RULE.md「实现禁令与坑」新增「主仓提交前防编辑器旧缓冲回写」条目。
