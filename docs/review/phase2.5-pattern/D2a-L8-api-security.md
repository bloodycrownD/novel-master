# D2a-L8：API 稳定性 & 安全跨模块模式识别

## 元信息

- 角度：L8（API 稳定性 & 安全，含包导出面 + 发版策略）
- 输入：`D1-08-api-security.md` + 全部 6 份 `D2-*.md` 切片 + `D0-1-code-map.md`（god module 引用表）/ `D0-2`（未直接读，仅借 D1-08 转引）
- 轮次：Phase 2.5 第 1 轮
- 模式：readonly，未读任何实现代码，未跑 build/test/lint，未宣布 ready

## 结论（叙述式）

把 D1-08 的 L8 发现叠到 6 份切片上对齐来看，最显眼的是**两条 S 级系统性反模式**：一条是「死代码 / `@deprecated` alias 仍然挂在公共面或顶层 facade 上对外导出」，另一条是「service 层实现目录或跨 context 子系统绕开两层 facade 直接发布」。前者散落在 compaction、agent-tool、chat-message、provider-llm、vfs、prompt 六个模块里——也就是说几乎每个切片都中招，已经不能用「局部尾巴」来解释，只能理解为「仓库从来没有一条『公共面退出机制』，迭代完成后清理死导出全靠人记得」；后者表面上只有 `./kkv` / `./session-kkv` 两个 exports 子路径直接发 service 目录，但叠上 `public/provider.ts` 把整个 `infra/tokenizer` 子系统 re-export、tokenizer 在 compaction 和 provider 两个 public face 重复出口，以及顶层 `index.ts` 直接碰 `createPersistentState` 这类 service factory——「绕开 facade 直发」其实是同一个反模式在三个层次（包导出面、源码 barrel、顶层 facade）上的不同变体，根因都是「facade 边界没有强制约束，全靠作者自觉」。

第二条值得 phase3 关切的是 **spec/PRD/ARCHITECTURE 与实现的安全语义系统性漂移**，且**当前的安全行为往往恰好靠代码偏离 spec 在撑**——SKSP env 空串语义（spec 写 `v !== undefined`，实现把空串当 null）、agent tool policy 的 allow/deny 互斥（schema 接受同时存在、互斥只在 service 层）、`chat_grep` 的去留（PRD 列为必备、代码已废）、ARCHITECTURE.md 的 documented exception §2（指向已删文件）。每一条单看是 doc-drift，叠起来是一个共同信号：仓库的安全/契约真相既不在 spec 里也不在代码里，而在「两者之差」里——一旦有人按 spec 字面去对齐代码，反而会把当前的安全行为打回不安全那一版。这条比单点 doc-drift 严重得多。

版本号矛盾（core/driver/sksp 全部 0.0.0 被 1.4.17 的 desktop/mobile 消费）本身 D1-08 已经 A 级立项，跨模块层面它的实际作用是**前面两条反模式的放大器**：0.0.0 + workspace `*` + CHANGELOG 软提示组合下，任何一次破坏 service 层封装、改 tool policy schema、撤掉某个公共导出都没有版本信号传递给消费方。换句话说，L8 在前两条例子上的整改紧迫性，部分是被发版策略的失能顶起来的——这一层关联 phase3 裁决时要看清楚。

## 跨模块模式清单

### 模式 1：死代码 / `@deprecated` alias 仍挂在公共面对外导出

- 类型：同一反模式（核心路径）
- 出现模块：**compaction、agent-tool、chat-message、provider-llm、vfs、prompt**（6 个）
- 共同特征：迭代完成或方向变更后，旧符号（函数 / 类型 / 字段）只在文件内被标 `@deprecated` 或干脆没人调，但**仍然挂在某个公共面**（顶层 `src/index.ts`、`src/public/<ctx>.ts` barrel、或对外 `.d.ts`），公共面类型签名上看起来还是「活的 API」。新消费者从公共面看进来无法判断哪些是稳定 API、哪些是准死代码。
- 各模块变体：
  - **compaction**（D2-compaction S1）：`estimateTokens` 旧启发式已无生产消费者（v3 走 `resolveCurrentPromptTokens`），但仍挂在 `public/compaction.ts`；外部误用会拿到与三端 Chat token 计数对不上的数。
  - **agent-tool**（D2-agent-tool B2）：顶层 `index.ts:152-180` 仍在 re-export `MUTATING_VFS_TOOL_NAMES` / `isMutatingVfsToolName` / `registerVfsTools` / `VfsToolContext` 这批 V1→V2 过渡 alias；`public/agent.ts:17-23` 仍 re-export `resolveApplicationModelId` 家族 4 个 alias。`tool-system-v2` PRD 明确写「旧名不保留别名」。
  - **chat-message / chat barrel**（D1-08 §源码公共面发现 1）：`public/chat.ts` 377 行，含已声明 `@deprecated` 但未收回的导出（净 diff 模块文件保留供过渡期单测相对路径引用）。
  - **provider-llm**（D2-provider-llm B1）：`BUILTIN_PROVIDER_IDS` deprecated 别名语义已从「UUID 列表」变成「builtin_key 列表」，类型仍是 `readonly string[]`，旧调用方按 UUID 用编译器不拦；`builtinProtocolByProviderId` 同时按 key 和 UUID 双查。
  - **vfs**（D2-vfs B2）：`vfs-tree-copy.ts` 的 `releaseAndDeleteVfsPrefix` 标 `@deprecated` 被 `sweepRevisionsUnderScope` 包装，但旧名仍 export 且**被同模块内部 4 处消费**（`vfs-zip-io.service.ts:182` 等），与「deprecated = 准备删除」语义直接冲突。
  - **prompt**（D2-prompt B2）：`PromptRenderContext.vfs` 字段在类型上声明、agent-runner L230 运行时仍传值，但 prompt 模块内部零引用——公共面类型签名上的死字段。
  - （旁证）**compaction** 还有 `CompactionConditionsTrigger` schema 草稿残留（D2-compaction A2），只在 `.d.ts` 出现、src/test/apps 全工程零引用——属于「不在 public barrel 但在 .d.ts 出口」的同模式边缘变体。
- 系统性根因：仓库没有「公共面退出机制」。`@deprecated` 标注是文档习惯，不是工程契约——没有 lint 规则禁止 `index.ts` / `public/*.ts` re-export 一个 `@deprecated` 符号，也没有发版前检查「公共面是否含 `@deprecated` 导出」。每次迭代留下的尾巴不会被自动捕获，只能靠后续 reviewer 肉眼发现，而每个切片都发现了 1–4 个这种尾巴，说明肉眼兜底已经失效。
- 严重度：**S** —— 同一反模式在 6 个模块（5 个核心 + prompt）重复出现，且根因是缺一条工程化护栏（lint / 构建期检查），属于架构层缺失。
- 建议方向：phase3 应优先立项一条**公共面退出契约**：(1) 加 lint 规则禁止 `src/index.ts` 与 `src/public/*.ts` re-export 任何带 `@deprecated` JSDoc 的符号；(2) 把 `@deprecated` 的语义从「文档提示」升级成「必须在 N 个迭代内移除，否则 build 失败」；(3) 各模块把当前已识别的死导出（`estimateTokens`、V1→V2 alias 全家、`BUILTIN_PROVIDER_IDS`、`releaseAndDeleteVfsPrefix`、`PromptRenderContext.vfs` 等）排进同一批清理，而不是每个模块各自拖延。注意：这一条与 L9（迭代残留）、L7（死代码）角度高度重叠，phase3 需要协调同一定单还是分别立项。

### 模式 2：service 层 / 跨 context 子系统绕开两层 facade 直接发布

- 类型：同一反模式（核心路径）+ 不一致（同一模块不同导出风格）
- 出现模块：core 顶层 + `public/provider.ts` + compaction barrel + kkv/session-kkv service
- 共同特征：仓库的源码 facade 设计是两层（顶层 `src/index.ts` 只放基础设施 + 13 个 `src/public/<ctx>.ts` barrel 配合 `@novel-master/core/<ctx>` 子路径对外）。但实际有**三类绕路**同时存在，且没有任何文档解释为什么有些走 facade、有些不走。
- 三种变体：
  - **变体 A（包导出面直发 service 目录，A 级）**：`./kkv` 与 `./session-kkv` 映射到 `dist/service/{,session-}kkv/index.js`，源码侧没有任何 `public/kkv.ts` barrel 复述，apps 共 16 次 import 直接拿 service 层实现细节（D1-08 §包导出面发现 1）。
  - **变体 B（barrel 内塞跨 context 子系统，B 级）**：`public/provider.ts:125-159` 把整个 `infra/tokenizer` 子系统 35 个符号 re-export；同时 `public/compaction.ts` 也暴露 tokenizer 入口（D2-provider-llm B2 + D2-compaction 耦合点）。tokenizer 是独立 infra capability（747 行 16 文件），与 provider/compaction 是不同 bounded context，却在两个 public face 重复出口——消费者从 `@novel-master/core/provider` 拿 `countPromptLlmInput` 会以为自己用的是 provider 稳定 API，实际上踩进了一个三端行为分叉的子系统（L6 A-4 tokenizer 三端计数公式不同）。
  - **变体 C（顶层 facade 碰 service factory，D1-08 自评「可接受」）**：顶层 `src/index.ts` 暴露 `createPersistentState` / `createPersistentPreferences` 这两个 service 层 factory + 常量 key，是顶层 facade 唯一直接碰 service 层的地方。D1-08 判「便利性导出、可接受」，但与「顶层只放基础设施」原则轻微冲突，是变体 A/B 的轻度版本。
- 各模块差异：变体 A 是 `package.json` exports 字段层面的问题（最显式、影响外部第三方）；变体 B 是源码 barrel 内部容纳了不属于本 context 的子系统（影响 apps 407 次 subpath import 里的 provider/compaction 部分）；变体 C 是顶层 facade 接受了 service factory 的存在。三者严重度不同，但**共同点是没有一条文档化的原则说明「service 层不直接 export」「一个 barrel 只能 re-export 自己 context 的符号」**。
- 系统性根因：`ARCHITECTURE.md` 规定了 domain/service/infra 分层，但没有规定**包导出面与 barrel 必须与分层同构**。`./tdbc` / `./sksp` / `./nmtp` 映射到 `dist/infra/` 之所以可接受（D1-08 §包导出面发现 4），是因为它们是显式的可插拔驱动端口、自带 facade；而 kkv/session-kkv 缺这套自洽性，是因为没有规则强制要求「新增 service 子目录时必须先在 `public/` 建 barrel」。tokenizer 重复出口则是因为早期某个迭代图省事把它塞进了 provider barrel，后来 compaction 跟着抄。
- 严重度：**S** —— 变体 A 单独是 A 级，但叠上 B/C 后看到的是「facade 边界全靠作者自觉」的系统性问题，且变体 B 直接放大了 L6（tokenizer 三端不一致）的危害面。
- 建议方向：在 `ARCHITECTURE.md` 或 `packages/core/README.md` 加一节「public face convention」，明确三条硬规则：(1) service 层原则上不直接 export，新增 service 子目录必须先在 `public/` 建 barrel；(2) 一个 `public/<ctx>.ts` 只能 re-export 自己 context 的符号，跨 context 子系统（tokenizer 等）走独立 subpath（`@novel-master/core/tokenizer`）或只在顶层 facade 出现一次；(3) 顶层 `index.ts` 不碰 service factory，现有 `createPersistentState` 要么移到 `public/state.ts` 要么显式 documented exception。整改顺序建议先收敛 kkv/session-kkv（变体 A，影响面最明确），再处理 tokenizer 重复出口（变体 B，需要 phase3 和 L6 协调）。

### 模式 3：spec / PRD / ARCHITECTURE 与实现的安全语义漂移（且当前安全行为靠代码偏离 spec 在撑）

- 类型：同一反模式 + 模块间不一致
- 出现模块：**provider-llm（SKSP env 空串）、agent-tool（tool policy allow/deny、`chat_grep`）、compaction（ARCHITECTURE.md documented exception）**
- 共同特征：仓库存在三处以上的「安全相关语义，spec 写的是 A，代码实现的是 B，而 B 比 A 更安全」。也就是说，**当前的安全行为恰好靠代码偏离 spec 在维持**——一旦有人按 spec 字面去「修正」代码，反而会把已经收紧的行为打回不安全那一版。这是比单纯 doc-drift 更危险的模式，因为正常的「文档对齐代码」整改会主动引入安全问题。
- 各模块变体：
  - **provider-llm SKSP env 空串**（D2-provider-llm S2，S 级）：`sksp/spec.md:248` 写 `return v !== undefined ? v : null`，实现 `env-secret-store.ts:17` 是 `v === "" || v.trim() === ""` 视为未命中。如果按 spec 改回，用户 shell 里设了 `NOVEL_MASTER_PROVIDER_<UUID>_API_KEY=`（空串）会让 env 命中并返回空串，composite 把空串当 apiKey 透传，HTTP 鉴权失败但根因被「env 覆盖」盖住。
  - **agent-tool allow/deny 互斥**（D2-agent-tool A3，A 级）：zod schema `agentToolPolicyDocumentSchema` 接受 `{allow: [...], deny: [...]}` 同时存在，互斥校验只在 service 层 `DefaultAgentRegistryService.upsert` 那条路径。db-backup import / cloud-sync pull 等绕过 service upsert 的写入路径能让脏配置入库；运行时 `resolveAgentToolRegistry:19-21` 「先看 allow，allow != null 就 return」，deny 被完全忽略——脏配置下用户以为禁掉的工具实际可用。
  - **agent-tool `chat_grep`**（D2-agent-tool S1，S 级）：`tool-system-v2` PRD 把 `chat_grep` 列为必备工具（§5 整节 + 验收 3 条），代码已 `@deprecated` 且从 `registerBuiltinTools` 移除，没有任何迭代记录说明反悔。`builtin-tool-context.ts:16-17` 注释还在说「供 chat_grep」，与现行代码对不上。
  - **compaction ARCHITECTURE.md documented exception §2**（D2-compaction A1，A 级）：规范允许 `domain/compaction/action/default-compaction-action.ts` import `infra/prompt-template`，但这个文件在 `event-bus-compaction-conditions` 迭代里被明确删除（spec L378 变更点第 10 项），目录都不存在了，规范仍把它当有效例外在列，Naming 表还拿它当命名范式示例。
- 系统性根因：仓库的 spec/PRD/ARCHITECTURE 与代码之间**没有双向同步机制**。spec 改了不强制要求代码 follow，代码改了也不强制要求 spec follow；`@deprecated` / 「目录已删」这类事实变更不会反向更新规范文档。更深层是：**安全相关的语义收紧往往先发生在代码里（修 bug 时顺手收紧），但 spec 没跟上**——这是「代码先行、规范滞后」的典型 churn，但一旦收紧方向恰好与 spec 字面相反，规范本身就变成了不安全的那一版。
- 严重度：**A** —— 单条都已经在各自切片定级（S2/S1 是 S、A3/A1 是 A），跨模块叠加后看到的是同一个根因（无 spec-代码同步机制），定 A 是因为「phase3 必须先决定哪一边是 source of truth，否则整改方向有 50% 概率走反」。
- 建议方向：phase3 优先裁决每一条漂移的「真相方向」——SKSP env 空串以代码为准（spec 改）、allow/deny 互斥以「schema 必须自闭合」为准（代码加 `.refine`）、`chat_grep` 必须先和产品确认去留（PRD 或代码二选一）、documented exception §2 以代码为准（规范删）。建立一个机制：每次 `@deprecated` 或目录删除必须在同 PR 里更新所有引用该符号的 spec/PRD/ARCHITECTURE 段落（这条与 L11 doc-drift 角度必然重叠，phase3 应协调）。

### 模式 4：版本号 0.0.0 + workspace `*` + CHANGELOG 软提示 = 前三条反模式的放大器

- 类型：god module / 摇摆交叉之外的发版策略放大器（D1-08 单点已 A 级，此处只分析跨模块下游影响，不重复立项）
- 出现模块：core + 9 个 driver/sksp 包 + cli 全部 0.0.0；desktop/mobile 1.4.17
- 共同特征：D1-08 §三已经把这个发版策略本身定为 A 级。跨模块层面它的实际作用是**模式 1/2/3 的整改紧迫性放大器**——semver 在 monorepo 内部完全失效，任何一次破坏 service 层封装、改 tool policy schema、撤掉某个公共导出、收紧 SKSP env 语义，都没有版本号信号传递给 apps 消费方，也没有 CHANGELOG 硬门槛兜底。
- 下游实际影响（对前三个模式的反向作用）：
  - **对模式 1（死代码公共面）**：撤掉一个 `@deprecated` 导出在 0.0.0 下是「任意变更都是 breaking」，但 0.0.0 又意味着 breaking 不需要任何仪式——结果就是「想撤就撤、想留就留」，既没有强制撤的时间点，也没有撤的时候的保护期。这是模式 1 之所以能拖到 6 个模块全部中招的工程化原因。
  - **对模式 2（service 直发）**：如果 core 是 1.x 正式版，把 `./kkv` 改指向 `dist/public/kkv.js` 是 breaking change（消费方 import 路径不变但拿到的符号集变了），会触发版本号上涨；但 0.0.0 下这次重构没有任何信号，apps 端的 16 次 `@novel-master/core/kkv` import 不会收到任何 deprecation warning。
  - **对模式 3（spec 漂移）**：发版策略失能意味着「spec 字面对不上的代码改动」不会在任何 release notes 里被看见，外部/未来第三方消费者即使读 CHANGELOG 也判断不出哪一次改动引入了语义收紧。
  - **对 driver 包的耦合**：D2-provider-llm 耦合点提到 mobile 绕过 registry 直连 `createAndroidSecretStore`、三端 SKSP driver 各自 0.0.0——这种「绕过 registry」的硬耦合在 0.0.0 下完全无 semver 保护，driver 内部任何签名变更都是无信号的 breaking。
- 系统性根因：D1-08 已经指出「中间状态最糟糕——既享受了 `private: true` 的不发版便利，又保留了 `name` 字段带来的『理论上可发版』错觉」。叠加 CHANGELOG 校验是软提示、release.yml 不发 core/driver，相当于 monorepo 内部完全没有版本契约。
- 严重度：**A**（单点已在 D1-08 立项，这里只标跨模块影响，不重复定级）
- 建议方向：phase3 决定 core/driver/sksp 是「workspace-internal only」还是「未来要独立发版」。前者统一锁 0.0.0 + workspace `*` 并在 ARCHITECTURE.md 明写、`name` 字段也可以考虑去掉；后者给真实版本号（哪怕 0.1.0）+ 独立 publish workflow + CHANGELOG 硬门槛。**不能停在中间状态**——这是 D1-08 的原话，跨模块层面我补一句：中间状态直接拖累前三个模式的整改可行性。

### 模式 5：`vfs-path-mapper` god module 对 L8 整改的放大效应

- 类型：god module 的跨模块影响（D0-1 已识别 god module，本角度补充它对 L8 整改成本的影响）
- 出现模块：vfs（42 次引用）+ agent-tool（policy 整改落点）+ prompt（`PromptRenderContext`）
- 共同特征：D0-1 §3 已经把 `vfs-path-mapper` 列为仓库唯一的真 god module（42 次引用，远超其他具体文件），L3 角度应重点看它。从 L8 角度看，它的 god 化会**反向推高 D1-08 §4.6 / D2-agent-tool A4（tool policy 缺路径白名单，A 级）的整改成本**——D2-agent-tool A4 已经确认「path scope 的唯一守卫是注入哪个 VfsService」，policy 维度加 `allowedPaths` 现在无处挂（`BuiltinToolContext` 没字段、runner 不二次校验）。如果按候选方案 1（扩 `BuiltinToolContext` 加 `allowedPathRoots`、runner 在 call 之前查）落地，意味着每次 tool 调用都要再过一次 path-mapper 的 `assertLogicalPathAllowed`，而 D2-vfs A1 已经发现 ScopedVfsService + RevisionAwareVfsService 双层重复 normalize 已经让单次调用链 normalize 跑 3 次、5000 条 zip entry 就是 15000 次。再叠一层 tool policy 路径校验，god module 的引用密度会进一步上涨，性能与维护成本同步恶化。
- 系统性根因：path scope 校验目前「装配期注入 VfsService」这一条路径是唯一守卫，是因为 path-mapper 已经被全 vfs 引用、再加抽象太重。L8 的 tool policy A 级发现的整改落点没有架构占位，本质是因为 god module 已经堵死了「再加一层统一 path 校验」的入口。
- 严重度：**B** —— god module 跨模块影响可量化（42 次）且危害可控（性能问题不是正确性问题），但与 L8 的 A 级发现整改路径直接冲突，phase3 需要知道。
- 建议方向：L8 的 tool policy 路径白名单整改与 L2/L3 的 path-mapper 重复 normalize 整改**必须同批做**，否则会陷入「加一层校验 → god module 进一步膨胀 → 下次整改更难」的恶性循环。具体方向是先把 `assertLogicalPathAllowed` 改成接收已 normalized 的路径（D2-vfs A1 建议），让 path-mapper 引用密度先降下来，再讨论 tool policy 的 `allowedPaths` 挂哪一层。

### 模式 6：高摇摆度模块 × L8 死代码 / spec 漂移高发区交叉

- 类型：摇摆度 × 角度发现交叉
- 出现模块：compaction、agent-tool（两个高迭代区）
- 共同特征：D2-compaction 显式提到「v1/v2/v3 改的是 trigger 的组装层级」是典型 churn，D2-agent-tool 显式提到「PRD 已变更但代码/迭代记录没跟」是典型 spec 漂移。把 L8 的死代码 / spec 漂移发现按模块分组后，发现这两个高摇摆模块恰好是模式 1（死代码公共面）和模式 3（spec 漂移）的最高发区——compaction 同时占了 `estimateTokens`（模式 1）+ documented exception §2（模式 3）+ `CompactionConditionsTrigger` 草稿残留；agent-tool 同时占了 V1→V2 alias 全家（模式 1）+ allow/deny schema 不闭合（模式 3）+ `chat_grep` PRD 漂移（模式 3）+ tool policy 缺路径白名单（D1-08 §4.6）。也就是说，**每次迭代都在改同一个模块但没改对**——局部修补无法解决全局问题，因为下一轮迭代又会留下新的尾巴。
- 系统性根因：高摇摆模块的迭代节奏快于公共面清理节奏，spec 更新节奏又慢于代码迭代节奏，三层节奏脱节。模式 1 和模式 3 的整改（公共面退出契约 + spec-代码同步机制）如果不同步落地，compaction 和 agent-tool 这两个模块会持续产出新的 L8 发现。
- 严重度：**B** —— 摇摆度交叉发现，危害可控但提示「局部整改无效」。
- 建议方向：phase3 把 compaction 和 agent-tool 列为模式 1/3 整改的优先验证对象——如果整改后这两个模块的下一次迭代不再产出新的死代码 / spec 漂移，说明整改机制有效；如果还产出，说明机制本身需要再加强。

## 覆盖声明

**读了**：`docs/review/phase1-lens/D1-08-api-security.md` 全文（含元信息、源码公共面、包导出面、发版策略、安全性、角度 × 模块矩阵、覆盖声明、待交叉线索、执行检查清单）；全部 6 份 `docs/review/phase2-slice/D2-*.md`（agent-tool / provider-llm / compaction / chat-message / vfs / prompt）的元信息、模块画像、交叉发现、债务清单、耦合点、覆盖声明段；`docs/review/phase0/D0-1-code-map.md` §3 God Module 候选表 + §7 初步观察（god module 引用表核实用）；`docs/review/guides/phase2.5-cross-module.md` 全文（执行规则）。

**没读**（按指导文档「不读实现代码」边界）：任何 `packages/*/src/` 下的源码；任何 `apps/*/src/` 下的源码；任何 `docs/Iterations/*/spec.md` 或 `prd.md` 原文（只引用 D1/D2 切片里已经引述的段落）；`docs/review/phase0/D0-2-docs-index.md`（摇摆度数据通过 D2 切片转引，未直接核对原文）；其他角度的 D1 报告（L9/L11 等只在切片的「涉及角度」字段里看到引用，未读原文）。

**为什么不读**：phase2.5 的边界明确是「输入 = D1 + D2 报告，不读源码、不读其他角度」。如果发现 D1/D2 里某个结论需要核实，按指导文档要求标 `待回派`，不自己翻代码。本次产出未出现 `待回派` 标记——所有跨模块模式都建立在 D1/D2 已有结论之上，未引入新的事实主张。

**未宣布**：本报告不宣布 ready，不提议合入，只产出 readonly 跨模块模式识别。

## 给 Phase 3 的线索

按 phase3 优先级排序：

1. **模式 1（死代码公共面，S 级）**：与 L9（迭代残留）、L7（死代码）角度必然冲突或重叠——L9 在 D2-agent-tool B2、D2-vfs B2 已经命中同一批 alias，L7 在 D2-compaction A2 命中 `CompactionConditionsTrigger`。phase3 需要决定：L8 这条 S 级是当成独立立项（「公共面退出契约」作为一条工程化整改），还是合并进 L9/L7 的整改批次？我的立场是**独立立项**——L9/L7 关心「文件内死代码」，L8 这条关心「公共面对外导出」，两者整改机制不同（前者是 knip/ts-prune，后者需要新的 lint 规则禁 `index.ts` re-export `@deprecated`）。

2. **模式 3（spec 漂移且安全行为靠偏离 spec 撑，A 级）**：与 L11（doc-drift）角度必然重叠，但 L8 的特殊切面是「漂移方向恰好与安全方向相反」——phase3 必须先把每一条漂移的「真相方向」裁决清楚（代码为准还是 spec 为准），**否则 L11 单纯按「文档对齐代码」整改会主动引入安全问题**（SKSP env 空串那条最危险）。建议 phase3 把 SKSP env 空串的 spec 改先做，allow/deny schema `.refine` 与 `chat_grep` 去留决策随后。

3. **模式 2（service 层 / 跨 context 子系统绕 facade 直发，S 级）**：与 L3（架构）角度直接冲突——D1-08 待交叉线索 §1 已经预判 L3 可能反驳「service 层 `index.ts` 自带 facade 也算干净合同面」。phase3 辩论焦点应该是「源码 facade 已有两层，exports 又开第三层，三种规则并存是不是没有规则」，而不是「kkv/session-kkv 单点要不要改」。变体 B（tokenizer 在 provider/compaction 重复出口）需要和 L6（跨端不一致）协调——tokenizer 独立 subpath 的整改会同时缓解 L8 公共面污染和 L6 三端不一致的危害面。

4. **模式 4（0.0.0 发版策略，A 级）**：与 L10（工程化）角度互补不冲突（D1-08 待交叉线索 §7-8 已经预判）。phase3 重点是决定 core/driver/sksp 是 workspace-internal 还是独立发版——这个决定直接影响模式 1/2/3 整改的版本信号机制能不能建立。

5. **模式 5（god module 放大 L8 整改成本，B 级）**：与 L2（path-mapper 重复 normalize）、L3（架构 hub）角度强耦合。phase3 应把 D1-08 §4.6 / D2-agent-tool A4（tool policy 缺路径白名单）的整改与 D2-vfs A1（双层 normalize）的整改**绑同一批**，否则 path-mapper god module 会进一步膨胀。

6. **模式 6（高摇摆 × L8 高发区交叉，B 级）**：提示 compaction 和 agent-tool 是整改机制的验证对象，不需要 phase3 单独裁决，作为前 5 条整改的回归参考。

**潜在的角度间冲突预警**：

- 与 **L3**：模式 2（kkv/session-kkv 是否算封装性破坏）+ 模式 5（path-mapper god module）会直接对撞，phase3 需要仲裁「facade 边界是按源码结构判还是按 exports 字段判」。
- 与 **L9 / L7**：模式 1（死代码公共面）的归属和整改机制需要协调，避免重复立项或互相推诿。
- 与 **L11**：模式 3 的「真相方向」必须先裁决，否则 doc-drift 整改会反向引入安全问题。
- 与 **L6**：模式 2 变体 B（tokenizer 重复出口）和模式 4（SKSP driver 各自 0.0.0）需要协调，因为 tokenizer 三端不一致和 SKSP driver 三端不统一是 L6 的发现，但整改出口在 L8 这边。
- 与 **L10**：模式 4（发版策略）的工程化整改归属需要确认是 L8 主导还是 L10 主导。
