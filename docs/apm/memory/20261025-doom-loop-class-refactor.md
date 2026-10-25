---
date: 2026-10-25 01:21
title: doom-loop 检测重构为状态类 DoomLoopDetector（已落地，checkStep 返 Result，错误工厂已删）
keywords: doom-loop, DoomLoopDetector, 状态外置, AgentError, 重构, 公共导出, Either, Result, 错误工厂, 参数不换行, AGENTS.md
abstract: 用户觉得 doom-loop.ts 函数多、实现乱，问能否统一成类。诊断出真正的乱在跨步窗口状态躺在 agent-runner（含 *4 魔数）、配置袋被两个检查共用、错误文案与两种检测语义错位、比较逻辑重复。已按实例类落地：配置与轨迹窗口收进 DoomLoopDetector；按用户习惯把所有 private 方法内联进 checkStep（内联后发现多余 slice）；checkStep 再不抛而返回 Result&lt;void, AgentError&gt;，runner 边界保留抛出；错误文案按阈值动态并新增交替专用文案；公共导出只留 class 并同步 allowlist 快照；测试扩到 12 条。随后按用户要求删掉 agent-runtime-errors 的三个工厂（agentUnsupportedProvider 无人使用，doom 两个只包一层 Error），DoomLoopDetector 直接 new AgentError，runtime 直传构造；函数参数不换行写进 AGENTS.md 与 RULE.md。规则亦写进 AGENTS.md「编码风格」。
---

user:
D:\Dev\Js\novel-master\packages\core\src\domain\agent\logic\doom-loop.ts 感觉有很多函数，能改成统一类，然后暴露为方法或静态方法吗？
其实感觉当前这个实现有点乱

assistant:
读完了 80 行实现与全部调用点（agent-runner 一处、public/agent.ts 四处导出、doom-loop.test.ts 7 条、public-agent-allowlist 快照）。结论：能改，而且该改，但「乱」的根不是函数数量，是状态分居。

诊断四点：
1. 跨步轨迹窗口 `toolUseWindow` 声明在 agent-runner（L261）、维护在 L840-845（push/shift + `doomLoopCrossRoundWindow * 4` 魔数），检测规则却在 domain——状态与规则两地分居，这是最实质的乱。类正好把状态收回实例。
2. `DoomLoopChecksConfig` 是两个检查共用的一袋可选参数，每个函数只吃其中一个字段，调用方要自己知道谁吃谁。
3. 错误文案与语义错位：`agentDoomLoop(toolName)` 写死 "invoked 3 times with identical input"，而 threshold 可配（配 2 时报「3 次」）；跨轮 A-B-A-B 分支把 `"read<->list"` 塞进 toolName，文案变成「工具 read<->list 用同样输入调了 3 次」，与实际检测条件不符。
4. `sameInput` / `sameToolUse` 两套比较并存，`assertNoDoomLoop` 还内联了一份比较没有复用。

方案（实例类，不用静态）：
- `DoomLoopDetector`：构造收 threshold / crossRoundWindow（默认值改 static readonly），实例持有轨迹尾窗；`checkStep(blocks)` 一步完成「本步同输入连击 → 折进轨迹 → 跨轮交替」，命中抛 `AgentError(DOOM_LOOP)`；`reset()` 备用。
- 跨轮窗口裁剪改为恰好保留 `crossRoundWindow` 条（检查只读尾窗），`*4` 魔数消失；行为等价。
- 静态方法只适合无状态纯函数；跨轮检测天然有状态，做成静态就得把窗口当参数传进传出，等于把状态又扔回调用方（现状即如此）。纯比较函数留模块私有。
- 仓内先例：`ToolRunner`、`ToolRegistry`、`DecodedContentCache` 都是 `logic/` 下的状态类，放 `domain/agent/logic/doom-loop.ts` 不违和。

迁移面：agent-runner 删 `toolUseWindow` 与三个符号导入、run 起步 new 一个 detector；public/agent.ts 导出改 class；public-agent-allowlist 快照同步；7 条测试改实例调用。另有两点待用户拍板：公共导出是只留 class（推荐，仓外无消费者）还是保留自由函数薄壳；错误文案是否顺手改成动态（跨轮单独文案，会改变 UI 错误提示文字）。跨轮窗口非法值（<4 或奇数）现在静默关闭检查，拟原样保留并在注释写明，不擅自改为报错。

user:
改

assistant:
按上述方案落地，用户未反对两个默认。改动四处 + 测试 + 快照：
- `doom-loop.ts`：只留 `DoomLoopDetector` 与 `DoomLoopConfig`。静态默认 `DEFAULT_THRESHOLD=3` / `DEFAULT_CROSS_ROUND_WINDOW=4`；构造收配置；`checkStep(blocks)` 顺序固定「本步连击 → 折进轨迹 → 跨轮交替」；`reset()` 留给复用。轨迹裁剪从 `window * 4` 改成恰好保留一个窗口（检查只读尾窗，行为等价）。模块私有只留 `toolUseBlocks` / `sameToolUse`，重复的内联比较随旧函数一起消失。
- `agent-runtime-errors.ts`：`agentDoomLoop(toolName, threshold)` 文案按阈值动态（修掉「配 2 报 3 次」），新增 `agentDoomLoopAlternating(first, second, window)` 专用文案（修掉把 `"read<->list"` 塞进 toolName 的语义错位）。
- `agent-runner.ts`：删 `toolUseWindow` 与四个符号导入；run 起步 new 一个 detector；原两段调用换成一行 `doomLoop.checkStep(result.blocks)`。
- `public/agent.ts` + `public-agent-allowlist.json`：四个自由函数/常量导出换成 `DoomLoopDetector`（+ 类型 `DoomLoopConfig`，类型不进快照）。
- `doom-loop.test.ts` 重写为 12 条：原 7 条语义保留（默认阈值、两个不抛、不同输入不抛、A-B-A-B 抛、非交替不抛、配置阈值、配置窗口），新增「只查尾窗」「跨 step 累积在同一实例」「交替错误文案含两个工具名与窗口」「阈值 2 的文案写 2 次」「非法窗口静默降级」「reset 清轨迹」。

验证：core typecheck 过、lint 0 error（新增文件零告警，105 条 warning 全为既有）、`test/agent` 203/203、export allowlist 快照 15/15、`npm run build -w @novel-master/core` 过（dist 已重建）。全量套件 3394 条 3 红，均与本次无关：`usage-stats.service` 的 T-C2/T-C6 时间桶用例（隔离复跑仍红，属当前挂钟/时区依赖的既有问题，跑时 00:56）、`agent-stream-registry-accum-perf` 的 T-N5-REG-LINEAR（隔离复跑 2/2 转绿，属满负载性能护栏噪声，与 RULE 记录同源）。

user:
我有个习惯，对于private方法，我希望你全部内联，因为内联你能看到是否可以简化的地方，抽private本质对你没什么意义。

assistant:
照做并把这条写进 RULE.md（类里不写 private 方法，只留 private 字段承载状态；多处复用的纯比较可留模块级私有函数）。DoomLoopDetector 的 `assertNoRepeatedInput` / `remember` / `assertNoAlternation` 全部内联进 `checkStep`。内联后的真实收益：轨迹在 ② 已裁到至多一个窗口，③ 走到长度判断时必然恰好等于窗口，原先的 `slice(-crossRoundWindow)` 是多余复制，直接读 `this.trajectory` 即可（已加注释点明该不变量）。模块级 `sameToolUse` 保留——三处复用的纯比较，内联会把同一表达式重复三次。验证：core typecheck 过、lint 0 error（105 条既有 warning 不变、新增文件零告警）、test/agent 203/203。

user:
生成一个AGENT.md记录这个规则，然后throw agentDoomLoop(first.name, this.threshold);正好可以用我们的eihter来优化了，checkStep(blocks: readonly ContentBlock[]): void 不返回 VOID 而是 Result<Void,Error>，可能写的不准，不过你应该能理解我的意思？

assistant:
规则写进仓里已有的 `AGENTS.md` 新增「编码风格」小节（仓里没有 AGENT.md，agent 实际加载的是 AGENTS.md；RULE.md 的同条保留）。`checkStep` 改为返回 `Result<void, AgentError>`：命中返回 `Result.err(agentDoomLoop(...))` / `Result.err(agentDoomLoopAlternating(...))`，通过返回 `Result.ok(undefined)`，方法本身不再抛。runner 边界保留抛出语义（`const doomLoopResult = doomLoop.checkStep(result.blocks); if (!doomLoopResult.ok) throw doomLoopResult.error;`），run 收口与错误展示契约零变化。测试改成断言 Result 分支（`expectErr` / `expectOk` 两个 helper），12 条语义不变，并顺带证明 checkStep 不抛。验证：core typecheck 过、改动文件 lint 0 问题、test/agent 203/203、dist 重建。

user:
D:\Dev\Js\novel-master\packages\core\src\errors\agent-runtime-errors.ts
这个写的也很抽象，agentUnsupportedProvider没人用，然后其他几个函数就没用过几次，就为了封装下ERRORR，而且封装的也没什么用。
还有我不喜欢函数入参换行的风格，改成不换行的。

assistant:
删掉该文件的三个工厂：`agentUnsupportedProvider`（全仓零调用）、`agentDoomLoop` / `agentDoomLoopAlternating`（只被 doom-loop 各调一次，确实只是包一层 new）。文件现在只剩 `AgentError` 类与 `AgentErrorCode`，并在类注释里写明「不提供工厂，抛出点直接 new」。doom-loop 改为直接 `new AgentError("DOOM_LOOP", ...)` 并构造 Result.err；`AgentErrorCode` 联合暂按公共契约保留（现状只有 DOOM_LOOP 真被产出，其余 code 无生产者，可后续再收）。

顺带去掉一层映射：`DoomLoopConfig` 字段改名为 `doomLoopThreshold` / `doomLoopCrossRoundWindow`（与 AgentDefinition.runtime 同名），runner 直接 `new DoomLoopDetector(options.definition.runtime)` 一行，不再手抄两字段；测试配置同步改名。

参数换行：AGENTS.md「编码风格」与 RULE.md 各记一条「函数签名/调用参数写一行，不换行，放不下先减参数」；`either.ts` 里唯一一处多行签名（Ok.andThenAsync）也拉平成一行。验证：core typecheck 过、改动文件 lint 0 问题（仅既有 `_branch` warning）、test/agent 203/203、dist 重建。
