---
date: 2026-09-04 00:20
title: 浅克隆 magic-context 与 legado-E 到 .reference（git 全局代理指向死端口 7890 的坑）
keywords: reference, magic-context, legado-E, 浅克隆, git 代理, 7890, mixed-port
abstract: 应用户要求把 cortexkit/magic-context 与 Luoyacheng/legado-E 浅克隆进 .reference；本机 git 全局 http.proxy 指向 127.0.0.1:7890（无人监听）导致克隆必败，须用 -c http.proxy=http://127.0.0.1:39859（clash 实际 mixed-port）临时覆盖，不动全局配置。
---

user:
把 https://github.com/cortexkit/magic-context.git 和 https://github.com/Luoyacheng/legado-E.git 这两个项目浅 clone 到 .reference。

assistant:
直接克隆报 "Failed to connect to 127.0.0.1 port 7890"——本机 git 全局 http.proxy 指向 7890，但 clash 的实际 mixed-port 是 39859，7890 无人监听。不改全局配置，用 `git -c http.proxy=http://127.0.0.1:39859 clone --depth 1` 临时覆盖，两仓均成功：magic-context（46M，HEAD 1f0d874）、legado-E（31M，HEAD 8b87c5a，小说阅读类 app 的 fork）。.reference 本身在主仓 gitignore 内，主仓工作区保持干净。后续在本机做 github 克隆/拉取若再遇 7890 拒连，同法覆盖或提醒用户清理全局代理配置。

user:
发版 push 时 7890 连接拒绝又复发，用户问为什么不直接把 clash 接口改成真正的 7890。

assistant:
采纳并从源头修复：clashctl 的 mixin.yaml（~/clashctl/resources/mixin.yaml）把 mixed-port 钉在 39859（主 config.yaml 本来就是 7890/7891），改 mixin+runtime 为 7890 后 systemctl --user restart mihomo 生效；git 全局与本仓代理统一归位 7890。验证：7890 监听、curl 经代理连 GitHub 200、git ls-remote 正常。本条闭合此前遗留的「全局代理端口失效」问题（git 侧不再需要 -c 临时覆盖）。push 剩余阻塞仅凭据：本机无 GitHub 凭据，需用户终端交互输 PAT 或配置 credential helper。
