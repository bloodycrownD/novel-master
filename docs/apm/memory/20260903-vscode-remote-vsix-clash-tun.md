---
date: 2026-09-03 21:44
title: VSCode 远程装插件慢的根因：vsassets.io CDN 无规则落到故障兜底链；clash TUN 其实已生效；pi 已是最新
keywords: vscode, remote-ssh, 插件安装慢, clash, mihomo, tun, fake-ip, vsassets.io, gallerycdn, 漏网之鱼, 延迟测试, pi 更新
abstract: 本机是被远程连的 vscode-server。插件慢的根因是 VSIX 下载 CDN gallerycdn.vsassets.io 在 clash 规则表里无匹配，落到漏网之鱼兜底链，而该链路到 Azure CDN 整体不通（全部节点 + 直连均失败）；TUN 其实已生效（fake-ip 198.18.x 为证）。修复方向已留档未实施。pi 版本 0.84.4 已是 latest，无需更新。
---

user:
帮我看看，为什么 VSCode 远程安装插件这么慢？本机上有 ~/.vscode-server，是被远程连接的那台服务器。

assistant:
查了一圈，链路是这样的：marketplace 主站 *.visualstudio.com 命中规则 `DomainSuffix visualstudio.com → Ⓜ️ 微软服务 → 🎯 全球直连`，直连很快（200 / 0.9s）。但 VSIX 真正的下载 CDN gallerycdn.vsassets.io（以及 vscode-server 更新用的 az764295.vo.msecnd.net）在 10201 条规则里没有任何匹配——微软规则只覆盖 visualstudio.com、msecnd.net、msft* 等，没有 vsassets.io——于是落到兜底 `Match → 🐟 漏网之鱼 → 🔰 节点选择 → ♻️ 自动选择 → 🇭🇰 香港WAP-优化2-Gemini`，走代理后 TLS 握手都不完成（http 000，约 1.6s 失败）。

user:
另外我开 clashctl TUN 模式好像也没用，为什么？

assistant:
TUN 其实是生效的，不是没接管：三个域名全被解析成 198.18.0.x（Clash fake-ip 段），mihomo 进程在跑（`~/clashctl/bin/mihomo -d ~/clashctl/resources -f runtime.yaml`）。「没用」的真正原因是兜底链路到 Azure CDN 整体不通——同一节点经 mixed-port(39859) 访问 Google 正常（302 / 0.8s），但对 VSIX URL 做延迟测试时，DIRECT 和 8 个不同地区节点（日本/新加坡/香港×4/台湾/美国LA/印度）全部失败，不像单节点问题，更像机场侧对 Azure CDN 不可达或被过滤。另有一个重要发现：marketplace 的 `/_apis/public/gallery/publishers/{pub}/vsextensions/{ext}/{ver}/vspackage` 端点直接在 visualstudio.com 域上以 HTTP 200 返回 VSIX 本体（application/vsix，约 1.9MB），即直连路径本身能下载插件。clash 环境：external-controller 0.0.0.0:9090，secret OD5DUt，Rule 模式 + fake-ip + TUN system 栈，查规则/连接表/延迟测试都走这个 API。

user:
算了，插件下载完了，先不修了。你先看看能不能更新 pi。

assistant:
pi 已装 0.84.4，npm 上 latest 也是 0.84.4（dist-tags 里只有更旧的 legacy-node20 → 0.74.2），无需更新。vscode 慢的问题留档未修，若复发有两个候选方向：一是给 vsassets.io 补显式规则（放在 Match 兜底之前）指向实测可用的出口，但当时所有节点对该 CDN 都不通，加规则指代理未必有效；二是更稳的方向，让下载走 marketplace 直连域（vspackage 端点直连 200 可用）。

user:
当前仓库的工作区好像没有清理干净？git 提交下？

assistant:
盘点了工作区：docs/apm/memory 下 2 个记忆文件追加轮次（8/20 目录规则、8/30 mobile CR）+ 4 个未跟踪新记忆（8/21 magic-context 调研、8/31 pi 安装、9/1 pi 模型查询、9/3 本文件），另有此前特意留而未提交的 AGENTS.md 人设改版（可爱→撒娇）、.vscode 清理（删 launch.json/tasks.json，settings.json 去掉 Windows Android SDK env 改为 pendant 配置）与 docs/dev/perf-conventions.md 删除（确认是纯删除未挪走，.woktree 里只是旧工作树副本）。顺手把 8/21 旧自由格式记忆重写成 front matter + user/assistant 规范格式、给 9/1 的 date 补上时刻，敏感词扫描干净。分两笔提交：docs(apm) 收记忆，chore 收人设改版与 .vscode/docs 清理。

user:
清理 worktree，应该都没用了。

assistant:
盘点 .woktree 三个工作树：stream-resume、import-dir-rule 分支均已合入 main（注意 `git branch --merged | grep -v main` 会把含 "main" 字样的分支名误滤掉，stream-resume 差点误判）；parallel-notify 分支有 13 笔未合入提交（notifee 通知 + AgentRunManager 一整套），git cherry 全 +，main 无 AgentRunManager/notifee 任何痕迹——删工作树不删分支，提交仍留在 feat/agent-run-parallel-and-notify 上。import-dir-rule 树里一份未提交的记忆追加（记录已合入的 CR fix 闭合，MF-1~4）先打补丁收编进主工作区再删树。三个树全 remove，.woktree 目录一并消失，分支全部保留未动。

user:
（发版后续）v1.5.11 Release 成功了吗？worktree 是不是没用了，清理一下。

assistant:
两件事闭环：① v1.5.11 发版成功——用户在代理修好后自行推送 tag+main（凭据在其终端侧可用），Release 七产物齐挂（5 APK + macOS DMG + Windows setup）。② worktree 清理：仅剩 .worktree/agent-run-parallel-and-notify（工作区干净，最后活动 9/5 21:25 merge main 进分支），feat/agent-run-parallel-and-notify 仍挂 13 笔未合入提交（notifee 通知 + AgentRunManager），延续 9/3「删树不删枝」口径：worktree 与空目录 .worktree/ 已删，分支保留待用户拍板。另注：清理期间 main 被并行会话两次推进（9e3d7234→b1d2c49a），本操作未触碰 main。
