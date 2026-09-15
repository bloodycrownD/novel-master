---
date: 2026-09-15 23:10
title: 清理 worktree、feature 分支与全部 stash
keywords: worktree, 分支清理, agent-run-parallel-and-notify, stash
abstract: v1.5.18 发版后清理唯一残留的附属 worktree 与已合并的 feat/agent-run-parallel-and-notify 分支；用户拍板后 stash clear 一并清掉全部 3 个 stash（调试探针 + 旧分支 package-lock 残留），仓库回到只剩 main 的干净状态。
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
