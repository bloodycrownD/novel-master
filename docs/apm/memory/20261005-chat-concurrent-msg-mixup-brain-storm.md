---
date: 2026-10-05
tags: [mobile, chat-webview-unify, regression, concurrency, webview, brain-storm]
source: 用户报障 brainstorm 诊断
---

# 并发会话 msg 混乱诊断（chat-webview-unify 回归族）

## 用户诉求

webview 优化后，并发会话会出现 msg 混乱。用户猜测是「状态未清理和并存」的原因，问有没有办法处理。

## 诊断结论（brain-storm 三路子代理探索 + 主代理抽查核实）

**用户猜测方向正确，但精确定位是：混串不在数据层，在 WebView 文档层（协议无会话身份 + 清场不全）。**

干净的部分（勿动、勿再排查）：

- core 事件 = 全局单总线广播，payload 一律带 sessionId+runId；mobile 的 SessionStreamUnitManager 全量订阅后按 `payload.sessionId` 路由进 per-session unit，unit 内再校验 runId 所有权——与 desktop `useAgentStream` 的 `p.sessionId !== sessionId` 守卫语义等价。
- stream unit（Map<sessionId>）、view-cache（projectId:sessionId）、idle 消息面（LruMap<sessionId>）全部 per-session。
- webview 句柄 attach/detach 按 sessionId（ChatTabProvider attach effect cleanup detach）——切会话后 A 的流式 delta 物理上不再推给文档。

病灶（SPA 化引入，「实例即会话边界」的天然隔离消失后手工清场链没补全）：

1. **协议层无按会话隔离的通道**：下行消息只有 `sessionSnapshot` 带 sessionKey+generation；`streamDelta`/`streamBatch`/`streamBlockCommit`/`streamCommit`/`appendTailRows`/`prependPage`/`streamToolInvoking` 全部不带会话身份也无代次，web 侧 `bridge.ts:handleHostMessage` 无校验直接写进单例 `state.rows` 与唯一 `#stream-tail`。代次机制只防「旧代次晚到」，防不了「用新代次发旧内容」（`sendSessionSnapshotNow` 调用时才 `++snapshotGenerationCounter`）。
2. **切会话清场 effect 只清一半**：`ChatConversationWebView.tsx:1884-1887` 的 `[sessionKey]` effect 只有 `resetComposerBaselines()` + `clearLocalStreamBuffers()`；没清 `deferredSnapshotActionsRef`、`pendingSnapshotRef`+`snapshotDeferTimerRef`、`streamActiveRef`、`lastStreamCommitIdsRef`、`prevMessagesRef`——与文件头 :38-41「新增 ref 须同步补清场」的自定纪律直接冲突（子代理实锤的矛盾点）。
3. **web 侧 state.stream 只在 `applySnapshot` 且 `sessionChanged`/非 preserve 时清**；而 ④ 开屏快照 effect 在 `messages.length===0` 时早退不发快照（:2189-2192）。

## 已证实的串台路径

- **P1（最危险）**：A 流式活跃时非 force 快照被压进 `pendingSnapshotRef`（streamActive=true 直接 return 只压栈）→ 切 B → 清场不清 pending/streamActive → B 侧 `resetStreamTail`→`flushPendingSnapshot()` 或残留 0ms 定时器 fire → 拿到最新代次发旧闭包快照 → web 判旧失效 → **整份 A 盖掉 B 的文档**（`state.sessionKey` 翻回 A）。附带：期间 A 的滚动 offset 会写进 B 的滚动缓存。定时器分支触发概率未实测（标注：E2 未证实）。
- **P2**：A 的 deferred 队列（分片在途时挂起的 `appendTailRows`/`streamCommit`）跨会话存活（被顶替时 finally 条件跳过清理）→ B 快照末片后原序重放 → **A 的行追加到 B 转录尾部**。web 侧 `applyAppendTailRowsNow` 无 id 去重（与 applyStreamCommit 不一致）。
- **P3（空会话残留，最易复现）**：切到 `messages.length===0` 的会话（新建会话）→ ④ 早退不发快照 → **A 的历史行+流式尾块原地留在文档当 B 显示**；此后 B 的 delta 直接 append 到仍属于 A 的 `state.stream` 气泡——「A 的半截话 + B 的话接在一起」。
- **P4**：`useInterruptedPartialCommit` 无 sessionId 守卫且 readyEpoch 切会话不递增（去 key 后不再重挂不再 ready，旧假设失效）→ 中断合成行错打或永久丢失。

历史文档无此预判（chat-webview-unify 全目录无并发/串台条目），同族先例 = `bugs/workspace-stale-on-session-switch.md`（SPA 化去 key 后组件跨会话复用、状态未重置，当时修法 key 补 sessionId 整实例重挂——但转录文档不能重挂，只能走协议清场）。session-stream-unit-2026-09 的 T-U13 只覆盖 manager/unit 层不覆盖 webview 文档层。

## 修复方向（三路子代理一致建议，待用户拍板立项）

1. 最小修（堵 P1/P2）：`[sessionKey]` 清场 effect 补清 deferredSnapshotActionsRef、pendingSnapshotRef+clearTimeout、streamActiveRef、lastStreamCommitIdsRef（与 :2073-2077 已有写法同款）。
2. 结构防线（治本）：全部转录域下行消息补 `sessionKey` 载荷（postToWeb 出口统一注入 sessionKeyRef.current）+ web 侧 bridge 入口统一判据「payload.sessionKey 非空且 ≠ state.sessionKey → 丢弃」——desktop 守卫在 webview 层的等价物。
3. P3：`messages.length===0` 的切会话路径发空快照显式清场（限定 sessionKey 变化时放行，避开 3 轮抖动顾虑）或新增显式 reset 消息。
4. P4：useInterruptedPartialCommit 补 sessionId 依赖 / 去重键含 sessionKey。
5. 别动 manager/unit 层（那层干净，动了破坏 T-U13 并行隔离）。
6. 回归锁：「A 跑着→切 B→断言 web state.rows 不含 A 的 message id」+「切空会话→rows/stream 已清」。
7. 改 web 侧（bridge.ts/model.ts）须 `build:webview(:native)` 重打包，reload 不生效。

## 复现/确诊手段

P1/P2 签名特征化（同一文档出现 sessionKey=A 但宿主 sessionKey=B；B 快照后紧跟 A 的 appendTailRows），可用现成 bootTimingLog/rollbackTimingLog 在 ④ 快照入口打 sessionKey+generation+chunkTotal、postToWeb 出口按类型打点，一次真机复现即可确诊主路径。

## 第二轮：spec-generate 修复方案定稿（2026-10-05）

用户 [$spec-generate] 进入方案设计。两路修复向探索（协议落点 + 测试/构建约束）后 spec 落 `docs/Iterations/transcript-session-isolation/spec.md`，**待用户确认**。

方案四层（详见 spec）：①宿主 `[sessionKey]` 清场 effect 补 7 个 ref（照抄 :2065-2078 切视图中止写法，先掐定时器再丢档最后顶代次；切会话不置 needsResume——走 ④ needsOpen 开屏语义）；②6 条带内容的下行消息（appendTailRows/prependPage/streamDelta/streamBatch/streamBlockCommit/streamCommit）在**构造点闭包捕获**当拍 sessionKey + web `bridge.ts` 入口一行判据「带 key 且基线非空且不匹配→丢弃」；③空会话开屏（needsOpenSnapshotRef 分支）发空快照清 DOM（planSnapshotChunkBounds 空列表天然返回单空桶，可行性已核实）；④useInterruptedPartialCommit 显式加 sessionKey 入参（不动 transcriptReadyEpoch——epoch 语义是 webview 基线世代，塞会话语义会污染）。

**探索定案的关键取舍（勿回退）**：sessionKey **不能**在 postToWeb 统一注入——sessionKeyRef 只在 ④ effect 更新，P1 场景旧闭包快照在途时 ref 已被改写，统一注入会给旧内容打新标签、web 判据反而放行，串台更隐蔽；判据必须「基线空则放行」否则新会话首片前的合法增量被误杀；streamReset/flagsUpdate/streamToolInvoking 不带 key（清空/全局/指示类，且 streamReset 载荷是 Record<string, never> 改它属类型骨架变更）。

**测试/构建要点**：新用例 T-SI1~11（宿主 closeChunkGate 在途窗口锁 + web 判据 loadFreshModules/FakeElement 桩 + P4 InterruptedTestHost）；generation 是模块级计数器禁断绝对值只断相对大小；空快照会撞既有 toHaveLength 计数断言须逐条复核；fake timers 与 flushTimers/flushSnapshotChunks 互斥；改 web 源码必须 build:webview 重建 dist（jest 直连 src 会假绿）；全量门 --maxWorkers=2。明确不改：session-stream-unit*（干净层）、ChatTranscriptBridge.ts（死类型面）、dispatcher.ts（透传无碍）、桥 v 号与 type 集合。

## 第三轮：spec-check-loop 三轮收敛至 execute-ready（2026-10-05）

用户 [$spec-check-loop] 审查 spec。三轮子代理审查 + 主代理 doc-fix 收敛（轮次上限 5 未触顶；r3 派遣曾两连空返回，重派新实例成功）：

- **r1 No-Go（2P0+1P1+6P2）**：P0-1 判据按原文会把新会话开屏快照整份丢弃（新快照带新 key 而基线还是旧值）——修法豁免 sessionSnapshot、迟到旧分片靠既有 generation 判旧兜底；P0-2 T-SI9 断言与 P4 实现互斥 + P1-1 单槽去重记录 A→B→A 永久丢合成行——修法「清空式」（sessionKey 变化清 committedRef，勿用增列进命中条件的等价改法）。顺带核实：清场 ref 清单完整、6 构造点穷举无漏、引用行号全准、既有计数断言不撞（baseProps 恒带 1 条消息）。
- **r2 No-Go（新 1P0+2P1+4P2）**：新 P0=unitView 切会话晚一拍（state+effect 同步），陈旧投影帧四道守卫全过、A 合成行提交进 B 且子组件 effect 先跑快照救不回——修法 hook 内身份比对守卫（`${unitView.projectId}:${unitView.sessionId}` !== sessionKey 则 return，与 chatScrollKey 逐字同格式）；P1-1=判据自身新回归（B 开屏快照分片在途窗口丢 B 自己的流式消息，attach 即注入正撞）——修法 state.pendingSessionKey 三态判据；P1-2=清空与 null 早退次序——清空必须 effect 第一句（否则 A→列表→A 丢行）。P2：T-SI8 变异观测面纠正（T-SI3 是宿主侧不执行 web 判据）、mock 面补 flagsEqual、子会话屏 TDZ（:244 memo 勿复用）、generation 兜底前提（RN 恒带 :1161）。
- **r3 Go（6P2 全顺手修完）**：①pendingSessionKey 第四处生命周期（:104-110 单片作废在途收集器也要清，收成 resetPendingChunkAcc helper 四点共用 + T-SI8c）——漏掉则 pending 长期挂 A、迟到 A 消息被放行；②prevMessagesRef 不入清场清单（③落地后无漏写路径）；③mock 面补 host-message-channel/scroll 必须真实加载（前者一 mock 全用例假绿）+ bridge 须与 state 同一 isolateModules（否则单例分叉假绿）；④T-SI8b 观测面改 appendStreamDelta 调用（stream 被 mock 后 state.stream 不可断言）；⑤T-SI9① 标注行为锁非变异面、T-SI10 改述主屏列表态帧；⑥文件计数 9 源文件+4 测试文件。

**终态：execute-ready（r3 Go + P2 全闭合）待用户确认后开工**。spec 路径不变。核心不变量（实现时勿回退）：快照豁免前置、三态判据、清空第一句、身份比对守卫、构造点闭包捕获（非 postToWeb 统一注入）、pendingSessionKey 四点生命周期。

## 第五轮：code-dev-loop 四波至 dev-ready（2026-10-05 续）

wave-0 三 impl 并行全部交卷（rn-webview=Step1+2+3 / interrupted=Step5 / web-guard=Step4，各带定向全绿与变异自证，八处变异全咬——rn-webview 的 deferred 变异失败信息直接实锤 P2 机制：A 的行带 A key 被补发进 B 尾部）；wave-1 verify-all（定向 130/130、tsc 三段零错、build:webview 门 C 四包 GREEN 棘轮零升、全量 2136 中 2130 绿——6 红定性：5 条=batch-delete mega-CR 遗留 mock 债与本分支 import 面零交集、1 条=满负载时序噪声隔离绿）；wave-2 cr-func-1 **func-ready: yes**（六不变量逐一对上、18 条 blocking 用例齐、A 组零交集独立复算确认、4 条 deviation 全是文档级）；wave-3 全量复跑坐实（B 组噪声消失、仅剩 A 组既有红）。**主代理统一四笔提交**：9c4b0b994（RN 侧）/8c9b26a46（P4）/eac0e9ff2（web 侧）/4402a7e0e（docs：spec 执行终态回填+Bundle dev-ready+chat-webview-unify/bugs/concurrent-session-msg-mixup.md 同族留痕+CHANGELOG Unreleased 修复条目）。spec 4 条文档级 deviation 已全部回填（'stick' 笔误/变异措辞收敛/Step3 依赖链结论/清场行序说明）；T-SI9⑤/T-SI10 的 null 帧实测必须走列表态驱动（面板常驻 surface 不卸载 ref 才真实存活）——测试按真实链路写。

**dev-ready 达成，未 merge**（等用户指令）。worktree `D:\Dev\nm\tsi`（分支 feat/transcript-session-isolation，base 28bcb9d0b）。待办：Step 7 真机并发验收（manual_user：A 生成中切空会话 B 应立即空白、来回切无串台、A 中断合成行只出现在 A——web 侧改动须 build:webview:native 重出 APK，Metro reload 无效）；batch-delete 5 条既有红建议单开 bug 清偿。

## 第六轮：e2e 模拟器验证通过（2026-10-05 续）

用户指令「进行e2e测试」。链路：nm35 模拟器（API35）+ tsi worktree 重打 APK（e2e:build-apk=build:webview:native+assembleDebug，新 worktree 首次全量 ~20 分钟）+ Metro 8081（真实路径）+ 设备 prefs 残留 8084 用 **reverse 8084→宿主 8081** 兼容 + mock provider 9753 + reverse。结果：**smoke.launch 绿；chat.conversation-webview 3/3 绿**（单文档判据/composer 回读/web 内发送，52s）。

**首跑失败的定性（e2e 基建长尾，非本分支问题）**：launchFresh 建项目后 `waitForDisplayed` 等项目行超时——库实锤项目创建成功（node:sqlite 拉 databases/novel_master_vfs 查 chat_project；注意 **db 实际在 databases/ 不在 README 写的 files/default/**，后者是空目录）、模拟器钟比宿主慢 ~7s（解释 created_at 与 submit 点击的 6s 时差）、a11y 树 dump 实锤新项目行**在树里但列表最底部离屏不可见**——设备堆积了 6 个 10-01 的「E2E Rollback Undo」残留项目把新行挤出屏。处置：UI 删除清理（循环脚本 dump+tap，**每单确认框正文含目标项目名才点删除**——红线），清后复跑即绿。改 page object（scrollIntoView）属 e2e 基建改进，挂账未做。

环境坑三连：①新 worktree 的 .appium 驱动为空，直接 npx wdio 绕过 ensure 会报「Could not find a driver」——必须 `npm run e2e -- --spec ...`（走 e2e:prepare 前置）；②cmd 下 timeout /t 与带引号 node -e 全不可用（延时用 Atomics.wait、脚本一律落 tmp 文件）；③设备侧链路诊断三板斧（uiautomator dump 文本提取 / run-as 只读拉库 / adb date 对钟）很有效。收尾：mock/Metro/模拟器全关，设备测试残留项目全清（7 个），tmp 日志留在 worktree tmp/ 备查。

## 第七轮：code-review-loop 两轮至 fix-spec-ready（2026-10-05 续）

用户 [$code-review-loop] cr。r1 三 scope 并行（rn/web/p4）→ 主代理 spec-fix 落 cr-fix-spec → r2 review-full 终审（条件性 yes，四条修订意见全部吸收后）判 **fix-spec-ready**（提交 bfff42b02）。

**发现汇总**：无 P0/spec deviations；must-fix 10 条（2P1+8P2，全部测试/注释层零实现改动）——rn/G-1 P1「五类构造点删 sessionKey 字段后 2130 用例全绿的结构防线静默失效」（六构造点断言全覆盖方案，r2 修订：streamBatch 与 delta 共 streamRafRef 必须分两拍 flush、streamBlockCommit 在既有 T-N6/B-2 骨架零成本触发直接断言）；p4/B-1 P1「回列表→再进同会话合成行永久丢失」——**r2 git show 独立复核确认为存量缺陷非本分支回归**（main 同样不重挂/epoch 不变/rows 整换；触发前提是回列表时快照分片恰在途被中止，needsResume 补铺整体替换 rows 抹掉合成行且 hook 依赖全不变不补交）→ 超出「切会话」范围进 OQ-1 待拍板三选一（并入本迭代修 onForceSnapshot epoch 方案 / 独立小迭代 / 挂账——挂账时不写「现状即丢」的契约用例）；p4/G-1 P2「T-SI9⑤ 场景标错」——真实回列表不清 sessionId、chatScrollKey 保持非 null（backFromConversation 只切 chatSubview），mock 双置 null 测的是「无选中会话态」另一条路，真实回列表路径零覆盖（与 OQ-1 联动）。B-K 抽查 D/E/F/H/J 干净；OQ-5 web 丢弃零可观测性（判据丢弃无日志无回传通道，Step 7 真机若见「消息不显示无报错」第一嫌疑即此）留痕。

**待用户**：确认按 cr-fix-spec 执行修复轮（10 条 must-fix）+ OQ-1 三选一拍板。

## 第八轮：spec-check-loop 执行视角复审 cr-fix-spec（2026-10-05 续）

用户「cr spec 不是开发 spec，loop」（与 chat-webview-unify 轮同款指令）。sc-r1 No-Go（4P1+6P2，事实面/API 依赖全核实通过，卡点全是「照字面执行会翻车」）+ sc-r2 **Go**，主代理 doc-fix 全闭合（提交 ddf0528b1）。关键修订：rn/G-1 ②③④改各立独立用例带期望值（并入 T-SI2 会被 commitSyntheticAssistantRow 清 streamActive 打破其收缩断言——:1349-1351 副作用）+行号归属组件源码+变异六处改五处；web/G-2 变异口径改「pending 非空即全放行」形态（原「去掉 pending 比较项」验错对象假绿）；web/C-1 死代码链四处（类型别名/字段/局部变量/require+返回项）+eslint --max-warnings 321 基线；p4/C-2 三处「列表态 null」→「无选中会话」；p4/G-1 拆开（T-SI9⑤ 只换场景词保留断言与变异牙口，T-SI10 整条换）；K 节五步可粘贴命令。**教训两条**：①「执行视角」与「评审视角」的网不同——CR 终稿的改法级修订（分拍 flush/直接落地）在执行视角仍暴露落位缺失与连锁漏改；②变异口径必须写成「能让新断言红的坏实现」并手推验证，不是「删掉相关代码」。终态：cr-fix-spec fix-spec-ready（sc-r2 Go），待用户确认执行 + OQ-1 拍板。

## 第九轮：cr-fix 执行轮至 dev-ready（2026-10-05 续）

用户 [$code-dev-loop] 确认执行。wave-0 三路并行（fix-rn/fix-web 子代理后台 + fix-p4 主代理直改注释级三条）；verify-gate 合并态五步（定向三文件 98/98=67+8+23、typecheck 三段零错、全量 2135/2140 仅 batch-delete 存量 5 红、build:webview 门 C 棘轮一致+dist 契约 29/29、eslint 零新增）；cr-func-cr 矩阵终检 **func-ready: yes**（9 条逐条 ✅——正文权威口径 9 条=1P1+8P2，此前「10 条」为提交信息口径口误；OQ-1 缓办确认未偷跑）。三笔提交 63d5da36a/d0d847a84/d0e7d7259，worktree 干净。变异全咬：rn 五处逐个红（组件源码终态零改动）、web/G-2 精确形态 Expected 1/Received 2、web/G-1 顶替变异只新命中 T-SI8d、web/B-1 反向验证死写（写回 18/18 绿）。spec 回填齐（④ 第三形留痕/T-SI9⑤T-SI10 口径更正/CR 修复轮执行终态节）；cr-fix-spec 状态改已执行完毕。

**迭代终态**：dev-ready（含 CR 修复轮），分支 feat/transcript-session-isolation 共 8 笔（4 主体+1 cr-fix-spec+1 sc 修订+3 修复轮），未 merge 待用户。遗留：OQ-1 拍板（回列表丢行存量缝隙三选一）、OQ-5（web 丢弃零可观测性，真机排查第一嫌疑）、Step 7 真机并发验收（须重出 APK——web 源码两文件有改动）、batch-delete 存量 5 红另立 bug。

## 第十轮：真机装机交付验收（2026-10-05 续）

用户「安装到真机，我测试下」。重出 APK（修复轮 web 源码改动必须重打包：build:webview:native+assembleDebug，179MB 新包）→ `am force-stop` 后 `install -r -d` 覆盖装（本次荣耀确认门一次过未拦）→ 装后重建 reverse tcp:8081（装机清 reverse 的坑复现：reverse 列表装完为空）→ Metro 8081 从 tsi 真实路径起 → bundle 拉取闭环（Metro 日志 BUNDLE 完成无错）→ app 前台（mCurrentFocus 确认）。真机 prefs debug_http_host=127.0.0.1:8081 与 Metro 端口直配。测试清单已交付（A 流式中切空会话 B 应立即空白/A-B 来回切无串流/中断合成行只出现在 A；「消息不显示无报错」第一嫌疑 OQ-5）。验收结果待用户反馈。

## 第十一轮：真机验收中断与方向拍板——visibility 误重挂修复 + 用户拍板「只退 SPA 化」另开会话（2026-10-05 续）

真机验收中用户报：①切会话整 app 卡死一次（CPU 210% 波动、无 ANR/崩溃/JS 异常——定性为 dev 包装机后首启预热+冷路径，一次性付清后同类操作监控窗口内全部健康）；②**进子会话每次都卡/白屏/渐进渲染，退出落「对话页加载失败」错误页**——dump 实锤错误页（「页面加载超时，点重载恢复」）、logcat 32s 无 ready 空窗、render-gone/ANR 全零。诊断三步修正：先疑 detachPreviousScreen（native-stack v7 已移除该 API，tsc 实锤不存在）→ 定位真凶为 **visibility 脏重挂误伤**（:1777-1791 被盖期间有改画推送即重挂，未区分「app 后台」与「push 子会话盖住」；前台被盖时 web JS 活着文档不脏）→ 修复：hidden 时快照 AppState、仅 'active' 判栈内被盖不重挂（null/未知保守沿用原判据）。回归锁「栈内被盖」用例三轮才装上牙口（教训：**init 计数断言对重挂路径无牙口**——重挂后要等新实例 ready 才发 init，测试没模拟就恒绿；正确断言=恢复可见后 streamDelta 基线增量 +1）。提交 2711bb8af（tsi），68/68 绿、变异红实证。性能病灶三件定性：visibility 误伤（已修）/8.53MB 未压缩 app.js（minify 一行可砍 1/3）/子会话每屏新实例（可复用预热）。

**方向拍板**：用户提出回滚 chat-webview-unify，定性「收敛为主+SPA 行为核心」，确认 1.5.29 稳定。三轮讨论后选**切面 B：只退 SPA 化、保留合成包**（tool-card/ui-card/划词/dock 全保留，会话列表回 RN + key 重挂恢复，SPA 衍生 bug 族从根消失；代价=切会话重建卡顿回来，已知情）。**交接**：新 worktree `D:\Dev\nm\despa`（分支 feat/rollback-spa = main + cherry-pick visibility 修复 63c51b439），交接文档 `docs/apm/memory/20261005-rollback-spa-handoff.md`（切面定义/拆除清单/探索起点/纪律/验收），用户另开会话处理。tsi worktree 保留（dev-ready 未 merge，若 despa 路线走通则 tsi 自然废弃；其文档是 SPA 病理参考）。
