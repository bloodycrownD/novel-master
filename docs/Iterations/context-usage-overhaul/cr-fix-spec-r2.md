# CR Fix Spec: context-usage-overhaul 增量轮 r2（统计优先二次修正 → 弹窗 KKV 缓存终态）

## 元信息
- repo: D:\Dev\nm-worktree\cuo（feature/context-usage-overhaul）
- base_sha: f51612a5（上轮 CR 十八修闭环点）
- head_sha: 82ae88eb（真实 HEAD 以 `git log -1` 为准）
- prd_path: docs/Iterations/context-usage-overhaul/prd.md
- spec_path: docs/Iterations/context-usage-overhaul/features/*/spec.md（本轮涉 fallback-caliber-align / token-source-label / metric-detail-sheet）
- review_round: 2（wave 1 三 scope 并行 + wave 2 review-full；主代理已实跑/实查复核 P0 与 s3/G-1）
- dag_version: 3
- 状态: fix-spec-ready（终轮修订已按 review-full 清单闭合）

## Must-fix（按 P0 → P1 → P2）

### s2/G-1 [P0] desktop 两阶段「永不升级」——preferEstimate 早退不查 L1，暖机缓存无人消费；既有 T-T9b/T-T9c 基线失真
- 维度：G（兼 A/B）
- 文件：
  - packages/core/src/infra/tokenizer/logic/resolve-current-prompt-tokens.ts:176-190（preferEstimate 早退分支）
  - apps/desktop/src/main/services/chat-prompt-tokens.service.ts:206-210（docstring）/:249（无条件 preferEstimate）/:257-263（后台暖机 + 静默 catch）
  - apps/desktop/test/chat-prompt-tokens.test.ts:150-198（T-T9b/T-T9c，T-T9b 主代理实跑已红）
- 问题：core 读口在 `preferEstimate:true` 时序列化后直接返回 heuristic 估算——不查 L1、不调驱动；desktop 后台暖机写入的 L1 永远没人消费，chip 在 api miss 期间**锁死估算档**，与 service docstring「renderer 下一次触发即命中 L1 拿到精确标签」的设计意图相反（实现违背意图，非设计要改）。连带：T-T9b 旧断言（tiktoken/gpt =）与实现矛盾（现红）；T-T9c 的 precise 参照实为估算档；mobile 侧同病——L1 已暖的会话每次刷新经历「精确→估算→升级回精确」的降级闪烁并多付一次后台 resolve。
- 改法（**方案乙：core 读口回填设计意图**——preferEstimate 早退前先查 L1，命中即回精确值（`estimated:false`、家族 counterKind，label 带 `=`），不进代际不推代际；miss 才走既有廉价估算。L1 是纯内存读，零成本，不违背「首帧不付计数成本」的本意，且与「统计优先、有哪个用哪个」口径一致。mobile/desktop 双端同受益，测试改法即成立）：
  1. resolve-current-prompt-tokens.ts 的 preferEstimate 分支加「先查 L1（promptWholeCache 按内容指纹命中）」前置——命中直接返回精确档（该分支注释同步写明「L1 命中是零成本精确值，早退前先查」）；
  2. T-T9b 改写两态断言：首帧（无 L1）`counterKind==="heuristic"/estimated===true/label /^gpt ≈ /`；触发后台暖机完成后第二次调用 `counterKind==="tiktoken"/label /^gpt = /`；
  3. T-T9c 的 `precise` 参照改取暖机后的第二次读数；
  4. 补一条「L1 已暖时 preferEstimate 直读精确」的 core 用例（mobile 降级闪烁回归锁）。
  若用户否决方案乙：退回方案甲（desktop 侧状态机——暖机完成后该会话后续调用走完整口径），core 不动；两案取一，不许只改测试断言。
- 验收/测试：desktop `test/chat-prompt-tokens.test.ts` 全绿；core 新增 L1 用例绿；mobile 既有两阶段用例不回归。
- 来源：review-scope-s2 r1 + review-full r2（full/A-1 并入；主代理实跑 T-T9b 复核）

### s3/G-1 [P1] mobile 弹窗组件测试整体脱节——82ae88eb 漏改，一跑必红
- 维度：G（兼 A）
- 文件：apps/mobile/__tests__/metric-detail-sheet.test.tsx:89-96/150-152/163-175（主代理 findstr 复核实锤）
- 问题：fixture 仍带 `totals`；断言「累计输入12K」「累计输出8K」与旧脚注（组件已不渲染，新脚注「消息数为可见口径 · 工具调用含已隐藏消息」）；空态用例仍断言「暂无累计数据」。
- 改法：fixture 删 `totals`；会话累计段断言改「消息数（可见）11 / 工具调用4 / 上下文占用」+ 新脚注，补负向断言 `!toContain('累计输入')`、`!toContain('累计输出')`；空态用例删 `totals` 与「暂无累计数据」断言；头注释 :6 的「last/totals」表述同步。
- 验收/测试：apps/mobile jest 套件（含此文件）全绿。
- 来源：review-scope-s3 r1

### s2/B-1 [P1] mobile 升级回调无新鲜度校验——跨会话/切模型时序下旧升级结果覆盖新首帧
- 维度：B
- 文件：apps/mobile/src/services/chat-prompt-tokens.service.ts:177-194；apps/mobile/src/screens/tabs/chat-tab/useChatTabScope.ts:113-117
- 问题：`onPreciseUpgrade` 回调不校验发起时的会话/模型是否仍是当前态。场景①跨会话：S1 升级在途（~5.8s）期间切 S2，S1 升级完成把 S1 的精确 label 写进 S2 的 meta；场景②同会话切模型：切 A 启动 P_A 在途，5.8s 内切 B，B 首帧因 `preciseUpgradeInflight`（key 仅 sessionId）跳过启动，P_A 完成后回调 A 家族 label，当前模型却是 B——UI 长期显示旧模型记号，无自愈。
- 改法（双层，两场景都要堵）：
  1. service 层 per-session 新鲜度代数——模块级 `Map<sessionId, number>`，每次 `loadChatPromptTokenLabelResilient` 首帧成功即 `gen++`；升级轮记录发起时 gen，回调前比对当前 gen，不等则丢弃（堵场景②：切模型必产生新首帧、gen 必变）；
  2. **回调闭包捕获发起时 sessionId，回调执行前与当前活跃会话比对（service 层比对 `gen` 所属 session 一致 + useChatTabScope 回调处以 ref 持最新 sessionId 双保险），不等则丢弃（堵场景①：gen 方案对跨会话无效——S1 的 gen 在 S1 视角没变）**。
- 验收/测试：见 s2/G-2 ③（含场景①②双回归）。
- 来源：review-scope-s2 r1 + review-full r2（full/B-1 并入）

### s2/G-2 [P1] mobile 两阶段边界用例缺失（inflight 去重 / 后台失败重试 / 新鲜度双场景回归）
- 维度：G
- 文件：apps/mobile/__tests__/chat-prompt-tokens.test.ts
- 改法：补四条——①首帧返回后立刻再次调用（升级在途），断言 `resolvePromptTokensWithBackfill` 总调用次数 3（两首帧+一升级）而非 4；②mock 后台轮 reject，断言无回调、第二次调用后（inflight 已清）升级可再次启动；③-B-1 场景②回归——首帧 A 估算在途时切模型，断言 A 的升级回调被丢弃、UI 不出现旧家族记号；③'-B-1 场景①回归——S1 升级在途时切 S2，断言 S1 回调不写入 S2 的 meta。
- 验收/测试：mobile 该文件全绿，四条各自改错实现必红。
- 来源：review-scope-s2 r1 + review-full r2 补场景①

### s3/B-1 [P1] 现算回填与并发失效的竞态：陈旧值写回缓存且不自愈
- 维度：B
- 文件：packages/core/src/service/chat/impl/usage-stats.service.ts:513-555；失效侧 message.service.ts:106-120、message-rollback.service.ts:275-287、clear-session-prompt-caches.ts:35-40
- 问题：读口 SELECT 快照与回填 set 之间隔数百毫秒解压循环；期间失效 delete 先落、陈旧 set 后写——失效被覆盖、缓存永久陈旧（run 进行中开弹窗是现实并发）。AsyncMutex 不覆盖跨多 await 的业务临界区。
- 改法（两层）：
  1. 三处失效挂点从 `delete` 改为写哨兵空串 `""`（`parseInt("")`=NaN，读口天然当 miss，语义不变）；
  2. 读口记录 miss 时所见原值（null 或哨兵），回填前 `get` 复核仍等于该原值才 `set`，不等则放弃回填（本次返回值已出，下次读重算）。**已知残余（接受，写入代码注释）**：miss 时原值已是哨兵、现算期间再失效（再写 `""` 幂等不可分辨）→ 复核通过回填陈旧值，窗口延续到下次失效——两次失效夹一次现算的低概率场景、后果有界（下次失效自愈），不引入版本化哨兵。
- 验收/测试：新增两用例——a)「miss 现算期间插入失效（写哨兵）」→ 断言回填被放弃、下次读重算出新值；b)「miss 时原值已是哨兵」→ 正常回填不循环（终轮抽检 B 裁决：无死循环，主体成立）。
- 来源：review-scope-s3 r1 + review-full r2 残余竞态注记

### s1/C-1 [P2] 撤回强制档后三处注释残留已废弃口径（误导后续维护）
- 维度：C
- 文件：packages/core/src/service/agent/impl/agent-runner.ts:344-346、:860-861；packages/core/src/domain/compaction-conditions/triggers/token-ratio.trigger.ts:81-83；精化 message.service.ts:207
- 改法：三处按现行口径改写（append 不失效、增量覆盖；写入时序的真实约束是 anchorSeq 与 usage 对应同一批 visible；估算档指 preferEstimate 的 heuristic+CJK 下限）；message.service:207 的「评估跌进本地整串计数」精化为「UI 刷新路径跌估算档」（评估已 preferEstimate）。
- 验收：scope 文件内不再有「append 失效」「强制 cl100k 估算档」表述。
- 来源：review-scope-s1 r1

### s1/G-1 [P2] 统计优先链路测试缺口三处
- 维度：G
- 文件：packages/core/test/infra/tokenizer/resolve-current-prompt-tokens.test.ts、estimate-tokens-cjk-aware.test.ts、prompt-token-invalidation.test.ts
- 改法：①可控 registry（heuristic 恒返小值）+ 纯中文 tail，断言 delta 恰等于 estimateTokensCjkAware 对序列化串的值（现有 `> 50_000` 恒真断言换牙）；②补 CJK 标点用例（U+3000-303F 计入 CJK ×1.64，与 full/C-1 注释修正同口径）与 25 字浮点 ceil 边界用例；③补 show/showRange/hideRange 失效挂点各一例（同 hide 既有形态，invalidation 测试头注释挂点清单同步）。
- 验收：三处各自改错实现必红。
- 来源：review-scope-s1 r1

### full/C-1 [P2] 估算器注释与实现相反：全角标点实际按 CJK 计
- 维度：C
- 文件：packages/core/src/infra/tokenizer/logic/estimate-tokens-cjk-aware.ts:23
- 问题：注释「不含全角标点——按非 CJK 宽松处理」，但 CJK_CHAR_PATTERN `[\u2E80-\u9FFF...]` 覆盖 U+3000-303F，全角标点实际按 1.64 计（保守方向、行为可接受，注释错）。
- 改法：随 s1/G-1 ② 补归类用例时一并修注释（与用例同口径：全角标点计入 CJK）。
- 来源：review-full r2

### full/I-1 [P2] 双端后台精确轮失败全静默——失败后 chip 永停估算档且无从排查
- 维度：I（可观测性）
- 文件：apps/desktop/src/main/services/chat-prompt-tokens.service.ts:263（`.catch(() => undefined)`）；apps/mobile/src/services/chat-prompt-tokens.service.ts:187-188（空 catch）
- 改法：两处失败补 `__DEV__`/`__DEV__` 等价的开发期 warn（与 mobile 首帧 :169-173 同款；desktop main 侧用其开发判定）。
- 验收：mock reject 断言 warn 被调（或 DEV 关闭时静默的等价护栏用例）。
- 来源：review-full r2

### s3/C-1 [P2] tool-use-count.ts 头注释仍把已撤回的列方案消费方列为在役
- 维度：C
- 文件：packages/core/src/domain/chat/logic/tool-use-count.ts:4-7
- 改法：消费方改为「usage-stats 读侧 miss 现算 + message.service append 失效判定」；「会话累计口径」改「工具调用数口径（含 hidden）」。
- 验收：`packages/` + `apps/` 源码内 `tool_use_count` 字样仅剩 bootstrap 墓碑一处（docs 下 spec 收窄注记与 verify-record 历史记录不计——终轮 Q-1 修订）。
- 来源：review-scope-s3 r1 + review-full r2（验收措辞修订）

### s3/C-2 [P2] usage-stats.port 方法级 docstring 仍描述已移除的「会话累计」
- 维度：C
- 文件：packages/core/src/service/chat/usage-stats.port.ts:223-228
- 改法：删「会话累计（含 hidden…）」短语，改「最近一条 usage 行 + 可见消息数 + 工具调用数（会话 KKV 缓存优先，miss 现算回填）」。
- 来源：review-scope-s3 r1

### s3/C-3 [P2] clear-session-prompt-caches 文档与测试未覆盖第四件（usage_stats 失效）
- 维度：C + G
- 文件：packages/core/src/service/vfs/logic/clear-session-prompt-caches.ts:16-24；packages/core/test/vfs/clear-session-prompt-caches.test.ts
- 改法：docstring 改四件套并列出 usage_stats 失效理由；测试预置 `usage_stats.toolUseCount` → 调用后断言**该键值已非数字（哨兵空串或不存在）——与 s3/B-1 哨兵方案一致，不断言「键已清」**（终轮冲突修订：原「断言键已清」在哨兵方案下必红）。
- 来源：review-scope-s3 r1 + review-full r2（与 B-1 冲突消解）

### full/C-2 [P2] desktop 弹窗测试头注释仍述「累计输入输出」
- 维度：C
- 文件：apps/desktop/test/metrics-detail-popover.test.tsx:10-11
- 改法：头注释删「/累计输入输出」表述（与同文件 :226-240 的移除断言矛盾）。
- 来源：review-full r2

### s3/G-2 [P2] 失效矩阵测试缺口五项
- 维度：G
- 文件：packages/core/test/chat/usage-stats.service.test.ts（及回滚测试族）
- 改法：仿 T-MD3「值可区分 + 缓存行存在性」观测面补——a) 回滚失效一例；b) delete/updateContent/truncateAfter 失效各一例；c) hide/show 不失效回归锁；d) 坏行（损坏 content_blob）按 0 计不抛；e) KKV 脏值（非数字串）当 miss 重算回填。
- 验收：各项改错实现必红。
- 来源：review-scope-s3 r1

## Spec deviations
- none（三 scope + 终轮均无 open deviation；列方案撤回、totals 移除、LruCache 4、纯文本追加不失效均已拍板并记录于 spec 收窄块与 verify-record）

## Open questions / 待拍板（不阻塞 fix-spec-ready；随执行确认）
1. **s2/G-1 方案乙的否决口**：本轮把「preferEstimate 先查 L1」定性为「修实现回到 docstring 声明的设计意图 + 统计优先口径的自然延伸」写入 P0 改法。若你否决，执行时改走方案甲（desktop 侧状态机），core 不动——两案在 fix-spec 内均已写明，执行前请顺手确认。
2. mobile `loadChatPromptTokenLabel` 生产调用方为零（仅测试消费），是否保留。
3. CJK 估算器：扩展 B-F 区生僻字（U+20000+）未覆盖（低估方向）；25 字类浮点 ceil 偶发 +1（保守方向）——是否改整数算术 `cjk*164/100`。
4. 增量序列化与整串序列化的连接符分叉（`\n\n` vs `\n`，保守方向）是否统一。
5. api 命中分支的增量不含 tools 变化（tools 增删在下次 usage 前不反映）是否有意。
6. KKV 缓存值解析 `Number.parseInt` 对 `"12abc"`/`"-5"` 类脏值宽松——是否随 s3/B-1 收紧为 `/^\d+$/` 校验。
7. 迭代 PRD 正文（prd.md:47/48/75）与 metric-detail-sheet spec 正文主体未随 2026-09-29 拍板回写（终态以收窄块为准）——建议执行时顺手回写。

## 已豁免（用户确认不修）
- 无

## 合并后 QA（manual_user）
- 真机：大会话弹窗首开现算一次（数百 ms）→ 复开即时；跑一轮带工具调用的对话后复开应重算新值；切模型后 chip 首帧 `gpt ≈` → 升级 `glm =` 节奏正常、旧家族记号不残留；L1 已暖会话刷新无「精确→估算→精确」闪烁（s2/G-1 方案乙生效后）。

## K 节建议（下游执行时闭合）
- 修复后重跑：desktop `test/chat-prompt-tokens.test.ts` + `test/metrics-detail-popover.test.tsx` + `test/usage-stats-ipc.test.ts`；mobile jest 全量；core chat/tokenizer/db-maintenance 套件；`git grep -n "tool_use_count" packages apps` 终态仅剩墓碑；core dist 重建；真机 reload 复验。

## Fix-Spec Closure
| 项 | 状态 |
| fix-spec-ready | yes（终轮修订闭合：P0 改法绑定 L1 方案并保留否决口、B-1 补跨会话层、C-3 与 B-1 冲突消解、C-1 验收措辞可达、新增 C-1/C-2/I-1 三条 P2 已入册） |
| **执行状态** | **已执行完毕**（2026-09-29，方案乙落地；全部 14 条闭合，证据见 verify-record「CR r2 十四条修复执行」轮） |
| fix_spec_path | docs/Iterations/context-usage-overhaul/cr-fix-spec-r2.md |
| dag_version / review_round | 3 / 2 |
| P0 / P1 / P2（已写入 fix-spec） | 1 / 4 / 9 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | none |
| C-orch | ✅（三 scope + 终轮均无偶然 hop；双端 parity 缺口随 s2/G-1、s2/G-2 闭合；review-full 判定「不需要再开新一轮代码评审」） |
| C 类合并后 QA | 已附（manual_user 不阻塞）——另注：真机复验项 = 弹窗首开/复开、切模型 chip 节奏、L1 已暖刷新无闪烁 |
