---
date: 2026-09-28 09:05
title: ① 消息正文压缩分支真机实测全绿 + 后续两件（去 base64 / VFS 打包）SPEC 定稿 + **Part A1（VFS/file_cache 去 base64）经 code-dev-loop 跑完 dev-ready**——含收益口径修正「VFS delta 82.6% 实为 61.3%」
keywords: worktree, message-content-compression, SCHEMA_BOOT_VERSION 撞号, 谓词驱动搬运, 真机测试, subst 短路径, base64 历史包袱, op-sqlite BLOB 真机验证通过, Hermes 无 WebAssembly, 收益口径修正 61.3%, 内容哈希去重计数, fflate 字典 32KB 窗口, byte_len 三态混杂, binary-blob-and-vfs-pack spec, code-dev-loop, runBlobBinaryNormalization, nm-blob-binary, BlobBinaryRunResult stalled, 零进展护栏, cr-func 判 no 与 fix, dev-ready, AsyncMutex 重入死锁, MCP 会话握手
abstract: ① 压缩分支（feat/message-content-compression）真机实测**全绿**（BOOT_VERSION 顺延 17 + ALIGN 补列、5350 条全量搬运、逐条字节校验零差异、库 111.1MB→79.0MB、二次启动零重扫）；**真机 BLOB 验证 6 项全 PASS → base64 可去**（+33%）。压缩率归因（84.6% 中文、英文对照 6.01:1 vs 中文 2.61:1、tool_result 占 60.9%）与算法横评（逐条最多 +12%；整块 7.7~9.4:1 全来自长程重复；**Hermes 无 WebAssembly** + 纯 TS zstdify 崩 → 移动端算法杠杆关闭）。**2026-09-28 复测修正**：旧记「VFS delta 省 10.7MB / 82.6%」把被多版本共享的 blob 按 revision 行重复计数，按 `content_hash` 去重后真实为 **6.080MB → 3.020MB（省 3.06MB / 61.3%）**；同批复测：消息去 base64 省 10.864MB、VFS 省 2.366MB、file_cache 省 0.06MB，**Part A 合计省 13.30MB（79.0→约 65.7MB）**。已**生成 SPEC `docs/Iterations/binary-blob-and-vfs-pack/spec.md`（Part A 去 base64 立即做；Part B VFS 内容打包收益仅 3.06MB、改动面覆盖 VFS 主力读写，待用户拍板）**，并实测否决了字典链（2.945MB，引入跨行依赖）、diff delta（无实现无增量证据）、大词典（fflate 只对末尾 32KB 生效）。另发现 `vfs_content_blob.byte_len` 写法三态混杂（859/71/97 行三种口径）需一并归一。
---

user:
恢复记忆，告诉我 .worktree/ 这几个 worktree 都是干什么用的，涉及哪些功能，我需要如何测试验证。

assistant:
（会话初始化读 RULE + 20260923 批次记忆后逐项实测核对）

【三 worktree 身份】`f-message-content-compression`→feat/message-content-compression@635c714c（① 消息正文 zlib 压缩存储，6 提交 +1563）；`f-rollback-large-jank`→feat/rollback-large-jank@19e4e841（② 大会话回滚卡顿，7 提交 +2063）；`f-background-run-continuity`→feat/background-run-continuity@61a14db9（③ 后台任务停摆，3 提交 +322）。均为 mobile-perf-2026-09 批次，dev-ready 未合并；④指标条⑥原生管子已随 v1.5.23 发布。三 worktree 工作区全净、node_modules 与 core dist 已装配、基线 23818754 已是 main 祖先（合并不带文档包袱）。

【验证命令实跑全绿】core 定向（worktree 的 packages/core 下）：`npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test <file>`——① codec-roundtrip 7/7、② rollback-plan-scope 3/3、③ sse-chunk-emitter 4/4；② mobile 定向 `npx jest __tests__/chat-transcript-snapshot-bytes.test.tsx` 7/7。注意：**worktree 的 core `npm test` 脚本缺 `-O globstar`**（三分支基线 23818754 早于 9-27 主仓修复），跑全量须手动补 flag 否则 92 个嵌套目录测试文件静默跳过；desktop 测试在 Windows cmd 假绿（0 条收集）是既有形态。

【合并演练实拍（merge-tree --write-tree main <branch>）】①冲突 2 处：CHANGELOG.md（Unreleased 两边都写）+ novel-master-bootstrap.ts（**BOOT_VERSION 撞号：分支 16 = main 已占 16（④ 用了），合并时顺延 17**；sqlite-message.repository.ts 反而自动合并）；②冲突 1 处：message-rollback.service.ts（main 侧 23818754 之后被后续迭代改过），且**分支没写 CHANGELOG Unreleased 条目，合入前要补**；③冲突 1 处：CHANGELOG.md，sse-chunk-emitter.ts 可自动合并（main 侧 ⑤ 回炉 3644a106 改过该文件——bufferedLength/打点痕迹），但需人工核对 ⑤ 痕迹与闸门改造语义兼容。

【⑥ 已发布对 ③ 的架构交互（重要）】③ 的主修复 emitter 事件驱动化只在 XHR 路径上（spec constraint 自记）；v1.5.23 起 mobile 传输择优 registered native > XHR > fetch——③ 合入后 emitter 修复主要覆盖「原生管子未注册/回落 XHR」场景；TDBC 量子让步后台跳过与传输层无关、始终有效。后台停摆在原生管子路径上的行为 ⑥ 验收没测过，属 ③ 合并后需重验的开放点（真机 manual 两场景天然覆盖双路径）。另：③ worktree 内验证 = 验证 XHR 路径（该分支无 ⑥），与 spec 口径一致。

【manual_user 三项待办（均未做）】① Step 7：实库升级观察——启动不无限期阻塞（首启 ≤60s 同步收尾）、存储页两态状态行、压缩比 desktop≥3:1/mobile≥2.5:1、SQL 三件套（`SELECT COUNT(*) FROM chat_message WHERE content_json != ''` 归零 + kkv_entry module='nm-message-content' key='compactionDone'）、抽查会话内容一致、搜索/回滚/复制正常、二次启动无重扫——**动真实库先备份**；② Step 7：大会话回滚录屏（AC-1 toast→刷新 <1s）+ 打点对比——打点 __DEV__ 门控且真机无 ReactNativeJS logcat，**打点对比在模拟器跑**（emulator-5554），真机看肉眼流畅度；③ Step 5：真机两场景后台双证（流式中切后台 / 发送后立刻切后台 backfill 阶段）+ **合并硬门禁：chrome://inspect 后台 timer 停摆实证未做，否定则整案撤回**。

【本次未动任何代码/分支，未 push/merge。】

user:
上下文压缩后回来：你能看出记忆压缩过吗？恢复记忆，然后告诉我另外两个 worktree（①③）的功能是什么，我看看接下来合并哪个。

assistant:
（恢复成功——rollback 记忆文件末尾的「压缩前状态快照」完整起效，恢复锚点/提交全景/环境终态/教训速查全接上；随后 git log/diff --stat 核实 ①③ 分支面貌未变：①=635c714c 六提交 30 文件 +1563，③=61a14db9 三提交 10 文件 +322）

给出合并顺序建议 **②（已就绪等指令）→ ③ → ①**：③ 改动小且集中（emitter 数据到达驱动 + TDBC isBackground 注入），不动 schema 无迁移，验收便宜（chrome inspect 硬门禁 + 真机两场景后台双证，一天内）；① 动 schema（BOOT_VERSION 撞号 16→17 顺延）+ 带存量压缩迁移任务 + 三端接线，验收要动真实库（备份先行），适合从容安排。补充提醒：verify-guide 的 merge-tree 实拍是「各分支对 main」——若 ① 改合进 integration/rollback-large-jank，其 sqlite-message.repository.ts（84 行改动）会撞 ② 的同名文件改动，须重新演练；③ 与 ② 无文件交集。

user:
（CR 阶段用户质疑）「什么叫 chrome inspect 没做？那优化了个寂寞吗？不是相当于没干活？」——③ 的合并硬门禁（chrome inspect 后台 timer 停摆实证）被 CR 的 SD-3 标为 open，用户要求解释与补做。

assistant:
（先解释该门禁的性质：它验证的是「后台 timer 停摆」的**机制假设**、不是验证修复有效性；现象真实（PRD 载用户曾实证停摆）、修复真实（单测 T-B1/T-B2/T-B3 + 真机行为），缺的只是机制级的直接观测。随后当场补做实证——**结论：停摆成立**）实证方法与结果：模拟器 1311 + metro，CDP 注入 2s 周期 setInterval——前台周期稳定 2.0s；**切后台出现 47.2s 空白间隔（零 tick）**；回前台立即恢复 2.0s。spec §4 根因前提确认成立，③ 实现无需撤回，fix-spec SD-3 转 fixed。
踩坑与产物：① 模拟器默认 dev host 10.0.2.2:8081 的 chunked 流被破坏（bundle 下载 ProtocolException 白屏）→ `run-as` 写 `shared_prefs/com.novelmaster_preferences.xml` 的 `debug_http_host=localhost:8081` 走 adb reverse 通道解决；② metro inspector proxy 强制 Origin 校验（白名单 hostname：localhost/127.0.0.1/0.0.0.0/[::]），Node 内置 WebSocket 无法设 Origin → 手搓最小 RFC6455 客户端。脚本留存 `D:\Dev\nm-worktree\{ws-min.mjs, cdp-bg-probe.mjs, probe-clear.mjs}` 可复用。

user:
（1.5.24 发布后）清理 worktree——已合并的分支与 worktree 可以删了。

assistant:
清理执行（当日）：**① 保留**（feat/message-content-compression + 其 worktree `.worktree/f-message-content-compression`，未合并）；**②③④ 全清**——`git worktree remove` ×3（f-rollback-large-jank / f-background-run-continuity / i-rollback）+ 分支 `-d` ×3（feat/rollback-large-jank / feat/background-run-continuity / integration/rollback-large-jank）+ junction `D:\Dev\nm-worktree\nm9` 删除。**Windows 删大目录踩坑**：`git worktree remove` 报「Directory not empty」（node_modules 深路径/句柄残留）——兜底法=robocopy 空目录 `/MIR` 镜像清空 + `Remove-Item -Recurse -Force` 删残根 + `git worktree prune` 清元数据（脚本留 `D:\Dev\nm-worktree\cleanup-worktrees.ps1`；注意 remove 失败时元数据可能已注销、目录成孤儿）。清理后 nm-worktree 剩 7 个可复用文件（ws-min.mjs / cdp-bg-probe.mjs / probe-clear.mjs / bump-1524.mjs / bump-buildgradle.mjs / cleanup-worktrees.ps1 / rn-dev-prefs.xml）；主仓 tmp 剩 4 个工具（cap.bat / dbinspect.mjs / dbinspect2.mjs / uidump.mjs）。**下一轮 ① 验收时需重建 nm9 junction（当前已断）**；1315 APK 随 i-rollback 目录删除（真机已装 1315，无需重出）。

user:
（1.5.24 发布后）就差这个分支没合并了，我确认下这个 worktree 迭代功能是什么？它 content json 迁移思路是什么？

assistant:
（逐项核实 ① 的 prd/spec、codec、搬运任务、repository 与 schema diff 后作答，未动任何代码/分支）

【① 迭代是什么】mobile-perf-2026-09 批次的「消息正文压缩存储」（PRD 2026-09-22 / SPEC 2026-09-23）。背景：storage-cache-dedup 后用户实测库 523MB→105MB，其中 `chat_message.content_json` 明文 JSON 73.1MB（5309 条，占该表 94%），是剩余唯一未压缩大头（vfs_content_blob 早已压缩）。目标：同规模库收敛到 50MB 量级，压缩比 desktop/CLI ≥3:1、mobile ≥2.5:1（zlib-b64 base64 +33% 膨胀口径）；三端读写语义零变化。用户可见产物＝双端存储页「消息压缩」状态行两态（进行中剩余 N 条 / 已完成「存储已优化完成」），desktop 落 SettingsViews「数据清理」区块、mobile 落 StorageConfigScreen。

【迁移思路·三支柱】① schema：`chat_message` 加 `content_encoding TEXT NULL CHECK (content_encoding IN ('zlib','zlib-b64'))` + `content_blob BLOB NULL`，原 content_json 列保留不动——迁移后的行置空串 `''`（NOT NULL 天然满足，blocks JSON 恒非空、无歧义），legacy 行两列全 NULL 继续放明文，**明文行永远合法**（e2e fixture 直插/迁移未完成/回滚写路径都靠它）；DDL+align+BOOT_VERSION 三件套。② 读写：codec 收口 repository（`MESSAGE_SELECT_COLUMNS`/`toMessageParams`/`updateContent`/`readRowContent`），因 `sqlite-message.repository.ts` 是 SQL 层唯一消费者故三端零感知；`updateContent` 签名由 `contentJson: string` 改 `content: MessageContent`（JSON.stringify 从 service 下沉 repo）；平台分支 Node=`zlib` 二进制 / RN=`zlib-b64`（规避 op-sqlite BLOB 绑参缺口），复用 vfs zlib-codec 三形态、压缩级别 fflate 默认 6；解压失败 fail-fast 抛类型化 ChatError（不做 file_cache 式静默自愈）；唯一受影响读路径 `searchMessages` 的 content_json LIKE 粗筛失效 → 全量拉取 + 内存精筛（召回严格不小于现状）。③ 迁移：**不注册 schema migration**（框架无跨 boot 进度语义、两度评审拒绝突破、空占位禁令封死「先登记后搬」），改后台幂等任务 `runMessageContentCompaction`——谓词 `content_json != ''`、批 ≤100 行（SELECT id/content_json → fflate 压缩 → 单条短事务 UPDATE 置 blob+encoding+content_json='' → 批间 setTimeout(0) 让步）、UPDATE 带谓词防并发重搬、中断后谓词重扫续跑；完成＝谓词空 → 置 KKV `nm-message-content/compactionDone` → 挂一次 `runDatabaseMaintenance`（GC→checkpoint→VACUUM 归还页空间），此后启动零成本短路；升级首启同步收尾预算 60s（小库当场搬完、超预算转后台）＝「不阻塞启动」口径修正为「不无限期阻塞」的由来；三端调度＝mobile runtime 就绪后低优先（agent 活跃/维护 busy 让路）、desktop main 就绪后预算制循环、CLI 命令进程内同步跑；应急预案＝谓词反转反向解回明文（读路径双形态保证反向搬完前后均可读）；生命周期三段式（V0 本迭代 / V1≈10 tag 后删后台循环与明文读路径 / V1' 删收尾门，迁移代码归零）。

【合并现状重拍（② 已合入 main 后）】分支=635c714c 六提交、领先 main 6 / 落后 129。`merge-tree --write-tree --name-only main HEAD` 实拍 **3 处冲突**（首轮演练仅 2 处）：CHANGELOG.md（两边都写 Unreleased，琐碎）；`novel-master-bootstrap.ts`（**BOOT_VERSION 撞号：两边都写 16，main 的 16 已被 run_state token 列占用 → 合并须顺延 17**，两边注释块都保留，align 文件本身可自动合并）；`sqlite-message.repository.ts`（**本轮新增的真冲突**——main 侧 ② rollback-large-jank 加了 `mapRows` 分片让步，把多处 `rows.map(rowToMessage)` 换成 `this.mapRows(rows)`，含 searchMessages 的返回处，正是 ① 重写的那段；解法＝① 的 searchMessages 返回也走 `this.mapRows(rows)`，两边都保住——且 keyword 路径改后无 SQL LIMIT、全量拉取，恰是最需要分片让步的地方）。

【连带核查（合并后不会炸）】main 上 `updateContent` 调用方（desktop ipc messages.ts:166 / mobile useChatTabMessageActions.ts:522 / core 三处测试）全部经 service 且传对象，port 签名改动是 repo 内部、无编译破坏面；main 上直读 content_json 的测试仅 2 个（schema-align-columns / usage-cache-model-schema），核实后确认它们**只插明文行 + 断言 id/hidden 与列名**，走双形态读路径零修改可过——印证 spec「豁免清单大概率零修改」的预判。

user:
如果改成强迁移方案，100mb 迁移很容易出问题吗？

assistant:
（不拍脑袋：先派子代理挖迁移框架与历史事故，再用真机实库实测；用户手动拷贝实库 nmbackup 111,120,384 字节 = 106.0MB，副本落 `tmp/nm-real.db`，`tmp/` 已 gitignore；临时脚本跑完即删、worktree 复净）

【真库现场】user_version=16、journal_mode=**delete**（非 WAL）、page_size 4096、page_count 27129、freelist 189、integrity_check=ok；chat_message **5350 行 / content_json 73.2MB / 已空行 0**。

【现状分批方案实测】align 两列 0.21s；`runMessageContentCompaction` 33.67s（含完成后 GC+checkpoint+VACUUM；裸库单独 VACUUM 仅 1.24s）；**逐条字节校验 5350/5350 全等、零不一致、零缺快照**；content_json 残留 0；**压缩后 blob 32.6MB → 压缩比仅 2.25:1**（spec AC-1 桌面端 ≥3:1 **未达标**；mobile zlib-b64 口径 ×4/3 ≈ 1.68:1，≥2.5:1 **也未达标**）；**DB 文件 106.0MB → 64.3MB（-41.7MB / -39.3%）**，未达 PRD「50MB 量级」但接近。

【强迁移模拟实测（align 与全部搬运同事务，复刻 bootstrap 形态；结束回滚）】桌面 better-sqlite3：搬完 5350 行 **4.55s**、0.9ms/行；**rollback journal 峰值 39.3MB**（采样：1000行 3.2 / 3000行 12.1 / 5000行 35.6 / 搬完 39.3MB）；事务内 db 文件体积不变（页复用）；**一旦中断/放弃，5350 行 / 73.2MB 全部作废，下次启动从零重来**。

【历史事故证据】① `table-constraints-v1b` 在 25MB 实库（2192 条消息）上，**事务累计写约 3MB 后 100% 报 disk I/O error、bootstrap 失败、应用进不去**，桌面 better-sqlite3 对同库 100% 成功，伴 SIGSEGV 闪退循环；原话结论「任何携带大事务 migration 的版本在真机上不可交付」→ 直接促成 replace-quick-sqlite。本次强迁移需 39.3MB journal，是该门槛 13 倍、库本身 4 倍大。② vfs-revision-storage-optimize spec：「**Hermes 上长事务 + 大批量 BLOB 写入曾触发闪退**，故 data migrate 拆到事务外，每批 1 行 + yield」。③ 两条明文纪律：RULE.md L45「空占位 migration 不得提前登记（登记即视为已执行）」；vfs-revision-storage-optimize「大库 data migrate 须事务外分批可跨 boot 重入」。④ 框架结构：`bootstrapNovelMaster` 把 DDL + 全部 pending migration + align + 版本写入包在**同一个 `conn.transaction`**（L324）；登记表 `schema_migrations(id, applied_at_ms)` 仅两态无进度列、登记与 up 同事务 → 失败即回滚、无续跑框架。⑤ TDBC 量子让步只在**语句边界**（16ms），fflate 压缩是同步 JS 调用、语句内部不可让步 → 事务内搬 = JS 线程连续阻塞（桌面 4.55s，Hermes 数倍）。⑥ 全仓无 `PRAGMA journal_mode`（默认 DELETE、明文决策不上 WAL）；VACUUM 禁在事务内（有测试锁死）。

【结论口径】强迁移（注册成 schema migration、在 bootstrap 单事务里搬）是这仓库**两次花代价学会不要做**的形态：桌面必然绿、真机方差大，而失败模式是「应用起不来 + 每次启动在同一处重试失败」的砖化，且桌面测试覆盖不到设备分歧。安全简化不是塞进 bootstrap 事务，而是「**事务外、逐行短事务、同步搬完才放行进 UI**」（即 spec 已规划的 V1 收尾门）——实库代价 desktop 约 34s、移动端分钟级一次性。另：**压缩比 2.25:1 未达 AC-1** 是本次实库测出的验收风险，合并前须摆上台面。

user:
那还是原方案吧，真机安装一下，测试看看。

assistant:
（用户拍板保留原方案——后台谓词驱动分批搬运；转入真机实测。**真机全绿**）

【前置改动（唯一代码改动，待合并）】`SCHEMA_BOOT_VERSION` 16→17：真机实库 `user_version=16` = main 的 16，不 bump 会走快路径跳过 ALIGN、两列永不落地（实测确认）；按仓库既有撞号先例（v13→v14 注释体例）留痕。

【构建踩坑（重要，下次直接用）】① **Windows 260 字符路径限制**：worktree 深路径下 ninja 报 `Filename longer than 260 characters`（safeareacontext codegen 目标），首轮构建白编 3 分 14 秒后失败；**解 = `subst X: <worktree>` 后用 `X:\apps\mobile` 构建**（junction 无效：配置被 `.cxx` 缓存且 Node realpath 会还原真实路径；subst 不会被 realpath 还原，实测 `fs.realpathSync('X:\\node_modules')` 仍返回 X:）。同时必须删掉旧的 `.cxx`（里面烘焙了旧绝对路径）。主仓之所以能编，是它路径恰好 248 字符贴着上限。② **Metro 必须从真实长路径启动**：从 subst 盘启动会报 `Unable to resolve module @novel-master/core/session-run-state`（workspace 符号链接解析到项目根之外）。③ `adb exec-out "run-as pkg sh -c 'cat f | gzip -1'"` 引号管道可用（拉 79MB 库加速）。④ 真机应用窗口高度是 **2202**（非屏幕 2340），底栏 tab 可点区在 y≈2199——按截图比例换算会点空。⑤ 手机 USB 中途掉线一次，重连后 `adb install` 正常。

【真机实测结果（荣耀 EBG-AN00，升级安装 1316 / 1.5.25-mcdev，保数据）】① bootstrap 慢路径通过：`user_version=17`、`content_encoding`/`content_blob` 两列就位（**印证不 bump 就废**）。② 搬运完成：未压缩行 `content_json != ''` = **0**、已压缩行 = **5350（全量）**、encoding 全 `zlib-b64`（RN 口径）、明文残留 0.00MB、KKV `nm-message-content/compactionDone` 已置、`integrity_check=ok`。③ **逐条字节级校验 5350/5350 全等、零不一致**（把迁移后库拉回本地解压，用迁移前原始副本逐条对比）。④ 体积：blob 43.4MB（明文 73.2MB）→ **移动端压缩比 1.69:1**（未达 AC-1 移动端 ≥2.5:1）；**库文件 111,120,384 → 79,015,936 字节（-32.1MB / -28.9%）**，UI 存储页显示「库体积 75.4MB / 可回收 0KB」。⑤ UI「消息压缩」状态行显示**已完成**。⑥ 消息渲染正常（含思考过程块与工具调用，取最重的会话 1032 条验证）。⑦ **二次启动零重扫**：force-stop 重启后库文件 size 与 mtime 均不变（完成标记短路生效）。⑧ 首启到搬运完成约 2 分钟内（23:20:30 启动，23:22 查库已降到 79MB）。

【遗留】① 装的 APK 是 **debug 构建（依赖 Metro，当前 Metro 仍在跑）**，要独立可用的包需 `assembleRelease`。② 设备侧留了迁移前备份 `novel_master_vfs.pre-mc-test.bak`（111MB）供回退。③ 分支上唯一未提交改动 = BOOT_VERSION 17。④ `tmp/nm-real.db`（迁移前原始库）保留备验收/回滚；subst `X:` 盘保留备后续构建。⑤ 模拟器已被还原（原测试库 + 临时文件已清）。

user:
为什么压缩率这么低？sqlite 没有 blob 吗？你为什么要转 base64？

assistant:
（在迁移前原始库 `tmp/nm-real.db` 上做归因分析，四个临时脚本跑完即删）

【Q1 压缩率为什么低——四个因素，按影响排序】① **语料 84.6% 是中文**（非 ASCII 61.95MB / 73.20MB）：同口径 deflate level 6 对照——英文源码/文档 5.00MB→0.83MB **6.01:1**，中文正文 73.20MB→28.03MB **2.61:1**。**spec 预估的 3~4:1 是英文口径，对中文不成立**，2.2~2.6:1 才是中文 deflate 的正常水平。② **质量集中在 tool_result**：按块类型 tool_result 44.58MB（**60.9%**）、thinking 15.19MB（20.7%）、text 6.75MB（9.2%）、tool_use 6.61MB（9.0%）；按 role user 46.71MB / assistant 26.49MB。③ **逐条独立压缩损失跨消息冗余**：逐条 2.24:1 vs 全部拼一条大流 2.61:1；而 **brotli q5 整块 7.69:1**（9.52MB）、q11 8.99:1——说明语料在**消息之间**有约 3 倍重复（同一文件被反复读进不同消息），逐条口径吃不到；但**逐条 brotli q5 只有 2.45:1**，即 brotli 的收益几乎全来自长窗口跨消息，不是静态词典。④ **压缩级别无收益**：level 9 = level 6（32.62 vs 32.65MB）。分桶：>48KB 的 340 条占 64.7% 字节、压缩比 2.36:1；<2KB 的 2712 条只占 2% 字节、压缩比 1.16~1.60（小消息开销可忽略）。高熵体检：疑似 base64 长串 **0 段**（正文里没夹带已编码数据）。

【Q2 为什么转 base64——不是 SQLite 的限制，是 RN 驱动的历史包袱】SQLite 当然有 BLOB，`vfs_content_blob` 现在就有 **13 行 `encoding='zlib'`、`TYPEOF=bytes` 为 `blob` 的真二进制 BLOB**（inflate 出正常中文 markdown）。base64 的来源：quick-sqlite 时代那个驱动**读回 BLOB 会变成 base64 字符串**（`decodeCompressedBytes` 里留有明文注释「存量：Mobile 曾写 encoding=zlib，但 quick-sqlite 读回为 base64 字符串」），于是 VFS 内容层给 RN 定的口径就是 `zlib-b64`，本次消息正文 codec 照抄先例。replace-quick-sqlite 换到 op-sqlite 后**没人回头复验**——`packages/tdbc-driver-op-sqlite/src/bindings.ts` 的注释仍写着「op-sqlite 的 blob 绑参语义（是否持有/释放传入 buffer）**尚未真机验证**」，只是保守保留了 Uint8Array→独立 ArrayBuffer 的防御性拷贝；spec 也明确把「评估 op-sqlite 二进制 BLOB 通道」列为**本期不做**。代价：base64 +33%（2.24→**1.68:1**），blob 从 32.65MB 涨到 43.53MB——**移动端去掉 base64 即可追平桌面（2.24:1），库文件预计从 79MB 再降到 ~68MB**，但需真机验证 op-sqlite 的 BLOB 读写往返（bindings/row-mapper 两侧代码都在，缺实证）。

【结论】AC-1 的 3:1 / 2.5:1 **按当前算法+中文语料不可达**，须改口径或改方案。可动的杠杆：去掉 base64（+33%，最划算、需真机验证）> brotli 替换 deflate（逐条仅 +9%，且 RN 侧无现成纯 JS 实现）≫ 提高压缩级别（零收益）。跨消息去重是另一个量级的机会（3 倍冗余）但属独立课题。

user:
blob 可以验证，另外就是除了 zip 没有更好的压缩算法吗？git 的算法是什么？我感觉它压缩还牛的。

assistant:
（真机验证 BLOB + 压缩算法横向实测，均为临时探针/脚本，跑完已全部撤除）

【真机 BLOB 验证：全项通过——base64 是纯历史税】用临时探针（挂 `scheduleMobileMessageContentCompaction` + Metro 热更，**不用重打包**）在荣耀真机上跑 op-sqlite 二进制 BLOB 往返，结果落 `__blob_probe_results` 表再拉库读（console 输出在 bridgeless 下 Metro/logcat 两边都收不到，**落库才可靠**）：256B 全字节值 / 64KB 伪随机 / **4MB 伪随机** / **64KB 事务内** / **64KB 带偏移视图** / **真实 codec 往返（180065B 明文→678B→读回解压逐字节一致）** —— **6 项全 PASS，读回类型都是 Uint8Array、逐字节一致**。结论：op-sqlite 的 Blob 绑参（含事务内 executeSync 路径与防御性拷贝）**在真机上完全可用**，`zlib-b64` 那 33% 是 quick-sqlite 时代的历史包袱，**移动端切二进制 BLOB 技术上已无障碍**（预计 blob 43.5→32.6MB、库 79→68MB）。探针临时表已 DROP 干净（库文件涨到 87MB 是 freelist，用户点一次「数据清理」即回收）。

【踩坑：探针第一版自己死锁了】首版探针在事务回调里用**外层 conn** 写记录行 → 撞驱动层 AsyncMutex 不可重入，**表现是静默挂起（无异常、无崩溃、UI 正常，只是 promise 再不 resolve）**，与 RULE.md 明文警告完全一致。修法：事务内只用传入的 `tx`，结果先收集、退出事务后再用外层 conn 落库。**教训：分不清「驱动有问题」和「自己踩了不能重入的坑」时，先看日志里有没有异常——没有异常只有静默挂起，八成是自己重入。**

【压缩算法横向实测（迁移前真库语料 73.20MB / 5350 条，Node 22 内置 zstd）】逐条（可随机读取的现状形态）：deflate6 **2.24:1** / deflate9 2.24 / brotli q5 2.45 / brotli q9 2.51 / zstd3 2.18 / zstd19 2.51；整块（理论极限、工程不可用）：deflate6 2.61 / brotli q5 **7.69** / brotli q9 8.26 / zstd3 5.66（仅 0.3s）/ zstd19 **9.44**。deflate+预置词典（64K/256K）：2.36~2.37。**git 式内容去重：全库仅 58 条重复、占 0.03%，完全无收益**；同会话内前 2KB 相同的近似重复也只有 38 条。结论：**逐条口径下换任何算法最多 +12%（brotli q9 / zstd19 = 2.51:1），没有银弹**；那些 7~9:1 的漂亮数字全部来自「让压缩器看到跨消息的长程重复」，属窗口/架构红利而非算法红利——**这正是 git 压缩好的真正原因**：git 松对象只是 zlib，packfile 才是「相似对象间做 delta（差量）+ zlib」，外加按内容哈希去重；它赢在跨对象，不在编码器。本项目里跨消息冗余约 3 倍（同一素材被反复读入不同消息），要吃到得走 delta/大窗口/共享词典路线，会把「一行一条、可随机读、可增量写」的简单模型打散，属独立课题。dictionary 实测只 +5%，wrap-up 可忽略。

user:
去掉 base64 是肯定要做的。另外版本管理系统（vfs）现在也是 base64 吧？这次是不是也能迁移掉？delta 是不是对 vfs 更合适？对消息压缩不合适？

assistant:
（真库实测 VFS 侧规模与 delta 机会，临时脚本跑完即删）

【VFS 确实也是 base64——规模与收益】`vfs_content_blob`：**1099 行 `zlib-b64` 文本 9.466MB** + 13 行已是二进制 `zlib`（6KB）；`session_file_cache_blob`：37 行 `zlib-b64` 0.278MB。去 base64 收益：VFS 省 **2.37MB**（9,925,780→7,444,335）、file_cache 省 0.07MB，**合计约 2.44MB**（远小于消息侧的 11MB，但纯免费）。**可迁移性比消息更好**：① 谓词就是 `encoding='zlib-b64'` 本身，没有「这行迁没迁过」的歧义（消息侧要发明 `content_json != ''` 这种谓词）；② 读路径 `decodeCompressedBytes` **本来就已经三形态兼容**（zlib+二进制 / zlib+存量 base64 串 / zlib-b64），转换期间新旧混存天然可读；③ 二进制 BLOB 真机已验通过。唯一要小心的历史脏点是「encoding='zlib' 但存的其实是 base64 文本」那种 quick-sqlite 存量（decode 里专门有这条分支），转换脚本得按 TYPEOF 判别而非只看 encoding。

【delta 对 VFS 远比对消息合适——实测悬殊 8 倍】把「同一 entry 的各版本明文按版本序拼接」与「各版本独立压」对比，差额即 delta/长窗口红利：**VFS 多版本 entry 150 个，独立压合计 12.936MB → 拼接后 deflate 仅 2.252MB（省 10.683MB，82.6%）**、brotli 1.367MB（省 11.569MB）；**消息侧同口径（同会话内拼接）73.199MB 明文只从 32.649MB 降到 29.547MB（省 3.102MB，9.5%）**。原因：VFS 的 revision 是**同一文件的不同版本**（经典 delta 场景，正是 git packfile 的用法），相邻版本差异小且落在 deflate 32KB 窗口内，普通 deflate 就能吃到；消息是彼此独立文档，「跨消息重复」分散而不成版本关系，整块 7.69:1 那种红利要靠大窗口/长程匹配，且与「一行一条、随机读、增量写」模型冲突。**结论：VFS 该走 delta（收益 10.7MB，是 VFS 去 base64 的 4.5 倍），消息该走「去 base64 + 保持逐条」，delta 对消息不成立。** 全库收益排序：消息去 base64（~11MB）> VFS delta（~10.7MB，属真功能，要接 ref_count/GC/重构读路径）> VFS 去 base64（~2.4MB，最便宜）。

user:
消息压缩存储有什么常见方案吗？或许网上有不同思路？帮忙探索下，我们尽量完善。（追问：你为什么不用 mcp 的 search 工具？）

assistant:
（子代理网络调研 + 自测六组实验；本会话唯一可用的 MCP 工具是**图片搜索**，没有通用网页搜索 MCP——调研走子代理的内置 WebSearch，但主流搜索引擎全返回反爬 403，只能直连 GitHub raw / npm registry / arXiv / StackExchange API 取一手资料）

【调研要点】① **sqlite-zstd**（phiresky）：行级透明压缩 + 训练词典，报告 74%~91% 缩减（IMDb 2.0GB→528MB），但作者明确 **>30~50KB 的大行词典收益极小**、压缩列上建不了索引、pre-production；其「**新写入先存明文、后台批量压缩**」的写法值得抄（与我们的搬运任务同构）。② **打包成块 + 偏移索引**：Parquet row group（官方建议 512MB~1GB，并承认「整块可能都要读」）、RocksDB BlobDB（大 value 走旁路 + GC 调参），成熟但无 SQLite 内嵌案例。③ **CDC/CAS 用在消息上：查无公开数字**；restic 用 512KiB~8MiB 变长块。④ **delta 用于非版本序列：查无公开经验**；git packfile 链深上限 50。⑤ 聊天 App 内部实现只有 Matrix 验证到（明文存 IndexedDB、不压缩不加密），其余未取得一手资料。⑥ **压缩与全文搜索冲突的正解是 SQLite FTS5 的 external-content / contentless 表**（正文可任意压缩/不存，索引单独存，靠触发器或 rebuild 维护一致性）。

【自测实验（真库语料 73.2MB / 5350 条）——三条都是关键结论】① **⚠️ Hermes 没有 WebAssembly**：真机探针实测 `typeof WebAssembly === 'undefined'`（`Atomics`/`SharedArrayBuffer` 也没有；HermesInternal 报 Static Hermes / bytecode 98 / hades GC）→ **所有 zstd/brotli 的 wasm 套件（@bokuweb/zstd-wasm、brotli-wasm、zstd-codec）在移动端直接出局，纯 JS 能压缩的只有 deflate（fflate）这一条**；「换算法」这个杠杆在移动端关闭。（`fzstd` 是纯 JS 但只解压、且回指距离受限，可作将来「桌面写 zstd、移动只读」的候补。）② **block 级完全重复 = 0.03%（60/12644 块）**，整条消息完全重复也只有 0.03% → **CAS/精确去重对消息无效**。③ **CDC 变长分块去重：avg1KB 去重率 43.2%、avg4KB 32.1%、avg16KB 20.4%**，但**「去重 + 逐块压缩」反而更差（2.01:1 vs 现状逐条 2.24:1）**——分块把压缩上下文切碎了；只有「去重 + 唯一内容拼成流压」才好（deflate 4.62:1 / brotli 6.78:1，但没有随机读）。④ **打包曲线（压缩比 ↔ 读放大）**：逐条 deflate 2.24:1 / 64KB 块 2.33 / 256KB 块 2.46 / 1MB 块 2.50 / 按会话（最大 7.2MB）2.48；brotli 侧 1MB 块 3.46:1。即**打包在移动端只值 +12%（deflate），而读放大涨到 1MB**。⑤ **消息顺序影响巨大**：同一份数据按**自然时序（rowid）整块 brotli = 7.69:1**，按 `session_id, seq` 聚簇掉到 **5.94:1**——跨会话的时序相邻比会话内相邻更值钱，任何打包/去重方案都别按会话聚簇。⑥ fflate **支持预设词典**（类型里有 `dictionary`），但 deflate 窗口上限 32KB → 词典收益封顶约 +5%（实测 2.36:1），且用错词典会解坏（官方警告），管理成本不值。

user:
搜索 mcp 已经就位，你试试？（先说 401，我加了 Bearer 后仍失败）

assistant:
（用户配了 `web-search-prime` / `web-reader` / `zread` 三个智谱 MCP；逐层排查后**验证可用**）

【MCP 排查结论（重要，以后遇到同类报错别误判）】① 配置在 `C:\Users\BloodyCrown\.zcode\cli\config.json` 的 `mcp.servers`，`Authorization` 需要 `Bearer ` 前缀（长度 56 = 7 + 49）。② **key 本身有效**——用它调常规 `POST /api/paas/v4/chat/completions` 返回 200 与正常 completion；所以 401 不是 key 的问题。③ **真正的坑：这个 MCP 是 Streamable HTTP + 会话制**——必须先 `POST initialize`（它返回 `Mcp-Session-Id` 响应头），再发 `notifications/initialized`，之后 `tools/list` / `tools/call` 都要带 `Mcp-Session-Id` 头。我一开始直接裸调 `tools/call`，服务端回的是**误导性的** `MCP error -401: Api key not found`（有时网关层回 `令牌已过期或验证不正确`）。走完整握手后 **`tools/call` 成功返回真实搜索结果**。④ 工具名与参数：`web_search_prime`（`search_query` / `search_domain_filter` / `search_recency_filter` / `content_size` / `location`）。⑤ **这三个 MCP 工具目前不在本会话的工具清单里**（会话早于配置变更启动），所以我是用 `tmp/mcp-search.ps1`（保留）走原始 HTTP 手调的——要让它们成为原生工具需要重启会话。⑥ 另外：ZCode 客户端下若 MCP 报鉴权错，先怀疑「会话/握手」而不是 key。

【借搜索补到的两条线索（都追到底了）】① **RN 0.84+/Hermes v1 被报道「支持 WebAssembly」**（Callstack 2026-02 文章），但我们的 **RN 0.85.3 真机实测 `WebAssembly === undefined`**，且在 `node_modules/react-native/ReactAndroid` 的 gradle/cmake 配置里**搜不到任何 wasm 相关开关** → 至少当前构建没有生效，不能作为方案前提（将来升 RN 可再验）。② 搜到 **`zstdify`**（bhouston，npm v1.4.0，MIT，纯 TypeScript 的 zstd 编解码 + `generateDictionary` cover/fastcover 训练，树摇后压缩端 ~5KB gzip、解压端 ~9KB，与官方 zstd CLI 互通）——本来这可能让移动端**绕过 wasm 重新拿到 zstd**。真库实测**不可用**：level 1 完全不压（1.00:1，落原始块）；level 3 **在 206 条抽样里崩 4 条**（编码器内部 `FSE readNCount: truncated input`）；成功者合计 2.89MB→1.36MB ≈ **2.13:1，还不如 deflate 的 2.24:1**，且 level 9/19 结果与 level 3 相同甚至更差（级别旋钮近乎无效）。结论：**纯 JS zstd 目前没有可用的编码器，移动端算法杠杆确认关闭**，方案收敛为「去 base64 + VFS delta」，与上一轮结论一致。

user:
（准备压缩上下文）更新记忆吧。

assistant:
（落盘交接清单：当前状态 / 环境恢复 / 下一步待办 / 不要再试的清单）

【当前状态】① **分支** `feat/message-content-compression` @635c714c，worktree 在 `.worktree/f-message-content-compression`；**唯一未提交改动 = `packages/core/src/bootstrap/novel-master-bootstrap.ts` 的 `SCHEMA_BOOT_VERSION` 16→17**（必做，否则真机走快路径两列不落地）。② **真机（荣耀 EBG-AN00）** 已装该构建 `1316 / 1.5.25-mcdev`，迁移已完成并全绿；库 79,020,032 字节；设备侧留有迁移前备份 `novel_master_vfs.pre-mc-test.bak`（111MB）。③ **装的 APK 是 debug 构建且依赖 Metro**——Metro 一停 app 就起不来；要独立包需 `assembleRelease`。④ Metro 当前仍在跑（端口 8081 + `adb reverse`）。⑤ `tmp/` 内保留：`nm-real.db`（迁移前原始库 106MB，备验收/回滚）、`mcp-search.ps1`（可用的搜索客户端）、`dbinspect*.mjs`、`uidump.mjs`、`cap.bat`。⑥ subst `X:` 盘仍挂着（备后续构建）。⑦ 模拟器已还原。

【环境恢复清单（压缩后照此操作）】构建 APK：① `subst X: <worktree>` → ② 删 `apps/mobile/android/app/.cxx` → ③ `cd X:\apps\mobile && node scripts/run-gradlew.mjs assembleDebug -PversionCode=13xx -PversionName=<name>`（版本号必须 ≥ 手机已装版本才能升级安装）。**Metro 必须从真实长路径起**：`cd <worktree>\apps\mobile && npx react-native start --port 8081` + `adb -s DSLDU20407006179 reverse tcp:8081 tcp:8081`。真机验证范式：**改 JS 后用 Metro 热更 + `am force-stop`/`am start` 重启 app，不必重打包**；探针结果**落库**再读（console 在 bridgeless 下 Metro/logcat 都收不到），拉库用 `adb -s <dev> exec-out "run-as com.novelmaster sh -c 'cat /data/data/com.novelmaster/databases/novel_master_vfs | gzip -1'" > x.gz`。UI 自动化：app 窗口高度 **2202**（非屏幕 2340）、底栏 tab 在 y≈2199，取元素坐标用 `uiautomator dump` 最稳。临时探针写法参照本轮：新建 `apps/mobile/src/services/__xxx-probe.ts` + 在 `message-content-compaction.service.ts` 的 `scheduleMobileMessageContentCompaction` 里挂一行 `void import('./__xxx-probe').then(...)`，跑完 `git checkout` 还原该文件并删探针。

【下一步待办（按优先级）】① **去 base64（已拍板要做）**：core 侧 `message-content-codec` 的 RN 平台分支改走二进制 `zlib`（BLOB 已真机验证可用），并新增一个把存量 `zlib-b64` 行原地转二进制的搬运任务——**谓词就是 `encoding='zlib-b64'` 本身**（比消息的 `content_json != ''` 更干净），且读路径 `decodeCompressedBytes` 本就三形态兼容、转换期间新旧混存天然可读；注意按 `TYPEOF()` 判别，兼容「encoding=zlib 但存的是 base64 文本」的历史脏点。预期：消息 blob 43.5→32.6MB、库 79→~68MB、移动端压缩比 1.68→2.24:1。② VFS + `session_file_cache_blob` 一起去 base64（省 2.44MB，最便宜、零风险）。③ **VFS delta**（收益 ~10.7MB，正经功能：要接 `ref_count` / orphan-revision-GC / 读路径重构）。④ 合并前必办：`SCHEMA_BOOT_VERSION` 顺延 17（已做）+ merge-tree 另两处冲突——CHANGELOG（琐碎）、`sqlite-message.repository.ts`（main 侧 `mapRows` 分片让步 vs 本分支 `searchMessages` 重写，**解法：searchMessages 返回也走 `this.mapRows(rows)`**）。⑤ **AC-1 须改口径**：3:1 / 2.5:1 在中文语料 + deflate 下不可达（实测 2.24:1 / 移动端 1.68:1）。

【不要再试的（均已实测证伪，省得重复劳动）】换 brotli/zstd（Hermes 无 wasm；纯 TS 的 zstdify 编码器会崩且压不过 deflate）；CAS/精确内容去重（重复率 0.03%，零收益）；CDC 变长分块去重（43% 去重率但「去重+逐块压缩」组合后反而更差 2.01:1）；按会话聚簇打包（顺序选错损失 29%，自然时序才最优）；强迁移（单事务 journal 峰值 39.3MB，且历史 table-constraints-v1b 已证真机砖化）；预设词典（deflate 32KB 窗口封顶，仅 +5%）；WASM 方案（移动端无 WebAssembly）。

user:
[$apm-usage] 你能看出记忆压缩了吗？回复记忆。然后【方案还是收敛到那两件：先去 base64（消息 +33%、VFS 2.37MB、file_cache 0.07MB，零风险），然后 VFS 做 delta（那 82.6% 才是真正的大头）。】生成 spec [$spec-generate]

assistant:
（记忆恢复 + 4 个 readonly 探索子代理并行探索 + 真库副本复测 + SPEC 落盘）

【记忆恢复】上下文确实被压缩过（前段是摘要接续）；按 apm 约定重读了 `RULE.md` 全文与最近 memory 摘要，上一个任务的交接清单（当前状态 / 环境恢复 / 待办）已完整读回。

【⚠️ 复测推翻了「VFS delta 省 10.7MB / 82.6%」这个数字——以后引用体积收益别再照抄】口径错在**基线**：把被多个版本共享的同一份 blob 按 revision 行重复累加了。按 `content_hash` 去重后（真库副本 `tmp/nm-real.db`，脚本 `tmp/vfs-pack-measure3.mjs`，另有一份上轮遗留的 `tmp/dict-vs-pack.mjs` 独立复现，两者一致）：**多版本 entry 命中的唯一 blob = 6.080MB（另测 6.113MB）→ 打包后 3.020MB，省 3.06MB / 61.3%**。理论下限（全链单流不保 head）2.242MB —— 与旧记录的「2.252MB」吻合，**终点数字本来是对的，错的只是基线**。副产物：`vfs_content_blob` 全库唯一明文 14.374MB，二进制口径压缩比 2.02:1；**`byte_len` 写法三态混杂**（1112 行里 859 行=base64 文本长度、71 行=二进制长度、97 行=二进制长度−2），归一任务必须重算。

【Part A（去 base64）定稿：三处写侧 + 一个三表归一任务】写侧分叉只有三处、都靠 `isReactNativeRuntime()` 运行时探测（`preferZlibB64` / `forceZlibB64` 两个注入参数**只有单测在用**）：`sqlite-vfs-content-store.put` / `file-cache-blob-codec.encodeFileCacheValue` / `message-content-codec.encodeMessageContent`。读路径 `decodeCompressedBytes` 的**三形态兼容是既有契约**（zlib 二进制 / zlib+存量 base64 文本 / zlib-b64），所以存量行不转换也能读、降级也安全；三张表 `encoding` CHECK 值域都已含 `'zlib'` → **Part A 零 schema 变更、刻意不 bump BOOT_VERSION**。存量归一 = 一个 `runBlobBinaryNormalization`（表适配器参数化三张表），谓词 `encoding='zlib-b64' OR (encoding='zlib' AND TYPEOF(bytes)='text')`，分批 ≤100 + 单行短事务 + KKV 每表完成标记（module `nm-blob-binary`）+ 完成后挂维护链路（**新增会话级去重，避免多任务叠加多次全库 VACUUM**）。实测收益：消息 blob 43.435→32.571MB（省 **10.864MB**）、VFS 9.472→7.105MB（省 **2.366MB**）、file_cache 0.278→0.218MB（省 0.06MB），**合计 13.30MB，真机库 79.0→约 65.7MB**。

【Part B 选型：pack（拼接单流）而非 diff delta、也非字典链】① **diff delta 无增量证据**：实测的 61.3% 本来就来自「按版本序拼接 + 单流 deflate」，仓库无现成 delta 编解码器，Hermes 又无 wasm，自研不划算。② **字典链（前一版本作 fflate preset dictionary，head 独立）实测 depth≤8 时 2.945MB、∞ 时 2.771MB —— 比 pack 略好约 75KB，但引入「blob 行之间互相引用」**：GC 要加 base 保活、深链读放大（最深 72）、`byte_len` 失真，为 75KB 不值得。③ fflate 0.8.3 的字典**只对末尾 32KB 生效**（实测：40KB 字典里靠前的段完全用不上，只有靠后的段命中）→ 大词典方案物理上界。**最终选 pack**：两张新表（`vfs_content_pack` + `vfs_content_pack_member`，canonical DDL + BOOT_VERSION bump）、live head 永不打包（热路径零改动）、单组 ≤8 版本 / ≤1MB 明文（单组最大流实测 215KB）、pack 自包含（可逐 member 校验 hash、可反向展开）、GC 仍是单层 `NOT IN`（不动点都不需要）。**改动面风险点**：`hash ⇒ blob 行` 这个隐含契约散在 8 处（`get`/`getMany`/`ensureBlob`/`findExistingBlobHashes`/`put`/`gc`/`findContentSizeByPath`/触发器注释），漏一处就出读失败或双份存储——尤其 `findContentSizeByPath` 若对已打包 hash 返回 null，workplace 文件缓存的大文件闸门会失效（超限文件被整读）。

【探索结论（4 路 readonly 子代理，摘要）】① 直接 SQL 读 blob 表**只有两个真实落点**（content store 全方法、entry repo 的 `findContentSizeByPath`），apps 三端零直接 SQL；② `vfs_content_blob.ref_count` 由 3 个 revision 触发器维护，`gc()` 是纯 SQL `NOT IN`；③ 搬运基建可整份复用 `message-content-compaction`（谓词+分批+单行短事务+KKV+挂 VACUUM），schema migration 框架无进度语义、不可用于数据搬运；④ 历史迭代 `vfs-revision-storage-optimize` **明文把「git 式 delta/pack」列为不包含范围**，`storage-cache-dedup-and-cleanup` 的评审把「触发器计数 + 扫描 GC」双计数器判为复杂度陷阱。

【spec 落盘】**`docs/Iterations/binary-blob-and-vfs-pack/spec.md`**（新建迭代目录；Part A 6 步 + Part B 7 步、T-BB1~8 / T-VP1~10 用例、已否决方案表、口径修正说明、Context Bundle）。**Part A 建议立即执行；Part B 收益 3.06MB 而改动覆盖 VFS 主力读写，SPEC 里明确标注「待用户拍板，可只做 Part A」**。执行前置：message-content-compression 分支先合并（含 CHANGELOG / `sqlite-message.repository.ts` / BOOT_VERSION 三处合并冲突）。当前状态：**待用户确认 spec**。

user:
[$code-dev-loop]

assistant:
（用 code-dev-loop 把 spec 的 Part A 拆出 A1 范围跑完：9 个 wave、7 个提交、两轮 cr-func，终态 **dev-ready**）

【范围拍板（自决，已记 spec_deviations）】spec 原文要求 Part A 晚于 message-content-compression 合并执行，而**合并是协作红线（须用户指令）**→ 拆为 **A1（VFS + file_cache，独立于该分支，本轮做完）** 与 **A2（message 侧写侧 codec + chat_message 归一适配器，待合并后追加）**；Part B（VFS 内容打包，3.06MB）维持「待用户拍板」。分支 `feat/blob-binary-normalization`（基 02d2fcc9），未 merge / 未 push。冲突预判已记：A1 与未合并分支在约 10 个文件重叠（`packages/core/src/index.ts`、`infra/db-maintenance/index.ts`、allowlist 快照、三端 wiring、双端存储页、`ipc-types.ts`、两端 `db-maintenance.service.ts`）。

【DAG 与提交（9 wave / 7 提交）】wave0 双 impl（core 写侧收口 `801d2347` / 归一任务 `41cad8f9`）→ verify-core（全量 + 实库副本端到端）→ crfunc-core（**func-ready: yes**，但 M1 是真问题：坏 base64 行会抛穿整轮、该行永留谓词 → 每次启动白烧预算）→ wave3 四节点并行（fix-core `92c409c4`；mobile `8aa75884`；desktop `b97585f5`；cli `2233e166` = 主代理自做 trivial 节点）→ verify-all → **crfunc-all 判 no** → fix2 `78bf9ab2` → verify2 + crfunc2（**func-ready: yes**）→ docs。

【cr-func 抓到的两条真缺陷（值得记的教训）】① **收尾 `runStartupMaintenanceOnce` 的 VACUUM 裸 await**：注释写着「失败不影响正确性」，但 CLI 启动链路没有 try/catch + 进程级去重每个新进程复位 → 磁盘满时**每条 CLI 命令都失败**、且每条重跑注定失败的 VACUUM。② **零进展护栏漏掉不满批 + app 层 `sleep(0)` 续跑**：core 用「连续 3 个**满批**零进展」判异常，但谓词是实时重扫的、任何批大小的零进展都算异常信号（护栏实际永不触发）；app 层又把 `done:false` 立即续跑、而 core 预算每次调用重置 → 从「每次启动烧 60s」被放大成**无界热循环**。修法：去掉满批条件 + 新增 `stalled: boolean` 把「护栏收手」与「预算耗尽」区分开，两端见 `stalled` 即停手。**教训：「护栏 + 调用方重试」必须一起设计，单看一侧都成立、合起来才漏。**

【验证账目（实测）】core 全量 **2788/2786 pass**（仅 2 条既有 usage-stats 时区红）+ 定向 34/34；三端 typecheck 全绿（desktop renderer 为既有 349 条债、与改动行区间交集 0；mobile 全量 1535 条唯一红是既有 `mermaid-fullscreen.test.ts`，其最后相关改动 f466efa5 早于本分支全部提交）；**实库副本端到端**：`{done:true, normalizedCount:1136, failedCount:0, stalled:false}`、二次 `normalizedCount:0` 且**不下发 UPDATE**（探针断言）、1149 个 hash 逐条 sha256 与原件比对零丢失、两表全 `blob`+`zlib` 且 `byte_len = LENGTH(bytes)`、副本 111,120,384 → 107,528,192 字节。收益：vfs 9,931,792 → 7,449,238、file_cache 291,004 → 218,209（**合计省 2.55MB 逻辑 payload；副本文件 -3.59MB 含 freelist 归还**）。

【产物与基线】新增 core 任务 `runBlobBinaryNormalization`（表适配器注册表 + 谓词分批 + 单行短事务 + KKV `nm-blob-binary` 每表完成标记 + 收尾维护去重 `runStartupMaintenanceOnce`）与 `getBlobBinaryStatus`；三端各自调度（mobile 仅 agent 守卫、desktop 三守卫、cli 内联）；双端存储页三行状态（未注册表显示 `—` 占位）。**baseline 已写进 `docs/.iteration-state.yaml` 的 `known_baselines`**（core 2 条时区红 / mobile 1 条 mermaid 红 / desktop renderer 349 条既有债），后续 wave 别把这三样当回归。CHANGELOG 已加 `[Unreleased]` 条目；RULE 两条纪律（体积收益按内容哈希去重统计、数据搬运走谓词任务）随本轮提交。

【留给用户的三个决定】① `feat/message-content-compression` 何时合并（合并后我做 A2：message 写侧切换 + chat_message 适配器）；② Part B（VFS 内容打包，3.06MB）做不做；③ A1 真机验收（spec Step 6 / manual_user）：升级安装后查两表形态与库体积、二次启动零重扫。
