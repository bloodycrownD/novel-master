---
date: 2026-08-31 12:00
title: 全局安装 pi coding agent CLI 及其内置示例插件
keywords: pi, pi-coding-agent, npm, 全局安装, 包迁移, @earendil-works, subagent 扩展, git-checkpoint 扩展, 软链接
abstract: 安装并升级 pi coding agent：注意包已从 @mariozechner/pi-coding-agent（停在 0.73.1）迁移到 @earendil-works/pi-coding-agent（0.84.4+）；@mariozechner/pi 是同名无关的 vLLM pods 工具；fd/ripgrep 缺失时 pi 会从 GitHub 下载，卡住就用 apt 装 fd-find + ripgrep。
---

user:
帮我安装 pi。

assistant:
先装了 @mariozechner/pi，发现它的 bin 是 pi-pods，描述是"CLI tool for managing vLLM deployments on GPU pods"，是个同名但无关的包，于是卸载了。

user:
我说的 pi agent。

assistant:
通过 npm search 确认真正的包是 @mariozechner/pi-coding-agent（pi coding agent 本体，提供 pi 命令）。执行 npm install -g @mariozechner/pi-coding-agent 装好了，验证 pi --version 输出 0.73.1，路径在 ~/.nvm/versions/node/v22.22.0/bin/pi。

user:
为什么 pi 无法直接使用？不在环境变量吗？

assistant:
排查确认：pi 装在 ~/.nvm/versions/node/v22.22.0/bin/pi，该目录在 PATH 里（nvm 经 ~/.bashrc 加载，默认 shell 是 bash），当前 shell 和登录 shell（bash -lc）都能 which 到，pi --version/--help 均正常。结论是环境变量没问题，用户侧找不到多半是旧终端的命令缓存（重开终端或 hash -r）或运行环境没 source bashrc；也可能是 pi 启动后的其它报错（如缺 API key），需要看用户的具体报错才能定位。

user:
实际运行 pi 输出 "fd not found. Downloading..." 和 "ripgrep not found. Downloading..."，然后卡住被 Ctrl+C。

assistant:
读了 pi 的 tools-manager.js 源码定位到机制：pi 启动时检查 fd 和 rg，先查自己的工具目录（~/.pi 下的 bin 目录），再查系统 PATH（fd 的 systemBinaryNames 是 ["fd","fdfind"]，认得 Ubuntu 的 fdfind），都没有就从 GitHub 下载最新 release（网络超时 10s/下载 120s），卡住是 GitHub 网络不通畅。解决方案：sudo apt-get install -y fd-find ripgrep 装系统级的即可跳过下载（sudo 要密码需用户自己跑）；或挂 HTTPS_PROXY 代理让下载完成；PI_OFFLINE=1 可跳过但会缺搜索工具，不推荐。

user:
这个 pi 不是最新的，有问题。

assistant:
官方 npm 上 @mariozechner/pi-coding-agent 的 latest 确实停在 0.73.1（time.modified 是 2026-05），不是镜像问题而是包迁移了。用 pi update self 升级，它自动卸载旧包并装上 @earendil-works/pi-coding-agent@0.84.4（新组织 scope），pi 命令路径不变。结论：以后装 pi 认准 @earendil-works/pi-coding-agent，旧 mariozechner scope 的包已停更。

user:
帮我安装下 subagent 插件与 checkpoint 管理插件，应该都是内置插件。

assistant:
查了 pi 自带文档和 examples 确认：这两个不是 pi install 的包，而是随包发布的官方示例扩展，位于 .../@earendil-works/pi-coding-agent/examples/extensions/ 下。subagent 是目录型扩展（index.ts + agents.ts），agent 定义按发现逻辑要放 ~/.pi/agent/agents/*.md（默认只加载用户级），工作流提示词放 ~/.pi/agent/prompts/；git-checkpoint 是单文件扩展（每轮 turn 用 git stash create 打检查点，/fork 时询问是否恢复代码状态）。安装方式按 subagent/README.md 用软链接：~/.pi/agent/extensions/subagent/{index,agents}.ts、~/.pi/agent/agents/{scout,planner,reviewer,worker}.md、~/.pi/agent/prompts/{implement,scout-and-plan,implement-and-review}.md、~/.pi/agent/extensions/git-checkpoint.ts 全部软链到 npm 包内的 examples 路径。注意点：软链指向 nvm 的 node_modules 路径，切换 node 版本或换安装路径会失效需重链；pi update 原地升级不影响；装完要重启 pi 或 /reload 才生效。


user:
还有什么内置插件？

assistant:
翻了 examples/extensions/ 目录，共 70+ 个示例扩展，按用途归类讲给用户：安全防护类（permission-gate 危险命令确认、protected-paths 保护 .env/.git/node_modules、dirty-repo-guard 有未提交改动阻止切会话、sandbox/gondolin 沙箱）、工作流类（plan-mode 规划模式、handoff 上下文交接新会话、todo 待办、preset 预设、tools 工具开关、summarize 对话总结、trigger-compact 超 100k 自动压缩）、Git 类（git-checkpoint、auto-commit-on-exit、git-merge-and-resolve）、界面类（status-line、model-status、custom-footer/header、notify 桌面通知、titlebar-spinner）、远程终端类（ssh 工具委托远程、interactive-shell 跑 vim/htop、inline-bash 提示词内嵌命令）、会话管理类（bookmark 配合 /tree、session-name）；其余为教学 demo 和小游戏（snake、doom-overlay 等）。安装方式同前：单文件软链 ~/.pi/agent/extensions/，目录型链整目录，或 pi -e 临时试挂。

user:
桌面通知（notify.ts）的原理是什么？用 SSH 是不是就没用了？

assistant:
读了 notify.ts 源码讲清原理：扩展监听 agent_settled（重试/压缩/后续消息全部结束后才触发），然后往 stdout 写转义序列——KITTY_WINDOW_ID 存在走 Kitty 的 OSC 99，WT_SESSION 存在（Windows Terminal 下的 WSL）调 powershell.exe 弹 toast，否则写 OSC 777（\x1b]777;notify;title;body\x07，Ghostty/iTerm2/WezTerm/rxvt-unicode 支持）。关键：扩展自己不调系统通知接口，弹窗由终端模拟器解析序列后代劳。SSH 场景结论恰好相反：转义序列是输出流字节，随 SSH 隧道传回本地终端解析，通知弹在本地桌面，天然适合远程长任务。真正失效的是：本地终端不支持 OSC 777（GNOME Terminal、macOS Terminal.app、VTE 系都不支持）、中间隔 tmux/screen 会吞序列（扩展没做 DCS 透传包装）、系统通知权限被禁、SSH 远端没有 KITTY_WINDOW_ID 会降级到 777 分支。验证方法：本地和 SSH 各跑 printf '\033]777;notify;Pi;测试通知\007'，弹了就支持；不支持可换 ntfy/Telegram bot 等网络推送方案。

user:
那安装吧。

assistant:
把 notify.ts 软链到 ~/.pi/agent/extensions/notify.ts，与之前的 subagent、git-checkpoint 同样方式（单文件扩展直接链入全局扩展目录）。至此 ~/.pi/agent/extensions/ 下共三个：subagent/、git-checkpoint.ts、notify.ts。生效需重启 pi 或 /reload。提醒用户先用 printf '\033]777;notify;Pi;测试通知\007' 验证本地终端支持 OSC 777，且 SSH 场景下不要隔着 tmux 跑 pi。

user:
你能调整 model 的默认窗口大小吗？比如 glm-5.3 是 1M，我想调整为 400k。

assistant:
可以，用 ~/.pi/agent/models.json 的 providers.<id>.modelOverrides 机制（按模型覆盖内置模型，保留计价元数据，未知 ID 会被忽略）。先 pi --list-models 确认 zai 和 zai-coding-cn 两个 provider 下都有 glm-5.3（均为 1M），于是两个都写了 modelOverrides：glm-5.3 → contextWindow: 400000。验证 --list-models 显示 400K，同家族的 glm-5.3-flash/highspeed 不受影响仍为 1M。说明：contextWindow 只是 pi 侧的账本（上下文占用百分比、自动压缩阈值、溢出恢复都按它算），不限制服务端真实接受量；models.json 每次打开 /model 时自动重载，改完即生效无需重启。
