---
date: 2026-10-07
title: 预览提示词 workplace 压缩后不刷新 + 内容预览行号移除（PRD 澄清轮）
keywords: 预览提示词, workplace, rule_snapshot, file_cache, 压缩, compaction, 行号, prompt-preview, RealPromptScreen, 性能回归, 冷组装
abstract: 用户报两问题：①压缩上下文后预览提示词 workplace 块不刷新（手动调工作区规则才刷新）；②预览页 Assistant/user 内容预览带行号要求移除。三子代理探索结论：workplace 块=rule_snapshot（清单）×file_cache（正文），清单首次组装即冻结（write 新文件不重写 canon）、file_cache 无 mtime 校验且 edit/编辑器保存不失效，压缩按 2026-09-29 拍板不清两域，refreshRuleSnapshot 是唯一全量刷新入口；行号非 UI 所加，是提示词正文自带 N| 前缀（workplace/附件/read 工具结果），预览 UI 只是如实渲染。待用户澄清刷新口径/行号口径/端范围后落 PRD。
---

# 预览提示词 workplace 压缩后不刷新 + 行号移除（prd-generate）

## 2026-10-05 第 1 轮

**user**:
压缩上下文后，预览提示词中 workplace 块不刷新，必须手动调整工作区规则后才刷新。需要调整为压缩上下文后，预览提示词 workplace 更新。另外预览提示词页面，各个 Assistant/user 内容的预览，怎么加了行号？没让加过，这是错误行为，移除。

**assistant**:
（PRD 探索轮，三路只读子代理，主代理汇总）

1. workplace 刷新链：预览（mobile RealPromptScreen → buildRealPromptPreviewTurns；desktop RealPromptPanel → ipcPromptRealPreview）与真实发送（agent-runner 每 step）是 assembleWorkplaceDisplay + prepareUserMessagesForPrompt 的两次独立调用，都实时读 KKV，无预览侧缓存。workplace 块 = rule_snapshot（{path,status} 清单）× file_cache（正文）。canon 首次组装即冻结（assemble-workplace-display.ts 只在缺失时评估）——agent write 新建文件只 upsert file_cache 不重写 canon，新文件永不进前缀；file_cache 命中无 mtime 校验（load-or-fill-file-cache.ts:52-68），edit 工具/fs mv cp/双端编辑器保存均不失效；runCompaction 按 2026-09-29 拍板不清两域（理由：缓存与消息可见性正交 + 回合内前缀冻结不变量 + 压缩卡顿）。refreshRuleSnapshot（重写 canon + clearDomain(file_cache)）是唯一全量刷新入口，即「手动调规则后刷新」的机制。结论：压缩后 workplace 陈旧不是压缩链 bug，是两域长期陈旧在压缩时机暴露。
2. 行号：预览 UI 层（mobile RealPromptScreen/PromptTurnDetailScreen/components/prompt/* + desktop RealPromptPanel/PromptLeafCard/PromptToolGroupCard/PromptWorkplaceCard）无任何加行号代码（全仓 grep 零命中）。行号是提示词 wire 正文自带格式——workplace 文件块 `${idx+1}|${line}`（workplace-display.ts:30-50，filename 档单行也是 `1|文件名`）、user 附件 action XML 正文同格式（prepare-user-messages-for-prompt.ts:209-222）、assistant 轮 tool_result 的 read 输出 6 位右对齐行号（format-tool-output.ts:32-74）。2026-10 新预览 UI（ui-prompt-fixes-2026-10 / prompt-preview-ui-redesign）如实渲染 wire 正文，行号因此可见；纯手打文本/thinking 无行号。无任何迭代立项过「预览显示行号」。
3. 文档漂移（修实现时需一并对齐）：docs/apm/RULE.md:27、packages/core/src/domain/session-kkv/model/session-kkv-domains.ts:30、packages/core/src/domain/workplace/logic/load-or-fill-file-cache.ts:45-46 三处仍写「压缩清两域」，与 2026-09-29 实现相悖（repo-mega-cr-2026-10 CD-57 曾登记过一次同类漂移）。
4. 相关测试锚点：run-compaction.test.ts T-CC2/3/4（压缩后两域必须仍在——若改口径这些测试要跟着改）、refresh-rule-snapshot.test.ts T-CR2、message-transcript-effects.test.ts（置位清两域）。

待用户澄清后落 PRD 到 docs/Iterations/：①刷新口径（压缩时全刷 / 只重评估清单 / 治本随文件变动失效）；②行号口径（预览层隐藏 vs wire 去行号 vs 开关）；③端范围（双端同构惯例 vs 仅 mobile）。

**assistant**:
（澄清轮）AskUserQuestion 三问（刷新口径/行号口径/端范围）用户未作答，按 prd-generate 兜底路径带缺口落盘。PRD 已写入 docs/Iterations/prompt-preview-workplace-lineno-2026-10/prd.md（date 2026-10-05，dependency []），默认口径全部标注「待确认」：①手动压缩后完整刷新（收窄 2026-09-29 拍板至「自动压缩不清」）＋自动压缩维持不清；②行号仅预览显示层移除、wire 不变；③双端同构。风险项含 mobile 预览屏仅挂载取数需补刷新时机、run-compaction T-CC2/3/4 断言按手动/自动入口拆分。状态：PRD 待用户最终确认（含三个待拍板口径）。

## 2026-10-05 第 2 轮（spec-generate）

**assistant**:
（spec 轮）用户点名 spec-generate，进 spec 前再问一轮三口径仍未获作答，按 PRD 默认口径设计。三路 readonly 子代理技术探索关键结论：①手动/自动压缩共用 runCompaction（run-compaction.ts:58-84）且无 trigger 判别——方案定为 RunCompactionParams 加可选 trigger（缺省 auto），manual 成功路径清 rule_snapshot+file_cache（吞错 warn，清域而非调 refreshRuleSnapshot：零新依赖且避开子会话 sessionId×评估 scope 分裂坑）；desktop 手动压缩入口缺 run 在途门禁（mobile 两入口各有），补 isDesktopSessionRunInFlight。②wire 与预览物理分叉——buildPromptLlmInputFromLayout 不读 cards/workplaceFiles，cards 消费方仅预览 UI 4 处，双端 8 渲染点纯透传；行号三形态：workplace `^N|`（零空格）、read `padStart(6)` 右对齐（≥1 空格判据防误剥）、user 附件行号藏在 JSON 转义串内逐行正则不可达（列 P2 允许降级）。③mobile RealPromptScreen 仅挂载取数且有「导航红线」mock 约束（补 useFocusEffect 须同步补两套件 mock）；desktop panel 常驻仅 visible 翻转重取，window CustomEvent session-compacted 为现成压缩成功信号（panel 自治订阅）。
SPEC 已写入 docs/Iterations/prompt-preview-workplace-lineno-2026-10/spec.md（12 步、T-CR/T-PL/T-PR 三族用例、回滚=去 trigger 参数整体回到现行行为）。既有测试处置：T-CC2 拆两半、desktop T-IPC1 方向反转、render-prompt-turns :128-162 期望更新；prompt-workplace-card/real-prompt-panel-rounds 的 T-WP1 系不改（UI 直喂 DTO 锁透传语义）。状态：spec 待用户确认，确认前不进 impl。

## 2026-10-05 第 3 轮（spec-check-loop）

**assistant**:
（审查循环启动）用户点名 spec-check-loop，编排状态登记 docs/.iteration-state.yaml `spec_check_ppwl` 段（共享文件末尾追加、未动并行会话段落）。
（审查循环收敛）共 4 轮 judge 审查：R1 No-Go（T-CR6 mock.module 在 desktop 跑不起来、PRD 验收3 与 Step7 降级互斥）→ R2 No-Go（门禁 reason 字段与 IpcResult 冲突、renderer 双保险无落点、T-PR3 落点打架、T-IPC1R 须改写非并存）→ R3 No-Go（T-CR6 残留旧形态、RULE:17 漏出对齐清单）→ R4 Go。累计闭合 P0×4 / P1×12 / P2×15，主代理 doc-fix 直改未动实现代码。审查验真关键事实：预览/发送物理分叉（wire 不读 cards）、行号三形态判据、abortRegistry 真态注入先例、IpcErrorPayload{code,message} 为拦截返回唯一合法形态、escapeXmlText 不碰反斜杠。

## 2026-10-05 第 5 轮（code-dev-loop 收敛 dev-ready）

**assistant**:
（dev-ready）DAG 六波全收敛：wave-0 双 core impl（A 压缩 trigger+按域独立吞错清两域 / B cards 行号三层剥离含 user 附件未降级）→ wave-1 三 app impl+主代理五文件注释 → verify-all（定向 87/29/27 全绿、desktop 全量 735/735 优于基线、core/mobile 全量红均判既有欠账或环境噪音）→ cr-func-1 一次 func-ready（blocking 测试断言逐条读源码核对有牙齿、红线零改动全守住）→ 加固笔（独立 try，cd258cba9）→ 主仓 RULE 三条目。7 笔提交 463b00bf5..cd258cba9 在 worktree D:\Dev\nm-worktree\ppwl 分支 feat/prompt-preview-workplace-lineno，未 merge 未 push 未发版；Step 12 真机/桌面手动验收留合并后用户。deviations 四条全 recorded 可接受（Step7 作用域收窄 userAttach/workplaceChange 更优等）。新坑入档：①提交信息经 cmd 传递偶发 UTF-8→GBK 编码坏，amend 用 UTF-8 文件 -F 修（cd258cba9 先例）；②worktree 的 .git 是文件非目录，临时文件勿落其下；③core 全量既有红 10 条中 8 条为 v1.5.30 read-ref 退役测试欠账（RT-01 六条调全仓无定义的 resolveReadRefCountChannel + T-DEL-RT2/3 断言 contentRef），遗留台账待单独立项。

## 2026-10-05 第 4 轮（code-dev-loop 启动）

**assistant**:
（dev 启动）用户以 [$code-dev-loop] 点名启动＝execute-ready 确认开工（tau 先例口径）。worktree D:\Dev\nm-worktree\ppwl / 分支 feat/prompt-preview-workplace-lineno / base 44d266dbc（v1.5.38）；DAG 六波：wave-0 双 core impl 并行（A 压缩 trigger+清域 / B cards 行号剥离）→ wave-1 三 app impl + 主代理直改五文件注释 → verify-all → cr-func → 动态 fix 循环 → RULE 三条目收尾。编排登记 iteration-state `dev_loop_ppwl` 段。wave-0 前置构建中（npm install + build + build:webview；第一轮命令因 cmd 无 tail 失败，已重发）。

## 2026-10-05 第 6 轮（e2e 进行中 + code-review-loop 收敛 fix-spec-ready）

**assistant**:
（两线）①e2e（用户「e2e测试下」）进行至一半挂起：nm35 模拟器（google_apis）+ Metro 从真实路径起 8084（**坑：app 保留 dev 偏好 debug_http_host=10.0.2.2:8084，历史会话用过 8084；Metro 起错端口即红屏 loadJSBundleFromAssets 失败——读 shared_prefs/react_native_dev_settings.xml 定位**，BUNDLE ./index.js 来源已验）；复用旧 e2e-fixture-model，UI 建项目 e2e-ppwl-ws+会话1，发消息失败落库 OK，工作区已建 e2e-new.md（两行）；待续：预览#1 → 手动压缩 → 预览#2。②用户点 [$code-review-loop] cr：wave1 三 scope 并行（core/desktop/mobile）→ P0=P1=0、P2=12；主代理落盘 cr-fix-spec.md → wave2 review-full 抽验 12 条全中、新发现 1 条 P2（RULE.md:27 与 load-or-fill-file-cache 注释同源漏「回滚/截尾」）+ 4 处精度修正（RunCompactionWithTokenWarm 名不存在→Outcome/Hooks、deferred 无 reject 需先扩、kebab「全仓唯一」限定 IpcErrorPayload.code 家族、hasLoadedRef 升主方案）→ doc-fix 后 **fix-spec-ready：13 条 P2**（测试加固 8/注释口径 4/竞态守卫 1）、spec_deviations 三项全 fixed（Step7 作用域经证据核验不构成收窄：userAttach/workplaceChange 恰好覆盖全部带行号附件正文）、C-orch 三链收敛（trigger 单点 3 处/行号单一数据流/刷新信号两端）；RULE.md「未更新」系 worktree 旧副本误报（docs 留主仓库惯例）。fix-spec：docs/Iterations/prompt-preview-workplace-lineno-2026-10/cr-fix-spec.md，待用户确认开工；mobile B-1（refocus 整屏 spinner+展开态被收，改静默档）与 desktop B-1（面板 load 竞态守卫）为 13 条中仅有的两条用户可感行为修复。

## 2026-10-05 第 7 轮（spec-check-loop 审 cr-fix-spec → execute-ready）

**assistant**:
（execute-ready）用户点名「cr spec 不是开发 spec」——spec-check-loop 的审查对象换成 cr-fix-spec（修复说明书），判据=下游可照此逐条开工。judge 两轮：R1 No-Go（P0×1：执行说明「全部在 worktree 实施」与 cr-full/C-1（RULE.md:27）/cr-desktop/C-2（spec.md 同步）两条主仓库落点打架——worktree docs 是旧副本且无本迭代 spec.md；P1×3：spec 里 run-in-flight 有 :56/:89 两处只点了一处、mobile B-1 并列口径直读会把换会话清展开态一起静默掉、G-2/G-3 对 userCardBody helper 写法打架；P2×9：core 测试路径多 service/ 层、T-CR5 编号与 desktop 撞车改 T-CR1b、desktop 桩无可控延迟需 queueInvokeResponse 前置、mobile 验收二落点须 prompt-turn-expand-control 且 mockFocus 需登记 handler、:248 行号括注矛盾、desktop G-1 拍板方案一、C-orch-1 括注精确化、三处行号漂移、「6 处注释」实为 5 处）→ 主代理 doc-fix 全闭合 → R2 **Go**（12/13 全闭 + 4 项纯文档残留已补齐：C-2 改法字段带 spec 两处、执行说明注明 C-2 跨两库、mobile B-1 附空集守卫注释提示）→ **execute-ready**。拍板口径入档：mobile B-1 的 silent 只压 setLoading、清展开态按 lastSessionRef 会话判（各管各的勿合并）；mobile B-1 执行时需留注释说明原空集原引用守卫前提已消失。待用户确认后按 fix-spec 开工。

## 2026-10-05 第 8 轮（code-dev-loop 修复 13 条 → dev-ready）

**assistant**:
（dev-ready）用户以 [$code-dev-loop 修复] 点名＝开工确认。DAG：wave-0 三 impl 子代理并行（core/desktop/mobile 各 4 条，worktree 侧 11 条）+ 主代理直改主仓库 2 条（RULE.md:27 补「回滚与截尾」、spec.md :56/:89 换 AGENT_RUN_IN_FLIGHT）→ 主代理补 C-2 注释连带（chat-prompt-tokens.service.ts:574 旧码名）→ wave-1 cr-func 一次 func-ready。worktree 12 笔提交 60a26e713..57c887cf9；定向全绿（core 83/83+邻 14/14、desktop 31/31+全量 737/737、mobile 25/25）+ tsc/eslint 干净；desktop/mobile 反向验证真做（守卫失效/提前 restore/静默档回退/过期守卫关闭→各自用例红）。cr-func 抽牙结论：6 条高价值新用例全真牙齿（T-G1 挪独立 describe 防假绿是 impl 自发发现——放 describe#1 会被 beforeEach 假桩掩护）。裁定：G-3 的 `/\\n\d+\|/` 与说明书字面一致非偏离；prettier 不跑（HEAD 同 warn、避免 churn，K 节建议项）；顺手闭 cr-func 观察项 spec.md:55 旧口径半句。**fix-spec 13 条全部闭合，dev-ready**；未 merge 未 push；e2e 仍挂起待续。新坑：desktop 全量首轮 736/737 的 after-pack `electron-builder --dir` 偶发红、单独复跑即绿（非回归判据）。

## 2026-10-05 第 9 轮（e2e 收官——双 bug 修复真机验证通过）

**assistant**:
（e2e 通过）修复后代码重载（force-stop 重启 → Metro 8084 增量 BUNDLE）继续挂起的 e2e。**关键路径发现：mobile 预览与压缩入口都在「会话详情页**」（会话操作图标进入）——查看提示词（real-prompt-row）/压缩上下文（compact-row），聊天页菜单只有置位/压缩/重命名/删除**。三步验证：①预览#1——workplace 卡仅 novel-outline.md（**不含** e2e-new.md，rule_snapshot 冻结符合预期）、全页无任何「数字|」行号前缀（workplace 正文 `# 新小说` 干净、用户消息干净）→ bug② 修复生效；②手动压缩——确认弹窗「将隐藏最早的一轮对话，此操作无法撤销」→ 确认 → toast「压缩完成」+ token chip 0→gpt≈25（warm 链路通）；③预览#2——workplace 卡 **含 e2e-new.md** 且正文「e2e line one/e2e line two」无行号 → bug① 修复生效。**额外收获**：该会话仅一轮对话，压缩走 hide 零命中路径（消息仍可见）但两域照样清、workplace 照样刷新——T-CR1b 锁定的场景真机复现。截图留档 D:\Dev\nm-worktree\ppwl\tmp\e2e-11~16。PRD 验收 1/2（mobile 侧）通过；遗留：desktop 面板刷新场景未补测（Step 12 手动验收）、真机端到端留用户。

## 2026-10-05 第 10 轮（发版 v1.5.39）

**assistant**:
（v1.5.39 已发布）用户点 [$novel-master-publish] 收尾。流程：mobile 全量补跑 **2073/2073**（+5 新用例）作发版门禁 → feat 分支 19 笔 ff 合入 main（57c887cf9，20 文件 +1914/−134）→ RULE 三条目单独文档笔（8eaa910e9）→ CHANGELOG v1.5.39 段（修复三条：压缩后预览工作区刷新/预览正文行号移除/desktop 运行中压缩拦截；维护一条）+ 双端 package.json/build.gradle fallback/package-lock workspace bump → 版本笔 51f62f242 → tag v1.5.39 + push（Release CI #125 已排队，#124 成功先例 ~28min）+ push main。changelog 口径：refocus spinner/desktop 面板竞态守卫属开发中引入即修复，用户未体验过未写修复段；CR 编号等内部术语不进 changelog。迭代闭环：PRD→SPEC（4 轮 check）→dev（6 波）→CR（fix-spec 13 条双闸门）→e2e 三步验证→发版。worktree D:\Dev\nm-worktree\ppwl 可回收；遗留台账：read-ref 退役测试欠账（core 全量 8 红既有）、desktop 面板刷新场景补测未做（T-PR3 有行为级断言兜底）。

## 2026-10-07 第 11 轮（v1.5.39 手动压缩性能回归诊断，未动手）

**user**:
上下文压缩的实现有问题，现在有点卡顿。上次让你处理预览提示词不更新的问题，但性能直接没了。我理解不应该影响到压缩的性能，因为预览提示词的 workplace 应该和 vfs 工作区的预览是一个逻辑，根据 rule snapshot 实时刷新的，实际上逻辑也差不多，预览提示词的 Workplace 不也是目录结构吗？

**assistant**:
（诊断轮，未改代码）根因定位：v1.5.39 手动压缩成功路径清 `rule_snapshot`+`file_cache` 两域（run-compaction.ts:104-123）之后，**压缩编排会同步 await 一次 token 预热**——mobile `compaction-warm-orchestration.service.ts` 第 3 步 `warmChatTokenLabelAfterCompaction`、desktop `ipc/handlers/compaction.ts` IPC 返回前 `warmChatPromptTokenStatsAfterCompaction`。预热=完整拼一轮提示词（assembleWorkplaceDisplay）；两域刚被清空，这次组装从「暖几百 ms」变成**全量冷组装**：canon 重评估（evaluateRuleView 目录扫描）+ 逐文件 probe SQL + VFS 全读 + blob inflate + 后台回填（serialize+hash+deflate，Hermes 纯 JS deflate 大头）。代码自证量化：assemble-workplace-display.ts fingerprint 注释「冷 5~16s、暖几百 ms 全在 inflate/读盘」；load-or-fill-file-cache.ts 2026-09-30 探针「3 文件 6M 字符冷态 466ms，回填写侧占 77%（hash 127+deflate 173），Hermes 更贵」。desktop handler 注释里的「await 暖机代价 ~0.3~1s」是**暖缓存假设下的旧成本模型**，与清域改动叠加后失效——两改动同迭代落地、成本交互没人算账。卡顿两个表现都能解释：按钮到 toast 的等待（await 冷组装）+ 压缩后 UI 掉帧（后台回填 deflate 占 JS 线程）。用户心智模型纠正：①预览与真实发送本来就共用同一 assembleWorkplaceDisplay 实时调用、无预览侧缓存，刷新口径只能动共享快照层；②workplace 块不是目录结构，是注入全文的常驻前缀，刻意按快照冻结（回合内前缀冻结不变量、S0 attach 去重、token 口径稳定），工作区文件浏览器不走 rule_snapshot、直读 VFS 树所以实时。修法方向（待用户拍板）：A 暖机移出 await 关键路径（快但 chip 跳变回潮、冷组装只是挪到下次发送）；B 只清 rule_snapshot 不清 file_cache（新文件进清单、旧文件正文沿用缓存）；C 治本=缓存条目 mtime 增量失效（probeFileMeta 的 findContentSize 已轻量带回 mtimeMs，命中判定加 `cached.mtimeMs === probe.mtimeMs`，只重读变更文件）+ canon 重评估。推荐 C。

## 2026-10-07 第 12 轮（用户三连问：预热为何在压缩链 / 置位为何立刻 / 工作区为何立刻）

**user**:
不是预热你放压缩干嘛？置位操作不也是立刻的？对工作区的不也是立刻生效的？怎么到预览提示词就麻烦了？

**assistant**:
（对比轮，证据链闭合）三问答案：①预热进压缩链是 2026-09-30 用户拍板「跳变也消掉」——压缩作废 API token 基线，压缩后 chip 刷新首帧必是估算档（gpt ≈）再 1~2s 跳回精确档（glm =）；消跳变只能在返回前 await 精确暖机。当时（2026-09-29 口径）压缩**不清两域**，暖机是暖缓存 ~0.3~1s，代价可接受；v1.5.39 加清域后同一行 await 变成全量冷组装，成本模型没人重算。②置位也清同样两域（message-transcript-effects.service.ts CoordinatedWrite 内 clearDomain×2）但**立刻**：mobile `runSetFloor` 的 chip 刷新是 `void refreshChatTokenLabel()` fire-and-forget、toast 不等它；desktop `handleMessagesSetFloor` 干脆没有暖机调用。冷组装成本置位照样付，只是后台懒付不挡按钮——且置位没接 freeze，chip 存在估算→精确跳变（当年拍板只覆盖压缩）。③工作区浏览器「立刻」是因为它根本不消费 rule_snapshot/file_cache，每次直读 VFS 树，列目录本来就便宜；预览提示词 workplace 是全文注入前缀，重建=清单重评估+逐文件读盘+inflate+回填 deflate，贵是本质。结论：不对称是「清域动作便宜、 awaited 重建贵」+两条分别拍板的决策叠加（09-30 消跳变 vs v1.5.39 清域）撞出来的。修法补充：A 变体=freeze 保持住、暖机 fire-and-forget、落定后再补刷（chip 冻结旧标签期间无跳变也不挡按钮，代价是 chip 短暂陈旧）；desktop 侧 renderer 刷新竞态需评估 freeze 等价物。根修仍是 C（mtime 增量失效让暖机本身变便宜）。

## 2026-10-07 第 13 轮（用户拆原子操作：拼接 vs token 计算——方向定调）

**user**:
稍等，你把预热放到压缩和置位操作没问题，但问题在于你把预热的两个原子操作弄混了，一个是提示词拼接一个是 token 计算，很显然 token 计算不阻塞其他操作，完全可以后台计算。workplace 首次拼接可以同步处理，但它也不是性能短板，1s 内绝对可以完成。

**assistant**:
（定调轮）用户拆解正确且被代码证实：mobile `loadChatTokenLabelWithFlag` 就是被 await 的两段——build 段 `buildSessionPromptInput`（整串装配，含 workplace 冷组装）＋resolve 段 `resolvePromptTokensWithBackbackfill`（token 计算），且已有分段诊断 `[nm-chip] build done/resolve done`。量级校准：build 段用户「1s 内」基本成立（2026-09-30 探针：3 文件 6M 字符冷态 466ms、回填后台化后 128ms，Node 22；「冷 5~16s」是双装配 SQLite 排队的争用场景非单次冷组装）；**反转点：重的恰是 token 段**——chat-prompt-tokens.service.ts:205 注释明写 resolve 段含「~5.8s 级原生整串计数」（大提示词、真机），比 build 段重一个量级，更不该挡按钮。闭环发现：置位没有暖机、其 chip 走的就是常规两阶段链（loadChatPromptTokenLabelResilient：估算首帧＋后台精确升级＋run 在途抑制＋shouldBail 弃权）——即置位早已是用户处方的形态；压缩的内联 await 才是异类。修法定调（用户方向＝A 变体正统化）：冻结窗口保持住、暖机两段整体 fire-and-forget、runCompaction 返回即出 toast、后台落定后解冻＋补刷一次→首帧即精确（无跳变无阻塞）；冷组装发生在后台暖机内、file_cache 回填后下次发送仍是暖的。desktop `handleCompactionManual` 同款拆（其 await 同为消跳变而生，需 hold 等价物或单独拍板）。C（mtime 增量）降级为可选优化——不在关键路径后价值缩小。待用户最终确认开工。

## 2026-10-07 第 14 轮（用户终拍板「压缩与置位同一实现路径」→ 双端落地）

**user**:
置位和压缩应该一个实现路径，然后渲染层可以先把 token 统计置空，等到计算出来再显示，这不是大问题。甚至不清空，等后台自动刷新都行。本身 UI 显示就没那么急切和时间敏感。

**assistant**:
（落地轮，未 commit）终口径＝放弃 2026-09-30「跳变也消掉」，chip 读数交给常规两阶段刷新自然跟进（选「不清空旧值」档）。mobile：`compaction-warm-orchestration.service.ts`（freeze+await 预热）整体删除，新 `manual-compaction.service.ts` 只剩 runCompaction(trigger:manual)→hooks（改名 runManualCompaction，r3-orc-1 去重价值保留）；`chat-prompt-tokens.service` 删 preciseWarmInflight/begin/endChatTokenLabelFreeze/warmChatTokenLabelAfterCompaction/isChatTokenPreciseWarmInflight；useChatTabScope 的 refreshChatTokenLabel 删冻结判空；两个 UI 入口（useChatTabMessageActions/SessionDetailScreen）改调新编排、删 onFinally 补刷；测试：新 manual-compaction.test.ts（保留 T-CR7 trigger 钉死）、chat-prompt-tokens.test 删两条 warm 用例、token-debounce 删冻结闸 describe、6 个文件 mock 工厂清死键。desktop（子代理实施+主代理抽查）：compaction.ts handler 删 await warmChatPromptTokenStatsAfterCompaction（保留 AGENT_RUN_IN_FLIGHT 门禁与 composer 通知）；service 删 warm 函数+compactionWarmInflight，读口路径 helper 按引用保留；T-IPC2 反转为「IPC 成功返回不依赖也不触发暖机+常规读口自然升级」，删 T-IPC2b/T-CW1~4/T-DA1b；主代理追加删除无调用方的 holdReadWarmInflightForTests。验证：mobile tsc 0 错+定向 10 套件 95/95+eslint 无新增（useChatTabMessageActions:401/503 与 SessionDetailScreen:137 三条 exhaustive-deps error 经 HEAD 对照实锤**存量欠账非本次引入**，未动）；desktop tsc 0 错+定向 21/21（子代理全量 731/731=737−6 删除用例）。坑：core dist 陈旧导致 tsc 报 trigger 不存在（npm run build -w @novel-master/core 后过）；git show | Set-Content 会 UTF-8→GBK 坏编码，HEAD 对照须 cmd /c 原始重定向。遗留：renderer ratchet 基线绝对路径错位红（子代理验证与本次无关）；真机验证压缩恢复速度未做；未 commit 未发版。

## 2026-10-07 第 15 轮（真机验证通过 → 发版 v1.5.40）

**user**:
安装到真机上，我试试，启动 metro。（验证后）没什么问题发布吧 [$novel-master-publish]

**assistant**:
（真机 + 发版轮）真机链路按硬规则走：无 subst（D:\Dev\Js\novel-master 即真实路径）→ Metro 后台起 8081（core dist 本轮已重建、含 trigger，旧 dist 会静默吞 manual 参数）→ `adb reverse tcp:8081 tcp:8081` → 现成 10/3 debug APK `install -r -d`（纯 JS 改动免出包）→ monkey 拉起 com.novelmaster。排障实录：①无 dev_settings.xml=默认 localhost:8081 正确；②首屏「Loading from 127.0.0.1:8081...」后 Metro 首包慢（metro-file-map 缓存反序列化失败→全量爬取，属无害降级，entities/decode WARN 同理）；③中途截屏纯黑=手机自动锁屏，`input keyevent KEYCODE_WAKEUP` 点亮即正常（对话 Tab 无报错）。用户真机试压缩报「没什么问题」→ 发版：版本 v1.5.39→**v1.5.40**（patch+1 硬规则），门禁 mobile 全量 + desktop 全量后台并行，CHANGELOG 补修复一条（用户可感卡顿归「修复」、短暂旧值取舍并进同条不拆、无独立维护项），bump 四处同步（双端 package.json / 根 package-lock 两 workspace 条目 / build.gradle versionName fallback 字节级），提交→tag v1.5.40→push tag 触发 Release CI→push main。
