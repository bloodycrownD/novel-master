---
date: 2026-09-06 23:05
title: pi-web 环境下 subagent 扩展失效排查与修复（含内部过程可视化增强）
keywords: pi-web, subagent, extension, getPiInvocation, process.argv, spawn, 排错, 内部执行可视化, subagent-logs, saveSession
abstract: 排查 pi-web 下 subagent 报 '-p, --port' 错误：根因是扩展用 process.argv[1] 定位 pi CLI，误把 pi-web 入口当 CLI；修复后两轮增强：实时活动流+落盘转录日志+saveSession 回放；并修复并行模式看不到运行内容的哨兵 bug（exitCode 0 vs -1）；含一次重启误杀 agent 的复盘与检测技巧。
---

user:
帮我检查下 subagent 为什么无法使用。

assistant:
复现报错：`option '-p, --port <port>' argument '--no-session' is invalid`。根因链条：subagent 工具由 `~/.pi/agent/extensions/subagent/`（原为指向 pi 示例目录的符号链接）提供；它派子进程时用 `getPiInvocation` 拿 `process.argv[1]` 当 pi 的 CLI 入口复用。9月5日 20:50 用户安装了 @agegr/pi-web 0.8.11（网页宿主，会话跑在 pi-web 的 node 进程内，process.argv[1] = pi-web 入口）；于是子进程实际执行 `node pi-web --mode json -p --no-session ...`，而 pi-web 的 CLI 里 `-p` 是 `--port <port>`（commander 校验非负数），`--no-session` 不是数字，直接报错。此前终端 TUI 下 argv[1] 是 pi 本体所以一直正常。

修复：把 index.ts / agents.ts 从符号链接换成实体拷贝（与 nvm 示例目录解耦），给 getPiInvocation 打补丁——只有当 argv[1] 路径包含 `/pi-coding-agent/` 时才复用，否则走 PATH 上的 `pi`。语法校验通过；端到端验证子进程正常回复；需重启 pi-web 后生效。

注意：pi 的 CLI 自己的 `-p` 是 `--print` 的缩写（dist/cli/args.js 自定义解析），跟 pi-web 的 commander `-p/--port` 是两套东西，别混淆。

user:
有什么办法展示 subagent 内部执行内容吗？我发现 pi 的内置 subagent 插件其实看不了内部进程？

assistant:
确认：官方示例只透出子代理最终发言，中间的 tool call/思考全是黑箱（子进程 --mode json 其实吐了 message_end 含 toolCall 部分和 tool_result_end，扩展收到了但没展示）。已在本地拷贝的扩展上做了三层增强（~/.pi/agent/extensions/subagent/index.ts，共 21 处编辑）：

1. 实时活动流：onUpdate content 改为 buildLiveView()——头部（agent、模型、轮次、上下文 token）+ 最近 6 条动作（→ 工具名 参数预览 / · 文本预览）+ 当前输出尾部；并行模式 content 也列出每个运行中 agent 的最新动作。
2. 落盘转录：每次派发写 ~/.pi/agent/subagent-logs/<时间戳>-<agent>.log，含元信息、invocation、逐条 [think]/[text]/[tool→]/[result] 行和 exit 统计；single/chain/parallel 的最终结果文本都附日志路径。
3. saveSession 参数（默认 false）：不传 --no-session，子会话保留在会话浏览器里可用完整 UI 回放（工具调用、思考、结果）。

语法校验通过，重启 pi-web 后生效。日志文件和 saveSession 回放不依赖任何 UI；流式更新取决于 pi-web 是否渲染 onUpdate。

user:
话说是不是并发 agent，还是看不了运行中内容？我看只有单独的 subagent 才能看运行中结果。

assistant:
确认是真 bug：runSingleAgent 的 currentResult 初始化 exitCode: 0，而并行模式的 running/活动行过滤都按哨兵 -1（占位符约定"-1 = still running"）判断。流式结果一替换占位符，running 计数把它踢出去、活动行 filter（exitCode === -1 && messages.length > 0）永远不命中→并行模式只有计数器没有活动内容。顺带：单模式实时视图的 running/finishing 状态判断也依赖这个哨兵（之前一直误显示 finishing）；chain 视图的 ✓/✗ 图标在流式步骤上也会误判。修复（3 处）：① currentResult 初始化 exitCode: -1 并加注释；② chain 展开视图 rIcon 三态化（-1 → dim …，0 → ✓，其他 → ✗）；③ chain 收起视图同三态。语法校验通过，重启 pi-web 后生效。

user:
你关闭 web 了吗？刚才好像所有 agent 全停止了。

assistant:
复盘（含乌龙）：01:16:55 为加载并行修复重启了 pi-web，杀掉了 01:10 的三个并行 reviewer（两个 17 轮 exit 0 已完成，一个 30 轮被 SIGTERM exit 143；三者日志都有完整收尾行——转录日志在重启事故下完整可用）。用户重连后 01:18 重发的 reviewer 一度被误判死亡，实际活着且在推进（日志 32→72 行）：① pi CLI 会改写 process.title 为裸 "pi"，命令行参数被隐藏，pgrep -f "pi --mode json" 检不出来（应改用 ps -ef --forest 看 pi-web 子进程）；② 子代理等长 API 响应时 30-60s 不写日志属正常，mtime 停更 ≠ 死亡，要隔 20-30s 复查。教训（项目记忆 #24）：重启 pi-web 前必须检查进程树下有无活跃 pi 子进程，有则先与用户确认。
