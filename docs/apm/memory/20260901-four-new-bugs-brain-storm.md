---
date: 2026-09-01 23:50
title: 新四问题探索：长文本输入变删除、统计模型下拉与维度、工具卡 markdown 预览不渲染、速率单位改短
keywords: ChatComposer, TextInput, 数据统计, 模型下拉, provider 维度, markdown 预览, token/s
abstract: 用户报告四个新问题（均 mobile）：1) 输入框文本过长时出现"输入文字却删除文字"；2) 数据统计模型下拉无法滚动且建议改 provider×model 维度；3) 从工具卡片进 markdown 预览不渲染，切文本 tab 再回来才正常（疑入口未刷新）；4) 统计汇总平均速率单位 token/s 改为 t/s。按 brain-storm 派三路 readonly 探索。
---

user:
报告四个新 bug：1) 文本过长时输入框会出现"输入文字却是删除文字"；2) 数据统计的模型切换下拉框无法滚动、很多模型无法选择，建议统计维度改成 provider×model；3) markdown 渲染有问题——从工具卡片（如编辑）进 markdown 预览时不渲染，切到文本 tab 再切回来才正常，其他入口正常，怀疑入口没刷新；4) 统计汇总的平均速率单位 token/s 改成 t/s。要求使用 brain storm skill。

assistant:
按 ~/.agents/skills/brain-storm 流程派三路并行 readonly scout 探索（问题 2 与 4 同屏合并为一路），等待报告后汇总。

assistant(汇总):
三路 scout 报告结论：
1) 输入变删除：ComposerAtPathInput 是 children 驱动全量受控 TextInput（无 value prop），库每次渲染 createElement 新 children → 每键全文重推原生 EditText（仓库铁证：已回退提交 99f5299 注释明言"重推 children 只会重建 spannable"，因真机 T-C2/3/4 回归被 e8aac80 回退）；每键同步 5 趟 O(n) 全文处理（tryAtomicMentionDelete 的 parseValue 先于长度守卫、库 diffChars 全文差分、mentionValueToPlain、useMentions useMemo 再 parse、setText+persistDraft），长文本 JS 滞后 → 重推旧全文覆盖原生新输入。children 路径不走 RN mostRecentEventCount 守卫（TextInput.js 仅 value 字符串才走 setTextAndSelection）。次嫌疑：IME 组合期长度骤减触发 tryAtomicMentionDelete 误删整个 mention（仅含 tag 时）。修复方向：复活 99f5299 children 引用复用（先查 T-C2/3/4 失败形态）+ 守卫提前 + 纯文本快速路径。
2) 统计下拉：StatsFilterBar.tsx:98-152 弹层选项裸 .map 平铺、无 ScrollView/FlatList，pickerSheet maxHeight:420 直接裁剪——根因确定，包滚动容器即修。provider×model 维度：chat_message.provider 列已有但存协议名（anthropic/openai/gemini，agent-runner.ts:588 落库口径注释明确）；真服务商在 llm_saved_model.provider_id→llm_provider.display_name，可与 model_name=vendor_model_id JOIN。改维度波及 core SQL（getModelBreakdown GROUP BY+其他桶归并）+ UsageStatsModelRow 类型 + SummaryTab/StatsFilterBar/screen state + 测试；需用户拍板口径（协议 vs 服务商配置）。存量 provider NULL 占比需 COALESCE 兜底。
3) 工具卡 markdown 预览首进不渲染：txt tab 直接 return <Text> 卸载 RichDocumentWebView → 切回=全新挂载（"切 tab 就好"机制确认）；最强嫌疑=push 转场期间同步挂 WebView（FileEditorScreen.tsx:97-111 注释明说会卡转场但只给 physical 只读分支加 80ms 延迟，session 分支即工具卡入口裸挂）；html 空走 plain 模式显示原文（RN 侧首帧缺失基本排除，但 previewEngine==='rn'+session scope 的 mdAnnotateActive 组合会强制挂 WebView 且 html=undefined → plain，次生缺陷）。修复方向：session 分支同套延迟 或 仿 chat-transcript 的 setDocument ack+重挂。待用户分流症状：原文可滚动复制（plain）vs 空白（渲染合成）。
4) 速率单位：唯一拼接点 format.ts formatTokensPerSecond（现值 tok/s 非用户所说 token/s），两调用点 SummaryTab third 卡片+DetailTab；同步 4 处测试断言（token-usage-format.test.ts:98,102、token-usage-stats-screen.test.tsx:899,938）。单点改 t/s。
待用户确认：① provider 语义=协议名还是服务商配置（决定 JOIN 与否）；② bug1 纯文本无 tag 是否复现；③ bug3 首进症状是原文还是空白、工作区入口是否同样复现。

user:
确认：1) bug1 纯文本可复现，与 tag 无关；2) bug3 首进症状是空白（未渲染），不是显示原文。provider 口径问题未答。

assistant:
两条现场确认收敛根因：bug1 排除 mention 误删（④），主犯=children 全量重推+长文本 JS 滞后（①+②）；bug3 排除 plain 模式（B），坐实转场窗口 WebView 初始化失效（C）。开修：新分支按 2A/4/3/1 顺序。

user:
provider 维度拍板：统计落库记 providerId + modelId（vendor_model_id），不是 provider name。历史数据匹配不上可接受，服务商删除重建丢匹配也合理，完全不需要 join。

assistant:
口径确定：chat_message 增 provider_id 列（写入时快照，agent-runner 落 savedModel.providerId）；聚合 GROUP BY provider_id + model_name；显示名查询时经配置解析（listProviders），解析不到归"其他/已删除"桶；筛选值改 (providerId, modelName) 复合。注：现有 provider 列存协议名不动（BILLED_INPUT_SUM_SQL 依赖 anthropic 判断）。
