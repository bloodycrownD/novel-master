---
zone: fix-spec/wave-a · 分片·组 C
agent: readonly reviewer
files_scanned: 34（含 wave-a.md A4/A7/§8/§9、ledger-v2.md §1/§3/§10/§11、baseline.md、RULE.md、raw/w1-core-tool.md、raw/w9-ds2-tool-*.md、delta-overview.md 按需）
baseline_commit: fe79b781
review_date: 2026-10-01
scope: A4（N-P0-03 CLI agent 创建入口 + [nm-boot] 改 stderr）、A7（编码还原批次 1）、core-tool 债务池抽验
---

# sr1-a-c · wave-a 分片 组 C 审查报告

**审查对象**：`docs/Iterations/repo-mega-cr-2026-10/fix-spec/wave-a.md` 的 A4、A7 两条目，外加 core-tool 簇债务池抽验。
**方法**：所有行号与引文逐处打开 `fe79b781` 工作树核对；所有计数类结论**实跑复算**（编码扫描、严格 UTF-8 校验、git 历史 good-rev 搜索、grep 消费方清点、CLI 用例计数）；修法可行性逐跳从代码重推导。
**纪律**：全程只读，未做任何 git 写、未改任何生产/测试代码、未改 fix-spec、未写 `docs/apm/`。

---

## 1 · 逐条 verdict 表

图例：✅ 通过（行号在位 + 修法可行 + 验收可测 + 依赖闭合）／⚠️ 需小修（不阻塞执行，但口径要改）／❌ 必须修（照 spec 执行会落空或引入事故）。

### 1.1 A4 · N-P0-03 —— CLI 开不了第一个会话 + `[nm-boot]` 污染 stdout

| # | 要素 | spec 主张 | 实测复核 | verdict |
|---|---|---|---|---|
| A4-1 | 性质/范围 | 台账 P0-03 是「26/102 条 CLI 测试永久红灯」的**症状**，本条只修 2 条已实锤根因，「26 条逐条归因」在两条落地之后做 | `ledger-v2.md:436` 原文「无。26 条红灯逐条归因在这两条之后做」、`:514`「只归因了 2 条根因，其余 24 条未逐条归因」、`:82`「26/102 条」。**接住了** | ✅ |
| A4-2 | 证据(i) CLI 调用点 | `apps/cli/src/session/commands.ts:63-72`，引 `case "create"` / `resolveProjectId` / `sessions.create` | 实为 `:63` case、`:64` resolveProjectId、`:67` create、`:71` console.log。区间与引文全部在位 | ✅ |
| A4-3 | 证据(ii) core 失败点 | `session.service.ts:106-118`（台账 `:105-113`，实测下移 1 行） | `create` 在 `:106`、取 agentId `:110-113`、抛错 `:114-118` —— 与 §8 row2 完全一致 | ✅ |
| A4-4 | 证据(iii) 取 agentId 逻辑 | `agent-run-shared.ts:64-71` | 函数体 `:65-70`，签名 `:57-64`；引文逐字一致 | ✅ |
| A4-5 | 证据(iv) 致命一步 | `agent-registry.service.ts:64-66`（`listAgentIds` 只读 DB）vs `:68-76`（`list()` 合并虚拟 general） | 逐字一致，含 `:72-74` 的同名短路 | ✅ |
| A4-6 | 证据(v) 否决备选修法 | `agent-registry.port.ts:13-19` 注释 + `DEFAULT_SUBAGENT_DEFINITION`（`default-subagent-definition.ts:19-32`）**没有 id 字段** ⇒ `listAgentIds()` 无法合法纳入 general | 端口注释 `:13-19` 逐字（乱码渲染但结构一致）；定义 `:19-32` 确认**无 `id` 字段**。**该备选修法确实不成立，推翻成立** | ✅ |
| A4-7 | 证据(vi) CLI 缺口 | `registry-commands.ts:43,54,63,76,85,107` = list/show/import/export/migrate/delete；`commands.ts:114-121` 只转发这 6 个；**无 create / upsert** | 六个 case 行号**逐个精确命中**；`commands.ts` 转发 case 在 `:114-119`、转发调用 `:120`、return `:121` | ✅ |
| A4-8 | 证据(vii) bootstrap 不种 agent | `packages/core/src/bootstrap/` 只有 providers / skills / smart-sort-rules 三个 seed | 目录列举确认：无任何 agent 种子文件 | ✅ |
| A4-9 | 缺陷② 三个打印点 | `git grep -rn "nm-boot" -- packages/core/src` 全量 = `schema-migrations/index.ts:67`、`:71`、`retire-pref-session-fs-version-check-v1.ts:40-43` | 全量 grep **恰好 3 处**，行号精确（第三处 `console.log(` 在 `:40`、模板串在 `:41`、`);` 在 `:42`） | ✅ |
| A4-10 | 危害自证 | `apps/cli/test/helpers.ts:39-46` 的 `stripBootLogs`；`parseProviderList:107` / `parseSavedModelList:142` 各带 `!line.startsWith("[nm-boot]")`；`:123-134` 是「UUID 打 stderr」的老口径 | 四处行号逐个命中，`parseCreatedProviderId` 确在 `:123-134` | ✅ |
| A4-11 | 修法 Step 1 语法可行 | 新 `case "create"`：`randomUUID()` + `registry.upsert(id, def, createRegistryValidateOptions(rt))` + `setCurrentAgentId` + `console.log(id)` | 逐项验证：① `AgentRegistryService.upsert` 在端口 `:24-28` 存在；② `AgentDefinition` 类型确由 `@novel-master/core/agent` 导出（`packages/core/src/public/agent.ts:1`）；③ `rt.state.setCurrentAgentId(id: string)` 在 `persistent-state.port.ts:37` 存在；④ `AgentPromptLayout` 的 `persist`/`dynamic` 是**必填数组**（`:112-113`），给出的 `{system, persist: [], dynamic: []}` 满足；⑤ `assertWritableAgentDefinitionShape` 只校验 name/prompts/字典序，**不要求 `mode`/`model`/`workplace`** ⇒ `satisfies AgentDefinition` 可编译 | ✅ |
| A4-12 | 修法 Step 4 校验不卡住 | `createRegistryValidateOptions`（`:124-133`）只校验 saved model 与已注册工具名；新定义不带 `model`、无 tools 限制 ⇒ 不触发 | `validate-agent-definition.ts:30-40` 确认：`registeredToolNames` 存在时只跑 `validateAgentToolPolicy(def.tools,…)`，`def.tools` 为 `undefined` 时不触发；`model` 为 `undefined` 时 `:37` 早退 | ✅ |
| A4-13 | 修法 Step 3 帮助文案完备 | 只需改 `registry-commands.ts:46` 空态提示 + `:117-119` 的 `default:` usage 串 | 全仓搜索 `agent <list\|show\|import\|export\|migrate\|delete>` **只命中该源文件自身**；`main.ts:134` 是通用 `Usage: novel-master ${top} <subcommand> ...`，无 per-subcommand 列表 ⇒ **文案面已覆盖完整，无遗漏** | ✅ |
| A4-14 | 修法 Step 2 转发 | `commands.ts:113-121` case 列表加 `"create"` | 位置正确 | ✅ |
| A4-15 | 「不 seed 默认 agent」的取舍 | 拒绝 seed 方案（会改所有新建库行为，属产品面变更） | 合理，与 Wave A 零风险定位一致 | ✅ |
| A4-16 | 缺陷② 修法 | `:67`/`:71`/`:40-43` 三处 `console.log` → `console.error`，日志内容一字不改；保留 `stripBootLogs` | 落点精确、内容不变、可单独立 commit。**成立** | ✅ |
| A4-17 | Step 7「不动 helpers.ts」 vs A4.4「只新增 `parseAgentId`」 | 两处措辞 | 语境可解（Step 7 的「不动」指 `stripBootLogs`/`parseProviderList`/`parseSavedModelList`），但字面互斥 | ⚠️ |
| A4-18 | **验收 ① 缺陷①的牙齿** | 空库上 `agent create` → `session create` 应退出码 0 | **空库上 `session create` 根本走不到 agent 那一步**：`apps/cli/src/config/resolve-scope.ts:29-35` 先抛 `Missing --project <id>`；即便补 `--project`，`session.service.ts:414-418` 的 `requireProject` 还会抛 `chatNotFound("project")`。spec 写的「修前症状 = 新建会话失败：workspace 未配置 Agent」在**该脚本下拿不到**，「修后期望 = 打印会话 UUID 且 exit 0」也拿不到 | ❌ |
| A4-19 | **验收 ② stdout 洁净** | 「期望 stdout 只有会话 UUID 一行」「改之前迁移会打**两行**」 | ① ② 跑在 ① 之后，此时该临时库的 6 条 schema migration 早已 applied（`schema-migrations/index.ts:36-43` 共 6 条），`[nm-boot]` **一次都不会打** ⇒ **该断言零牙齿，改前改后都过**。② 数字也错：`ledger-v2.md:82` 明记「实测 **12 行**污染」（6 × run/applied），spec 写「两行」 | ❌ |
| A4-20 | **验收 ③ / A4.5 回归判据** | 「`npm test` 与 `baseline.md` 对照；不得新增红」 | `fix-spec/baseline.md` §4「已知红基线」总表**只有 7 行**（core tsc / desktop 主进程 / desktop renderer / mobile typecheck / mobile lint / core 测试 / desktop 测试 ×2 / mobile jest），**没有 `apps/cli` 行**；§3 也只跑了 core/desktop/mobile 三包。⇒ 「与 baseline 对照」**当前无可比基线** | ❌ |
| A4-21 | A4.4 引用的口径符号 | 「`parseAgentId`（`assertCreatedAgentId` 口径）」 | `git grep assertCreatedAgentId -- apps/cli` **零命中**，`parseAgentId` 也不存在（它就是待新增的那个）⇒ 引了一个不存在的「口径」 | ⚠️ |
| A4-22 | A4.4 牙齿三判据自检 | ① 有牙 ② 恒红 ③ 一夹具两期望 | 逻辑成立；但 A4-18/19/20 三处使「有牙」在当前写法下**不成立**（用例本身设计对，执行脚本错） | ⚠️ |
| A4-23 | A4.7 风险表 | 覆盖 console 流变更、最小 agent 缺 workplace、general 同名 upsert 拒绝（`agent-registry.service.ts:108-111` ✓ 命中） | `:108-111` 逐字核对成立。**未列**「在已有 agent 的库上跑 `create` 会静默覆盖 workspace 的 `currentAgentId`」——内联注释已交代意图，故仅记 nit | ⚠️ |
| A4-24 | 「不得改 RUNTIME 字符串」红线 | A4 明确不改任何 RUNTIME 字符串 | 成立：改动只有新增 CLI case + 3 处流切换 | ✅ |

**A4 小计**：✅ 15 / ⚠️ 6 / ❌ 3。

### 1.2 A7 · 编码还原批次 1（★5 部分阻塞）

| # | 要素 | spec 主张 | 实测复核 | verdict |
|---|---|---|---|---|
| A7-1 | 状态标记 | `blocked-by-decision(★5)`，但 ★5 只卡 sksp 三处，其余可先落 | `ledger-v2.md:325`（★5 默认建议「先只还原已核实纯注释的 7 个文件，sksp 三处单独人工看过再定」）、`:439`（Wave A 行「需拍板项 ★5 先答。**不得改 RUNTIME 字符串**」）。**挂起范围正确、拍板项标记到位** | ✅ |
| A7-2 | 顶部计数 | 「其余 **5 个文件（71 处**字面 U+FFFD）」+「1 个 GBK 污染文件（178 处）」 | 非 sksp 的 5 个文件实为 **74 处**（vfs 2 + tool-definitions 1 + agent-runner 64 + openai-mapper 4 + message-body-text 3），不是 71；且其中 `message-body-text.test.ts` 按 spec 自己的类 2 表属「**非 UTF-8**」而非「字面 U+FFFD」，「1 个 GBK 污染文件」也应是 **2 个** | ❌ |
| A7-3 | 编码扫描命令与修前输出 | 单行 `node -e` + 10 行输出 | **实跑复算，逐行逐数完全一致**（vfs 2 / session-prompt-input 178 / prd.md 2 / tool-definitions 1 / composite-secret-store 1 / ref-to-env 1 / secret-store.port 1 / agent-runner 64 / message-body-text 3 / openai-mapper 4，`files with U+FFFD = 10`） | ✅ |
| A7-4 | `build.gradle` 被 SKIP 挡掉 | 该文件字面 `EF BF BD` 为 0，只属「非 UTF-8」类；SKIP 正则含 `android[\\/]app[\\/]build` | 实跑清单确无该文件；严格解码实测 `INVALID firstBad=389` | ✅ |
| A7-5 | 类 1/类 2 的 VALID/INVALID 分类 | 类 1 = 5 文件 72 处全 VALID；类 2 的 6 个文件 INVALID/VALID 逐个标注 | 用独立 UTF-8 校验器复算：`session-prompt-input` INVALID、**`composite-secret-store.ts` VALID**、vfs VALID、tool-definitions VALID、agent-runner VALID、openai-mapper VALID、**message-body-text INVALID**、ref-to-env INVALID、secret-store.port INVALID、build.gradle INVALID、prd.md INVALID。**与 spec 的逐文件标注全部一致** | ✅ |
| A7-6 | 「178 全部在注释里」实测 | GBK 还原实验：**28 行受损注释、0 行代码**；另 8 行含 `?` 全是 TS 三元/可选链 | 独立复跑（PowerShell codepage 936 解码 + 统计）：**总 51 个 `?`、分布在 31 行；非注释行含 `?` 的恰好 8 行，逐行看过全是 `?:` / `?.` / `??`**。计数完全吻合；「0 行代码」成立（所有含 CJK 的受损行都在 `//` / `/** */` 内） | ✅ |
| A7-7 | 首个坏字节位置 | `session-prompt-input.service.ts`「首个坏字节在 **index 833**」 | 实测为 **835**（字节 `e5 9c 3f`：`e5` 起 3 字节但第 1 续字节是 `?`）。833 落在 `e6 96 b0`（合法「鎴」）的**中间**，不是坏字节起点 | ❌ |
| A7-8 | 类 1 表格的 agent-runner 定位 | 「64 处，分布 8 行，**全在 `it("…")` 的用例标题字符串里**」 | 计数/行号**全对**：64 处、8 行 = `294:7 351:13 417:8 460:11 520:12 789:2 1133:9 1474:2`。但 **`:1133` 是 `/** … */` JSDoc 块注释**，不是用例标题 ⇒ 「全在 it() 标题里」**为假** | ❌ |
| A7-9 | 「it() 用例名逐字相同」验收 | 改前导出用例名清单、改后逐条 diff | 因 A7-8，该口径**覆盖不到 `:1133`**，会漏检 9 处 | ❌ |
| A7-10 | sksp 三处引文与行号 | `composite-secret-store.ts:17` / `ref-to-env.ts:8` / `secret-store.port.ts:2` | 三行**逐字命中**，形态确为 `<FFFD>?` 统一分隔符 | ✅ |
| A7-11 | ★5 处置 | 三处整块挂起 + 备齐 file:line 与引文 + 参考 ledger §11 的空目录哨兵线索 | `ledger-v2.md:522` 记的目录名是 `(echo`/`exist`/`OK)`/`if`；**本 worktree 根目录实见 `(echo`、`echo`、`-Command`、`-NoProfile`、`-p`、`powershell`、`$TEMP`**（`exist`/`OK)`/`if` 不在此 worktree）。RULE:135 确实记载过同族 cmd 转义事故，哨兵推断方向合理（spec 已用「可能」限定），但**目录名清单与本 worktree 现状对不上**，且本 worktree 另有 6 个同类目录未被记录 | ⚠️ |
| A7-12 | **Step 1「从父提交还原」可行性** | 「逐个历史提交试严格 UTF-8 解码，取最后一个合法且无 U+FFFD 的版本」→ `git checkout <good-rev> -- <path>` → 重打后续真实改动 | **good-rev 确实存在，但 spec 没钉住它，且把可避免的人工风险写成了必经之路。** 实测：最后一个 good-rev = **`46b37654`（2026-09-29）**，该版本**合法 UTF-8、0 个 U+FFFD、中文完好**（第 32-36 行 `可见消息列表（SQL 层已滤 hidden）…` 正常显示）；其后仅 3 个提交（`acb4379e`/`d3b1049a`/`23e56dba`），`git diff --numstat 46b37654 HEAD` = **+90 / −22**。⇒ `git checkout 46b37654 -- <path>` + 重打 112 行即**逐字节**还原，A7.2.1 的「GBK 往返」段与 A7.7「51 个 `?` 被原样提交（中）」风险行**都可以删掉** | ❌ |
| A7-13 | Step 1 与 Step 2 的路线归属 | Step 1 标题写「类 2 的 GBK 文件（**1 个：mobile**）」；Step 2 标题写「类 1 的字面 U+FFFD 文件（**4 个可做**）」却列了 **5 个** bullet，其中 `message-body-text.test.ts` 被标「同 Step 1 的 GBK 路线」 | **两处自相矛盾**：Step 1 说只有 1 个 GBK 文件，Step 2 又把第 2 个 GBK 文件塞进「类 1 用 Edit 逐处替换」的清单里；「4 个」与 5 个 bullet 不符。实测 `message-body-text.test.ts` 的 good-rev **`d054a523`** 存在且三条用例名就是 `text only → hello` / `thinking only → empty` / `image → [image]`（⇒ 损坏字符是 `→`），与 HEAD 差异仅 **+4 / −4** 行 ⇒ 走 checkout 路线成本极低，不该混进「Edit 逐处替换」 | ❌ |
| A7-14 | 其余 class-1 文件走 Edit 逐处替换是否合理 | vfs.ts(2) / tool-definitions.ts(1) / agent-runner.test.ts(64) | 合理：实测这三个文件的**最后 good-rev 距 HEAD 太远**——`agent-runner.test.ts` 最后 good-rev `9083af16` 只有 26,884 字节 vs HEAD 54,875（重放不可行）；`vfs.ts` 最后 good-rev `5f5204ab` 8,842 字节 vs HEAD 13,701。⇒ Edit 路线是**唯一可行**选择 | ✅ |
| A7-15 | 「形态统一是 `→`/`—`/`·` 一类的分隔符」 | | 由 A7-13 的 good-rev 直接证实（`→`）；vfs/tool-definitions 形态同为 `<FFFD>?`，推断合理 | ✅ |
| A7-16 | 「不可逆片段」警告 | `:417` 的 `޵ڶ` 是不可逆片段，必须逐行人工判读补写 | `:417` 实为 `it("T-ARP-C3: abort <FFFD><FFFD><FFFD>޵ڶ<FFFD><FFFD><FFFD> model request<FFFD><FFFD>stepsExecuted===0")` —— 逐字命中。**对 agent-runner.test.ts 成立**（无近 good-rev），但若照 A7-12 改走 checkout 路线则本条不适用于 mobile 文件 | ✅ |
| A7-17 | 验收 ① 修后期望 `= 4` | 「只剩 sksp 三处 + prd.md」 | 10 − 6 = 4，算术自洽 | ✅ |
| A7-18 | 验收 ② 严格 UTF-8 校验 | 「修前 session-prompt-input / message-body-text = INVALID，其余 4 个 VALID」 | 实测**逐个吻合** | ✅ |
| A7-19 | 验收 ③ 回归 | 三条 core 测试文件 + mobile jest + `format:check` | 命令与文件都在位；`it()` 逐字相同的验证口径有 A7-9 的漏检问题 | ⚠️ |
| A7-20 | 纪律「只用 Edit、禁 PowerShell 管道」 | 引 RULE 两次实锤 | RULE:119（PS 管道毁 UTF-8 中文）、RULE:113（build.gradle 必须字节级替换）**逐字对得上**；A7 的场景确实是「文件含非 UTF-8 字节」⇒ **对 A7-14 的三个 VALID-UTF-8 文件成立，但对 A7-12/A7-13 的两个非 UTF-8 文件不成立**（Edit 工具在非 UTF-8 文件上同样会经过文本解码/重编码，风险等价于 PS 管道）⇒ 纪律应按「文件是否合法 UTF-8」分流 | ❌ |
| A7-21 | 「不得改 RUNTIME 字符串」红线 | A7 只改注释 + `it()` 标题 | 红线本身守住，但 **`it()` 标题是字符串字面量**，严格读法会禁掉 71/74 处；spec 只在 A7.4 隐含声明「本条目改的是注释与 it() 标题」，**没有显式豁免说明** ⇒ 执行者可能自我否决 | ⚠️ |
| A7-22 | 跨分片撞车声明 | 与 wave-e H1 Step 4 清单重叠，建议 H1 让位 | §A7.6 + §9.2 + §9.3 三处都写了，边界清楚 | ✅ |
| A7-23 | §8 口径修正 row 3/4 | 「session-prompt-input 178 处字面 FFFD 为 0，是 GBK 污染」 | 实测：该文件按 UTF-8 读出 **178 个 U+FFFD**（与扫描一致），而**字面 `EF BF BD` 计数为 0** —— 两者同时成立，spec 的区分正确 | ✅ |
| A7-24 | §8 口径修正 row 4 的「11 个文件」 | 字面 5 个 + 非 UTF-8 6 个 = 11 | 算术对，但**与 A7.3 扫描输出的 10 个文件**不是同一口径（11 含 `build.gradle`，它 FFFD=0 且被 SKIP 挡掉），读者容易误读为扫描会报 11 个 | ⚠️ |

**A7 小计**：✅ 11 / ⚠️ 5 / ❌ 8。

---

## 2 · 债务池抽验表

### 2.1 前置纠正：`ledger-v2.md` §3 **没有 `core-tool` 簇行**

`ledger-v2.md:193-207` 的 §3「P2 / P3（按簇计数）」只有 10 行簇：**core-runtime / core-data / core-storage / core-misc / apps-mobile / apps-desktop / cloudsync / dead-backlog / 新增（W8 测试语料面）/ 新增（W9 死代码面）**。全迭代目录内 `core-tool` 字符串只出现 3 处：`fix-spec/wave-a.md:971`（A6 的簇标签）、`ledger-v2.md:263`（§5 一致率表的 **tool 区** `domain/tool`）、`ledger-v2.md:438`（Wave A 的 A-14 行簇列）。

⇒ **原抽验指令的落点不存在**。按最贴近的口径改执行：以 §5「**tool** 区（`domain/tool`）」的三方构成 —— `raw/w1-core-tool.md`（原扫）+ `raw/w9-ds2-tool-a.md` + `raw/w9-ds2-tool-b.md` —— 为该簇债务池。`w1-core-tool.md` 的发现清单实测为 **20 条 = 4×P2（F-1/2/3/5）+ 14×P3 + 2 intentional**；后两份 ds2 报告用非表格体例书写，无独立 P2/P3 编号。

**抽验比例**：18 条 P2/P3 中抽 **5 条 = 27.8% ≥ 10%**。

### 2.2 逐条抽验（全部在 `fe79b781` 复核）

| # | 条目 | 级别 | 原始 file:line | 复核结论 | 排期状态 | verdict |
|---|---|---|---|---|---|---|
| T-1 | **F-core-tool-1** `isTaskToolUse` 零引用、整个 34 行模块是死码 | P2 | `logic/subagent-tool-session-id.ts:33` | 行号在位（`:33 export function isTaskToolUse`）。`git grep -n isTaskToolUse -- packages apps` **只命中定义自身** ⇒ 死码主张**成立**。定级 P2 合理（真死码但无害） | **已被 `fix-spec/wave-d.md:32/:105/:398-423` 的 D-116 完整承接**（选 B1-a，只删 `:29-35`） | ✅ 定级合理 · **已排期** |
| T-2 | **F-core-tool-2** `FILE_OPEN_TOOL_NAMES` 公开份零消费 + 私有同值副本 | P2 | `builtin/vfs-tools.ts:69` | 行号在位。grep 结果：公开份只有 `vfs-tools.ts:69` 定义 + `index.ts:196` 转导出 + `test/package-exports/snapshots/main-entry-allowlist.json:12` 快照；真正被用的是 `logic/vfs-tool-file-path.ts:10` 的私有副本并在 `:26` 消费 ⇒ **重复实现 + 公开面漂移成立**。（原报告写 `index.ts:195`，实测 `:196`，off-by-1） | **未排期** —— 全 `fix-spec/` 目录 grep `FILE_OPEN_TOOL_NAMES` **零命中** | ✅ 定级合理 · ⚠️ **未排期** |
| T-3 | **F-core-tool-3** A-14 两道闸恒空转；`resourceQuota` 零读取方 | P2 | `builtin/builtin-tool-context.ts:193` + `:197` | 两个字段行号**在位**。但三个装配点的 raw 行号已过期：实测 `run-agent-turn.ts:993` / `:1351`、`create-user-vfs-turn-service.ts:83`（raw 写 `:926-927`/`:1276-1277`/`:78-79`）—— 与 `wave-a.md:994-995` 的修正表一致，符合 `ledger-v2.md:508` 的行号纪律（**非新问题**） | **已被 `wave-a.md` A6.2.2 承接**（「`resourceQuota`：真删」） | ⚠️ **行号过期** · 已排期 |
| T-4 | **F-core-tool-5** `truncateToByteBudget` 与 `tool-output-limits.sliceUtf8BytePrefix` 逐行等价；UTF-8 字节口径散落 4 处 | P2 | `builtin/curl-tool.ts:192` | 行号在位（`function truncateToByteBudget`）。跨模块同算法重复的主张与代码形态吻合 | **未排期** —— `fix-spec/` grep `truncateToByteBudget` 零命中 | ✅ 定级合理 · ⚠️ **未排期** |
| T-5 | **F-core-tool-6** `tool-path-policy.ts` 五个「导出了却不出模块」的 export | P3 | `logic/tool-path-policy.ts:20` | 行号在位。`wave-a.md:980` 独立复核同一组符号（`extractInputPaths:20`/`pathStartsWithPrefix:43`/`isPathAllowed:65`/`findDisallowedPath:81`/`readAllowedPaths:104`）与本条一致 ⇒ 双源印证 | **已被 `wave-a.md` A6 承接**（A6.1 证据 (a) 逐个列出） | ✅ 双源 · 已排期 |

### 2.3 抽验结论

- **定级合理性**：5/5 成立，无一条定级虚高或虚低。P2 给「真死码 / 重复实现」，P3 给「导出面漂移」，与 `ledger-v2.md:282`「一致率不能当定级依据」的口径不冲突（T-3 未被抽到第二方，属预期）。
- **无已修条目**：5 条逐条在 `fe79b781` 实测仍在，**零条「已修」**。
- **重复风险**：**发现 1 条债务与 Wave A 条目同病灶** —— F-core-tool-3 的 `resourceQuota` 半边 = `wave-a.md` A6.2.2。若不标注，后续开单会双做。已在本表标注。
- **排期覆盖**：5 条中 **3 条已被 fix-spec 承接**（w-d D-116、w-a A6.2.2、w-a A6），**2 条（T-2 / T-4）完全未排期**。建议把 T-2 / T-4 作为 Wave D（死码）或 Wave E（导出面收口）的候补条目登记，避免债务池条目在无人认领的情况下过期。
- **行号纪律**：T-3 暴露 raw 报告（W1 时期）的行号已随 1.5.29 漂移，**任何债务池条目被复用前必须按 `ledger-v2.md:508` 重新 `git log -1` 复核行号**。

---

## 3 · must-fix 清单表

| # | 位置 | 问题 | 必须改成 | 严重度 |
|---|---|---|---|---|
| **M1** | A4.3 ① | 空库上 `session create` 先在 `apps/cli/src/config/resolve-scope.ts:29-35` 抛 `Missing --project`，**到不了** `session.service.ts:114` 的目标错误；补 `--project` 后又被 `:414-418` 的 `requireProject` 拦。spec 声称的「修前症状」与「修后期望」双双拿不到 | 脚本改为三步：`nm project create --name p` → `nm agent create --name smoke` → `nm session create --title t1`；「修前症状」必须**在有 project、无 agent 的库上**取证（即先 `project create` 再 `session create`） | **高**（验收不可执行） |
| **M2** | A4.3 ② | stdout 洁净断言**零牙齿**：② 跑在 ① 之后，6 条 schema migration 早已 applied，`[nm-boot]` 一次都不会打 ⇒ 改前改后都过。数字也错（写「两行」，`ledger-v2.md:82` 记的是「12 行」） | ② 必须换一个**全新 db 路径**（先删文件再跑），期望写成「改前 12 行 `[nm-boot] migration run/applied`，改后 0 行、stdout 恰 1 行 UUID」 | **高**（守卫无牙） |
| **M3** | A4.3 ③ + A4.5 | 判据「与 `baseline.md` 对照」不可执行：`baseline.md` §4 无 `apps/cli` 行、§3 未跑 CLI | 要么在 `baseline.md` 补一行 `apps/cli` 基线（`tsx --test test/**/*.test.ts` 的 tests/fail 实测数），要么显式写明「以 `ledger-v2.md:82` 的 26/102 为判增量基线」 | **高**（回归线不实存） |
| **M4** | A7.2.1 Step 1 | 未钉 good-rev，且把**可避免的** GBK 往返 + 51 个 `?` 人工判读写成必经之路 | 钉死 `good-rev = 46b37654`（合法 UTF-8、中文完好）、`git diff --numstat 46b37654 HEAD` = **+90 / −22**、其后 3 个提交（`acb4379e`/`d3b1049a`/`23e56dba`）；删掉 A7.2.1 的 GBK 往返段与 A7.7 中风险行 | **高**（凭空多出一个人工事故面） |
| **M5** | A7.2.1 Step 1/Step 2 | Step 1 说「类 2 的 GBK 文件（1 个：mobile）」，Step 2 又把第 2 个 GBK 文件（`message-body-text.test.ts`）塞进「类 1 用 Edit 逐处替换」清单；Step 2 标题写「4 个可做」却列 5 个 | Step 2 标题改「4 个可做」为实际数目；`message-body-text.test.ts` 移出 Step 2，单独走 `d054a523` checkout 路线（差异仅 +4/−4，三条用例名的正确形态已在该版本可查：`text only → hello` / `thinking only → empty` / `image → [image]`） | 中 |
| **M6** | A7.1 类 1 表 + A7.3 ③ | 「agent-runner.test.ts 64 处**全在 it() 标题里**」为假 —— 8 行中 **`:1133` 是 JSDoc 块注释**（9 处）；且 A7.3 ③ 的「导出 it() 用例名清单逐条 diff」覆盖不到它 | 类 1 表把 `:1133` 单列为「JSDoc 块注释」；A7.3 ③ 补一条「非标题受损行（`:1133`）单独 diff」 | 中 |
| **M7** | A7 顶部状态行 | 「其余 **5 个文件（71 处）字面 U+FFFD**」+「1 个 GBK 污染文件」与自身数据对不上 | 改为「非 sksp 的 5 个文件共 **74 处** U+FFFD，其中 `message-body-text.test.ts` 属非 UTF-8 类」；「1 个 GBK 污染文件」改「2 个」 | 低（计数类结论，RULE 要求实测） |
| **M8** | A7.1 类 2 表 | 「首个坏字节在 **index 833**」实测为 **835** | 改 835（`e5 9c 3f`；833 落在合法 `e6 96 b0` 中间） | 低（实测数字） |
| **M9** | A7.2.1 Step 3 | 纪律「一律用 Edit 工具（字节级安全）」对**两个非 UTF-8 文件不成立** —— Edit 同样经文本解码/重编码，风险等价于被禁的 PS 管道 | 纪律按「文件是否合法 UTF-8」分流：合法 UTF-8 的（vfs / tool-definitions / agent-runner / openai-mapper）用 Edit；非 UTF-8 的（session-prompt-input / message-body-text）**只允许 `git checkout <good-rev> -- <path>` + 重打**，禁止任何文本级写入 | **高**（照原文做有二次毁码风险） |
| **M10** | A4.3 / A4.4 | 引用了不存在的口径符号 `assertCreatedAgentId`（全仓零命中）；`parseAgentId` 本身就是待新增的 | 改为「参照 `apps/cli/test/helpers.ts:123-134` `parseCreatedProviderId` 的 `.at(-1)` 取尾行口径」 | 低 |
| **M11** | A7.4 / A7.6 | 「不得改 RUNTIME 字符串」红线未对 `it()` 标题作显式豁免 —— 标题是字符串字面量，严格读法会禁掉 71/74 处 | 在 A7.6 依赖里加一句：「红线指运行期注入 LLM/UI 的行为字符串；`it()` 标题与注释**不在其内**，但标题的可读部分逐字不动」 | 中 |
| **M12** | A4.2 Step 7 vs A4.4 | 「不动 `helpers.ts`」与「只新增 `parseAgentId`」字面互斥 | Step 7 改成「不改 `stripBootLogs`/`parseProviderList`/`parseSavedModelList`」 | 低 |

**must-fix 合计 12 条**：高 5 / 中 4 / 低 3。

---

## 4 · 结论

**组 C 判定：No-Go（需 doc-fix 后复审）。**

**一句话理由**：A4 的病症链与 `[nm-boot]` 修法全部经代码重推导成立、行号逐处命中，但**三条验收（①②③）当前都跑不出结果**——① 空库上 `session create` 根本到不了目标错误、② stdout 洁净断言在已迁移库上恒真、③ 所对照的 `baseline.md` 里没有 CLI 基线；A7 的分类与计数实测全部命中，但**把两个存在现成 good-rev 的文件（`session-prompt-input.service.ts` 的 `46b37654`、`message-body-text.test.ts` 的 `d054a523`）误写成必须走 GBK 往返 + 51 处人工判读**，并且「只用 Edit 工具」这条纪律在非 UTF-8 文件上恰好复制了 RULE 禁止的毁码路径；债务池 5 条抽验全部成立、无已修，但暴露 1 条与 Wave A A6 重复、2 条完全未排期。

**复审门槛**：M1–M4、M9 五条高severity 闭合后可转 Go；M5–M8、M10–M12 建议同轮一并 doc-fix（成本极低，且其中 M7/M8 属 RULE 明令「计数类结论必须实测」的硬要求）。
