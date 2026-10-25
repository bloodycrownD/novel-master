---
date: 2026-09-30 23:59
title: 全仓有效代码量统计（生产 ~14.2 万行 / 测试 ~14.5 万行）
keywords: 代码量, LOC, 有效行, 统计口径, 剔除空行注释, webview 构建产物, .reference
abstract: 恢复 worktree-123 记忆后统计全仓有效代码：生产源码约 14.2 万行（core 5.1 万、mobile 4.8 万、desktop 3.5 万、cli 0.35 万、外围包+原生 ~0.5 万），测试约 14.5 万行，合计约 28.7 万。统计脚本 tmp/count-loc4.mjs 可复跑；两个必须剔除的污染源是 android assets 下的 webview app.js 构建产物（42 万行）与 .reference/pi 参考仓。
---

user:
（[$apm-recall] 恢复记忆 docs/apm/memory/20260927-worktree-123-verify-guide.md 后）当前项目的有效代码是多少？大概多少万？

assistant:
（记忆恢复完成后用 node 脚本实测统计，口径=剔除空行与注释的近似有效行；剔除 node_modules/dist/webview 构建产物/.reference 参考仓/docs/tmp）

【结论】生产源码有效行 ≈ **14.2 万**；测试代码 ≈ **14.5 万**；生产+测试 ≈ **28.7 万**。生产物理总行（含空行注释）≈ 18.5 万。

【生产代码分布（有效行）】
- packages/core：51,143（639 文件）
- apps/mobile（RN + webview TS 源码 src/web）：47,649（382 文件）
- apps/desktop：34,644 = renderer 25,166 + 主进程 src 7,998 + shared 1,480（242 文件）
- apps/cli：3,491（48 文件）
- 其它 packages（tdbc/tokenizer 驱动、sksp 四端、llm-sse-native、cloud-sync-driver-s3、conformance）：TS ~4,274 + 原生 Kotlin ~990（13 个 kt/java，1,236 总行）

【测试代码分布】core/test 78,453（442 文件）+ mobile/__tests__ 44,257（237）+ desktop/test 16,910（132）+ cli/test 4,215 + e2e 1,203 + 零散 ≈ 14.5 万。另根/双端 scripts 工具脚本 ~6,900 有效行未计入。

【两个必须剔除的污染源（首次统计的教训）】① `apps/mobile/android/app/src/main/assets/webview/**/app.js` 是 **build:webview:native 的构建产物**（三份合计 ~42 万行，会被「src 路径」过滤误收）；② `.reference/pi/` 是第三方参考仓库（几十万行）。另注意 **apps/desktop 的代码在顶层 `renderer/` 而非 `renderer/src/`**，只按 `/src/` 过滤会漏掉 renderer 主体（首轮只数到 8 千行就是漏了它）。

【脚本】`tmp/count-loc4.mjs` 可复跑（含各区域明细）；注释剔除是正则近似（不解析 AST），数字做量级参考足够。
