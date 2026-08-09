# D2a-L10：工程化基建一致性跨模块模式识别

## 元信息

- 角度：L10 工程化基建一致性
- 输入：D1-10 + 全部 D2-*（vfs / chat-message / provider-llm / prompt / compaction / agent-tool）+ D2a-L3 模式 4（driver peerDep）+ D2a-L7 模式 3（运行器分裂）作为去重对照
- 轮次：Phase 2.5 第 1 轮
- 产出日期：2026-08-05

## 结论（叙述式）

诶～这个角度的跨模块模式确实是所有 L 里最少的一个啦，毕竟基建本来就是全局性的、不按业务模块分布——TS 分裂、ESLint 分裂、CI 缺失这些发现放在哪个切片都一样，没有「vfs 的 TS 版本」和「chat 的 TS 版本」这种东西。所以这一轮的主要价值不在「找出新的跨模块反模式」，而在**把基建缺失如何放大其他角度发现的问题**叠起来看，这一点指导文档也明示了。

叠完之后冒出来的核心结论是：**这个仓库的工程质量债务呈现出一种很典型的「散点状局部正确 + 全局无把关」形态**。6 份切片单看，每一份的 S 级发现都有具体根因和具体修复路径——vfs 的 ref_count 偏高、chat-message 的 undo_send 删光、provider-llm 的 currentProviderId 清理散在 app 层、agent-tool 的 chat_grep 已废但 PRD 仍列为必备——单看每一条都成立。但把 6 份叠上 L10 的「CI 零覆盖 + lint 只覆盖 5/14 个 workspace + knip 因运行器分裂大面积误判」这个底色，结论就翻盘了：这些发现不是「偶发的实现 bug」，而是 **一个没有任何自动 gate 的工程环境里必然会积累的稳态**。每一条 S/A 级发现背后都有「这个问题能在 1700+ commit 里长期存在且从未被自动捕捉」这一条 L10 根因在起作用。

最值得 Phase 3 优先关注的是模式 1（CI 缺失作为所有质量门的兜底失效）和模式 2（lint/tsconfig 不对称把 mobile 整条线变成规则洼地）。模式 3（driver 包的独立性在基建层面从未被验证）会和 D2a-L3 的模式 4 在 Phase 3 重叠，本报告只补 L10 视角下的基建证据（无 lint / 无 test 脚本 / 不声明 engines / 版本号永远 0.0.0），不重复 L3 的依赖图判定。模式 4（@deprecated 与 dead code 的系统性残留）是 L9 在单角度已经覆盖过的，本报告只把它和「lint 规则不对称 + knip 误判」叠起来，指出 **lint 层面根本没有工具能拦住这类残留**。

## 跨模块模式清单

### 模式 1：CI 零覆盖是所有切片 S/A 级发现无法被自动捕捉的根因中的根因

- 类型：同一反模式（基建缺失作为下游放大器）
- 出现模块：vfs、chat-message、provider-llm、prompt、compaction、agent-tool（全部 6 份切片的 S/A 级发现）
- 共同特征：D1-10 的 S 级发现已经写明——`.github/workflows/` 下只有 `release.yml`（仅打 tag 触发、只构建安装包、不跑 lint/test/typecheck），1700+ commit 全程零 PR/push 检查。叠到 6 份切片上看，这条不是孤立的「工程化瑕疵」，而是 **每一条 S/A 级业务发现能在代码里长期存在的共同前提**：
  - **事务缺口类**：D2-chat-message S1（undo_send 删光会话文件）、S2（setMessageFloorAtMessage 四步无事务）、D2-provider-llm S1（跨 secretStore 多步裸写）——CI 跑 `tsc --noEmit` 拦不住事务缺失，但 CI 跑 `npm test` 时如果有人补过「第三步抛错则前两步回滚」的回归测试就能拦。chat-message 切片 S2 明确说了这条测试**是有的**但只覆盖 happy path，没有任何 CI 强制失败路径回归。
  - **公共面污染类**：D2-compaction S1（estimateTokens 旧路径死代码仍挂 public/compaction.ts）、D2-agent-tool B2（顶层 index.ts re-export 5 个 @deprecated alias）、D2-vfs B2（releaseAndDeleteVfsPrefix 标 @deprecated 仍被同模块消费）——CI 跑 knip 就能拦，但 knip 因为运行器分裂在 desktop 误判 74 个 test 文件、mobile 误判 17 个 e2e 文件（D1-10 A 级发现 + D2a-L7 模式 3 已立项），knip 本身的可信度已经被打折扣，即便有人在本地跑过 knip 也无法分辨真死代码还是测试入口识别失败。
  - **spec drift 类**：D2-agent-tool S1（chat_grep 已废但 PRD 列为必备第 7 个）、S2（prompts 形态已超出列举迭代）、D2-compaction A1（ARCHITECTURE.md documented exception §2 失效）、D2-prompt A1（D1-02 标题「递归解析」与正文「线性扫描」自相矛盾）——这一类 CI 拦不住，但 doc lint / spec-test 能拦，仓库目前都没有。
  - **静默吞错类**：D2-provider-llm A2（inferLlmProtocolFromSavedModelId 三处静默回落 "anthropic"）、D2-chat-message A3（SessionFsError 写入端不传 cause）、D2-vfs S1（bootstrap repairRefCounts 的 `.catch(() => {})`）——CI 跑 lint 规则集（如 `no-empty-catch`）能部分拦，但 mobile 走另一套 ESLint、8 个子包根本无 lint，规则覆盖本身就不闭合。
- 各模块差异：事务/spec drift/吞错三类问题在不同切片的具体形态不同，但 **它们能长期停留的机制是同一个**——没有任何 PR 级别的自动质量 gate。
- 系统性根因：D1-10 已判定 CI 完全缺失是 S 级。本报告补的是因果链——**CI 缺失不是 L10 的内部债务，而是其他所有角度（L1/L2/L4/L7/L9/L11）的发现无法被自动捕捉的总开关**。换句话说，先把 CI 补上锁住现状，再做任何单角度整改（事务、死代码、spec drift），否则整改过程引入的回归同样没人拦。
- 严重度：**S**（保持 D1-10 判定；切片证据把「下游影响」从「理论上会放大」升级为「已经放大了至少 9 条 S/A 级业务发现」）
- 建议方向：D1-10 已经给过具体建议（补 `ci.yml` 至少跑 lint/typecheck/test/build + `tsc --noEmit`）。本报告补一条**优先级排序原则**：CI 补上后第一波应优先把 knip、`tsc --noEmit`、各 workspace 的 `test` 接入，先把「现状能被机器描述」这一步做出来；事务回归测试、spec-test 是后续迭代逐步加，不在第一波。这一条要和 D2a-L7 模式 1（事务多步写缺失败路径回归测试）在 Phase 3 合并裁决——L7 给的是测试内容，L10 给的是测试执行机制的根因。

### 模式 2：工具链分裂把 mobile 整条线变成「规则洼地」——多角度偏差的共同底色

- 类型：模块间不一致（应该一致但不一致）+ 摇摆度交叉
- 出现模块：mobile（主 tsconfig / webview-boot / e2e / src/web 全套）
- 共同特征：D1-10 已经从工具链内部记录了 mobile 的脱节——TS 5.8.3 钉死（其余 7 个包走 TS 6.0.3）、ESLint 8 legacy `.eslintrc.js` + `@react-native`（其余 flat 9）、tsconfig 主文件 extends `@react-native/typescript-config` 而非 base（`noUnusedLocals` / `noUnusedParameters` / `target` 全部没传到）、webview-boot 与 e2e 连 `extends` 都没有、jest 走 `moduleNameMapper` 强依赖 `core/dist`、Node engines 写 `>=22.11.0` 而根写 `>=20`。本报告不重复这些单角度事实，只把它们叠到切片上看：**mobile 的工具链脱节不是孤立工程问题，而是 6 份切片里 mobile 相关偏差的共同底色**。
- 切片层面的证据叠加：
  - **D2-provider-llm S1**：mobile 完全漏接 provider delete 入口，CLI/Desktop 各写一份 currentProviderId 清理，mobile 零命中。这条功能矩阵缺口之所以能长期存在，是因为没有任何跨端契约测试（L7 视角）+ 没有 CI 跑 mobile 的 lint/test（L10 视角）会暴露「mobile 漏实现了一个 CLI/Desktop 都有的入口」。
  - **D2-compaction B1 + 模块画像**：mobile 因为 tokenizer bundle 重做了 lazy init，集成测试里把 evaluator stub 成 `undefined`——意味着 mobile 端的 compaction 判定路径在测试里根本没覆盖。叠加 D1-10 的 jest moduleNameMapper 强依赖 `core/dist`，core 改一行 mobile 测试要先重 build，**测试基建本身在劝阻 mobile 写跨端契约测试**。
  - **D2-vfs S2**：mobile 的 assertZipArchive 扫 EOCD、Desktop 只查 PK 魔数、CLI 不校验，三端深度不同。这种「同一语义三份实现」之所以能稳定存在，是因为没有任何 CI lint 规则或契约测试会跨端对比这三份实现。
  - **D2-provider-llm B2 + D2a-L3 模式 4**：mobile 绕过 SKSP registry 直连 `createAndroidSecretStore`。这是 driver 装配的硬编码偏离，但因为 mobile 不继承 base tsconfig、不接入统一 ESLint，**没有任何静态检查会发现「mobile 没走 registry」这件事**。
- 系统性根因：mobile 在工具链层面脱离 core 基线是 RN 生态的现实约束（必须 jest、必须 `@react-native/typescript-config`、必须 ES5/ES2018 target 适配 webview），这部分 D1-10 已认定为合理。但 **「现实约束」没有触发任何补偿措施**——mobile 没有自己的内部 base tsconfig、没有把 base 的 `noUnusedLocals` 显式补回来、没有跨端契约测试、CI 也没跑。结果就是 mobile 整条线在规则覆盖上比 core/desktop/cli 低一档，成为「写了不会被告警」「漏了不会被跨端测试发现」的规则洼地，业务侧的功能矩阵漏接（provider delete）、装配偏离（绕过 registry）、测试盲区（evaluator stub）才会都集中在 mobile 这边冒头。
- 严重度：**A**（mobile 规则洼地本身是 L6 跨端约束的现实产物，B 合理；但洼地直接放大了至少 3 条切片 S/A 级发现的停留时长，升到 A。不是 S 因为业务正确性在 mobile 上仍可工作，只是规则覆盖薄）
- 建议方向：分两层。① 工具链层（L10 主导）：mobile 主 tsconfig 在 `compilerOptions` 里显式补齐 `noUnusedLocals` / `noUnusedParameters` / `target` 对齐 base；webview-boot 和 e2e 至少 `extends` 一个 mobile 内部的 local base；mobile 的 ESLint 8 → 9 flat 迁移可分阶段但要在 ARCHITECTURE.md 里登记为已知偏离。② 跨端契约层（L6/L7 主导，L10 配合）：抽一组 core 行为契约测试，让 mobile 也能跑（这条与 D2a-L7 模式 3 重复，本报告不展开）。Phase 3 把这两层拉到一起裁决。

### 模式 3：driver / 子包的「独立性」在基建层面从未被验证——L10 视角下的补充证据

- 类型：模块间不一致（应该一致但不一致）
- 出现模块：sksp-windows / sksp-mac / sksp-android / tdbc-driver-better-sqlite3 / tdbc-driver-rn / tdbc-conformance / tokenizer-driver-node / tokenizer-driver-rn / cloud-sync-driver-s3（共 9 个 packages/* 子包，D2a-L3 模式 4 已立 S 级）
- 共同特征：D2a-L3 模式 4 已经从依赖图角度立过这条 S 级——driver 全用 dependencies 而非 peerDependencies、workspace link 掩盖双重安装风险、mobile 绕过 registry 直连、mobile 测试 stub undefined、三端 vfs-zip 校验不同。本报告**不重复 L3 的依赖图判定**，只补 L10 视角下的基建层证据：这些 driver / 子包作为独立 workspace package，**没有任何一层工程化基建验证过它们的「独立性」**。
- L10 视角的补充证据：
  - **8 个子包完全无 lint 脚本无 eslint 配置**（D1-10 A 级）：cloud-sync-driver-s3、sksp-mac/windows/android、tdbc-conformance、tdbc-driver-better-sqlite3/rn、tokenizer-driver-node/rn——根的 `npm run lint --workspaces --if-present` 对它们是 no-op。这意味着 driver 包内部代码（加解密、SQL driver 适配、token 切分）**从来没有被任何 lint 规则扫过**，质量纯靠 code review 自觉。
  - **2 个子包没有任何 test 脚本**（D1-10 A 级 + D1-07 已立项）：sksp-android 和 tokenizer-driver-rn 连 `test` 脚本都没有，是测试基建层面的完全盲区。叠 D2-provider-llm 的 SKSP 加解密信任面（L8 §4.1 已认证正面）和 D2-compaction 的 tokenizer 三端计数分叉（L6 A-4），这两个包的内部实现从未被机器验证过。
  - **全部 10 个 packages/* + desktop + cli 不声明 engines**（D1-10 A 级）：driver 包普遍依赖 native module（better-sqlite3 / DPAPI / Keychain / Keystore），但 engines 字段全空。到底 sksp-windows 在 Node 20 下能不能跑、tdbc-driver-better-sqlite3 在 Node 22 下 prebuilt binary 可用性如何，仓库里没有任何契约声明，也没有 CI 矩阵验证。
  - **release.yml 只对 mobile/desktop 执行 npm version**（D1-10 C 级）：core/cli + 全部 10 个 packages/* 永远停在 `0.0.0`。也就是说 driver 包作为「独立可发布单元」连版本号都没有，发布流程从未把它们当作可发布物对待。
  - **三端 tsconfig 分裂**（D1-10 A 级）：Node 侧 driver（sksp-windows/mac、tdbc-driver-better-sqlite3、tokenizer-driver-node）走 TS 6.0.3 hoist，RN 侧 driver（sksp-android、tdbc-driver-rn、tokenizer-driver-rn）钉死 TS 5.8.3。同一组 driver 概念（secret store / token counter / db driver）在 Node 侧和 RN 侧用不同 TS 主版本编译，类型定义跨端引用时是否有不兼容痕迹，**没有任何 CI 的 `tsc --noEmit` 会跨包验证**。
- 系统性根因：driver 包的「独立性」只是 `package.json` 描述层的宣称（独立 name / version / description），但 **lint、test、engines、版本号、跨端 TS 兼容性**这五条工程化维度全部不闭合。叠 D2a-L3 的依赖图视角（dependencies vs peerDependencies）+ 切片视角（mobile 直连绕过 registry），driver 现在处于「描述上是独立包、工程上从未被当作独立包对待」的状态——workspace link 让它们一直搭 core 的车，从未独立 build / 独立 test / 独立 lint 过。
- 严重度：**S**（与 D2a-L3 模式 4 同级；L10 补的证据只升不降，因为暴露面从「依赖图结构」扩展到「lint/test/engines/version 全维度不闭合」）
- 建议方向：D2a-L3 已经给过 peer 化整改方向。L10 补的整改要求是——**peer 化整改同时必须把这 8 个子包接入 lint（至少复用 `createTsEslintConfig`）+ 给 sksp-android / tokenizer-driver-rn 补 test 脚本 + 全部 packages/* 补 engines 声明 + release.yml 决定是统一 bump 版本还是文档化「不发版」**。这些是「driver 独立性」的最低验收门槛，否则 peer 化只是把依赖图改对了，包内部的代码质量仍然无把关。Phase 3 把 D2a-L3 模式 4 和本模式合并成单一整改项，依赖图部分归 L3 主导，lint/test/engines 部分归 L10 主导。

### 模式 4：@deprecated 与 dead code 在 core 系统性残留——lint 规则覆盖本身有盲区

- 类型：同一反模式 + god module 的跨模块影响
- 出现模块：core（vfs / agent-tool / prompt / compaction / provider-llm 全部 5 个 core 内切片都有命中）
- 共同特征：6 份切片里 @deprecated / 零引用残留 / 公共面死代码 这一类发现反复出现，且全部集中在 core 这个包：
  - D2-vfs B2：`releaseAndDeleteVfsPrefix` 标 `@deprecated` 但被同模块内部消费（vfs-zip-io.service / vfs-tree-copy 自身 4 处调用点）
  - D2-agent-tool B2：顶层 `index.ts:152-180` re-export `MUTATING_VFS_TOOL_NAMES` / `isMutatingVfsToolName` / `registerVfsTools` / `VfsToolContext` 4 个 V1→V2 alias；`public/agent.ts:17-23` re-export `resolveApplicationModelId` 家族 4 个 alias——全部 `@deprecated`
  - D2-compaction S1：`estimateTokens` 旧启发式路径 src 下零生产引用，但仍挂 `public/compaction.ts:24` 对外导出
  - D2-compaction A2：`CompactionConditionsTrigger` 子接口全工程零引用，schema 草稿残留
  - D2-prompt A（债务清单）：`validatePromptBlocks` / `validatePromptBlocksFromMap` / `PromptBlock` / `shouldIncludePromptTextBlock` 整套遗留 flat-block 路径已无生产引用但仍挂 `public/prompt.ts`
  - D2-prompt B2：`PromptRenderContext.vfs` 字段注释自承「不再读取」、agent-runner 仍往里塞值，声明上的死代码
  - D2-provider-llm B1：`BUILTIN_PROVIDER_IDS` deprecated 别名，语义已从 UUID 变 key 但类型不变（`readonly string[]`），改名不改类型的陷阱
- 各模块差异：残留形态各异（@deprecated alias / 零引用 export / 公共面死导出 / 注释自承退役但仍在用），但 **它们能稳定停留在 core 这个有 lint 的包里**，说明 lint 规则集对这类残留根本没有覆盖。
- 系统性根因：core 接入了 ESLint 9 flat + `eslint.config.base.mjs`，规则集包含 `@typescript-eslint/no-unused-vars`，但这条规则**对 export 的符号默认视为「已使用」**（因为 export 就是面向外部的契约），所以零引用的 public 导出 lint 完全扫不到。`@deprecated` JSDoc 标签也不会触发任何 ESLint 规则。真正能扫这类残留的工具是 knip——但 knip 因为运行器分裂在 desktop 误判 74 个 test 文件、mobile 误判 17 个 e2e 文件（D1-10 A 级 + D2a-L7 模式 3），**knip 报告的可信度已经被打折扣**，即便有人在本地跑过 knip 也无法分辨「这条是真死代码」还是「测试入口识别失败导致的连带误判」。叠 CI 零覆盖（模式 1），knip 从未在 PR 上自动跑过，残留积累完全靠人眼。
- 严重度：**A**（单条 @deprecated 残留是 L9 的 C/B 级问题；但「lint 规则覆盖本身有盲区 + knip 可信度被运行器分裂打折扣 + CI 不跑 knip」三层叠加让这类残留**没有工具能拦**，升到 A。不是 S 因为这类残留不会直接破坏业务正确性，是工程债务）
- 建议方向：分三层。① lint 层：考虑引入专门扫「零引用 public export」的规则（如 knip 在 CI 跑 + 把 desktop/mobile 的测试入口显式登记让 knip 不再误判）；② 流程层：约定 `@deprecated` 必须带 `@deprecated since <version>, removed in <version>` 字段，让「长期挂着的 @deprecated」有时效压力；③ 公共面维护层：Phase 3 应该把 6 份切片里散落的「公共面收尾」需求（D2-vfs B2 / D2-agent-tool B2 / D2-compaction S1+A2 / D2-prompt A / D2-provider-llm B1）合并成一次「public face cleanup」整改批次，因为它们都是同一类残留、同一个根因、同一种修法（删 export 或删 re-export）。这条与 D2a-L3 模式 3（公共合同面从未做过收尾维护）在 Phase 3 强相关，建议合并。

## 覆盖声明

查了的：
- D1-10 全文（含五条工具链脉络对照表 + 9 条发现清单 + 5 条待交叉线索）
- 6 份 D2 切片的「交叉发现」+「债务清单」+「与其他模块的耦合点」+「覆盖声明」全文，逐条把每条 S/A/B 级发现按「是否本该被 CI/lint/knip 拦住」分类
- D2a-L3 模式 4（driver peerDep）+ D2a-L7 模式 3（运行器分裂）+ D2a-L7 模式 1（事务多步写缺失败路径回归测试）作为去重对照，确认本报告不重复 L3 的依赖图判定和 L7 的测试内容判定
- D2a-L1 / D2a-L2 / D2a-L4 / D2a-L5 / D2a-L6 / D2a-L8 未读，因为它们的角度（数据模型 / 算法 / 错误处理 / 并发 / 跨平台 / API 安全）与 L10 的工具链视角不直接交叉；本报告引用的「其他角度发现的业务问题」全部来自 6 份 D2 切片而非其他 D2a 报告，避免二次推断

没查的（及原因）：
- 实现代码（指导文档明示「不读实现代码」，本报告只做 D1 + D2 的二次分析）
- 其他 D2a 报告的完整内容（理由如上；如果 Phase 3 发现 L6 / L8 视角下有 L10 应该但未覆盖的跨模块模式，标 `待回派`）
- pnpm lockfile 里 TS / ESLint 实际锁定的小版本（D1-10 已声明只确认 major 走向，精细版本对齐留待 fix-spec）
- 8 个无 lint 子包的内部代码质量是否「确实更差」（指导文档要求回答这一点，但本报告是 readonly 二次分析，未读子包源码；只能从「这些包从未被任何 lint 扫过 + sksp-android / tokenizer-driver-rn 连 test 都没有」推断「质量无把关」，不能下「质量确实更差」的结论。这点标 `待回派`，建议主代理在 Phase 4 安排一次针对 driver 包源码的 lint 试跑来验证）

## 给 Phase 3 的线索

1. **模式 1（CI 缺失）的合并优先级最高**：Phase 3 应该把 D2a-L7 模式 1（事务多步写缺失败路径回归测试）+ 本报告模式 1 合并成单一整改项——L7 给的是「应该补什么测试」，L10 给的是「为什么这些测试即使补了也跑不起来（CI 没跑）」。两边的整改顺序是 L10 先（补 CI 锁现状）、L7 后（在 CI 上补回归测试）。如果反过来，补的测试在本地能跑、合入后没人跑，等于没补。

2. **模式 3（driver 独立性）和 D2a-L3 模式 4 必须合并裁剪**：两条都标 S 级、都覆盖同一组 8-9 个 driver 包。Phase 3 应该把这两条合并成单一 S 级整改项，分两个维度计分——依赖图结构（L3 主导）+ lint/test/engines/version 工程化维度（L10 主导）。如果两条都各自保留 S，会在 Phase 4 synthesis 时双重计分。

3. **模式 2（mobile 规则洼地）可能和 D2a-L6（跨平台）冲突**：L6 视角下 mobile 的工具链偏离可能被认定为「RN 生态现实约束、合理」；L10 视角下判定为「现实约束但缺乏补偿措施、A 级」。Phase 3 需要拉 L6 一起裁决——mobile 的 tsconfig/ESLint 偏离到底是「接受现状、文档化」还是「补补偿措施（显式 noUnusedLocals / 内部 base / 跨端契约测试）」。本报告的立场是后者，但 L6 如果认为 RN 生态约束太硬，可以下调到 B。

4. **模式 4（@deprecated / dead code）和 D2a-L3 模式 3（公共面收尾）强相关**：两条都指向「public face 需要一次系统性 cleanup」。Phase 3 应合并，避免 6 份切片各自的公共面残留被分散整改。

5. **`待回派` 项**：① 8 个无 lint 子包的内部代码质量是否「确实更差」需要主代理在 Phase 4 安排一次 lint 试跑验证；② `@typescript-eslint peerDep <6.1.0` 的版本地雷（D1-10 C 级）在 TS 6.1 发布后会触发到什么程度，需要持续盯 typescript-eslint 9.x 的发布节奏，这条不在 Phase 3 裁决范围，属于长期监控项。

未宣布 ready。本报告只产出 readonly 评审发现，所有 S/A 级模式均给出依据 + 建议方向，但建议方向需 Phase 3 / 主代理收敛。
