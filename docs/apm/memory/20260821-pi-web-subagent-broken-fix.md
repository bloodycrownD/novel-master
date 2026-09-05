---
date: 2026-09-06 21:45
title: pi-web 环境下 subagent 扩展失效排查与修复
keywords: pi-web, subagent, extension, getPiInvocation, process.argv, spawn, 排错
abstract: 用户反馈 subagent 无法使用；排查发现根因是 pi-web（9月5日晚新装的网页宿主）进程内运行会话，官方示例 subagent 扩展用 process.argv[1] 定位 pi CLI，误把 pi-web 入口当 CLI，子进程报 '-p, --port' 参数错误。已把扩展换成实体拷贝并打补丁，重启 pi-web 生效。
---

user:
帮我检查下 subagent 为什么无法使用。

assistant:
复现报错：`option '-p, --port <port>' argument '--no-session' is invalid`。根因链条：subagent 工具由 `~/.pi/agent/extensions/subagent/`（原为指向 pi 示例目录的符号链接）提供；它派子进程时用 `getPiInvocation` 拿 `process.argv[1]` 当 pi 的 CLI 入口复用。9月5日 20:50 用户安装了 @agegr/pi-web 0.8.11（网页宿主，会话跑在 pi-web 的 node 进程内，process.argv[1] = pi-web 入口）；于是子进程实际执行 `node pi-web --mode json -p --no-session ...`，而 pi-web 的 CLI 里 `-p` 是 `--port <port>`（commander 校验非负数），`--no-session` 不是数字，直接报错。此前终端 TUI 下 argv[1] 是 pi 本体所以一直正常。

修复：把 index.ts / agents.ts 从符号链接换成实体拷贝（与 nvm 示例目录解耦），给 getPiInvocation 打补丁——只有当 argv[1] 路径包含 `/pi-coding-agent/` 时才复用，否则走 PATH 上的 `pi`。语法校验通过；用 `pi --mode json -p --no-session --model zai/glm-5.3-flash "Task..."` 端到端验证子进程正常回复。当前会话仍挂旧模块（同错），需重启 pi-web 后生效。

注意：pi 的 CLI 自己的 `-p` 是 `--print` 的缩写（dist/cli/args.js 自定义解析），跟 pi-web 的 commander `-p/--port` 是两套东西，别混淆。
