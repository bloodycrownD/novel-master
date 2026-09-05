---
date: 2026-09-06 10:30
title: magic-context 插件调研、安装与更新（pi 可用）
keywords: magic-context, cortexkit, pi extension, 上下文管理, historian, compaction, sqlite, embedding, execute_threshold, 压缩阈值
abstract: 调研确认 Magic Context 官方原生支持 pi（@cortexkit/pi-magic-context）并安装（historian 用 zai/glm-5.3-flash）；后更新到 0.41.3；源码调研确认压缩阈值设计：默认 execute_threshold 65%、主动触发 63%、强制墙 95%，400k 窗口实际用 ~252k 属预期，可通过 execute_threshold_percentage/tokens 调高。
---

user:
看到 https://github.com/cortexkit/magic-context，问：这个能否安装到我们现在的 pi 环境里，还是只支持 opencode？它是不是一个上下文管理插件？

assistant:
是上下文管理插件，而且官方原生支持 pi。核心机制是 historian 后台子代理把旧历史压缩成分层摘要（compartments）、自动沉淀项目记忆、dreamer 夜间整理、按轮次注入回忆。专门的 npm 包是 `@cortexkit/pi-magic-context`（0.41.1），基于 `@earendil-works/pi-coding-agent` extension API，要求 pi >= 0.74.0，当前 0.84.4 满足。安装二选一：向导 `npx @cortexkit/magic-context@latest setup --harness pi`，或手动 `pi install npm:@cortexkit/pi-magic-context` 后自建 `~/.config/cortexkit/magic-context.jsonc`（必须配 `historian.pi.model`，否则 historian 起不来）。它会接管上下文管理，与宿主 compaction 冲突时自我禁用；pi 端不需要显式关 pi 的自动压缩（pi 的 compaction 默认是手动的，OpenCode/OMP 的 setup 才会关原生 compaction）。pi 与 OpenCode 插件共享同一个 SQLite 数据库，项目记忆和 embedding 互通。健康检查：`npx @cortexkit/magic-context@latest doctor --harness pi`。

user:
好，那装上吧。

assistant:
已执行 `pi install npm:@cortexkit/pi-magic-context`（注册进 `~/.pi/agent/settings.json` 的 packages 数组，实体在 `~/.pi/agent/npm/node_modules/`），手写 magic-context.jsonc：historian.pi.model 用 `zai/glm-5.3-flash`（便宜、1M 上下文，适合后台摘要），embedding 用默认本地模型（Xenova/all-MiniLM-L6-v2），dreamer/sidekick 暂不配。doctor 全 PASS，除一项：共享数据库迁移被装扩展前启动的 pi 进程阻塞，重启 pi 后扩展加载时自动迁移，属预期；另有 WARN：onnxruntime-node 原生绑定未随包装上，embedding 回落 WASM 推理（慢一点但可用）。npm audit 报 4 个 high（adm-zip 经 onnxruntime-node、sharp/libvips CVE），都是间接依赖，`npm audit fix --force` 会把插件降到 0.41.0，暂不处理。激活条件：重启 pi 会话后扩展生效。另外 magic-context CLI 的 engines 要求 node >= 24，本机 nvm 只有 v22.22.0，npx 只是 EBADENGINE 警告、实际能跑；扩展本身在 pi 的 node 22 进程内运行（node:sqlite 22.13+ 免 flag），不受影响。

user:
magic-context 更新了，帮我更新下。另外我有个问题：magic-context 是不是不会使用 100% 上下文？60% 就压缩了？我现在是 400k 上下文，实际只用了 240k？

assistant:
更新：`pi update --extension npm:@cortexkit/pi-magic-context`，0.41.1 → 0.41.3（npm latest）。0.41.2 修复 embedding 回灌卡死整个进程（0.41.1 回归）+ Anthropic signed-thinking 会话缓存稳定性；0.41.3 修复同项目第二个 OpenCode 实例启动卡死、cache/启动修复、Pi/OMP parity。重启 pi 后新版本才生效。当日代理 127.0.0.1:7890 挂了，git 克隆用 `git -c http.proxy=` 绕过，curl 用 `--noproxy '*'`。

阈值调研（源码结论）：`execute_threshold_percentage` 默认 65（packages/plugin/src/config/schema/magic-context.ts），可配 20–90，硬上限 90；主动触发 = 阈值 − 2 = 63%（compartment-trigger.ts 的 PROACTIVE_TRIGGER_OFFSET_PERCENTAGE=2），historian 在这里开始压缩；升级带：强制物化 ≥ max(85, 阈值+2)，绝对墙 95%（escalation-bands.ts）；丢完后目标落到阈值×0.75（POST_DROP_TARGET_RATIO）。百分比分母是“可用窗口”：pi 端对独立输出窗口的模型不做输出预留，glm-5.3 的 400k（models.json 手动 override）基本就是分母；token 数是本地字节估算而非 API 实报，所以实际触发点会漂几个点。用户观察 240k/400k=60% ≈ 63% 标称值减去估算误差，符合设计。压头留白是为了：中途单个大 tool output 突增、输出预留、缓存稳定（90% 上限的官方理由）。想用更多窗口：magic-context.jsonc 里配 `execute_threshold_percentage`（支持 per-model map）或 `execute_threshold_tokens`（绝对 token，按模型映射）。
