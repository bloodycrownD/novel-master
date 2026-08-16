---
date: 2026-08-17 01:10
title: chat-fixes-2026-08 集成收尾——压缩锚定定稿、user ops 遗留丢弃、专属模型下拉修复
keywords: chat-fixes-2026-08, 压缩楼层, resolve-hide-message-range, 回滚, user ops 拆除, 专属模型下拉, feat/chat-fixes-integration
abstract: chat-fixes-2026-08 集成分支全部收尾：压缩锚定经 Metro 日志定位为 to 侧边界拦腰切断轮次，最终口径「从边界向旧找第一条真用户输入、整轮保留、保留 ≥ startDepth+1」（8846076）；user ops 遗留操作日志展示层直接丢弃（9e87da5）；专属模型下拉「两个模型 id」根因是重复计数只按 modelName 全局统计，改按 providerId+modelName 对齐工作区（ddbde2e）。教训：from/to 方向别搞反、单测 mock 必须贴协议形态、模糊需求先确认口径。
---

user:
把 feat/chat-fixes-2026-08 合并到主工作区集成分支，跑测试并修复失败。

assistant:
main 已发 v1.4.28，从 main 新建 feat/chat-fixes-integration 合入 chat-fixes-2026-08（唯一冲突 spec.md 取 worktree 侧）。基线确认 25 个失败套件全是存量：修了 jest 环境（sanitize-html@2.17.6 嵌套 ESM-only htmlparser2@12 全家需进 transformIgnorePatterns 白名单，每层 node_modules 都要命中）、9 条过期断言、webview 快照重发真回归（v1.4.21 起 pendingSubagentSessions effect 依赖不安定，任意重渲染多发 sessionSnapshot，改走 ref 修复，提交 4c2bf4c）。最终 core 1913 / mobile 728 / desktop 35 全绿。

user:
我从没说要「取消隐藏」菜单，我要的是隐藏的消息支持回滚；回滚不需要更改消息状态。

assistant:
需求 4 原文「隐藏的消息希望支持回归菜单」，首版把「回归」误读成「取消隐藏」做了整套 unhide。订正：unhide 菜单/handler/测试整体拆除；rollback 去掉 !hidden 前置，隐藏消息可回滚；回滚不改变消息可见性（core 回滚链路本就不碰 hidden）。提交 77d3b69。

user:
压缩不对。消息顺序必须 user assistant 交替，一开始的要求就是向上找 user 且非工具调用的消息，不允许第一条是 assistant。单测有问题吧？要不你 mock 个数据测试下？复现不了就加日志，我把 metro 发你。

assistant:
严格交替 mock 实测全过——嫌疑转向真实链路形态。加了 [compaction-debug] 日志（入口全量消息形态 + 锚定行走过程），同时按用户口径落了「可见前缀锚不出真用户输入 → 放弃压缩」（T-CF5），重建 core dist（mobile 跑 dist 不是 src，Metro 须 --reset-cache）。

user:
（Metro 日志）range=500..534，压缩后可见开头是 assistant tool_use / user(tool_result)。

assistant:
日志钉出根因：from 侧 500 锚定一直是对的，坑在 to 侧——startDepth=6 边界恰切在一轮中段，535 assistant(tool_use)、536 user(tool_result) 这段残缺轮留在可见头。首版修复把方向搞反了（to 侧向更新方向吃掉 534..537，可见只剩 2 条，被用户抓包「这是严格小于 6」）。

user:
可以超出 6，本来就是启发式搜索大于等于 6 第一条 user。

assistant:
重写为最终口径（8846076）：从 slice 最新边界向更旧方向找第一条真用户输入（user 且非 tool_result），只隐藏严格更旧的消息，锚点起的整轮保留；保留 ≥ startDepth+1，可见必以 user 开头；锚不出返回 null 放弃压缩。历史遗留的 anchor-must-assistant 校验与配对外扩逻辑全部拆除——它们是历次跑偏的源头。单测按最终口径重写 6 例全绿，调试日志拆除后再提交。

user:
没问题了。两点优化：user ops log 展示不需要兼容直接丢弃；agent 配置专属模型下拉会展示两个模型 id，和工作区模型下拉不一致。

assistant:
9e87da5：buildChatListItems/buildTranscriptRows 统一丢弃非 annotate 的 user_ops 附件，空正文仅剩操作日志的旧消息不再生成空行，原始 attachments 不篡改。ddbde2e 根因：AgentEditorForm 的 modelNameCounts 只按 modelName 全局计数，同一模型名挂两个服务商时被误判重复、每行露出与模型名相同的 vendorModelId 副标题，看似一行两个 id；改按 providerId+modelName 计数并按 label 排序，与 ModelPickerModal 同口径。changelog Unreleased、RULE 术语（压缩/回滚/user ops 拆除/KKV 域）同步更新。
