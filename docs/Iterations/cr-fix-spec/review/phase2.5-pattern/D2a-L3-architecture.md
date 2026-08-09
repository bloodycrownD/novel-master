# D2a-L3：架构 & 依赖跨模块模式识别

## 元信息

- 角度：L3 架构 & 依赖
- 输入：D1-03（本角度横扫）+ 全部 6 份 D2 切片（agent-tool / chat-message / compaction / prompt / provider-llm / vfs）
- 轮次：Phase 2.5 第 1 轮
- 工作方式：只对 D1-03 已列发现 + D2 切片中新暴露的 L3 命中段做主题聚拢；不重读实现代码。`packages/core/ARCHITECTURE.md` 作为规范文档读了「Documented exceptions」段（L56-63）与「Naming」表（L52）以核对系统性结论。

---

## 结论（叙述式）

诶～叠完 6 份切片之后，L3 自己最关心的事情其实收敛成了一句话：**源码 import 层面的纪律是真稳，但围绕这套纪律的「外围合同」——规范文档、schema 校验、公共面、包描述——普遍落后于源码**。D1-03 单看以为只是「core devDep 环 + driver 全用 dependencies」两条包描述问题，切片把它放大了：D2-prompt 直接证伪了「domain → service 0 violations」（漏报 type-only 的 `PromptRenderContext → service/workplace`），D2-agent-tool / D2-prompt / D2-compaction 共同指出公共面挂着 dead schema 路径与 @deprecated alias，D2-vfs 又补了一刀「同语义代码三端各自重实现」。

四个用户指定角度叠完的结果是这样的：「documented exception 失效」按 1/6 比例算是个别（§2 一条），但补上「合法但未记录的跨 context 引用」之后，规范维护机制不闭合就成系统性了；「schema vs 运行时校验不对齐」在 agent / compaction / prompt 三个模块里都出现，根因都是「schema 与 service 是两个独立校验点、绕过 service upsert 的写入路径不走 schema」；「跨 context 引用」除了 prompt → chat 那条，D2-prompt 新暴露了 prompt → service/workplace 的 type-only 引用，全部集中在 prompt 这一个 context——prompt 是仓库里**唯一**的跨 context 引用枢纽；「driver → core 全用 dependencies」在 D1-03 已是 S 级，切片又给了一条新证据：mobile 绕过 SKSP registry 直连 `createAndroidSecretStore`（D2-provider-llm §「与三端 sksp driver 的耦合」+ L6 A-5），说明 driver 的「独立性」连 runtime 装配都从来没被独立验证过。

最值得 phase3 关注的是 **模式 3（公共面污染）**——它横跨 5 个模块、出现在两层 facade 的每一层，且每一条单看都像「B 级清理项」，但合起来构成「公共合同面（public/<ctx>.ts + 顶层 index.ts）从未做过收尾维护」的系统性信号。模式 2（schema vs runtime 不对齐）紧跟其后，因为它直接影响 db-backup import / cloud-sync pull 这类「绕过 service 写入」路径的数据正确性。模式 4（driver peer 化）严重度最高但 D1-03 已经把它说透了，本报告只补切片层面的新证据。

---

## 跨模块模式清单

### 模式 1：documented exceptions 维护机制不闭合——失效条目是个别，但「合法未记录」是系统性

- 类型：同一反模式 + god module 影响（规范文档作为「契约 hub」的失修）
- 出现模块：compaction（失效 §2）+ prompt（3 条未记录灰色引用）
- 共同特征：
  - **失效条目（1/6，个别）**：D1-03 + D2-compaction A1 共同确认 ARCHITECTURE.md「Documented exceptions」6 条 bullet 里只有第 2 条（`domain/compaction/action/default-compaction-action.ts` 可 import `infra/prompt-template` + `infra/date-format`）失效——文件在 `event-bus-compaction-conditions` 迭代里被删，但规范与 Naming 表（L52 把它当「Default impl」命名范式示例）都没同步。其余 5 条 D1-03 核对仍有效。
  - **未记录的灰色引用（系统性）**：以下跨 context 引用全部「合法但未列入 documented exceptions」：
    1. `domain/prompt/logic/normalize-for-llm-export.ts → chat/{content,model}`（value-level，D1-03 已标未记录）；
    2. `domain/prompt/logic/message-body.ts → chat/content`（re-export shim，D2-prompt A3 新暴露——L3 当时只标了直连那条，漏掉了 shim 这条平行路径，同一个 prompt 模块内「shim 存在但不强制使用」是最差状态）；
    3. `domain/prompt/model/prompt-render-context.ts` + `domain/prompt/logic/expand-dynamic-macros.ts → service/workplace`（type-only `import type { WorkplaceService }`，D2-prompt A2 新暴露——这条是 **domain → service** 方向，按 ARCHITECTURE.md 红线「domain 不得 import service」字面读已经踩线，但 L3 的运行时 import 扫描扫不到 `import type`，所以 D0-1 §2「domain → service 0 violations」是误判）。
- 各模块差异：compaction 那条是「代码先删、规范没跟」；prompt 那 3 条是「代码合理、规范从一开始就没列」——方向相反但同源。
- 系统性根因：ARCHITECTURE.md 的 documented exceptions 清单**只跟踪 value-level runtime import**，对三类变动都没有维护闭环：(a) 迭代删文件后规范没同步（compaction §2）；(b) `import type` 跨层引用（prompt → workplace）；(c) 同一引用同时存在 shim 与直连两条路径（prompt → chat）。规范维护者与代码迭代者脱钩——这恰好是 D2 切片里反复出现的「spec drift after iterations」在 L3 维度的具体形态（参见 D2-prompt A1 / D2-chat-message A2 / D2-provider-llm S2 / D2-vfs F1，那些归 L11，本模式只收 L3 直接相关的子集）。
- 严重度：**A**（单看每条都是 B，但「domain → service 漏报」直接动摇 D0-1 / D1-03「三类硬违规清零」结论的可信度，整体升 A；未到 S 因为没有真违规，只是规范盲区）。
- 建议方向：
  1. **回派 L3 单角度报告**：D1-03 §1「分层违规：未发现回归」需要补一句「本结论基于运行时 import 扫描，type-only `import type` 不在覆盖范围内；至少存在 prompt → service/workplace 一处 type-only 灰色引用」——避免后续 review 把「0 violations」当强结论读。
  2. **ARCHITECTURE.md 一次性补齐**：把上述 3 条 prompt 系灰色引用补进 documented exceptions，并在规范段加一句「type-only port 引用视同 value 引用纳入管理；shim 与直连不得并存」。
  3. **删除 §2 失效条目 + Naming 表换示例**：D1-03 open_question 3 已经问过，本报告确认这是规范侧的清理动作，不涉及代码。

### 模式 2：schema 校验 vs service/runtime 校验不对齐——绕过 service upsert 的写入路径全部失防

- 类型：同一反模式
- 出现模块：agent（tools.allow + tools.deny）+ compaction（CompactionConditionsTrigger 草稿残留）+ prompt（validatePromptBlocks 整条 flat-block 路径已死）+ chat-message（setMessageFloor spec 承诺两步、代码四步——同构问题）+ provider（BUILTIN_PROVIDER_IDS 改名不改类型）
- 共同特征：每一处都是「schema 层定义的契约 ≠ service/runtime 实际执行的契约」，并且**两层之间没有强制桥**——schema 通过 `.strict()` / `.refine()` 自闭合的部分，service 层会再校验一遍（或反过来）；schema 没自闭合的部分，service 层的校验**只在主写入路径上生效**。结果：db-backup import / cloud-sync pull / migration 直接 decode wire 入库的路径，全部跳过 service 层校验，把脏配置写进表。
- 各模块变体：
  - **agent**（D2-agent-tool A3，最严重）：`agentToolPolicyDocumentSchema` 接受 `{allow: [...], deny: [...]}` 同时存在，互斥只在 `DefaultAgentRegistryService.upsert → validateAgentDefinition` 里跑；`SqliteAgentDefinitionRepository.rowToDefinition` 只 `decode(wire, agentDefinitionSchema)`，不跑 service 校验。db import / cloud-sync pull 能写入「allow + deny 并存」的脏配置，运行时 `resolveAgentToolRegistry` 优先 allow 直接 ignore deny——用户以为禁掉的工具实际可用。这是「schema 不闭合 + service 校验不传染到读路径」的双重失效。
  - **compaction**（D2-compaction A2）：`CompactionConditionsTrigger` 子接口在 model 文件里定义但无任何引用——`CompactionConditions` 主接口把字段重复声明了一遍。schema 草稿期与定稿期的差异在代码里看不出痕迹，外部读 model 的人分不清哪个才是权威定义。
  - **prompt**（D2-prompt A1 + 债务清单）：`validatePromptBlocks` / `validatePromptBlocksFromMap` / `PromptBlock` 整条 flat-block 遗留路径已无生产引用（只剩测试自己），但仍挂在 `public/prompt.ts` 公共面。`prompt-llm-input-parity` spec 的「单 chat 块」约束在 flat-block 路径里实现，新 `AgentPromptLayout` 路径里隐式成立、不校验——同一个不变式在两条路径里执行策略不同。
  - **chat-message**（D2-chat-message A1 + S2，同构但根因不同）：`setMessageFloorAtMessage` 的 spec Core API 只承诺两步（hide/show），代码实际做四步（多两条 `sessionKkv.clearDomain` + `tokenCache.invalidate`）。这是「公共契约文档落后于代码」而非「schema vs runtime」，但形状同构——**外部按 spec 写的消费者会以为函数是原子的两步，实际四步无事务**。
  - **provider**（D2-provider-llm B1）：`BUILTIN_PROVIDER_IDS` 从「UUID 列表」改成「builtin_key 列表」，名字保留、类型仍是 `readonly string[]`，编译器不拦——「改名不改类型」陷阱，与 schema vs runtime 同构（编译期契约 vs 运行期语义）。
- 系统性根因：仓库**没有「schema 是单一校验真源」的纪律**。zod schema 被当成「wire 反序列化用」的纯解析器，业务约束（互斥、必填组合、字段语义）散落在 service 层；同时 service 层的校验又**不传染到所有写入入口**——`SqliteXxxRepository.rowToDefinition` 这类从 DB 反序列化的路径只过 schema、不过 service。db-backup / cloud-sync / migration 是天然绕过 service 的入口，schema 不闭合 = 这些入口的脏数据阈值。deprecated alias「改名不改类型」是同源的编译期版本——TS 类型系统本可作为校验点，但被「readonly string[]」绕过。
- 严重度：**A**（agent 那条直接导致 deny 失效、用户感知的工具禁用不工作，且影响 db import / cloud-sync 这类真实路径；其余 4 处单看都是 B，但 5 个模块出现同构问题升 A）。
- 建议方向：
  1. **schema 自闭合优先**：业务约束（如 allow/deny 互斥）放进 zod `.refine`，而不是 service 层 `if`——这是最小改动且覆盖所有 decode 路径。
  2. **repository rowToDefinition 强制走 validate**：对配置类实体（agent_definition / compaction_conditions / provider 这类「用户可写、跨设备同步」的数据），让 `rowToDefinition` 在 decode 之后强制跑一次 service-level validate，把校验闭环钉在 DB 读路径上。
  3. **deprecated alias 改类型**：`BUILTIN_PROVIDER_IDS: readonly BuiltinKey[]` 让旧用法编译失败，逼调用方显式选 key 域或 UUID 域。
  4. **public 面的 dead schema 路径直接撤**：`validatePromptBlocks` 家族、`CompactionConditionsTrigger` 子接口、`estimateTokens`（见模式 3）。
  5. **回派 D2-chat-message A1**：spec 同步是 L11 整改批次，但「spec 与代码步数不一致」要纳入「公共面契约文档收尾」同批做。

### 模式 3：公共合同面（public/<ctx>.ts + 顶层 index.ts）从未做过收尾维护

- 类型：同一反模式（跨 5 模块）
- 出现模块：chat（`public/chat.ts` 377 行过宽）+ compaction（`estimateTokens` 死路径仍挂 public）+ prompt（`validatePromptBlocks` 家族仍挂 public）+ provider（`public/provider.ts` 把 `infra/tokenizer` 整个子系统 re-export）+ vfs（`releaseAndDeleteVfsPrefix` @deprecated 仍被同模块消费）+ agent-tool（顶层 `index.ts` + `public/agent.ts` re-export 一堆 @deprecated alias）
- 共同特征：两层 facade（顶层 `src/index.ts` 暴露基础设施 + 13 个 `public/<ctx>.ts` 分语境 barrel）的设计本身是 D1-03 确认的健康方向，但**导出之后没有人维护**——迭代完成后旧名、@deprecated alias、dead schema 路径、跨子系统 re-export 全部留在公共面，理由都是「为了兼容」。但 core 包版本仍是 0.0.0（D2-provider-llm L8 命中），**没有任何外部消费者真依赖这些 alias**——兼容理由不成立。
- 各模块变体：
  - **顶层 `src/index.ts`**（D2-agent-tool B2）：re-export `MUTATING_VFS_TOOL_NAMES` / `isMutatingVfsToolName` / `registerVfsTools` / `VfsToolContext` 四个 tool V1→V2 alias + `domain/tool/*` 唯一直通 domain 的例外；`tool-system-v2` PRD L161 明确写「破坏性变更，旧名**不保留别名**」，但 alias 至今挂顶层 export，影响面比 D1-03 / L9 描述的「apps + core test」更宽——任何走 `@novel-master/core` 主入口的第三方消费方都能拿到。
  - **`public/agent.ts`**（D2-agent-tool B2）：re-export `resolveApplicationModelId` 家族 4 个 deprecated alias（已被 `resolveSavedModelId` 取代）。
  - **`public/chat.ts`**（D1-03 §5 + D2-chat-message）：377 行，暴露 composer / annotate / user-vfs-turn / user-ops-log 等大量实现细节，文件中段还留着「净 diff 模块已退出 public；文件保留并标 @deprecated，仅供过渡期单测直接相对路径引用」的过渡注释——过渡期已过但没收尾。L8 主判这条。
  - **`public/compaction.ts`**（D2-compaction S1）：`estimateTokens` 旧启发式路径仍挂 public 导出，v3 之后生产路径走 `resolveCurrentPromptTokens`，`estimateTokens` 在 src 下零生产引用，外部从公共面看进来会误以为是「官方 token 估计算法」。
  - **`public/prompt.ts`**（D2-prompt 债务清单）：`validatePromptBlocks` / `PromptBlock` 整套 flat-block 遗留路径已无生产引用，仍挂公共面。
  - **`public/provider.ts`**（D2-provider-llm B2）：L125-159 一整段 35 个 tokenizer 符号 re-export，把 `infra/tokenizer` 整个独立子系统（747 行 / 16 文件）塞进 provider 公共面——同时 `public/compaction.ts` 也独立暴露 tokenizer，tokenizer 在多个 public face 重复出口。
  - **vfs**（D2-vfs B2）：`releaseAndDeleteVfsPrefix` 标 `@deprecated` 但 `vfs-zip-io.service.ts:182` 等 4 处同模块内部仍在消费——「deprecated = 准备删除」的语义被自家调用破坏。
- 系统性根因：两层 facade 设计里**只有「add export」的路径，没有「review & withdraw export」的路径**。迭代完成后旧 API 留在公共面是默认行为，撤 export 反而需要主动动作。叠 core 仍是 0.0.0——「兼容」的理由其实是空的。同时 tokenizer 这类跨子系统 re-export 反映**公共面切分与 bounded context 切分不对齐**——tokenizer 在架构上是独立 infra capability，但 public face 把它当 provider 的附属品。
- 严重度：**A**（横跨 5 个模块的公共合同面污染；每条单看是 B，但合起来构成「公共 API 信誉」的系统性问题——core 想做稳定发布就必须先把这批 dead alias 撤掉，否则版本号永远只能停在 0.0.0）。
- 建议方向：
  1. **一次性 cleanup 批次**：把所有 @deprecated alias + dead schema 路径（D2-agent-tool B2 列的 5 处 + estimateTokens + validatePromptBlocks 家族 + CompactionConditionsTrigger）打包成一个独立的整改迭代，因为它们之间没有耦合、可以一起删。
  2. **tokenizer 独立 subpath**：给 tokenizer 开 `@novel-master/core/tokenizer`，撤掉 `public/provider.ts` 的 35 个 re-export；compaction 那边也改成走独立 subpath。
  3. **`public/chat.ts` 瘦身交给 L8**：D1-03 已交代，本报告只确认它属于这个模式。
  4. **补一条 ARCHITECTURE.md 规范**：「public/<ctx>.ts 不得 re-export @deprecated alias；@deprecated 标注的同模块内部消费视为未 deprecated」——把隐性纪律写成规则。

### 模式 4：driver → core 全用 dependencies 而非 peerDependencies——7 包系统性偏差，切片补新证据

- 类型：同一反模式（D1-03 已立 S 级，本报告只补切片层面的新证据）
- 出现模块：tdbc-driver-better-sqlite3 + tdbc-driver-rn + tokenizer-driver-node + tokenizer-driver-rn + sksp-android + sksp-mac + sksp-windows + cloud-sync-driver-s3（共 8 个包，D1-03 表列 7 个 + tdbc-conformance 弱环）
- 共同特征：D1-03 已详述——7 个可插拔 driver / sksp / cloud-sync 包全部把 `@novel-master/core` 放进 `dependencies` 而非 `peerDependencies`；其中 tdbc-driver-better-sqlite3 与 tokenizer-driver-node 又反向被 core 列入 devDep，构成两条 devDep 形态的事实环。
- 切片新证据（D1-03 没看到的）：
  - **mobile 绕过 SKSP registry 直连 driver**（D2-provider-llm §元信息 + L6 A-5）：`apps/mobile` 不走 `@novel-master/core/sksp` 的 registry 注册流程，直接 import `createAndroidSecretStore` 自己装配。这等于说 driver 的「可插拔」契约连 runtime 装配都没遵守——driver 在 mobile 端是被硬编码直连的，与 peer 化的初衷（宿主装哪份 core 就用哪份）完全脱节。
  - **mobile lazy init evaluator + 测试 stub undefined**（D2-compaction §模块画像 + §与其他模块的耦合点）：mobile 因为 tokenizer bundle 重做了 lazy init，集成测试里把 evaluator stub 成 undefined——意味着 mobile 端的 driver 装配连测试都不覆盖。这与上条共同说明：driver 的独立性**从未被独立安装或独立测试验证过**，workspace link 一直在掩盖双重安装风险。
  - **三端 vfs-zip 校验深度不同 + core 不兜底**（D2-vfs S2）：CLI 不校验 / Desktop 查 PK 魔数 / Mobile 扫 EOCD，core 的 `vfs-zip-validate.ts` 是 import 路径校验、救不了 export 预检。这是「三端各自维护同语义代码」的典型——与 driver 三端分裂（tdbc-driver-better-sqlite3 vs tdbc-driver-rn、tokenizer-driver-node vs tokenizer-driver-rn、sksp-windows/mac/android 三包）是同源现象：**monorepo 把 driver 当独立包发布，但实际开发用 workspace link，每个端各自演化、各自的实现细节从未回头合并**。
- 系统性根因：D1-03 已点明——monorepo + workspace link 把「双重安装」的真实风险盖住了，所以 driver 全用 dependencies 一直没暴露问题。切片补的根因是：**driver 的「可插拔」只是包描述层的宣称，runtime 装配（mobile 直连）、测试覆盖（mobile stub undefined）、跨端实现一致性（vfs-zip 校验三端不同）都没按可插拔设计走**。换言之 driver 现在既不是真独立（mobile 直连），也不是真 peer（dependencies），处于「描述上是可插拔、实际是硬编码、各自演化」的混乱中间态。
- 严重度：**S**（保持 D1-03 判定；切片证据只升不降，因为暴露面比 D1-03 写时更宽）。
- 建议方向：D1-03 open_question 4-5 已经给过整改方向（driver 改 peer + core devDep 解环）。本报告补一条：**peer 化整改同时要核对 mobile/desktop 的 driver 装配路径**——如果 mobile 真要绕过 registry 直连，这条偏离要么写进规范（「mobile 因 bundle 限制允许直连」），要么修回 registry 注册；不能停留在「描述说可插拔、mobile 自己硬连」的隐性偏离。同时三端 vfs-zip 校验、三端 SKSP `get()` 行为差异（L6 A-6 Android 漏 version）应作为「driver peer 化」整改的验收项——peer 化后这些差异必须显式 documented 或合并。

### 模式 5：type-only 跨 context 引用逃过 L3 运行时扫描——L3 方法论盲区

- 类型：模块间不一致（L3 扫描方法 vs ARCHITECTURE.md 规范字面）
- 出现模块：prompt（→ service/workplace）+（潜在的）其他未被切片覆盖的 domain context
- 共同特征：D1-03 §1「分层违规：未发现回归」的判定基于「随机抽查 `domain/**` 下没有 `from '...service...'`」——这条扫描对 value-level import 有效，但对 `import type { WorkplaceService } from "@/service/workplace/workplace.port.js"` 完全无效。D2-prompt A2 暴露的就是这样一处：`PromptRenderContext`（domain 层）的字段类型声明 `workplace?: WorkplaceService`，`expandDynamicMacros` 函数签名也接 `WorkplaceService`——按 ARCHITECTURE.md 红线「domain 不得 import service」字面读已经踩线（规范无 type/value 之分），但 L3 扫描扫不到。
- 系统性根因：L3 的扫描方法（grep `from '...service...'`）与 ARCHITECTURE.md 的规范字面（无 type/value 之分）不对齐。`import type` 在 TS 编译期擦除，不会真把 service 拉进 domain bundle，所以**架构上**比 value-level 反向依赖温和；但规范没说「type-only 允许」，扫描也没覆盖——两边都不闭合。
- 严重度：**B**（单点发现 + 方法论盲区；不影响运行时 bundle，但影响 L3 报告可信度）。
- 建议方向：
  1. **回派 L3 扫描**：D1-03 应当补一条覆盖说明，明确「0 violations」仅适用于 value-level runtime import；并附 grep `import type.*from.*service` 在 `domain/**` 下的扫描结果作为补充。本报告不自己跑这个 grep（按指导边界，标 `待回派`）。
  2. **ARCHITECTURE.md 明确 type-only 引用归档**：参考模式 1 的建议——type-only port 引用应纳入 documented exceptions 管理，而不是无差别按红线判。

### 模式 6：跨 context 引用全部集中在 prompt——prompt 是仓库唯一的跨 context 引用枢纽

- 类型：god module 影响（不是「引用次数高」，而是「跨 context 耦合的唯一出口」）
- 出现模块：prompt（被 D2-prompt 与 D1-03 共同确认）
- 共同特征：把 D1-03 + 6 份切片里所有「跨 bounded context 引用」叠加，**全部指向或来自 prompt**：
  - prompt → chat（value-level，normalize-for-llm-export 直连 + message-body shim 双路径）；
  - prompt → service/workplace（type-only，PromptRenderContext + expandDynamicMacros）；
  - prompt → domain/vfs（type-only 死字段 `PromptRenderContext.vfs`，agent-runner 仍往里塞值，D2-prompt B2）；
  - prompt → domain/depth + regex（`applyRegexChannelForLlm` 物理位置在 service/prompt 但语义属 depth/regex，D2-prompt §「与其他模块的耦合点」）；
  - service/prompt 与 service/workplace 的运行期依赖（`expandDynamicMacros` 调 `workplace.renderFileTree()`，D2-prompt §模块画像）。
- 各方向差异：prompt → chat 是「prompt 必须读 chat message 结构才能组装 LLM export」（语义合理）；prompt → workplace 是「prompt 需要文件树前缀」（语义合理但绕过了 vfs —— `vfs` 字段退役、改读 workplace）；prompt → vfs 是「死字段」（注释自承不再读取）；prompt → depth/regex 是「文件位置错放」（语义不属 prompt）。每一处的方向都「合理」或「可解释」，但全部集中在 prompt 一个 context——prompt 是仓库里**唯一**承担跨 context 耦合的模块。
- 系统性根因：prompt 的职责定义本身就是「把 chat 历史 + workplace 文件树 + dynamic 宏 + depth 切片拼成 LLM 输入」——它天然是「组装器」，组装器必须读所有上游 context。这不是设计缺陷，而是职责使然。但仓库**没有把这个事实显式化**——prompt 在 ARCHITECTURE.md 里被当成普通 domain context，没有「跨 context 组装器」的特殊地位，所以它的每条跨 context 引用都得走「合法但未记录」的灰色路径（见模式 1）。
- 严重度：**B**（跨 context 引用集中在 prompt 本身是合理的；问题在于规范没把这个事实写明，导致每条引用都得单独判灰色）。
- 建议方向：
  1. **ARCHITECTURE.md 加一条「组装器 context」例外**：明确 prompt（以及未来可能的同类组装器）允许 type/value 跨 context 引用 chat / workplace / depth / regex，但要求每条引用都在规范里登记（参考模式 1 的补齐动作）。
  2. **prompt 内部 shim 收编或撤掉**：D2-prompt A3 给的整改方向——要么所有 chat 引用统一走 message-body shim，要么撤掉 shim 全部直连；当前「shim 存在但不强制使用」是最差状态。

---

## 给 Phase 3 的线索

- **模式 1（documented exceptions）vs 模式 5（type-only 扫描盲区）** 是同一类问题的两个面——都涉及 L3 扫描方法与 ARCHITECTURE.md 规范字面的不对齐。phase3 应把这两条合并裁决：要么改规范（允许 type-only），要么改扫描（grep 补 `import type`）。这条裁决会影响「domain → service 0 violations」结论是否需要更正，可能与 L1（数据模型）的报告产生冲突——L1 报告里如果有基于「0 violations」做的下游判断，需要回溯。
- **模式 2（schema vs runtime 不对齐）** 与 **L4 错误处理** 高度相关——「绕过 service upsert 的写入路径」与 L4 标的「跨 store 多步无事务」是同一类「主路径有保护、旁路无保护」的反模式。phase3 应拉 L4 一起裁决：是不是要立一条「所有写入入口都必须过 service-level validate」的硬规则。
- **模式 3（公共面污染）** 主判归 **L8 API 稳定性**——L8 判每条 export 的真实使用面。但 L3 这边的独立性贡献是：**这批 dead alias 即使 L8 判「无外部消费者」也必须撤**，因为 core 还在 0.0.0、不存在兼容义务。phase3 不要把这条降级成「L8 排期清理」——它是发布 blocker。
- **模式 4（driver peer 化）** 与 **L6 跨端** + **L10 工程化基建** 三方交叉。L6 主判三端实现差异（vfs-zip 校验、SKSP `get()` 漏 version、tokenizer 公式分叉），L10 主判 install 行为与 CI 拓扑，L3 主判包描述语义。phase3 应把这条作为「L3 + L6 + L10 联合裁决」的典型——driver peer 化整改同时是 L6 三端对齐的契机。
- **模式 6（prompt 跨 context 枢纽）** 与 **L1 数据模型** 交叉——L1 验证 prompt 是否真的需要理解 chat message 内部结构（D1-03 待交叉线索已列）。phase3 决定 prompt 的「组装器」特殊地位是否要在规范里确立。
- **回派项**（L3 单角度报告需要补的）：
  1. D1-03 §1 补「type-only 扫描盲区」说明；
  2. D1-03 §2 补 prompt → chat 的 shim 路径（A3）；
  3. D1-03 §4 补「documented exceptions 维护机制不闭合」系统性结论（不再只是「§2 失效」个别条目）；
  4. D1-03 open_question 4（driver peer 化）补 mobile 绕过 registry 直连的证据。

---

## 覆盖声明

**查了**（作为本跨模块报告的输入）：
- D1-03 全文（本角度横扫报告）逐段读，特别核对 §1 / §2 / §4 / §5 与 open_questions。
- 全部 6 份 D2 切片全文：D2-agent-tool（137 行）/ D2-chat-message（178 行）/ D2-compaction（97 行）/ D2-prompt（125 行）/ D2-provider-llm（128 行）/ D2-vfs（180 行）。重点是每份切片的「交叉发现」「债务清单」「与其他模块的耦合点」三段。
- `packages/core/ARCHITECTURE.md` L50-95 段（Documented exceptions 全文 + Naming 表 + Service/Infra 模板开头），用于核对模式 1 的「失效条目数」与规范字面表述。
- Phase 0 code map 目录（`docs/review/phase0/`）与 phase2.5-pattern 目录（确认输出目录存在但为空）。

**没查**（按指导边界）：
- 任何实现代码（`.ts` 源文件）——指导明确「不读实现代码，D1/D2 里需要核实的结论标待回派」。本报告里所有需要核实源码的点（如 `import type` 在 `domain/prompt` 的完整分布、`BUILTIN_PROVIDER_IDS` 在 apps 的真实使用、driver 装配路径）都标了「回派 L3」或「phase3 / L6」。
- 其他角度的 D1 报告（L1 / L2 / L4 / L5 / L6 / L7 / L8 / L9 / L10 / L11）——指导明确「不和其他角度对比，那是 phase3 的事」。本报告在「给 Phase 3 的线索」段提到与 L1 / L4 / L6 / L8 / L10 / L11 的交叉点，但只基于 D2 切片里引用的 D1 段落，不直接读其他 D1 报告。
- D0-1 / D0-2 完整内容——只读了目录确认存在；本报告对 god module 引用次数、摇摆度的引用全部来自 D1-03 §必查两张表与 D2 切片的二次引用，没去 D0-1 原文复核。

**未宣布**：本报告不宣布 ready，不提议合入，只产出 readonly 跨模块发现。所有建议方向需 phase3 / 主代理收敛。
