---
date: 2026-09-27 20:55
title: 回滚反馈全链闭环：集成（②+③）→ CR 四轮收敛（13 条 must-fix 全落地）→ 配置页即时保存 → 真机验证 → 发布 1.5.24（tag 已推、CI 触发）；chrome inspect 门禁补做实证（停摆成立）；build.gradle 非法 UTF-8 字节坑
keywords: 回滚, rollback, 用户反馈, nmbackup.db, 门禁静默, P1 吞快照, P5 刷新阻断, integration/rollback-large-jank, CR, code-review-loop, cr-fix-spec, code-dev-loop, chrome-inspect, CDP, 后台停摆, 聊天配置, 即时保存, 发布, v1.5.24, Buffer 字节级, 串行验证
abstract: 本轮全链闭环（终态）：回滚真实用户反馈（门禁静默/刷新不及时）→ 集成分支 merge ②+三处补修 → merge ③（916c5c48）→ CR 四轮收敛（P0=0/P1=2/P2=11，全部写入 cr-fix-spec 并按 fix-spec 落地，SD-1/2/3 与 D4 全 fixed）→ code-dev-loop 实现（dev-ready，5 笔提交 73c8f3f8/f310cc89/6de4d130/11e1e35c/d713336f）→ 聊天配置页保存按钮移除+压缩配置即时保存（58e13d03）→ 真机 1314/1315 用户验证通过 → **发布 1.5.24**（main merge ed6d8cc5 + bump 02d2fcc9，tag v1.5.24 推送、CI 触发）。期间补做 ③ chrome inspect 硬门禁实证（后台 timer 停摆成立：切后台 47.2s 零 tick），新增 build.gradle 非法 UTF-8 字节须 Buffer 级替换的教训。文件末尾为压缩前状态快照 + 发布后终态。
---

user:
我测试了下，发现没卡。这个是一个用户的 db 文件（nmbackup.db），它说它回滚的时候出现过卡顿，就是长时间不弹出确认框，还有就是 user 消息回滚后，刷新不及时，需要重新进入会话。这个分支的优化我理解也有用？那就先保留吧，我们探索下 user 消息回滚链路。

assistant:
（本轮全程：集成分支 worktree 已建好且 merge ② 解完冲突；用户中途两次纠偏——「修的是不是一个东西」与「junction 别放盘根」，均已采纳）

【症状重定义】用户原话拆成两个独立症状：A=点回滚菜单项后确认框长时间不弹；B=user 消息回滚后界面不刷新、需重进会话。② 的四个改动（parse 分片让步/快照字节分片/孤儿清扫 deferred/token 错峰）只覆盖「确认之后的执行链卡顿」，对 A 的「不弹」和 B 的「不发生」两个功能性症状零覆盖——判定「有用但不够」，探索补齐。

【用户库解剖（nmbackup.db，只读）】61 条消息/86KB/5 会话的小库——数据量排除计算型卡顿（61 条 parse 是毫秒级）。关键现场：最大单条 21.5KB 的"user 消息"实为 tool_result（read 工具的文件全文，user 角色落库），所在 792f 会话只有 3 条且 tool_result 后无 assistant 收尾（run 异常中断现场）；session_run_state 仅 e943 一行 settled；user_version=14（≈v1.5.21/22，早于 1.5.23）；llm_provider 0 行。教训：「user 消息长」的实体可能是 tool_result 而非人工输入——undo_send 判定按 isPlainUserUndoSendEligible 走 rewind 分支。

【子代理全链路梳理结论（Explore，107 次调用）】弹窗前链路干净（无 DB/parse/大计算；唯二成本 = chatMessages.find×2 O(n) + editableTextFromMessage O(len) 且 rewind 模式白算）。真病灶：A=agentRunning 门禁只弹 toast「请稍候」（useChatTabMessageActions.ts:191）——run 在途/状态残留时确认框永不出现；B 三条实证丢失路径——P1（ChatTranscriptWebView messages effect 吞快照分支：lastStreamCommitIdsRef 非空+条数不变即静默不发快照，回滚删尾 tail 满页时命中，与症状一字不差）、P5（refreshComposerStatusAfterSessionKkvCleared await 抛错直接跳过 reloadMessages 且误报「回滚失败」）、P2/P3（分片缺片不自愈/webReady 无失效通道，低概率）。另 P6=resetStreamTail 的 flushPendingSnapshot 用旧 messages 多开一次全量快照（成本翻倍，本轮未修登记）；P7=session-transcript-changed 接错回调（同族刷新洞，非本症状）。

【模拟器复现（导入用户库重放）】模拟器（emulator-5554）装 1310+metro（i-rollback 源码）。用户库经产品「导入数据库」入口 UI 导入（存储配置→导入数据库→SAF 选文件，全程 UI 合规）。复现结果：A **实锤**——mock-dead 挂死 run 后长按消息点回滚，只弹小 toast、无确认框；同入口中断后回滚确认框正常弹出（对照成立）。B **两轮均正常**（792f 常规回滚 + 中断后回滚都刷新成功）——结合用户设备与旧版本，判定 B 主因=旧版（无②优化）执行链卡顿在低端机放大到秒级、用户等不及重进；P1/P5 是特定条件（>40 条会话+中断残留 / composer 刷新恰好抛错）下的真丢失路径，用户库最大会话 36 条未达 P1 门槛。

【三处补修（集成分支 a4ac7546）】①门禁 toast→Alert.alert 模态（「暂时无法回滚/Agent 正在运行，请先停止生成或等本轮完成后再回滚」）；②P1 吞快照分支加 committedStreamRowsStillPresent 校验（已 streamCommit 的行必须仍全部在当前列表才允许跳过快照；合成行 id 不在 messages 里→自然走全量快照，语义更正确）；③P5 的 composer 状态刷新改 try/catch 隔离（DB 已截断，刷新链与成功 toast 不允许被阻断，失败只 console.warn）。新增回归 chat-transcript-snapshot-after-stream-commit.test.tsx（2 用例：回滚满页窗口必须重发快照+messages 同引用去重保持），**反向验证过**（临时去掉校验→第一用例红）；chat-transcript 全系 17 套件 155/155 绿；typecheck 零错。metro 热重载模拟器回归：门禁 Alert 实弹✓、中断后回滚全链（确认框/删除/composer 恢复/toast）✓。CHANGELOG Unreleased 补回滚三条（7b0ab616）。

【merge ② 的冲突解法（5f239c57）】message-rollback.service.ts 与 main 的 context-usage 治本双删撞车：保留 invalidateSessionApiPromptTokenEntry（双删覆盖②旧的单缓存失效调用），顺序上「await 失效在前、fire-and-forget 孤儿清扫在后」——否则清扫的全表 DELETE 先排进连接互斥队列会把失效挂点挡在后面、间接阻塞 rollbackToMessage resolve。

【环境与坑（本轮新增）】①junction 迁移 D:\Dev\nm-worktree\nm9（用户拍板「集中处理」，约定已入 RULE；不再写 D:\ 盘根）；**换 junction 后 gradle autolink 缓存残留旧绝对路径**（报 configured projectDirectory 'D:\nm9\...' does not exist）——须删 android/build+app/build+.gradle 再构建。②双 mock 隔离：真机（用户在自测）与模拟器 reverse 到同一 8787，而 8787 挂着 hang-after=1 的挂死配置——立刻拆成 8787（安全 999999，真机用）/8788（挂死实验，模拟器用），避免挂死用户的测试请求。③真机 Honor 的聊天 WebView 对 input swipe 滚动零响应（模拟器正常）——真机上定位列表外消息不可行；本轮全部改在模拟器验证。④模拟器 uiautomator 时灵时不灵（空树 2253 字节反复出现，pkill 无效）——降级为「截图+视觉逐字转写」驱动，每步截图问坐标，流程跑通但每步 ~10s。⑤模拟器中途 app 莫名退到桌面（hang1 输入进了 launcher 搜索框）——关键操作前先 dumpsys window 确认 mCurrentFocus 是 com.novelmaster。

【终验与收尾（17:40）】1311 从 D:\Dev\nm-worktree\nm9 全量构建成功（8m36s，junction 迁移后 autolink 缓存坑已解）。真机中途离线（USB 断开），终验改在模拟器完成：1311 安装启动正常（用户库 5 会话完整）、回滚确认弹窗正常弹出（取消路径收尾，确认路径已在热重载轮全验过）；**真机 1311 复验待设备回来补**。清理完毕：双 mock/metro 已停、各设备 adb reverse 已清、tmp 内 frames/截图/日志已删（保留 cap.bat/dbinspect*.mjs/uidump.mjs 三个可复用工具脚本）；模拟器保留 1311+用户库+mocktest 环境（下轮回归直接用）；junction D:\Dev\nm-worktree\nm9 保留（集中地约定）。真机残留未清（不在线）：mocktest provider、会话5/6 及测试消息——等真机回来清或用户自删。

【真机复验与清理完成（18:10）】真机回连后装 1311 复验全过：门禁 Alert 在流式进行中实弹「暂时无法回滚」模态✓、正常回滚全链路（确认框→删除→即时刷新→composer 恢复→toast）✓。清理完毕：测试会话 5~10（含排队误建的 7~10）经 UI 多选删除、mocktest 服务商经 UI 删除，用户原有会话 1~4 完好；mock/metro 已停、真机 reverse 全清；**metro 停用后 1311 靠缓存 bundle 冷启动正常**（验证过，留给用户可用状态）。真机一个新观察：app 冷启动（从 metro 拉包）后 JS 就绪前的 tap 会排队延迟生效——误建了 4 个空会话，操作前应等 JS 就绪再交互。

【遗留】分支 integration/rollback-large-jank（HEAD 7b0ab616）未 merge（协作红线等指令）；P6/P7/P2/P3 登记未修；② 原有的真机 manual_user 大会话卡顿打点对比（spec Step 7）未做——本轮用户库实测未复现卡顿，优先级降。

【1311→1312 教训与终态（18:40）】1311 是 metro 模式 debug 包，我收尾时把「停 metro」与「重启 app 验证」两条命令**并行**发出——app 在 metro 死透前启动拉到了 bundle，截图正常属假象；用户再冷启动即红屏（dev 包无 metro 起不来），被用户当场抓到。**教训：依赖「某进程已死」的验证必须严格串行（先杀、探活确认、再启动验证）**。补救：重新拉 metro 救活手机 → 按内嵌 bundle 诊断配方出 1312（MainApplication.kt 临时加 useDevSupport=false + bundle --dev true 进 assets + gradle 1312 + **git checkout 还原 kt**——res/assets 副产物未跟踪不提交）→ 装机后串行验证（metro 探活确认死 + reverse 全清 + force-stop 冷启动）正常——**真机终态：1312 独立包，无 metro 依赖**。

user:
（后续轮）同意合并 ③ 到集成分支并真机测试（不占主分支与主 worktree）；测试后进入 CR 阶段。

assistant:
【③ merge 与真机（当日）】集成分支 merge ③ 完成（916c5c48，仅 CHANGELOG 冲突、sse-chunk-emitter 自动合并且语义核对通过）；回归：③ 定向 4/4+3/3、② 快照三套件 11/11、三包 typecheck 零错。1313 内嵌 bundle 包（MainApplication.kt useDevSupport=false 配方 + 还原）装机；mock 慢流（interval 400ms/total 1800）真机跑后台场景：流式中切后台观察 + 用户接手完成测试，结论「感觉没问题」。（真机 WebView/输入法操作坑：API Key 输入框 adb input text 不触发 RN onChangeText 导致创建按钮禁用——华为 IME + secureTextEntry；发送键/创建键 tap 不生效；最终用户手动完成服务商配置与发送，测试通过。）

【CR（code-review-loop）四轮收敛】范围 = 集成分支 vs main（14 提交/39 文件 +2644）。round1 三路 readonly scope（rollback-core / rollback-mobile / background）→ P0=0 / P1=2 / P2=11；spec-fix 写入 `docs/Iterations/mobile-perf-2026-09/cr-fix-spec.md`（在 i-rollback worktree）。round2 review-full 抓出 N1~N6（B-01 改法方向性错误最重）；round3 校验发现方案 1 两个前提不成立 → **B-01 收敛为「10s 窗口上限自动失效」**；round4 终校验判「达可宣布 fix-spec-ready 质量」，主代理顺手补两处小修（trivial 豁免）。关键 must-fix：RB-CORE-01（共享 truncateTailInTransaction 写死 includeGlobalOrphans:false，参数上提）、B-01（打点窗口只开不关）、M4（db-backup 注册无 isBackground 被 last-wins 覆盖）、M1/M2（emitter 终态契约 + 注释假陈述）、M5（CHANGELOG ③ 口径）。SD-3（chrome inspect 门禁）当日补做实证→成立→转 fixed；**SD-1（三处补修回填 spec/PRD）仍待用户确认**——确认后即可宣布 fix-spec-ready + 附 Closure。

user:
（对 chrome inspect 门禁的质疑）「什么叫 chrome inspect 没做？那优化了个寂寞吗？」→ 解释+补做实证后：「修正吧，按这个步骤来」——授权 SD-1 回填 + 宣布 fix-spec-ready + 开实现任务。

assistant:
【全链收口（当日）】① SD-1 回填：rollback-large-jank/spec.md 变更点 #8 + 批次 PRD 用户拍板记录补条目 → fix-spec 状态转 **fix-spec-ready**（SD-1/SD-3 全 fixed，附 Closure）。② code-dev-loop 实现：wave-0 四路并行 impl（core 回滚链 RB-CORE-01~04 / mobile 快照链 B-01+A-01+C-02+G-01 / emitter M1~M3 / mobile db M4）+ 主代理 M5（CHANGELOG 口径，trivial），全部带红绿确认全绿；wave-1 verify 整合回归（core 767/769——唯二失败为既有 Windows TZ 环境问题、与改动面零重叠；mobile 8 套件 89 用例全绿；双 typecheck 通过；lint 变更文件 0 新增）；wave-2 cr-func readonly 13 条逐条核验 **func-ready: yes**（抽查 RB-CORE-01/G-01/C-02 三处断言确认咬住改法）。③ 五笔提交按逻辑块：73c8f3f8(core 回滚链) / f310cc89(core emitter) / 6de4d130(mobile 快照链) / 11e1e35c(mobile db) / d713336f(docs: fix-spec + CHANGELOG)——**HEAD = d713336f，dev-ready 达成**。SD-2/D4 随代码落地转 fixed。C-02 实现取 (a) 真字节方案（utf8ByteLength 惰性 TextEncoder，Hermes 缺全局时兜底 .length）。遗留（不阻塞）：usage-stats 2 例 TZ 失败为既有无关闭题（Windows 无 IANA TZ 支持）；mobile lint 既有 4 个 exhaustive-deps error 非本轮引入；`res/assets/` 构建副产物未提交。

user:
（真机测试收工后追加需求）「帮我把聊天配置页面，它的保存按钮移除，我发现点击不点击都不影响配置生效」→ 真机验证通过后：「发布吧」（novel-master-publish）。

assistant:
【配置页改造（同类修复）】ChatConfigScreen：压缩配置三个控件改**即时保存**（开关切换即落库、输入框 onEndEditing 落库；校验失败/写库失败 toast 并回滚开关），移除底部保存按钮（StickyFormFooter 不再使用）。经查 mobile 侧 setConditions 此前唯一调用点就是该按钮（无自动保存路径），故「移除按钮」必须配套即时保存否则功能回归。测试 chat-config-screen-switch.test.tsx 更新（FormField/FormSectionCard mock 改渲染 children 以触达 Switch）+3 条新用例，12/12 绿；提交 58e13d03；1315 包真机用户验证通过。
【发布 1.5.24（当日）】主仓 main 合并集成分支（**ed6d8cc5**，45 文件 +3551；未提交的 docs 改动与 merge 无重叠，保持工作区）→ CHANGELOG 定稿（Unreleased → `## [1.5.24] - 2026-09-27`，5 条修复）→ 版本 bump（desktop/mobile package.json + build.gradle 默认 versionName；**踩坑新录：build.gradle 含历史非法 UTF-8 字节（中文注释乱码），utf8 字符串读写会把乱码行洗成 U+FFFD——必须纯 Buffer 字节级替换**，重做后 diff 恢复 1 行）→ desktop typecheck 通过 → 发布 commit **02d2fcc9** → tag **v1.5.24** 推送（CI：Android APK + Windows NSIS + macOS DMG）→ main 推送 origin（4a6f7d4e..02d2fcc9）。环境清理：mock/metro 停、真机 reverse 清、真机留 1315 包。主仓遗留未提交 docs：spec/prd 回填（SD-1）、RULE.md、pi-token-rate 记忆、本文件与 verify-guide 两个记忆文件——待随下次 docs 提交。

════════ 压缩前状态快照（2026-09-27 19:05）════════

【恢复锚点（按优先级）】
① 用户给 merge 指令——`integration/rollback-large-jank` 全部就绪可合（含 ② 全部提交 + 三处补修 + CHANGELOG）；合并后注意 ①④ BOOT_VERSION 撞号顺延、①② sqlite-message.repository 冲突等备忘见 `20260927-worktree-123-verify-guide.md`。
② 未修登记项 P6/P7/P2/P3（本轮 Explore 子代理实证、未动手）：P6=resetStreamTail 的 flushPendingSnapshot 用旧 messages 多开一次全量快照（回滚链成本翻倍）；P7=session-transcript-changed 监听接错回调（`ChatTabProvider.tsx:209` 传了 refreshChatTokenLabel，跨入口改库后消息面不刷新）；P2=快照分片缺片不自愈（会话>50 条丢任一片永久不 apply）；P3=webReady 无失效通道（WebView 重建后 postMessage 静默丢）。
③ ①（压缩）/③（后台）两分支的验收仍待做（指引同 verify-guide 文件）。

【提交全景】集成分支 `integration/rollback-large-jank`：4a6f7d4e(main 文档提交) → 5f239c57(merge feat/rollback-large-jank@19e4e841，冲突解法见前文) → a4ac7546(三处修复+回归测试) → 7b0ab616(CHANGELOG)。**HEAD=7b0ab616，未 push 未 merge**。feat/rollback-large-jank(19e4e841)/feat/message-content-compression(635c714c)/feat/background-run-continuity(61a14db9) 三 feature 分支原样未动；main=4a6f7d4e（=origin/main 之后又有本地 docs 提交？以 `git log -1` 实查为准）。

【主仓未提交改动（下次会话留意）】main 分支：M `docs/apm/RULE.md`（junction 集中约定 + 更早会话的改动）；M `docs/apm/memory/20260927-pi-token-rate-reference-study.md`（前会话遗留）；?? 本文件 + `20260927-worktree-123-verify-guide.md`（两个新记忆，待随下次 docs 提交入库）。

【环境终态】真机 DSLDU20407006179：**1312 独立包在装**（内嵌 bundle、无 metro 依赖、串行验证过冷启动）、用户 4 会话完好、测试残留全清（会话5~10+mocktest 已删）。模拟器 emulator-5554：1311+导入的用户库+mocktest provider 留存（下轮回归环境）。metro/mock 全停、双机 reverse 全清。junction `D:\Dev\nm-worktree\nm9` → i-rollback worktree 保留（RULE 已约定集中地）。worktree i-rollback：工作区净（除未跟踪构建产物 res/assets 与 android build 输出，勿提交）。tmp 保留 4 个工具脚本（cap.bat/dbinspect.mjs/dbinspect2.mjs/uidump.mjs）。1312 APK 在 `D:\Dev\nm-worktree\nm9\apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk`。

【本轮教训速查】串行验证纪律（1311 事故）；换 junction 须清 gradle 缓存（autolink 残留旧绝对路径）；真机冷启动（metro 拉包）后 JS 就绪前的 tap 排队延迟生效（误建 4 会话）；双设备共享 mock 时 hang-after 全局计数会误伤对方；findstr 中文管道编码不稳（用 node 脚本过滤）；cmd 多行 node -e 静默丢弃（写文件执行）。
