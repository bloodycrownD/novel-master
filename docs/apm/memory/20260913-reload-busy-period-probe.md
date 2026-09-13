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
