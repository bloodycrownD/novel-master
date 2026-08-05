# D2a-L11：文档与代码漂移跨模块模式识别

## 元信息

- 角度：L11 文档与代码漂移
- 输入：D1-11 + 全部 6 份 D2 切片（compaction / agent-tool / prompt / provider-llm / chat-message / vfs）
- 轮次：Phase 2.5 第 1 轮

---

## 结论

诶～这个角度的跨模块叠图，可以说是 L11 的大年——6 份切片几乎每一份都往「文档漂移」这口锅里添了料，叠起来之后，「PRD 定稿但被推翻且无 supersede 注记」已经不再是单模块的偶发失误，而是一条贯穿 agent-tool / chat-message / vfs / compaction 四个模块的系统性迭代管理缺陷。仓库源码纪律很强（L3 已经确认），但**迭代落档纪律明显跟不上代码演进的速度**：每一次架构收口都在代码里留下了痕迹，却没人回头给历史 PRD/spec 加一道 supersede 标注，导致任何后来者按 PRD 反推现状都会扑空。

第二圈模式是「spec 描述的能力已被移除但文档未更新」——和第一圈方向相反但同源：第一圈是 PRD 说要做但代码没做（或反悔了），这一圈是 spec 写的是 v1 时代的能力，代码已经迭代到 v3，spec 还停在旧语气。compaction 的 `estimateTokens`、prompt-engine spec L201 的 `index.ts` 导出、vfs-zip-native-compression 的 native ZIP 实现，都属于这种「文档滞后于代码演进」的同质漂移。第三圈是「文档承诺的脚本/包/路径不存在」，集中在 `docs/monorepo.md`、`packages/core/ARCHITECTURE.md` 的 documented exceptions 表、`examples/` 这三个高人流入口，对新人伤害最直接。

最需要 phase3 特别标注的是第四圈——**spec vs 实现的安全语义反向漂移**。provider 模块的 SKSP env 覆盖层只有这一处命中，但它的危害结构很特别：当前代码比 spec 更安全（把空串/纯空白 env 视为未命中），spec 反而是不安全的那一版。如果未来有人按 spec 字面把代码「修回」，会主动撕开一道信任面漏洞。这种「按文档改回会更不安全」的模式和前三圈「按文档改只是扑空」完全不同，必须单独标出来。整体严重度建议把模式 1/2 定 S（3+ 核心模块 + 架构层缺失），模式 3 定 A，模式 4 定 A 但附「反向危险」警示。

---

## 跨模块模式清单

### 模式 1：PRD/spec 定稿方案被后续代码推翻，无 supersede 注记

- 类型：同一反模式多处出现
- 出现模块：agent-tool（3 处）、chat-message、vfs、compaction（ARCHITECTURE.md 镜像）
- 共同特征：迭代 A 把方案定稿写入 PRD/spec，迭代 B 把方案整体推翻（字段移除、工具废弃、流程重写），但迭代 B 既没在自己的 PRD 里写「取代了 A」，也没回头给 A 加 supersede 注记。结果就是同一份定稿文档里，A 仍以「当前事实」语气存在，B 在另一份文档里以「当前事实」语气存在，两份都自称真相——按 A 反推代码会全错。
- 各模块差异：
  - **agent-tool S1（chat_grep）**：`tool-system-v2` PRD 把 `chat_grep` 列为「内置工具从 10 减至 7」的第 7 个必备工具，还配了 §5 整节描述和 3 条 Given/When/Then 验收。当前代码 `chat-grep-tool.ts:1` 标 `@deprecated`、`register-builtin-tools.ts:18` 注释「不再注册」、`FILE_TOOL_NAMES` 只有 6 项。**没有任何列举的迭代 PRD 提到要废掉 chat_grep**。
  - **agent-tool S2（prompts 形态）**：`agent-prompt-abstract-block` PRD 把 `type: abstract` 块当核心交付（L21/L65/L142-146），代码 grep `type.*abstract` / `abstractPromptBlockSchema` 全零命中；`agent-config-shape` PRD 把 `prompts.blocks` map 当核心交付（L25），代码 `agent-definition.schema.ts:41-46` 的 `rejectLegacyPromptKeys` 直接拒绝 `blocks` 键。**两份 PRD 的定稿方案都被推翻，推翻它们的迭代不在列举清单里**——主体形状 `system/persist/dynamic` 的来源只能推测到 `agent-prompt-save-and-vfs-ua-bugfix` 或某次 trunk 直接提交。
  - **chat-message A2 / D2-CM-C2（rollback 整体架空）**：`message-rollback-remove-session-log/spec.md` 描述的是 `session_execute_batch` + `session_execute_checkpoint` + `session_vfs_snapshot` 旧表上的 rollback 流程，现网 `bootstrap/session-fs/session-fs-schema.ts` 已是空数组（注释「legacy tables removed in message-checkpoint v2」），回滚走的是 `message-rollback-execution-redesign` 的全新 `rollbackToMessage` 路径。**spec 没有任何「已被取代」标注**，仍可被 reviewer 当功能基准误用。
  - **vfs F1（repairRefCounts 调度）**：`vfs-version-redesign` PRD §8 白纸黑字「`repairRefCounts` 补空闲调度钩子，在 bootstrap 完成后**或 session 切换时**跑一次」。spec.md（Step 15）已经把这条收窄到「新 migration 跑完后条件触发」，代码只兑现 spec 那部分。**PRD 没同步收窄**，PRD 比 spec 更激进，而且 migration runner 是 id-based 幂等的，第二次启动直接跳过——生产路径里 `repairRefCounts` 实际上只跑一次就再也不会跑。这是「PRD 与 spec 自我矛盾 + spec 与代码不闭合」的复合变体。
  - **compaction ARCHITECTURE.md §2（架构规范的 supersede 缺失）**：`packages/core/ARCHITECTURE.md` L59 documented exception 把 `domain/compaction/action/default-compaction-action.ts` 列为合法例外，但该文件已在 `event-bus-compaction-conditions` 迭代里被明确删除（spec L378 变更点第 10 项）。Naming 表 L54 还拿这个死路径当「Default impl」命名范式示例。这是 PRD/spec 漂移扩散到架构规范文档的镜像——规范层也没建立 supersede 机制。
- 系统性根因：**仓库缺少迭代之间的「取代关系」元数据**。Iteration 是按目录平铺的，目录名之间没有 `supersedes:` / `superseded-by:` 字段，PRD/spec 头部也没有标准化的 supersede 注记模板。结果就是当迭代 B 推翻迭代 A 时，唯一的留痕方式是「在 B 里提一句」，但没人强制这么做；A 自己永远以「当前事实」语气留着。这是迭代管理的系统性缺陷，不是单个 PRD 作者的疏忽——单点修补（给每个被推翻的 PRD 加注记）治标，建立 supersede 元数据字段（比如 Iterations 根目录一份 `iterations.yaml` 列 `supersede_chain`）才治本。
- 严重度：**S**——同一反模式在 4 个核心模块（agent-tool / chat-message / vfs / compaction）共 5+ 处出现，且根因是迭代管理机制缺失（架构层）。
- 建议方向：phase3 之前不修代码，但建议在 fix-spec 阶段建立两件事——(a) 给 Iterations 目录补一份 `index.yaml`（或每份 PRD 头部加一段 `supersede:`），把所有已知的取代关系列清楚；(b) 给被推翻的 PRD/spec 统一在文件头加 `> ⚠️ 本迭代已被 <X> 整体撤销，保留作历史记录` 标注。短期至少要把模式 1 里命中的 5 份文档（`tool-system-v2/prd.md`、`agent-prompt-abstract-block/prd.md`、`agent-config-shape/prd.md`、`message-rollback-remove-session-log/spec.md`、`vfs-version-redesign/prd.md`）的 supersede 状态先标清楚。

### 模式 2：spec/PRD 描述的能力已被移除或迁移，文档未更新

- 类型：同一反模式多处出现
- 出现模块：compaction、prompt（2 处）、vfs
- 共同特征：spec/PRD 以「当前实现」的语气描述某个能力（函数、导出、子系统），但代码侧该能力已经被迁移到别处、降级为内部、或整体删除。文档没追加「已迁移/已撤销」标注，读者按 spec 反推代码会被误导。
- 各模块差异：
  - **compaction S1（estimateTokens）**：`public/compaction.ts:24` 仍对外导出 `estimateTokens`（走 `HeuristicTokenCounter`，字符数 ÷ 3.35），但 v3 之后生产判定路径已切到 `resolveCurrentPromptTokens`（按 savedModelId 解析精确 tokenizer）。src 下 `estimateTokens` 零生产引用，唯一引用方是 `heuristic-token-counter.test.ts` 顺带断言。外部从公共面看进来会以为「这是 compaction 用来估 token 的官方函数」，实际生产根本不走它。这是 spec 描述已撤销能力的镜像——公共面承诺没收回。
  - **prompt-engine spec L201（index.ts 导出）**：spec 写「`index.ts` 导出 prompt API」，但当前 `src/index.ts` 全文 191 行零 prompt 导出，公共面走 `src/public/prompt.ts` 子路径。这是 `core-package-structure` 迭代（晚于 prompt-engine）重新定型两层 facade 的结果，spec 没同步更新。
  - **prompt flat-block 路径（validatePromptBlocks / PromptBlock）**：整套遗留 flat PromptBlock 路径已无生产引用（`prompt-llm-input-parity` 的「单 chat 块约束」事实上已经是死规则，因为新 `AgentPromptLayout` 路径里 chat 是运行时槽位），但仍挂在 `public/prompt.ts` 公共面。spec 仍以「活跃约束」语气描述这条路径。
  - **vfs-zip-native-compression/spec.md（native ZIP 打包）**：spec 详细描述「Core 增加可插拔 buildZip 注入」「Mobile 用原生 ZIP 替代 fflate」的实现步骤，但该能力已被 `remove-mobile-vfs-zip-native` 完整撤销（fflate STORE 为唯一实现，注入点删除）。spec 头部没有「已撤销」标注。
- 系统性根因：和模式 1 是同一根因的两面——**没有「文档健康度」的回归机制**。代码侧有 knip / 类型检查 / 测试三道防线能发现死代码，但文档侧没有任何 lint 能告诉你「这个 spec 描述的函数已经没人调了」「这个导出已经不是主路径了」。叠加公共面导出列表（`public/*.ts`）和 spec 之间没有同步机制——一旦迁移完成，spec 永远落后一拍。compaction S1 还暴露一个更细的根因：**公共面没有「deprecate before remove」的纪律**，`estimateTokens` 这种已不生产的符号仍挂在 export 上，外部消费方完全感知不到它已经退役。
- 严重度：**S**——同一反模式在 3 个核心模块（compaction / prompt / vfs）共 4 处出现，且每一处都会反向污染 L1/L2/L6 等其他角度（按 spec 推断当前实现会全错）。
- 建议方向：建立两件事——(a) 给公共面 export 加 `@deprecated` 纪律（结合 L9 整改批次），让 `estimateTokens` / flat-block 路径 / `releaseAndDeleteVfsPrefix`（vfs B2）/ `BUILTIN_PROVIDER_IDS`（provider B1）/ `resolveApplicationModelId` 家族（agent-tool B2）这一批已退役符号至少在公共面声明退役；(b) 给 spec 文档建立一次性的「核对当前实现」清扫，至少把模式 2 命中的 4 份 spec（compaction 相关 PRD 的 estimateTokens 段、`prompt-engine/spec.md:201`、`prompt-llm-input-parity` 的单 chat 块段、`vfs-zip-native-compression/spec.md`）头部加撤销标注或正文改写。

### 模式 3：文档承诺的脚本/包/路径/示例不存在或已失效

- 类型：同一反模式多处出现
- 出现模块：横跨 monorepo（D1-11 集中点）+ ARCHITECTURE.md（compaction/prompt 双重命中）+ examples/（D1-11 集中点）
- 共同特征：文档以「存在」语气引用某个脚本、workspace、export 路径、示例文件、内部链接，但代码侧这些资源不存在或已迁移。这一类和模式 1/2 的区别在于——它不是「迭代 A vs 迭代 B」的语义推翻，而是「文档与代码事实直接脱节」，往往是机械性的目录迁移、脚本删除、schema 升级没回填文档。
- 各模块差异：
  - **monorepo.md 系统性失真（D1-11 A 级）**：`vfs:watch/push/pull/sync` 四个脚本根 `package.json` 全部不存在；`scripts/vfs-test-sync` 包不存在；`./front-matter` export 不存在；布局表少列 `apps/desktop` 等 8 个真实 workspace、多列虚构的 `scripts/vfs-test-sync`；exports 清单写 5 条而实际 24 条。这是「按文档跑命令立刻报错」级别的硬漂移，伤害最直接。
  - **ARCHITECTURE.md documented exception §2 失效（compaction A1 + L3）**：`domain/compaction/action/default-compaction-action.ts` 文件不存在（目录整体改名 `compaction-conditions/`），规范却把它列为合法例外，Naming 表还拿它当命名范式示例。这条在模式 1 已经从「supersede 缺失」角度提过，这里从「承诺的路径不存在」角度再叠一次——同一处漂移命中两个模式，说明它不是单维度问题。
  - **examples/ 陈年幻影（D1-11 A 级）**：`examples/README.md` 自称「纯 HTML/CSS/JS UI 原型」、功能对比表把 provider/compaction/regex 标「🔄 待实现」，但实际产品已用 RN + Electron 实现，三块功能在 core 中均有 schema 与 service。`examples/events.yaml` 写 `schemaVersion: 1` + `{ mode, actions: [{ type, params }] }`，当前 `events-config.schema.ts` 是 strict + `z.literal(2)` + 单键 action 节点——**直接喂给 parser 必然抛错**。`agents.yaml` 和 `compaction-conditions.yaml` 对得上 schema，没漂移。
  - **内部链接批量指向已移除的 `.apm/kb/docs/`（D1-11 B 级）**：`README.md:99`、`packages/core/ARCHITECTURE.md:3-4`、`docs/monorepo.md:77-80` 都把迭代/monorepo 文档路径写成 `.apm/kb/docs/...`，而 `.apm/` 已从 git 跟踪移除，新 clone 上这些链接全是死链，实际文件现在 `docs/...`。
- 系统性根因：**文档与代码之间没有任何机械性的一致性校验**。脚本表、exports 清单、workspace 列表、example yaml schema——这些都是结构化数据，理论上可以由 CI 跑一段脚本自动核对（`jq` 对比 `package.json` 的 scripts 与 README 里的脚本表；`zod.parse` 跑一遍 `examples/*.yaml`；链接检查器扫一遍 `.apm/` 死链）。但仓库没有这套校验，文档完全靠人工维护，每次代码演进漏改一两处就成了必然。examples/events.yaml 这条尤其典型——schema 已经 strict + literal(2)，但 yaml 还停在 v1，说明从 schema 升级到 example 更新之间没有任何强制联动。
- 严重度：**A**——集中在 monorepo.md / ARCHITECTURE.md / examples/ 三个高人流入口，伤害直接但范围相对集中（不是 3+ 核心模块），且修复成本低（一次性 mechanical replace + 加 CI 校验）。
- 建议方向：(a) 一次性 mechanical 修复——把 `.apm/kb/docs/` 全替成 `docs/`、重写 monorepo.md 整张表、重写 events.yaml 到 schemaVersion 2、归档或删除 examples README；(b) 加 CI 校验——至少跑一段脚本把 `examples/*.yaml` 喂给对应 zod schema，跑 `package.json` scripts/exports 与 README 声明的 diff，扫 `.apm/` 死链。这三个校验都是几十行脚本，能永久性堵住这一类漂移。

### 模式 4：spec vs 实现的安全语义反向漂移（特别标注）

- 类型：模块间不一致（单点命中但危害结构独特）
- 出现模块：provider-llm（单点）
- 共同特征：和模式 1/2/3 完全不同的危害结构——前三圈按文档改回去只是「扑空」（功能不存在、字段已移除），这一圈**按文档改回去会主动撕开一道安全漏洞**。代码当前的行为比 spec 更安全，spec 是不安全的那一版；这种状态下，「以 spec 为准」的整改惯性反而成了危险的来源。
- 具体命中：
  - **provider-llm S2（SKSP env 空串语义）**：`docs/Iterations/sksp/spec.md:244-254` 写 `get(key) { const v = env[key]; return v !== undefined ? v : null; }`——空串仍返回。实际 `env-secret-store.ts:17` 是 `if (v === "" || v.trim() === "") return null`——把空串和纯空白都视为未命中。composite-secret-store 在 DB 之前查 env（`if (fromEnv !== null) return fromEnv`），所以一旦按 spec 字面把代码改回，用户 shell 里设了 `NOVEL_MASTER_PROVIDER_<UUID>_API_KEY=`（空串）会让 env 命中并返回空串，composite 把空串当 apiKey 透传给 adapter，HTTP 鉴权失败但根因被「env 覆盖」盖住——用户看到的是 HTTP 401，不是「你的 env 覆盖了 DB」。叠 L8 已经命中的「desktop 默认开 env」信任面问题，这种诊断难度会进一步放大。
- 系统性根因：和模式 1/2/3 同源（spec 没跟上代码演进），但**方向反过来**——这次是代码先收紧、spec 没同步。这种反向漂移特别难发现，因为常规 review 默认「代码偏离 spec 是 bug」，没人会想到「代码偏离 spec 是修复」。它暴露的是 spec 作为「真相源」的脆弱性——一旦 spec 落后于代码且方向反过来，以 spec 为锚的所有 review 都会得出相反结论。
- 严重度：**A**（单点命中，没到 3+ 模块的 S 级），但**特别标注**「反向危险」——这是本角度唯一一条「按文档整改会更不安全」的发现。
- 建议方向：**(a) 立即把 `sksp/spec.md` 的 env `get` 段落改成与实现一致的「空串/纯空白视为未命中」，并解释为什么**（避免空 env 变量意外覆盖 DB）。这一条不能拖，因为 spec 当前状态就是一颗活雷——任何按 spec 字面实现的未来重构都会引爆。(b) 在 `infra/sksp/index.ts` 的 module 注释里加一句「env 空串 = 未命中」的硬契约声明，把这条语义从「实现细节」升级成「文档化的契约」。(c) phase3 交叉时把这条标为 L8（信任面）和 L11（doc-drift）的复合命中，单独跟踪。

### 模式 5（附加）：ARCHITECTURE.md documented exceptions 双向失真

- 类型：god module / 规范文档的跨模块影响
- 出现模块：compaction（失效条目未删）、prompt（灰色引用未补）
- 共同特征：`packages/core/ARCHITECTURE.md` 的 documented exceptions 表是仓库唯一的「合法违反分层规范」白名单。它存在两种方向的失真——失效条目没删（指向已删文件，模式 1 的 compaction 命中），真实存在的灰色引用没补（type-only import 没登记，prompt A2 命中）。同一个表两个方向都漂，说明这张表本身没有「与代码同步」的维护机制。
- 具体命中：
  - **失效条目未删**：documented exception §2 引用 `domain/compaction/action/default-compaction-action.ts`，该文件已删（模式 1 已展开）。Naming 表 L54 同样拿这个死路径当示例。
  - **灰色引用未补**：prompt 模块的 `PromptRenderContext`（domain 层）类型签名声明 `workplace?: WorkplaceService` 字段（`prompt-render-context.ts:9`），`expandDynamicMacros` 函数签名也接 `WorkplaceService`（`expand-dynamic-macros.ts:7`），都是 `import type`——TS 编译期擦除，运行时扫描扫不到。L3 报告「domain → service 0 violations」是基于运行时 import 的扫描，漏掉了这两处 type-level 灰色引用。严格按 ARCHITECTURE.md「domain 不得 import service」字面读（无 type/value 之分），这两处应该登记进 documented exceptions 但没登记。
- 系统性根因：documented exceptions 表是「人工维护 + 人工核对」的纯文本，没有任何工具能告诉你「这条引用还存在吗」「有没有新的灰色引用该登记」。L3 报告里的「0 violations」结论本身也是 type-only import 的扫描盲区产物——这是规范文档 + 扫描工具协同失真的复合问题。
- 严重度：**B**——documented exceptions 表本身范围有限（就 7-8 条），单条失效危害可控（L3 已经标过跳过 §2 即可），灰色引用未补也是边界问题（type-only 不影响 bundle）。但它是「规范文档可信度」的局部裂痕，叠加模式 1/2/3 之后会让 ARCHITECTURE.md 整体可信度下降。
- 建议方向：(a) 删 documented exception §2 + 改 Naming 表示例（和模式 1 的整改合并）；(b) 给 prompt → service/workplace 的 type-only 引用补进 documented exceptions（标注「type-only port reference」），或者改用结构化窄接口（`{ renderFileTree(): Promise<string> }`）彻底解掉；(c) 中期给 L3 的扫描工具加 type-only import 检测能力，让「0 violations」结论能覆盖类型层。

---

## 覆盖声明

**查了**：D1-11 全文（文档漂移清单 + spec 信任度降级清单 + 发现清单 A/B/C 三档共 8 条）；6 份 D2 切片中所有 L11 / doc-drift / spec / PRD / ARCHITECTURE / deprecated 命中段——
- D2-compaction：A1（ARCHITECTURE.md §2 失效）、S1（estimateTokens 退役）、A2（CompactionConditionsTrigger 草稿残留）
- D2-agent-tool：S1（chat_grep PRD vs 代码）、S2（prompts 形态超出列举迭代）、B2（顶层 index.ts re-export @deprecated alias）、C（builtin-tool-context.ts 注释漂移）
- D2-prompt：A1（D1-02「递归解析」标题与正文矛盾）、A2（L3 漏报 type-only import）、A3（prompt → chat 双路径）、A（prompt-engine spec L201 偏离）、A（validatePromptBlocks 遗留路径仍挂公共面）、B2（PromptRenderContext.vfs 字段退役未删）
- D2-provider-llm：S2（SKSP env spec vs 实现反向漂移）、B1（BUILTIN_PROVIDER_IDS deprecated 别名语义已变）、B2（public/provider.ts 把 tokenizer 子系统 re-export）、C（opencode-builtin-provider PRD 文案过期）、C（provider-model PRD §62 defaultModelId 字段不存在）
- D2-chat-message：A1（setMessageFloorAtMessage 实现超出 spec Core API 契约）、A2（message-rollback-remove-session-log spec 整体架空）、B1（rollback 事务外读 plan 是 spec 设计但缺护栏）、C2（D2-CM-C2 spec 历史化）
- D2-vfs：F1（vfs-version-redesign PRD 承诺的 repairRefCounts 调度未实现）、F2/F3/F4（PRD 兑现但含隐性成本）、B2（releaseAndDeleteVfsPrefix @deprecated 仍被同模块消费）、覆盖声明里引用的 D1-11 vfs-zip-native-compression spec 命中

**没查**（及原因）：151 个 Iterations spec 的逐一核对（D1-11 已经声明「只抽查了指导文档点名的 3 个 + 1 个被撤销的」，本角度作为 phase2.5 不重复 spec 全扫，只做跨模块叠图）；D2 切片里非 L11 命中的发现（比如 L4 事务、L5 并发、L6 跨端——那些归各自角度的 phase2.5 报告，本报告只在它们和 doc-drift 叠加时引用）；实现代码（phase2.5 边界，依据全部来自 D1/D2 报告）。

---

## 给 Phase 3 的线索

- **最高优先级：模式 1 + 模式 2 的整改需要统一调度**。这两条根因相同（迭代之间无 supersede 元数据），命中 4 个核心模块共 9 处。phase3 不应该让各模块切片各自整改自家的 spec 漂移——应该拉一次专门的「文档清扫迭代」，建立 `iterations.yaml` supersede 字段 + 给所有被推翻的 PRD/spec 加标注 + 给公共面退役符号统一挂 `@deprecated`。这是典型的「局部修补无法解决全局问题」。
- **冲突预警：模式 4（SKSP env 反向漂移）和 L8 整改方向可能撞车**。L8 已经标过「desktop 默认开 env 信任面偏宽」建议收窄；但如果 L8 的整改顺手「按 spec 改 env 语义」就会引爆模式 4 的雷。phase3 必须把这两条放在同一张决策表上——L8 收窄 env 信任面 + L11 把 spec 改成与实现一致（空串视为未命中），两件事必须同步做，不能先做一件。
- **可信度降级清单的传播**：模式 1/2 命中的 spec/PRD（`tool-system-v2/prd.md`、`agent-prompt-abstract-block/prd.md`、`agent-config-shape/prd.md`、`message-rollback-remove-session-log/spec.md`、`vfs-version-redesign/prd.md`、`prompt-engine/spec.md`、`vfs-zip-native-compression/spec.md`、`sksp/spec.md`）**不应作为其他角度推断当前实现的功能基准**。phase3 交叉时如果发现 L1/L2/L4/L5 引用了这些 spec，需要回 D1-11 / D2 切片核对它们是否已被降权。
- **可能和 L9 冲突**：模式 2 的整改方向（公共面 export 加 `@deprecated`）和 L9 的整改方向（删除 `@deprecated` alias）方向一致，但执行顺序有讲究——L9 想「直接删」，L11 想「先标 deprecate 再删」，phase3 要裁决是先标后删还是一刀切。建议先标（保留观察期），等下一个迭代再删。
- **可能升级到 S 的污染效应**：模式 1 的 agent-tool S2（prompts 形态）已经从「doc-drift」升级成「公共面契约与 PRD 完全不匹配」——`promptsDocumentSchema` 是 `public/agent.ts:5` 对外导出的公共契约，外部解析 agent YAML 的代码按 PRD 写的 `blocks` 形态构造输入会被现网 schema 一律 reject。phase3 应该把这条单独跟踪，它不只是文档问题，是公共 API 契约问题。
