---
date: 2026-08-27
title: thinking-context-toggle CR：撰写 cr-fix-spec（节点 spec-fix-thinking-context-toggle）
keywords: CR, fix-spec, thinking-context-toggle, feat/thinking-context-toggle, must-fix, P2, persistent-preferences 分组嵌套, resolvePreviewThinkingContext 重复, LlmProtocolKind, PreferencesError 容错, CHANGELOG Unreleased
abstract: 节点 spec-fix-thinking-context-toggle：为 feat/thinking-context-toggle（base b3429b0 / head 6e7e595，review_round 1，dag_version 2）新建 docs/Iterations/thinking-context-toggle/cr-fix-spec.md（draft，commit 666661b）。本 wave 全部 4 条 P2：MF-1 测试分组嵌套 + vfs 坏值覆盖丢失（对应偏差 SD-1）、MF-2 双端 resolvePreviewThinkingContext 约 44 行逐字重复下沉 core + LlmProtocolKind、MF-3 agent-runner 偏好读取 catch 回退 true + 标签日志、MF-4 CHANGELOG 补 Unreleased（对应偏差 SD-2）。另 Open questions 3 项（mobile 副标题档位例外文案 / 剥离决策日志 / UI 写偏好失败静默）、合并后 QA（真实服务商冒烟 + T-UI1/UI2 + changelog 校对）、K 节建议 4 条。只写文档不改实现代码。
---

user:
节点 spec-fix-thinking-context-toggle。只改文档不改实现代码。为 .woktree/thinking-context-toggle（分支 feat/thinking-context-toggle）新建 docs/Iterations/thinking-context-toggle/cr-fix-spec.md，落盘后 git add + commit（message：docs(cr): 记录 code-review 第一轮 fix-spec）。must-fix 4 条 P2 由用户给定（MF-1 测试分组嵌套 + vfs 坏值丢失、MF-2 双端预览口径重复 + wire 三份、MF-3 runner 偏好无容错、MF-4 CHANGELOG 缺条目），每条含 id/严重度/维度/文件/问题/改法/验收/来源；open_questions 3 项入「待拍板」附录；spec_deviations 如实记录（T-PF1 替换、CHANGELOG 缺失，对应 MF-1/MF-4）；结构按 skill 约定（元信息 / Must-fix P0→P1→P2 / Spec deviations / Open questions / 已豁免空 / 合并后 QA manual_user / K 节建议）。

assistant:
撰写前逐条核实了代码事实：persistent-preferences.test.ts L73 vfs describe 未闭合即嵌套 L87 thinkingContext（末尾 L111-112 双闭合），vfs 坏值用例被改写为 chat.thinkingContext（key 见 preference-keys.ts：vfs.userVfsUnifiedToolTurn）；双端 prompt-preview.service.ts 的 resolvePreviewThinkingContext 各约 43 行逐字重复（desktop L59-101 / mobile L57-99），协议类型为手写字面量联合，LlmProtocolKind 实际定义在 packages/core/src/infra/llm-protocol/ports/adapter.port.ts（inferLlmProtocolFromSavedModelId 即返回它）；agent-runner.ts L270-273 读取无 catch，KKV 坏值时 PreferencesError 炸 run；CHANGELOG 无 Unreleased（最新 1.5.4），changelog 惯例经 novel-master-changelog skill 确认（中文四分类 + 用户视角 + [Unreleased] 段）。runner 日志惯例确认：L663 console.error("[agent-runner] tag", {...}) 标签式，MF-3 改法对齐该风格。工具坑：grep/find_path 的 include_pattern 带点开头目录前缀（.woktree/...）时全部空手而归，换 shell 终端 grep 才命中——与 20260820 批次记录的 find_path 坑同类。产物：cr-fix-spec.md（101 行，commit 666661b），实现代码零改动。
