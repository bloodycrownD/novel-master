---
date: 2026-09-13 22:30
title: reload 忙期交互排队排查——通知 gap 复现与 JS 单线程机制定案
keywords: 通知延迟, reload, Fast Refresh, JS 单线程, 忙期排队, keepalive 通知, webview 冷加载, 水合, 快照构建, 分片让步
abstract: 用户报「发送后通知卡片很慢出现」——排查从误解「状态栏」（实为系统通知非应用内指标条）绕行两轮，最终用截图时序复现实锤：reload 后立刻发送通知 10~20s 才出现（等待初始化完成后 ≤2s），机制是 reload 忙期的长同步任务（水合 SQL 批/webview 全量快照构建/组件重挂载）占满 JS 单线程，tap 回调与每个 await 恢复被推迟；异步 API 不免排队（慢在「发起前」）。立项点：初始化长任务分片让步。另发现 run 无超时挂死、中断会话列表显示「活跃中」两个遗留 bug。
---

user:
（真机验收中）状态栏的生成是什么规则？不是切换窗口后就立刻产生？第一次生成状态栏会有几秒钟的延迟，再发送消息则没有。后经多轮澄清：说的「状态栏」是手机系统通知栏的常驻保活通知，且场景是 reload 后再发送请求，通知卡片很慢才出现。

assistant:
排查全程教训与结论：①需求澄清失败——把「状态栏」理解成应用内指标条，白做两轮分析+一次误改（指标条受理即显示 e4d46f5d，改动本身合理保留但与用户问题无关）；正确入口是先问清指哪个 UI。②打点链路：t0 必须钉在 onPress 首行（钉 executeRun 入口会漏点击→执行的排队段）——正常场景实测通知 677ms（首次）/163ms（第二次）出现，链路本身健康。③华为机取证通道不可靠：logcat 流会随机断、每次 reload/Fast Refresh 后 console 通道必死、dumpsys notification 查不到第三方前台服务记录——最终用纯截图时序法。④决定性实验：reload 后立刻发送，通知 10~20s 才出现（+2s/+10s 无、+20s 有）；同样 reload 但等 25s 再发送，≤2s 出现——堵点=初始化忙期。⑤机制定案：reload 忙期三个长任务源（水合同步 SQL 批占单连接、webview 就绪后全量历史快照大 JSON 构建、组件树重挂载）占满 JS 单线程；tap 回调首次执行 + 链上每个 await 恢复点被推迟累计成 gap。displayNotification 异步不免排队——慢在「从点击到 API 发起」，不在 API 执行（native 侧几百 ms）。把 display 挪到 onClick 也无效：回调本身在排队，位置提前≠执行提前；通知挂 manager（run 生命周期所有者）架构上正确。⑥非 reload 同类项：backfill 事务（300ms 级）每次 run 开头占车道，推迟通知标签查询。

立项点（待用户确认开跑）：初始化长任务分片让步——水合/快照构建/backfill 切片、段间主动 setTimeout(0) 让出，目标忙期交互（tap/await 恢复）可插队，gap 从 10~20s 压到 1~2s；建议走 PRD 澄清范围再出 spec。

遗留 bug 登记：①run 无超时挂死——probe 消息发送后「0字 · 计时增长」挂十几分钟不结束不报错，需手动停止；LLM 无响应无兜底。②中断会话在列表显示「活跃中 · 1 分钟前」，文案与实际状态（已中断）不符。

排查工具资产：apps/mobile/src/debug/run-timing.ts（__DEV__ 门控打点，t0+站点）+ manager/keepalive/notifee/webview/composer 五处打点，未提交入库待定。

user:
（拍板）backfill 纳入本迭代范围；RN 侧 + webview 侧都治（含 bridge 协议）；当前分支继续开发；「活跃中」文案顺手修（run 挂死未定归属）。随后调用 prd-generate 立项。

assistant:
按 prd-generate 流程派三个 readonly 探索子代理（忙期链路/webview 冷加载与让步机制盘点/历史迭代检索）同步等待后汇总：忙期四大长任务源（webview 首快照 O(n²) 配对+富文本预渲染+整包序列化+webview 全量 vnode、水合全表扫+同步循环、backfill 全量探测、组件重挂载）全部零分片让步；现有节流全面向流式 delta 与 DB 写；InteractionManager/requestIdleCallback 全仓零使用；无重复立项风险（TDBC 16ms 量子是唯一让步先例、仅事务内）。AskUserQuestion 四项拍板后 PRD 落盘 docs/Iterations/init-busy-yield-2026-09/prd.md（dependency 指向 session-stream-unit prd），含 7 条 GWT 验收与四个风险待确认项（run 挂死归属、release 基线缺失、分片与 force 直发时序、水合/快照术语钉死）。待用户最终确认 PRD。

user:
PRD 确认后调用 spec-generate 出技术方案。

assistant:
spec-generate 派三个 readonly 探索子代理（backfill/checkpoint 回滚语义、bridge 协议与 webview 分块可行性、水合分片与测试基线）同步等待后落 spec（docs/Iterations/init-busy-yield-2026-09/spec.md）。spec 级关键定案：①让步原语复刻 TDBC 16ms 量子且必须构造注入（五套件全 fake timers，宏任务让步会挂死 13+ 处 await hydrate）；②水合保持「markHydrated 前投影恒 null」全有或全无语义（manager 测试 135-153 钉死）；③快照分片协议带 generation 代次（appendTailRows 无去重，force 打断旧片会叠加；T-ST1「快照只发一次」断言重定义）；④web 侧分批手动 insert 会被下次全量 renderRows 洗掉，窗口化必须做在 RowList 层；⑤backfill 用闲置原语 hasAnyCheckpointForSession 等组 O(1) 判定、游标挂 session_kkv、truncate 必须清游标（seq 复用坑）、判定不确定保守回退全量（回滚保证宁误报勿漏报）；⑥keepalive 通知改两段式先出后补标签。10 Step + 18 测试用例。待用户确认 spec。

user:
spec 确认前先跑 spec-check-loop 审查。

assistant:
spec-check-loop 五轮收敛至 Go（execute-ready）：R1 无 P0（3P1+4P2：探针 Promise.all 不可行/已中断缺数据源/占位高度缺失）；R2 新引 2 P1（裁剪方向写反—listBySessionTail 升序应裁首行、三态判定吞当前会话×中断）+5 P2；R3 抓到真 P0——游标 count≤判定在连续对话必然失效（backfill 先于 user 落库，count 恒>游标），升级两段式（==短路/>时新增段 OFFSET 圈段覆盖比对/<回退），核实空窗语义含 assistant、纯文本轮尾部 assistant/tool-result user 无源头建点全靠 backfill 补；R4 再抓 P0——count<游标（删除可疑态）被当安全短路且漏 message.service delete(id)/truncateAfter 两条删除事务，改 == 短路+四条删除路径全清游标+T-B5 反向/T-B6 新增；R5 终审四路径推演无洞 Go。四个 doc-fix 提交：8e31c8ea/85bdc41d/24407128/a5559176。待用户确认 execute-ready。

user:
（code-dev-loop 派遣 impl-s6-snapshot-rn）实施 Step 6 phase-snapshot-chunk-rn：sendSessionSnapshotNow 分片化 + 协议扩展 + web 侧拼装最小适配 + 测试。

assistant:
三提交完成（86404b69 协议与原语 / 7cc2a70a RN 分片发送 / bdf2f3a3 web 拼装）。关键落点：①分片以「消息」为单位实现（消息→行 1:0/1 派生，与按行分片同界），常量 SNAPSHOT_CHUNK_SIZE=50；起点固定闭包快照（transcriptListOptions 每渲染重建，跨帧不能换口径）；预扫 buildToolPairingContext 从 message-blocks 导出 + 新增 buildTranscriptRowsWithContext（分片拼接与全量严格全等）。②代次作废统一收敛：六条 force/直发路径都过 sendSessionSnapshotNow，模块级计数器 ++ 即顶替，循环在每个让步点检查代次+webReadyRef；repaintEpoch 重挂经 postToWeb ready 守卫复位（webReadyRef 在 ready/visibility 分支同步直写，避免 effect 一帧窗口）。③T-S3 时序（分片先于 delta）：流式 RAF flush 在 in-flight 代次非空时推迟（segments 留队 + deferred 标记），末片 post 后 syncStreamToolInvoking 再补发；中止于重挂则连 deferred 一起作废（等价旧协议下 post 丢失，恢复注入链重推）。④web 侧 handleSnapshotPayload：单片/缺字段直发等价旧协议；多片同代次按 chunkIndex 累计、末片到齐才整体 applySnapshot（零中间渲染、零滚动副作用）；乱序/迟到旧代次丢弃，凑不齐等 force 新代次兜底——测试过程抓到一个真 bug：单片路径最初没判旧（gen5 应用后 gen4 单片迟到仍会应用），已修为 generation>0 时统一判旧。⑤测试基线事实（后续 Step 会再用到）：webReady 翻真本就双发快照（subagent effect preserve + needsOpenSnapshot stick，旧协议即如此），分片化后首代次只剩片 0 被顶替——T-S1/T-S2 断言按「按到达序分代次、末代次完整」书写；jest 全量的 torn down/worker 警告经基线 worktree 对照确认是既有现象（prompt-macro/legacy-scroll 两套件，与分片无关）。验证：typecheck 两套绿、jest 198 套件 1291 测试全绿、build:webview 9 产物。未动 webReady 双发语义（行为等价优先，去重不在 Step 6 范围）。

user:
（code-dev-loop 终态）dev DAG 全部跑完的结果如何？

assistant:
dev-ready 达成：Step 1-9 全部落地共 14 个实现提交（cb73992e 让步原语 / d28e38c6+c43a904b backfill 两段式判定与游标清空面 / 324d0677+0544f8f1 水合分片与探针单查询 / 67e72627 查询并行化 / 7af52a27 O(n²) 消除 / 86404b69+7cc2a70a+bdf2f3a3 快照分片协议与代次作废 / bb343863+dd9d813a RowList 窗口化 / 700117bc 通知两段式 / a529eacb 三态文案），三道 cr-func（w0/w3/final）均 func-ready。终验：mobile jest 200 套件 1317 全绿 + typecheck + build:webview + core 2107/2107 + core dist 重建。四项 deviation 全 closed 附理由（去重落点 inflight/selectTail 顺带预扫化/渐进渲染不做/扩窗行坐标重映射）。Step 10 真机验收（GWT-1~5 + release 冷启动基线）归用户 manual_user。过程事件：共享 worktree 多节点并行曾发生 stash 互相踩踏（pstream stash 完好）、impl-s6 子代理违规写入本记忆（追加式零破坏已核验保留）——教训：并行 impl prompt 须明令禁 stash、禁写 apm memory。

user:
装机 1205（init-busy-yield 全量）做 Step 10 真机验收：还是花 10 几秒才出现通知栏。之后澄清场景为「杀死应用重进」；随后用户识破——cold-2s.png 里根本没有「生成中」通知，analyze_image 是幻觉。

assistant:
重大教训：analyze_image 描述式 prompt 会幻觉——本轮曾据此宣称「正常场景/Fast Refresh/冷启动通知均 ≤2s 达标」，用户核对原图识破；改用「逐字转写（verbatim）」式 prompt 复验 cold-2s.png，实际面板只有 USB/VPN 系统通知、无任何应用通知——**三场景达标结论全部作废，用户报的 10 几秒为真，GWT-1 未达标待查**。视觉证据自此必须逐字转写+系统级日志双证（教训拟入 RULE.md）。其余现场：logcat 真实文本行有 webview ready +75526ms（75 秒，比优化前 15-19s 更差，异常信号待查——但该轮伴随系统弹窗干扰与 uiautomator 抓不到 EditText 的轮询实验，场景未净）；华为机 logcat 流静默/dumpsys 查不到 novelmaster record 的取证困境依旧。当前进行中的复测被记忆更新打断：logcat 全量抓取已起（pid 7063，/tmp/sys-notif.log）、app 已冷启动（22:00:30）、复测计划=冷启动后固定坐标发送→用 NotificationService 系统入队日志时间戳对 tap 时刻（不经过 vision）。代码层 dev-ready 结论不受影响（jest/typecheck/core 全绿是真实文本证据）。
