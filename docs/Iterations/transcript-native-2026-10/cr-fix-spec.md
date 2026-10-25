# CR Fix Spec: transcript-native（转录原生化）

## 元信息
- repo：D:\worktree\transcript-native（分支 feat/transcript-native）
- base_sha / head_sha：615dda436 / 64dfccd88（7 commit：P0 spike→P1 行组件→P2 行为层→P3 主屏+§3.3→P4 子会话→P5 退役→e2e 并发专项）
- prd_path：未提供（需求主线见 spec「背景」）
- spec_path：D:\Dev\Js\novel-master\docs\Iterations\transcript-native-2026-10\spec.md
- review_round：3（=cr_loop 2 轮 + spec-check 2 轮，R2 spec-check 亦手工：核双阶段 reload×宽限销毁时序——宽限 30s≫600ms ✓、applyMessages unchanged 幂等守卫 ✓、attach force 落点 ✓、N1-N3 全闭合，**Go**）
- dag_version：4
- 状态：execute-ready（待用户确认）

## Must-fix（按 P0 → P1 → P2）

### cr-s3/B-1 [P0] DEF-03+DEF-01 合并：settle force-reload × core 最终落库竞态，消息面停旧值无二次刷新
- 维度：B（正确性）× C-orch（消息面刷新路径单一化）
- 文件：
  - apps/mobile/src/services/session-stream-unit.ts:537-564（settle→kickTailReloadQuietly）
  - apps/mobile/src/services/session-stream-unit.ts:1195-1228（loadTailMessages：force 回源 listBySessionTail 后 applyMessages+setSessionViewCache）
  - apps/mobile/src/services/session-stream-unit-manager.service.ts:1596-1691（finishRun：unit.settle→notifyChanged 同步先于异步 reload 完成）
  - apps/mobile/src/screens/tabs/chat-tab/TranscriptHost.tsx:119-140（re-attach 只内存 resync 无回源——修复点③落点）
  - apps/mobile/src/screens/stack/SubagentSessionScreen.tsx（同构复制面：subscribe+sync/focus attach 同款，修复点③须一并覆盖）
- 问题：settle(finished) 内 kickTailReloadQuietly() 是**异步** force 回源；finishRun 随后同步 notifyChanged() 使订阅者读到旧 messagesValue。当 core 的 FINISHED 事件早于最终 assistant 行落库到达时，force reload 从 DB 拉到的仍是旧面——applyMessages 后无任何第二次刷新，消息面与 view cache（setSessionViewCache 同轮写旧值）永久停旧。三种外部形态（e2e 实证，evidence/e6/gate6-concurrency-report.txt）：
  - DEF-01：多段 delta 同屏停留——settle 后「助手」静态行为空/无内容（DB seq 完好，重启水合即显示）；
  - DEF-03：发送后切屏再回（EXP-B3 干净复现）——attach 时 loadSessionTailMessages 走 unit 分支**非 force→view cache 命中采纳旧面**，user 行丢失；屏幕侧 flushStreamTailToHandles 固化尾块兜住了 reply 显示（不对称的假象来源）；
  - S5 形态：切回后整轮 user+assistant 4 行不显示。
- 改法：
  1. 诊断先行（半小时）：在 finishRun 与 loadTailMessages 加 timing log（RUN_FINISHED 事件时刻 / reload 查询返回的 max(seq) / DB 实际 max(seq)），mock-slow（12×600ms）复现确认竞态窗口；
  2. 修复（R1 spec-check doc-fix 定稿——按可执行性改写）：**默认执行案（纯 mobile 侧，不依赖 core 改动）= 双阶段 reload + attach force 回源组合**：settle 的 kickTailReloadQuietly 保持立即一次 force reload，追加 600ms 后第二次 force reload（二次 applyMessages 经引用/内容比对天然幂等，发现变化才触发通知——applyMessages 既有 unchanged 短路即守卫）；同屏停留场景由该二次 reload 收敛（覆盖 reload 早于落库的窗口）。**可选增强案（若诊断证实窗口 >600ms 或复现仍存）**：core 侧 FINISHED payload 增补 terminalSeq 落库水位（agent-runner.ts:1012-1020 附近，落库 await 完成后 publish 已天然保证同进程序；跨进程到达后 manager 比对 reload 结果 maxSeq < terminalSeq 则再拉）——此为 core 小改，仅在默认案不足时启用，启用前须用户知情；
  （原「reload 后比对 DB maxSeq」表述作废：与 reload 同一查询自我循环，无独立参照——R1 审查发现）；
  3. attach 侧防御（R2 校验修正——当前 re-attach **根本没有回源调用**，不止缺 force）：TranscriptHost.tsx:135 re-attach 只调 `resyncRef.current()`（=setMessagesView(readMessagesSnapshot) 纯内存读——有单元返回旧 messagesValue、无单元返回 idle 内存视图），须补 `manager.loadSessionTailMessages(sessionId, {force: true})` 回源（settled 宽限单元与 idle 视图两条通道都覆盖——S5「无单元但 idle 视图停旧」整轮丢失的第二通道也在此闭合）；回源完成经既有 subscribe/notify 链刷新（勿绕过 manager 直写 state）；
  4. view cache 污染治理：reload 拉到旧面时不写 cache（写前比对 DB maxSeq）或 cache 条目带 seq 水位。
- 验收/测试：
  - 单测：unit.settle 后 reload 结果落后于 DB 时（mock messageStore 第一次返回旧面第二次返回新面）断言消息面最终收敛到新面+notifyChanged 被再次触发；双阶段第二次 reload 的幂等（第二次结果与第一次相同时不通知）；
  - e2e 复跑（evidence/e6 口径）：mock-slow 多 step×同屏停留（DEF-01 复现路径）与×切屏往返（EXP-B3 路径）双矩阵，assistant/user 行均显示；S1（部分覆盖→）与 S5（No-Pass）场景补齐收口 DoD-7；单 step 不回归；step 边界 reset-stream 清尾块后无内容空窗残留（reload 完成前后的显示连续性）。
- 来源：cr-s3 手工审查（R1）× e2e 并发专项 DEF-01/DEF-03 定性

### cr-s3/B-2 [P1] DEF-02：provider 连接半开无超时，run 无限卡 running、后续发送静默被吞
- 维度：B（错误处理）+ J（可观测性）
- 文件：
  - apps/mobile/src/services/session-stream-unit-manager.service.ts:2142 附近（连接断开收口：仅一处「连接已断开」finishRun('failed') 路径，覆盖不到 fetch 挂起）
  - provider fetch 层（runAgentTurn 链内的网络调用，需在诊断时定位具体 fetch 封装）
- 问题：provider TCP 半开（服务端进程重启/网络切换）时 fetch 无超时无重试，run 永久 running；该会话后续发送被「已有进行中的生成」守卫拒绝（manager.service.ts:1300-1304），无 UI 错误提示（e2e：expb2/recover1 mock 零请求+session_run_state 卡 running；「上次生成」仍正常显示无异常标识）。
- 改法：
  1. fetch 加 AbortSignal.timeout（与既有 abortRegistry 的 controller 合流——R1 spec-check 补：**须与用户主动停止区分语义**：超时触发走 finishRun('failed', '连接超时：响应停滞')口径并 toast，不得并入 cancelled/finished 家族——实现上 timeout abort 的 catch 分支按「provider 超时」识别（如 controller 外包一层标记或 AbortSignal.reason 区分 timeout/用户 stop），stopReason 保持用户主动停止的原语义不变）；
  2. 冷启水合对 stale running 行已有 interrupted 恢复——补**运行中检测**：app 前台 resume 或 keepAlive 校准轮询发现 run 超时（如 10 分钟无 delta）主动 finishRun('failed', '连接超时')；
  3. 发送被拒时若单元状态为 running 且无在途 controller（abortRegistry 无注册），视为挂死单元先行收尾再受理新发送。
- 验收/测试：单测（mock fetch 永挂起，断言超时后 run settled + 可再发送）；e2e：mock 重启场景（原 EXP-B 复现路径）run 在超时窗口后转失败、重发成功。
- 来源：cr-s3 手工审查（R1）× e2e DEF-02 定性

### cr-s3/G-3 [P1] 三缺陷复现测试缺口：§3.3-7/3.3-8 交错路径无 e2e 级锚定
- 维度：G（测试）
- 文件：apps/mobile/__tests__/（新增）、apps/mobile/e2e/scripts/mock-anthropic-provider-slow.mjs（复用）
- 问题：jest 侧 §3.3 各小节有单测锚定，但「settle×落库竞态」「attach 缓存采纳旧面」两条 e2e 实证破损路径无任何层级测试锚定（B-1 修复的守卫测试在验收项，此处指场景级回归矩阵缺失）。
- 改法：随 B-1/B-2 修复补两个复现测试（单测优先，e2e 脚本归档 evidence/e6 复用口径）；CI 层面以单测为准（e2e 模拟器链路不进 CI）。
- 验收/测试：B-1/B-2 的验收测试即本条交付物。
- 来源：cr-s3 手工审查（R1）

### cr-s4/K-4 [P2] 退役注释残留：4 处文档性引用已删符号
- 维度：K（收尾）
- 文件：
  - apps/mobile/src/components/chat/native-composer/dock-types.ts:6
  - apps/mobile/src/components/chat/transcript/buildTranscriptMenuItems.ts:22
  - apps/mobile/src/components/chat/transcript/MessageActionSheet.tsx:7
  - apps/mobile/src/components/chat/transcript/transcript-scroll-behavior.ts:7,21
- 问题：注释中引用已退役符号（ChatConversationWebView / @/webview-host/chat-transcript/scroll）——非活代码（grep 零 import 命中），但作为「退役后仅存提及」易误导后续维护者去找不存在的模块。
- 改法：措辞改为「已退役（feat/transcript-native P5），历史实现见 git log」或直接删句。
- 验收/测试：grep 退役符号零命中（注释除外→改后零命中）。
- 来源：cr-s4 手工审查（R1）

## Spec deviations
- none（scope 手工核对：§3.3 十小节中 3.3-1/2/3/4/5/9/10 落地有 file:line 证据；3.3-6 generation 信号盒有单测；**3.3-7/3.3-8 落地但存在 B-1 竞态破损**——以 must-fix 表达，不构成 deviation；DoD-7 未全过属已知（三缺陷），spec §9 验收依赖修复后复跑）

## Open questions / 待拍板
- ~~B-1 修复主案与兜底案取舍~~（R1 spec-check 定稿：默认执行案=双阶段 reload+attach force 回源，纯 mobile 侧；可选增强案=core FINISHED 增补 terminalSeq，仅诊断后需要时启用并先告知用户）。
- B-2 超时阈值（10 分钟 vs 按模型/长任务分级）——执行时按既有 keepAlive 轮询节拍定初值。

## 已豁免（用户确认不修）
- 无

## 合并后 QA（manual_user）
- 真机/模拟器走查：多段流式回复完成后内容即时显示；会话切换往返无丢行；断网/切网后 run 有失败提示且可重发。

## K 节建议（下游执行时闭合）
- cr-s4/K-4 注释清理
- 命名残留：TranscriptHost 的 `controller.onWebMessageMenuAction`（web 前缀名，实际已是 native 命令面）——随 B-1 修复顺手改名（K 级，不阻塞）
- 修复 commit 后 evidence/e6 场景矩阵复跑结果归档 evidence/e7（或并入 e6 更新）
- CHANGELOG/迭代文档收尾随 P7 统一处理

## Fix-Spec Closure（spec-check R2，execute-ready）
| 项 | 状态 |
| execute-ready | yes（主代理判定；R2 手工轮 N1-N3 全闭合、无新 P0/P1） |
| fix_spec_path | docs/Iterations/transcript-native-2026-10/cr-fix-spec.md |
| dag_version / review_round | 4 / 3（cr_loop 2 + spec_check 2） |
| P0 / P1 / P2（已写入） | 1 / 2 / 1 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none |
| C-orch | ✅（B-1 即消息面刷新路径收敛） |
| C 类合并后 QA | 已列 |
| 执行注意 | cr_loop R1/R2 与 spec_check R1/R2 均为主代理手工等效审查（子代理连续限流豁免，累计 8 次派遣失败）；用户确认 execute-ready 后按 #7 交 code-dev-loop，B-1 诊断步骤先行（timing log 验证「reload 早于落库」假说——若诊断推翻假说，回到本文档补充定性再修） |
