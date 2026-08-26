# cr-fix-spec：thinking-context-toggle（code-review 第一轮）

## 元信息

- repo: novel-master（worktree `.woktree/thinking-context-toggle`）
- base: `b3429b0`（main，五迭代 PRD/SPEC 定稿点）
- head: `6e7e595`（feat/thinking-context-toggle，base..HEAD 共 11 个 commit）
- review_round: 1
- dag_version: 2
- 状态: draft
- 业务 Spec / PRD（只读参考）：`docs/Iterations/thinking-context-toggle/spec.md`、`docs/Iterations/thinking-context-toggle/prd.md`
- 本 wave 范围：全部 4 条 P2（无 P0 / P1）

## Must-fix

> 本轮仅 P2 四条，按 id 顺序排列（P0→P1→P2 的排序规则下 P0/P1 段为空，不重复列出）。

### MF-1 [P2][B/K] persistent-preferences.test.ts 分组嵌套错误 + vfs 坏值覆盖丢失

- **文件**：`packages/core/test/persistent-preferences/persistent-preferences.test.ts`（L73-111）
- **问题**：
  1. `describe("chat.thinkingContext")`（L87）开在 `describe("vfs.userVfsUnifiedToolTurn")`（L73）内部——vfs 分组未先闭合（文件末尾 L111-112 连续两个 `});` 才补上），导致 thinkingContext 的三个用例在测试报告中挂在 vfs 分组名下，归属误导、按分组跳跑/统计时口径错误。
  2. vfs 分组原有的坏值用例被改写为 thinkingContext 坏值用例（L101-109，写入 key 为 `chat.thinkingContext`），vfs 自己的 `INVALID_VALUE` 覆盖丢失——spec T-PF1 要求「扩展 `persistent-preferences.test.ts`」，是扩展而非替换。
- **改法**：
  1. 在 vfs 的 round-trip 用例（L79-85）之后先闭合 `describe("vfs.userVfsUnifiedToolTurn")`；
  2. `describe("chat.thinkingContext")` 提为 `describe("PersistentPreferences")` 内与 vfs、`v2 defaults (C1)` 等平级的顶层平行分组；
  3. 坏值用例两个 key 各保留一份：vfs 分组补回 `vfs.userVfsUnifiedToolTurn` 的 `not-a-bool` 坏值 → `PreferencesError` 且 `code === "INVALID_VALUE"` 用例；thinkingContext 分组保留现有 `chat.thinkingContext` 坏值用例。
- **验收**：
  - 源码结构：vfs 与 thinkingContext 为两个平级 describe，各自闭合；两组各含 3 个用例（defaults / round-trip+reset / 坏值）；
  - `packages/core` 定向测试（`persistent-preferences.test.ts`）全过，core 全量不回退（基线 2174 pass）。
- **来源**：CR R1（dag v2）；对应 spec 偏差 SD-1。

### MF-2 [P2][C/C-orch] 双端 prompt-preview.service.ts 约 44 行逐字重复，加 wire 侧共三份近似口径

- **文件**：
  - `apps/desktop/src/main/services/prompt-preview.service.ts`（L59-101，注释 + 函数体）
  - `apps/mobile/src/services/prompt-preview.service.ts`（L57-99，同上）
  - 近似口径第三份：`packages/core/src/service/agent/impl/agent-runner.ts`（L259-273，`savedModelForAppend` 解析 / 档位读取 / `savedModelId` 判空兜底）
- **问题**：`resolvePreviewThinkingContext`（savedModelId 解析：agent pin → 会话 modelId 覆盖；档位读取：`thinkingLevel !== "off"`；协议推断：`inferLlmProtocolFromSavedModelId`；三级 anthropic 兜底）在双端逐字重复（仅引号风格差异）；wire 侧 agent-runner 另有一份手写近似口径。三处口径后续任一变更（如兜底方向、pin 优先级调整）极易改一漏二，preview 与 wire 的「同构」承诺（spec Step 6、风险 4）靠复制粘贴维持。
- **改法**：
  1. 下沉 core：在 `packages/core/src/service/prompt/`（或经 `public/prompt.ts` 暴露的公共层）新建单一实现（如 `resolve-preview-thinking-context.ts`），入参用 repo 端口 Pick（`savedModels: Pick<SavedModelRepository, "findById">`、`providers: Pick<ProviderRepository, "findById">`、preferences 窄切片、`agentModelId` / `sessionModelId`），不依赖双端 runtime 类型；返回 `{ enabled, requestThinkingEnabled, protocol }`；
  2. 协议返回类型改用 `LlmProtocolKind`（定义于 `packages/core/src/infra/llm-protocol/ports/adapter.port.ts`，`inferLlmProtocolFromSavedModelId` 本就返回该类型），替换双端手写的 `"openai" | "anthropic" | "gemini"` 字面量联合；
  3. 双端 `prompt-preview.service.ts` 各改为调一次 core 实现，删除本地副本。
  - 注：wire 侧 agent-runner 的读取点在 run 主路径上、语义为 per-run 快照，与 preview 的调用形态不同，本轮只收敛口径来源（协议/档位/兜底判定同源），不强求 runner 改调同一函数；若改法实现时发现可无代价共用，可顺带收敛。
- **验收**：
  - 双端 service 内不再有本地 `resolvePreviewThinkingContext` 定义（grep 双端各 0 处）；
  - 预览口径不回退：T-PV1 / T-PV2 相关 core 测试与双端 prompt-preview 相关套件全过；desktop / mobile typecheck 零错；
  - 新实现有单测覆盖「取不到模型兜底 true + anthropic」「pin 优先于会话覆盖」「档位 off → requestThinkingEnabled false」三个分支（可由双端既有测试代偿，若代偿则在 fix commit 中说明）。
- **来源**：CR R1（dag v2）。

### MF-3 [P2][B/I] agent-runner 偏好读取无容错，KKV 坏值炸掉整个 run

- **文件**：`packages/core/src/service/agent/impl/agent-runner.ts`（L270-273）
- **问题**：`(await this.deps.preferences?.getThinkingContextEnabled()) ?? true` 只兜 `undefined`（未注入 preferences 的 mock 场景）；KKV 中存了坏值（如手工写入 `not-a-bool`）时 `getBooleanPref` 抛 `PreferencesError`（`INVALID_VALUE`），异常沿 `run()` 冒泡直接炸掉整个 run。GUI 侧无自愈入口——用户不重置 KKV 就一直无法发起对话，且报错对用户不可解读。
- **改法**：读取处 try/catch：catch 到 `PreferencesError` 时回退 `true`（保守保留方向，与 `savedModelForAppend == null` 时 `requestThinkingEnabled` 取 true 的既有保守占位一致），并按 runner 既有标签式日志惯例（参照 L663 `console.error("[agent-runner] checkpoint_capture_failed", {...})`）记一条可观测日志（含 key `chat.thinkingContext`、错误码、回退值 true）。
- **验收**：
  - 新增/扩展 runner 测试：注入 preferences mock 使 `getThinkingContextEnabled` 抛 `PreferencesError`，run 正常完成、thinking 按开态（true）参与剥离判定；
  - 日志断言（或至少用例中捕获日志输出）包含偏好 key 与错误码；
  - core 全量测试不回退。
- **来源**：CR R1（dag v2）。

### MF-4 [P2][K/H] CHANGELOG 缺本迭代条目（spec 风险 2 的发版提示未落地）

- **文件**：`CHANGELOG.md`（当前无 `## [Unreleased]` 段，最新为 `[1.5.4] - 2026-08-25`）
- **问题**：spec 风险 2 明确要求——默认语义从「全历史透传」变为「仅最新一轮」，存量长会话首次请求后服务商前缀缓存可能失效一次（一次性成本/延迟抖动），发版说明需提示（CHANGELOG `Changed` 条目）。实现轮未补任何本迭代条目，发版时该语义变化会对用户静默生效。
- **改法**：按仓库 changelog 惯例（Keep a Changelog、中文四分类、`## [Unreleased]` 段、发版时由 publish 流程挪入版本号）补两条用户视角条目：
  - **变更**：思考内容进入上下文的默认行为——历史思考不再随请求透传，仅保留最新一轮（含活跃工具循环所需块）；存量长会话首次请求后服务商前缀缓存可能失效一次，带来一次性的成本/延迟抖动；
  - **新增**（双端）：设置中的「思考进入上下文」开关，可控制思考内容是否进入后续请求上下文。
  - 措辞对齐 changelog skill 原则：面向用户结果，不出现 CR 编号 / 内部术语（retainProtocolMinimum、KKV 等）。
- **验收**：`## [Unreleased]` 段含上述变更 + 新增条目；变更条目同时覆盖「仅最新一轮」语义与前缀缓存抖动两点；过 changelog skill 校对清单（无重复 / 无内部细节 / 面向用户 / 措辞简洁）。
- **来源**：CR R1（dag v2）；对应 spec 偏差 SD-2。

## Spec deviations

| id | 偏差 | 事实 | 对应 must-fix |
|----|------|------|---------------|
| SD-1 | T-PF1 以「替换」而非「扩展」方式落地 | spec T-PF1 / Step 1 要求扩展 `persistent-preferences.test.ts` 覆盖偏好三件套；实现轮将 vfs 坏值用例改写为 thinkingContext 坏值用例，`vfs.userVfsUnifiedToolTurn` 的 `INVALID_VALUE` 覆盖丢失（且伴随 MF-1 的分组嵌套错误） | MF-1 |
| SD-2 | CHANGELOG 未按 spec 风险 2 补发版提示 | spec 风险 2 要求 CHANGELOG `Changed` 条目提示默认语义变化（全历史透传 → 仅最新一轮）与前缀缓存失效抖动；实现轮 CHANGELOG 无本迭代条目 | MF-4 |

## Open questions（待拍板）

1. **mobile 副标题档位例外文案**：`ChatConfigScreen` 的 `ProfileSwitchItem` 副标题目前仅描述开关态；档位 off 时无论开关开 / 关均全剥（spec Step 2 全局前置门），是否在副标题补充档位例外说明（如「模型思考档位为关闭时不保留」）？涉及 UI 文案口径，需拍板后另开改动，不在本轮 must-fix 内。
2. **剥离决策可观测日志**：wire 侧每 run 的剥离决策（`enabled` / `requestThinkingEnabled` / 边界位置 / 是否触发协议最低保留）是否记 debug 级可观测日志，便于用户报障「为什么 thinking 没进上下文」时定位？若采纳，建议与 MF-3 的 catch 日志同点落地（同一日志通道）。
3. **UI 写偏好失败静默**：双端开关 onChange 先 setState 再异步写偏好（desktop `ipcPreferencesSetThinkingContext` / mobile `setThinkingContextEnabled`），写失败时 UI 状态与持久值不一致且无提示、下次 refresh 才回真值；是否需要失败回滚 UI 状态或 toast 提示？

## 已豁免

（无）

## 合并后 QA（manual_user）

- **真实服务商关态工具循环冒烟**（spec 风险 1，高危项）：anthropic / gemini 真实账号往返冒烟，覆盖「档位从高改回关」×「开关开 / 开关关」×「活跃工具循环」组合，确认关态不 400、开态签名逐字节回传；gemini 侧顺带确认签名挂载不受剥离影响。
- **双端 UI 真机验收**（T-UI1 / T-UI2）：设置开关出现、默认开、切换持久化（重启仍在）、双端一致；开态「查看提示词」可见最新轮 thinking 段、关态不可见；中途切换模型（GLM→Claude）的存量会话发起请求不 400。
- **CHANGELOG 人工校对**：`[Unreleased]` 条目按 changelog skill 校对清单逐项过（无重复 / 无内部细节 / 无过程 bug / 面向用户 / 措辞简洁）。

## K 节建议

1. **扩展既有测试文件时保持分组闭合与平行新增**：新增 describe 必须与既有分组平级、各自闭合，坏值等既有覆盖不得被改写占用——本次 `persistent-preferences.test.ts` 的嵌套 + 替换事故即反例；可纳入 review checklist（测试文件 diff 检查分组结构闭合）。
2. **双端同口径业务逻辑直接下沉 core**：preview / wire 共用口径的判定链（模型解析、档位、协议推断）应收敛为 core 单一实现（端口入参），禁止双端 service 层复制粘贴维持「同构」——与 spec 既有「单点实现」原则一致，本次三份近似口径是违背该原则的实例。
3. **run 关键路径上的偏好读取必须容错**：KKV 坏值抛 `PreferencesError` 不应炸掉整个 run（GUI 无自愈入口）；统一模式为「catch → 回退默认值 → 标签式可观测日志」。
4. **spec 点名的发版提示在实现轮同步补齐**：行为语义变化（含缓存抖动类用户可感知代价）点名要求 CHANGELOG 条目时，应随实现 commit 一并补 `[Unreleased]`，不留到发版轮补写（发版轮只做挪段与校对）。
