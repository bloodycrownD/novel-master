---
date: 2026-10-05 21:55
title: worktree 清理两轮（v1.5.18 后 / v1.5.38 后）
keywords: worktree, 分支清理, agent-run-parallel-and-notify, stash, Metro 锁目录, nm-worktree
abstract: 两轮 worktree 清理：v1.5.18 后清唯一附属 worktree+分支+stash；2026-10-05 清 D:\Dev\nm-worktree 与 D:\Dev\nm 两处共 5 个 worktree（含杀残留 Metro 进程树才删得动的坑），分支保留未删，feat/transcript-session-isolation 有 9 个未合回 main 的提交留在分支上。
---

user:
帮我清理 worktree 和 feature 分支，你看看是不是所有 worktree 和 feature 分支都基本合并了，没什么用了？

assistant:
查了一圈，仓库只有一个附属 worktree（.worktree/agent-run-parallel-and-notify），挂的 feat/agent-run-parallel-and-notify 已经全部合进 main（--no-merged 为空），worktree 内除 .tmp-metro/ 临时缓存外无未提交改动。用 git worktree remove --force 删掉 worktree，git branch -d 删分支（-d 安全删除校验通过），prune 后 .worktree 空目录也顺手移除。最终只剩 main（与 origin/main 同步在 3ea432b4），本地/远端均无残留 feature 分支。

另发现 3 个 stash 未动：stash@{0} 是该分支上的 pstream 调试探针（3 文件 16 行，对应 reload-busy-period-probe 排查），stash@{1}/{2} 是早已删除的旧分支（thinking-context-toggle、feature-c-ui-optimization）留下的各 2 行 package-lock.json 差异。均属可删的临时残留，但因删除 stash 不可逆，留给用户拍板。

user:
也都清理下吧。

assistant:
好，git stash clear 一次清掉全部 3 个 stash，验证列表已空。至此 worktree、feature 分支、stash 全部清理完毕，仓库只剩 main（与 origin/main 同步）。

user:
清理下 worktree（附路径 D:\Dev\nm-worktree、D:\Dev\nm）。

assistant:
两处共 5 个 worktree（nm-worktree 下 mc5/tcs，nm 下 despa/r1r2/tsi），全部无未提交改动；除 feat/transcript-session-isolation（tsi）外四个分支均已合入 main，tsi 分支上还有 9 个未合回的提交（转录域会话隔离轮，dev-ready）。本次只删 worktree、不动分支——删除 worktree 不影响分支与提交，需要时可 `git worktree add <路径> feat/transcript-session-isolation` 拉回。

删除过程踩坑：git worktree remove 多个报 Permission denied / Directory not empty，实为残留 Metro dev server 锁目录（tcs 端口 8084、tsi 端口 8081、despa 端口 18081——外层 cmd 持日志文件、内层 cmd 的 CWD 钉住 apps\mobile、连带 jest-worker 树），另有一个僵死 git grep 进程（CWD 指向早已不存在的 nm-worktree\upfx）。按命令行路径定位进程树根 taskkill /T /F（主仓 8082/8083 的 Metro 与其它项目进程未动）后 rmdir /s /q 收尾 + prune，两处父目录一并删除，git worktree list 只剩主仓。教训已补进 RULE.md worktree 条目；scripts/worktree-force-clean.ps1 只管删目录+prune，不含杀进程一步。
