---
date: 2026-08-30 12:00
title: 四个优化点探索：角色卡导入刷新、max_steps 生成中残留、主会话 thinking 恢复、多会话并行与通知
keywords: 角色卡导入, dir rule, max_steps, uiRunning, streamRegistry, thinking, 并发, 通知, AgentRunManager
abstract: 四个优化点经全链路交付：导入刷新（reload 早于补行时序+根短路）与主会话 thinking 重进丢失（缺三件套）已修复合入 main 并发版 v1.5.8；max_steps 残留暂姆；并行+通知线已实现至 dev-ready 待 Step3 融合合入（含跨项目通知点按坑、会话列表生成中角标等待拍板增补）。
---

user:
提了四个优化点：1) 导入角色卡后 UI 开关状态不实时刷新，进出文件夹才变开启；2) react 轮数到限后对话停止但「生成中」不消失；3) 会话中途退出重进 thinking 流式内容不保存会重新渲染，希望参考子会话方式修；4) 想支持多会话并行，退出会话请求会失败，希望退出后保持请求并在结束后发可开关的通知。

assistant:
按 brain-storm 派四个 readonly 子代理探索，结论：

1) 角色卡导入刷新：mobile `VfsFileManager.tsx` 的 `runImport`（844 行起）时序错位——872 行 `reloadVfsListOnly()` 在 887 行 `setDirRule` 补目录规则行**之前**，补行后没有二次 reload。reload 时 `workplace_dir_rule` 无行，规则引擎判 `rule_off`（无行=关闭），UI 显示「关闭」；进出文件夹 currentPath 变化触发 reload 重查才显示「开启」。Core 导入服务不写规则行（补行是 UI 层做的）。desktop 更糟：导入路径压根没补行 + `handleVfsCharacterCardImport` 是 vfs.ts 唯一没调 `pushWorkspaceMutated` 的写 handler。根治方向：把补行下沉进 Core 导入服务（用前缀遍历而非单层 list 求差，顺带解决嵌套目录漏补）。

2) max_steps 生成中残留：core 层 `agent-runner.ts` 三条收尾路径对称——max_steps break（L760-762）与正常完成都汇到 L786 统一发 `EVENT_AGENT_RUN_FINISHED`（带 stopReason）。不是漏发事件。UI 层 `uiRunning` 只靠 FINISHED/FAILED 事件清；mobile 主聊天页没有子会话页那样的兜底探针（`useSubagentRunProbe`）。风险点：FINISHED 被 `shouldAcceptRunEvent`（activeRunId 失配）拒收、`finishRun` 挂在 `flushRunUi().finally()` 上（DB reload 挂起则永远不清）。修复优先级：主聊天页补对称兜底探针 > finishRun 与 reload 解耦 > 修 beginUiRun→RUN_STARTED 窗口 abort 竞态。静态推演无法复现用户现象，需运行时日志（也可能用户版本旧）。

3) 主会话 thinking 恢复：core 层主/子会话机制完全相同（流式 delta 进内存 streamRegistry，step 结束 `session.append` 落库，thinking 块在 content_json 保存）。差异全在 mobile UI：子会话 `SubagentSessionScreen.tsx:221-268` 有三件套——webview ready 后查 `streamRegistry.get(sessionId)` 注入累积 partial、`acceptRunEvent` 放宽（接受任何非空 runId）、per-step reset 防已落库文本重复推；主会话重进时 `resetUiForSessionChange` 清 activeRunId，`activeRunId == null` 拒绝一切 run 事件，也没人查 registry。修复=照搬三件套到 ChatTabProvider/useSessionStream，难点是 activeRunId 重建（RUN_STARTED 无法重放，可用 abortRegistry.has() 或 core 加查询入口）。杀进程场景无解（registry 是内存 Map）。

4) 多会话并行与通知：core 层已为并发做好防护（per-session abort/stream registry + 所有权句柄），门禁在平台层——mobile `ChatComposer.tsx:328` `isMobileAgentActive()` 全局单 run 静默 return，desktop 返 AGENT_BUSY。**静态代码不存在「离开页面→abort」路径**（tab 切换不卸载、面板切换 CSS 隐藏），退出致请求失败的机制未定位，疑为 Android 后台化 OS 掐网络（SSE 走 RN XMLHttpRequest）或回页 UI 状态不一致被误读，需真机复现。方案：mobile 仿 desktop 建 app 级 AgentRunManager（React 外 fire-and-forget + per-session 跟踪 + 回页复用 probe 模式）；门禁改 per-session（`abortRegistry.has(sessionId)`），盘点 agent-activity refcount 其它消费方（备份/云同步守卫语义保留）。通知：desktop 在 `attachAgentRunLifecycleListeners` 加 Electron Notification 成本低；mobile 要引 notifee 类新依赖 + Android 13 POST_NOTIFICATIONS 权限；偏好键走 nm-preferences，开关进 ChatConfigScreen；通知订阅必须在 React 树外（runtime 层），否则离开页面通知就没了。

用户已确认四个问题均发生在 mobile 端——desktop 的对照结论（AgentRunManager 架构参照、导入补行缺失）仅作架构参考不作修复对象；问题 2 与问题 4 的失败机制仍需真机复现确认后再动刀。

user:
问题 2、4 先不管，先给问题 1（角色卡导入后开关不实时刷新）和问题 3（主会话重进 thinking 流式不恢复）生成 PRD。

assistant:
复用 brain-storm 阶段的四路探索报告作为 prd-generate 的探索产出（链路已闭合，未重复派遣），进入澄清阶段；计划拆成两个独立 PRD（相互无依赖）。待澄清：问题 1 的修复口径深度——窄=仅修 mobile UI 时序；宽=补行下沉 Core 统一保证（含嵌套目录默认开启）。

user:
选宽口径，且 ZIP 导入要和角色卡导入效果相同；问题 3 维持「只救 app 存活的重进、杀进程不救」的边界。

assistant:
已落盘两个 PRD 待用户最终确认：`docs/Iterations/import-dir-rule-default-on/prd.md`（导入目录规则默认开启，角色卡+ZIP 同口径、含嵌套、导入链路统一保证、双端同链路受益）与 `docs/Iterations/main-session-stream-resume/prd.md`（主会话流式内容重进恢复，对齐子会话体验，不包含杀进程/并行/通知/max_steps 残留）。

user:
并发+通知也要出 PRD；确认搁置的问题 2 不影响该需求。

assistant:
回答：问题 2 需求层面零依赖（仅工程上碰同一批文件，可顺带修）；问题 3 的 PRD 已把杀进程/保活边界指向本需求，故并发 PRD 标 dependency 指向它（共享回页恢复机制）。澄清后台边界后落盘。

user:
选口径 B：除非用户主动关闭应用，否则退后台/锁屏/切 app 都要保持请求。

assistant:
已落盘第三个 PRD 待确认：`docs/Iterations/agent-run-parallel-and-notify/prd.md`（跨会话并行、单会话仍串行；后台保持含前台保活；本地通知点按直达会话、停留该会话不发、设置可开关；备份/云同步守卫不回退；杀进程不救；依赖 main-session-stream-resume）。待确认项：通知默认开、权限拒绝降级、失败通知噪音控制。

user:
三个 PRD 均确认（用户直接要求生成 spec，视为接受 PRD 内容），进入 spec-generate 阶段。

assistant:
按 spec-generate 又派三个深挖子代理（导入链路 / 主会话流式恢复 / 并行后台通知），关键发现：①导入补行有两个硬坑——T-C15 源码正则契约测试与需求正面冲突须正面改写，vfs 与 workplace 的 scope_key 是两套键空间（session:projectId:sessionId vs session:sessionId）不能混用；②「退出重进」实为两条故障路径——同会话重进（订阅在、partial 无注入）与跨会话切换（reset 清 activeRunId 事件全拒），且 core registry 只有 has() 拿不到 runId，须用恢复窗口+首事件反填的混合接纳；③并行化前必须先修 refcount 泄漏（切走会话 FINISHED 被 sid 过滤丢弃→全局 busy 卡死），收尾改 Manager 事件驱动；core abortRegistry 是覆盖式无同 session 拒绝，单会话串行靠 Manager 门禁；mobile 无任何通知依赖，Manifest 只有 INTERNET，targetSdk 36。三个 spec 已落盘待确认：`docs/Iterations/import-dir-rule-default-on/spec.md`、`docs/Iterations/main-session-stream-resume/spec.md`、`docs/Iterations/agent-run-parallel-and-notify/spec.md`。

user:
发起 spec-check-loop 审查循环。

assistant:
共 3 轮收敛到 execute-ready（逐轮子代理审查 + doc-fix/trivial 直改）：①导入迭代第 1 轮 Go（修 T-C15 表述、事务内吞错差异、验收映射）；②流式恢复第 2 轮有条件 Go（P0：标记提升到常驻 Provider 无复位语义→三信号复位；反填落点写死带副作用 accept；删窗口超时与两信号口径的矛盾）；③并行通知第 3 轮 Go（P0：Manager 装配契约补齐；starting 空窗导致门禁双 run 与开窗信号互掐→门禁/开窗/探针三处信号扩为 RunEntry 投影；refcount 受理同步 increment；onSettled 签名收敛 abort 归 finished；前台不发通知口径；dataSync 6h 超时降级）。关键拍板：两迭代存在落地时序耦合（stream-resume 先合入、parallel 合入后替换其开窗信号）。三个迭代均 execute-ready 待用户确认。

user:
确认 execute-ready，新建三个 worktree 并行开发（.woktree/import-dir-rule、stream-resume、parallel-notify，分支 feat/*），按 code-dev-loop 走 impl→verify→cr-func 波次。

assistant:
已提交迭代文档到 main（6c8a872，用户自己的未提交改动未碰），建三 worktree。DAG：wave-0 三线并行 impl。拍板：迭代 3 的 Step 3（activeRunId per-session 化）与迭代 2 同文件冲突，延后至融合阶段（记 spec_deviations），本次迭代 3 只做 refcount 收口且不碰 activeRunId/acceptRunEvent 区域；实现顺序耦合为 stream-resume 先合入。

assistant:
code-dev-loop 收敛：三线均 dev-ready。导入线（head 88f088c，6 提交，core 1786 测试全绿）；流式恢复线（head 66de06f，4 提交，mobile 1069 测试全绿，四项关键设计抽查一致）；并行通知线（head ce289b4，8 提交，mobile 1091 测试全绿，cr-func 一轮 not-ready：T-P7 守卫用例缺失 + 失败双 toast，fix 后 r2 复核 func-ready）。遗留：真机验收三份（manual_user）；合并顺序 import→stream-resume→parallel-notify，最后做 Step3 融合（useAgentRunLifecycle/ChatTabProvider/useSessionStream 三文件手工融合）。

user:
发起 code-review-loop 对三线 diff 评审。

assistant:
两轮收敛 fix-spec-ready（round1 三线并行评审→spec-fix 三份落盘→round2 校验+trivial 修订）。关键发现：导入线 P1——根前缀整体短路，CLI/desktop 缺省路径就是根，那条路 bug 原样保留；并行线 3 P1——子会话 FAILED 误弹 toast、RUN_STARTED 后 reject 的 refcount 永久泄漏（finally 早退条件错）、后台点按走 onBackgroundEvent 未处理致「点按直达会话」落空（notifee 9.x 该 API 返回 void 不可退订，只能模块级注册+handler 引用替换）；恢复线无 P0/P1 仅 4 P2。三份 cr-fix-spec 已提交各分支（import e355cc5 / resume 49e44c1 / parallel 0184f44），待用户确认后按 fix-spec 执行修复。

user:
确认，发起 code-dev-loop 执行 fix-spec。

assistant:
fix-spec 执行轮收敛 dev-ready（wave：三线并行 fix → 增量 verify → cr-func 全 func-ready）。最终：导入线 head 7c4d938（4/4 闭合，core 1791 pass）；恢复线 head 64172b4（4/4 闭合，mobile 1071 pass）；并行线 head 3d3bd4b（8/8 闭合含 3 P1，mobile 1105 pass）。遗留：真机验收三份、导入线一条 flaky 观察、恢复线 integration 文件 2 处非 CI 裸 tsc、合并顺序 import→stream-resume→parallel-notify 后做 Step3 融合。

user:
导入和流式两条线直接合并到 main。

assistant:
已合并：main 在 6c8a72 后新增两个 mobile 样式提交（5a1a6ce），与两线零交集；7909552 合并导入线（干净）、e91422d 合并流式线（仅一个 memory 文件冲突，双侧轮次合并保留）。合并后 main 全量验证：core 1791 pass / mobile 1080 pass 全绿。并行线 feat/agent-run-parallel-and-notify（head 3d3bd4b）保留在 .woktree/parallel-notify 待后续 Step3 融合后合并。

user:
写 changelog 并发版。

assistant:
v1.5.8 已发布（tag 1aba999）：CHANGELOG Unreleased 转 1.5.8（两项修复+两条维护，期间用户补记的 1.5.7 后续弹窗/样式/依赖修复三条同段发放），双端 package.json 与 build.gradle 默认 versionName 同步 1.5.8，三端测试全绿（core 1791/mobile 1080/desktop 100），tag 已推送触发 Release CI（APK+NSIS+DMG），main 已同步。并行+通知线未入本版，待 Step3 融合后随下版发布。

user:
问：并行通知支持项目间切换吗？切换后返回请求还能继续吗？另：进行中的会话是不是应该在消息栏/状态栏常驻、每个进行中一条、结束后消息变化？

assistant:
代码核实：①切项目只更新 scope 指针（setMobileProject），不重建 runtime 不关连接（closeMobileConnection 仅初始化重试与备份恢复两处触发），Manager/registry/前台服务均 app 级，跨项目天然并行，切回流式恢复机制照常接管；②发现跨项目通知点按坑——通知 data 只带 sessionId，setCurrentSession 用当前 scope.projectId 定位，跨项目会落错且无存在性校验（已登记 iteration-state fusion_todo_extra: cross-project-notify-tap，随融合修复）；③常驻通知现状是全 app 单条固定 id 的「正在生成」（保活载体），多会话不区分、结束即消失另发完成通知；应用内会话列表（ChatSessionListPanel）完全没有「生成中」标记。用户预期是下载管理器模式（每任务一条、完成后变化）——已建议两项增补：会话列表 per-session 生成中角标（数据源 Manager RunEntry，与 Step3 同批）+ 通知拆分或至少带会话名并 updateNotification 更新完成态；两项待用户拍板是否补入 PRD 随融合阶段做。
