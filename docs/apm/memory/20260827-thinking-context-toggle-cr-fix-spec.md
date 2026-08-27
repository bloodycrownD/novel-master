---
date: 2026-08-27
title: thinking-context-toggle CR：撰写 cr-fix-spec（节点 spec-fix-thinking-context-toggle）
keywords: CR, fix-spec, thinking-context-toggle, feat/thinking-context-toggle, must-fix, P2, persistent-preferences 分组嵌套, resolvePreviewThinkingContext 重复, LlmProtocolKind, PreferencesError 容错, CHANGELOG Unreleased
abstract: 节点 spec-fix-thinking-context-toggle：为 feat/thinking-context-toggle（base b3429b0 / head 6e7e595，review_round 1，dag_version 2）新建 docs/Iterations/thinking-context-toggle/cr-fix-spec.md（draft，commit 666661b）。本 wave 全部 4 条 P2：MF-1 测试分组嵌套 + vfs 坏值覆盖丢失（对应偏差 SD-1）、MF-2 双端 resolvePreviewThinkingContext 约 44 行逐字重复下沉 core + LlmProtocolKind、MF-3 agent-runner 偏好读取 catch 回退 true + 标签日志、MF-4 CHANGELOG 补 Unreleased（对应偏差 SD-2）。另 Open questions 3 项（mobile 副标题档位例外文案 / 剥离决策日志 / UI 写偏好失败静默）、合并后 QA（真实服务商冒烟 + T-UI1/UI2 + changelog 校对）、K 节建议 4 条。只写文档不改实现代码。
---

user:
节点 spec-fix-thinking-context-toggle。只改文档不改实现代码。为 .woktree/thinking-context-toggle（分支 feat/thinking-context-toggle）新建 docs/Iterations/thinking-context-toggle/cr-fix-spec.md，落盘后 git add + commit（message：docs(cr): 记录 code-review 第一轮 fix-spec）。must-fix 4 条 P2 由用户给定（MF-1 测试分组嵌套 + vfs 坏值丢失、MF-2 双端预览口径重复 + wire 三份、MF-3 runner 偏好无容错、MF-4 CHANGELOG 缺条目），每条含 id/严重度/维度/文件/问题/改法/验收/来源；open_questions 3 项入「待拍板」附录；spec_deviations 如实记录（T-PF1 替换、CHANGELOG 缺失，对应 MF-1/MF-4）；结构按 skill 约定（元信息 / Must-fix P0→P1→P2 / Spec deviations / Open questions / 已豁免空 / 合并后 QA manual_user / K 节建议）。

assistant:
撰写前逐条核实了代码事实：persistent-preferences.test.ts L73 vfs describe 未闭合即嵌套 L87 thinkingContext（末尾 L111-112 双闭合），vfs 坏值用例被改写为 chat.thinkingContext（key 见 preference-keys.ts：vfs.userVfsUnifiedToolTurn）；双端 prompt-preview.service.ts 的 resolvePreviewThinkingContext 各约 43 行逐字重复（desktop L59-101 / mobile L57-99），协议类型为手写字面量联合，LlmProtocolKind 实际定义在 packages/core/src/infra/llm-protocol/ports/adapter.port.ts（inferLlmProtocolFromSavedModelId 即返回它）；agent-runner.ts L270-273 读取无 catch，KKV 坏值时 PreferencesError 炸 run；CHANGELOG 无 Unreleased（最新 1.5.4），changelog 惯例经 novel-master-changelog skill 确认（中文四分类 + 用户视角 + [Unreleased] 段）。runner 日志惯例确认：L663 console.error("[agent-runner] tag", {...}) 标签式，MF-3 改法对齐该风格。工具坑：grep/find_path 的 include_pattern 带点开头目录前缀（.woktree/...）时全部空手而归，换 shell 终端 grep 才命中——与 20260820 批次记录的 find_path 坑同类。另外 grep 工具不带 include_pattern 时会连 .woktree 里其他 worktree 的匹配一起返回，搜索主仓必须带 novel-master/ 前缀的 include_pattern。产物：cr-fix-spec.md（101 行，commit 666661b），实现代码零改动。

---

## 2026-08-27 执行轮（节点 fix-thinking-context-toggle）

user:
按 cr-fix-spec 修 4 条 P2（MF-1 测试分组 + vfs 坏值补回、MF-2 双端 resolvePreviewThinkingContext 下沉 core、MF-3 runner 偏好容错、MF-4 CHANGELOG Unreleased），在主仓 feat/2026-08-thinking-context-toggle 分支按逻辑块提交，每条修完跑定向测试，最后 core 全量确认无回归。

assistant:
四条全过，四个 commit：d56b0ed（MF-1）、70f1279（MF-2）、fe6f42d（MF-3）、9e8d956（MF-4）。关键实现：MF-2 新建 packages/core/src/service/prompt/resolve-preview-thinking-context.ts（repo 端口 Pick 入参，返回 protocol 用 LlmProtocolKind——它已从 public/provider 导出，无需补导出），经 public/prompt.ts 暴露；双端 prompt-preview.service 删本地副本改调 core，sessionConfig 读取留在双端调用点（helper 只收 agentModelId/sessionModelId 原始值）；public-prompt-allowlist.json 快照需同步补 resolvePreviewThinkingContext。MF-3 catch PreferencesError 回退 true + [agent-runner] thinking_context_pref_read_failed 标签日志，非 PreferencesError 照常冒泡；新用例验证 run 正常完成 + 最新轮 thinking 保留 + 日志含 key/code/fallback。验证：persistent-preferences / 新 helper 单测 / agent-runner（27 pass）/ render-prompt T-PV1 / package-exports allowlist / desktop session-prompt-input 全过；desktop+mobile typecheck 零错（均需先 npm run build core，双端走 dist）；core 全量 bash extglob 坑仍在——sh 不支持 extglob、bash -c 单行内 shopt -s extglob 也来不及生效（解析先于执行），改 npm run test:fast（无参 --test 自发现）跑通 2198 pass / 0 fail。坑：terminal 工具本轮前半持续报 tool input was not fully received（约 8 连挂），期间用 grep/find_path/diagnostics 文件工具推进，之后自愈；language server 对双端文件的诊断会拿过期 dist 解析 @novel-master/core/*，报一堆不存在的缺导出错误，build core 后消失，不要被误导。
