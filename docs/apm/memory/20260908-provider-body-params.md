---
date: 2026-09-09 00:25
title: tool_stream 非标字段报错与 provider 自定义参数设计
keywords: [tool_stream, glm, openai 协议, 非标字段, provider 高级字段, 自定义参数, body_params, schema v12]
abstract: 用户报「未知请求字段: tool_stream」（第三方 openai 网关严格校验），提议移除非标字段并给服务商配置新增「自定义参数」。双路探索确认 tool_stream 是 v1.4.21 为智谱直连流式 tool 缓冲问题硬编码注入的（仅按模型名正则判定、不看服务商）；方案定为移除硬编码 + 新增 body_params_json 配置 + 内置智谱 seed 预填保直连体验。
---

user:
（新需求）tool_stream 报错「未知请求字段: tool_stream」。它不是标准 openai 协议，不如移除那些不是 openai 标准协议的字段。服务商配置的高级字段，除了 header json，还可以加一个自定义参数，专门处理这种非标字段，你觉得呢？

assistant:
派两路 readonly 探索后给结论：

①tool_stream 来历：v1.4.21 为修智谱直连「流式 tool JSON 长时间缓冲」bug（glm-post-text-tool-buffer-no-loading）硬编码注入——openai.adapter buildBody 在 stream+tools+isGlmToolStreamModel(模型名正则) 时写 body.tool_stream=true，判定只看 vendorModelId 不看服务商/baseUrl，第三方网关模型名叫 glm-5.x 就中招。buildBody 其余字段（sampling 三件、reasoning_effort、stream_options 等）全是 openai 标准；历史非标（enable_thinking/thinking.type）已在 thinking-openai-unify 拆除。

②方案意见：同意移除硬编码（非标字段全走显式配置），但为智谱官方直连用户保底——内置智谱 provider 的 seed 直接预填 body_params 含 tool_stream（内置 seed 幂等列清单，改显式列即可），开箱体验不变；自定义网关默认干净。移动端老用户（内置智谱 seed 早已落库）需要升级后手动配一次或在 seed 幂等更新里带上。

③自定义参数设计（探索报告已给分层清单）：llm_provider 加列 body_params_json（ALIGN + SCHEMA_BOOT_VERSION 11→12——注意 regex-removal 已占用 10→11，必须基于集成分支开发）；值放宽任意 JSON（新写宽松解析，不复用 parseHeaders 的 string-only）；合并顺序定「用户 extraBody 最后合并、覆盖一切」（含 sampling/thinking 冲突时用户优先）；支持显式清空（避开 headers「清不掉」坑）；三协议 adapter 统一透传（openai/anthropic/gemini 原样合并进请求体顶层）。

待拍板：合并优先级、三协议 vs 仅 openai、内置智谱 seed 预填、是否基于集成分支开发（schema 版本号依赖）。流程待用户确认是否走 PRD/spec 一条龙。

user:
追问：官方文档 tool_stream 默认 false，移除不就回默认了吗？现在难道是 true？缓冲问题和【生成中】有什么区别？

assistant:
澄清：①现在代码硬编码发 true（stream+tools+GLM 正则即注入），报错正是字段带着 true 发出去被网关拒；②验证 mapper（tryEmitOpenAiToolUseIfComplete 只在攒完整才发事件、不渲染半截参数）与 webview（streamGenerating = uiRunning || toolInvoking 全程覆盖），true/false 观感无差——用户正确，撤回 seed 预填建议，定纯移除。用户拍板「做吧」。

执行（agile-dev 流程，探索沿用双 scout 报告）：worktree .worktree/provider-body-params（feat/provider-body-params，基于集成分支 c825d7ce，npm ci+全 dist 重建）；worker 子代理 inline 实现 7 笔提交（schema v12+body_params_json、domain/service/repo 贯穿、三协议尾部合并 extraBody、删 tool_stream 硬编码与 glm-tool-stream.ts、双端表单控件+清空语义、CHANGELOG）；主代理复核：tool_stream 残留 4 处均良性（placeholder 示例+测试夹具）、BOOT_VERSION src/dist 同步 12、extraBody 最后合并、独立重跑 12+13 用例全绿。全量：core 1815/desktop 116/mobile 1095/typecheck 0。PRD/SPEC 落盘 docs/Iterations/provider-body-params/features/provider-body-params/。待用户确认；分支待并（与集成分支一起或单独）。

user:
集成分支指什么？main 更新了需要合并下；另外测试断言 user_version === 11 不合理，哪有测版本号的。

assistant:
①集成分支 = feat/feature-optimizations-2026-09（三个 feature 的测试分支，provider 从它切出因 schema v12 叠 v11）。②发现主 worktree 已被并行会话切回 main（他们发了 v1.5.13 还在开新 worktree：smart-filename-sort/web-search-tool 等），故不动主 worktree，在 provider worktree 里完成合并：先 checkout 集成分支并入 main（c7c1a48e，CHANGELOG 冲突手工解：我方 Unreleased 叠在其 1.5.13 定稿之上），再切回 provider 并入集成分支（c72f56e2）。③解冲突时发现自己此前 merge-3（图表并入集成）时把 Unreleased「变更」两条目（移除正则系统、子会话隐藏）弄丢只剩空标题——本次合并已从 90a4bde8 取原文修复回。④user_version 断言：用户说得对，写死字面量 11 不合理（版本升即假红）；worker 已改为引用 SCHEMA_BOOT_VERSION 常量——断言语义变为「boot 把当前 schema 版本盖进 user_version」（快路径门，v9/v10 两次真机事故的正是戳没推进），不是测数字，版本再升不会挂。⑤合并后全量复验：core 1845/1845（含 main 带入的角色卡修复用例）、desktop 116/116、mobile 183 套 1098/1098、typecheck 0。

user:
把 tool_stream（provider 分支）合并到集成分支。

assistant:
integration-test worktree 合并 feat/provider-body-params（2bfefe8b，零代码冲突，CHANGELOG 六条全齐：新增 3 变更 3）。合并态环境踩缺 dist 三连（本 worktree 此前只建了 core/webview/部分驱动）：tdbc-driver-better-sqlite3（core 122 挂全是它）、desktop 四件 dist、sksp-mac（skill-zip-import 挂）——补建后全绿：core 1845/1845、desktop 116/116、mobile 1098/1098。core dist 重建 BOOT_VERSION=12，真机重启（v11→v12 二段升级）。本轮真机反馈四笔已入库（饼图标注/竖排详情/标题间距/推送图标+弹窗）。

user:
没问题了，生成 changelog 准备发布。

assistant:
按 novel-master-changelog 规程校对定稿 Unreleased：新增 3（推送/自定义参数/图表——图表条目归并点选详情竖排）、变更 2（正则移除/子会话隐藏）、修复 1（tool_stream 网关报错——用户真机实际遇到，从变更移入修复）；无维护段（内部清理均属移除功能的实现细节）；真机反馈四笔均为未发布功能的实现细节不单列。提交于集成分支，待发版（publish skill，默认 v1.5.13→v1.5.14 由用户拍板）。

user:
发布吧。

assistant:
publish 流程完成：主 worktree（并行会话 worker 同时在跑，操作保持原子）合并 feat/feature-optimizations-2026-09 进 main（28878f19，无冲突、未碰其脏文件）→ 四文件 bump（双端 package.json + build.gradle 默认 versionName + CHANGELOG Unreleased→[1.5.14] - 2026-09-08，镜像 v1.5.13 提交范围、不含 lock）→ 5234817f → tag v1.5.14 推送 → main 推送。CI Release v1.5.14 in_progress（Android APK + Windows NSIS + macOS DMG）。测试依据：合并态在 integration-test 全绿（core 1845/desktop 116/mobile 1098），bump 仅动版本字符串。
