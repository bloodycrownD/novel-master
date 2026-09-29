---
date: 2026-09-28
---

# fallback-caliber-align 技术规格（SPEC）

## 设计目标

修复 counterKind 谎报（node WEB/SP 失败分支、Kotlin 失败分支）、Android 失败兜底对齐 cl100k、四处编码表缓存收敛为 core registry 单一实现、RN countTiktoken 升级真值。本 feature 是迭代地基：message-token-cache 与 token-source-label 依赖本 feature 的表源与口径稳定。需求来源：`docs/Iterations/context-usage-overhaul/features/fallback-caliber-align/prd.md`。

## 总体方案

四条改造线：

**A. registry 收敛**：core 新增 `infra/tokenizer/encoding-registry.ts`——零分词器依赖的「容器 + 键规范 + 生命周期」模块，构造器由各端注入（node 注入 WASM tiktoken 构造、RN/renderer 注入 js-tiktoken 构造）。键统一 `enc:<encodingName>` 单命名空间（node 现有 `model:` 命名空间废除，model→encoding 解析上游化）。生命周期语义沿用现有两份驱动缓存的不变量：失败缓存 null、**TTL 5 分钟后允许重试**（OQ#6 轻量解）、共享句柄绝不 `free()`、测试钩子「清缓存 / 换构造器」分离。物理边界：desktop main（WASM）与 renderer（js-tiktoken）跨进程，收敛目标定义为「每进程内单一实例 + 三端共用同一段实现代码」。

**B. 消费方接驳**：node 驱动 `impl/encoding-cache.ts` 与 RN 驱动 `impl/encoding-cache.ts` 改为 registry 薄包装（保留既有导出签名，内部转 registry，避免下游大面积改 import）；desktop renderer `stream-token-estimator.ts` 的自建第 4 处单例改用 registry（注入 js-tiktoken 构造器，经 `@shared/logic/encoding.ts` 独立文件具名薄再导出遵守 X1 门禁——cr-func 实现拍板）；双端预热（`scheduleCl100kEncodingWarmup` / `primeStreamTokenModelHint`）写进 registry。mobile shim 在 `countTiktoken` 改走驱动缓存后唯一生产消费者消失 → 删除 shim 与 Metro alias（`metro.config.js:305-307`）。

**C. 谎报与 Kotlin 契约**：node `count-prompt-llm-input.ts:129/:134` 按 `estimated` 降级 counterKind；Kotlin 侧删 `TokenizerEngine.heuristic` 折算与 catch-all resolve、失败一律 `reject`（JS `countPromptViaNative` 的 catch→null 分支现成承接，JS 无需改动识别逻辑）。

**D. countTiktoken 升级**：表源从 `import("tiktoken")`（shim）改 `getRnEncoding`（经驱动薄包装进 registry）、删 `enc.free()`、OpenAI 消息包装对齐 node 精确档（`count-openai-style-message` 逻辑从 node 驱动包下沉 core `infra/tokenizer/logic/count-openai-style-message.ts`，node 驱动改为 re-export，RN 复用；**encode 的分块包装由 message-token-cache feature 在 core 下沉版内统一认领，本 feature 下沉时保持原样不包装**——spec-check 第 1 轮 P1-5 定稿，避免双重包装）、成功后报 `{counterKind:"tiktoken", estimated:false}`。**边界声明（P1-1）**：`RnEncodingName` 仅 cl100k/o200k 两表——p50k/gpt2 家族模型（如老 gpt-3.5-turbo 系）在 RN 恒走 cl100k 兜底、**报 heuristic/est=true 不冒充精确**（不扩 ranks 引入，避免 Metro 包体增大；对拍用例限定两表覆盖域）。实现拍板（cr-func 补注）：encName 解析为两跳——vendorModelId 直查官方映射优先，**认识但出界（如 text-davinci-003/p50k）立即判 null 走兜底**（防 core 映射改写成 cl100k 冒充精确），不认识才走 `mapVendorModelIdToTiktokenModel` 第二跳。

## 最终项目结构

```
packages/core/src/infra/tokenizer/
  ├─ encoding-registry.ts                    [新增] 容器+键规范+TTL重试+测试钩子
  ├─ logic/count-openai-style-message.ts     [新增] 自 node 驱动下沉，双驱动复用
  └─ index.ts / public/provider.ts           [改] 导出新模块（快照 allowlist 联动）
packages/tokenizer-driver-node/src/
  ├─ impl/encoding-cache.ts                  [改] registry 薄包装；model: 键废除
  ├─ logic/count-openai-style-message.ts     [改] 改为 core re-export
  └─ count-prompt-llm-input.ts               [改] :129/:134 counterKind 降级
packages/tokenizer-driver-rn/src/
  ├─ impl/encoding-cache.ts                  [改] registry 薄包装
  └─ count-prompt-llm-input.ts               [改] countTiktoken 重写（表源/分块/包装/真值/去 free）
packages/tokenizer-driver-rn/android/.../
  ├─ TokenizerEngine.kt                      [改] 删 heuristic 折算；失败抛错
  └─ TokenizerModule.kt                      [改] catch-all 改 reject
apps/mobile/src/shims/tiktoken.js            [删] 连同 metro.config.js alias
apps/desktop/renderer/hooks/stream-token-estimator.ts  [改] 单例改 registry
```

## 变更点清单

| 文件 | 变更 |
|---|---|
| `packages/core/src/infra/tokenizer/encoding-registry.ts` | 新增：`getEncoding(name, build)` / `clearForTests` / `setFactoryForTests`；null 缓存记 `failedAt`，超 TTL 5min 重试 |
| `packages/core/src/infra/tokenizer/logic/count-openai-style-message.ts` | 自 `tokenizer-driver-node/src/logic/` 下沉。**类型依赖修正（P1-2）**：原文件 :8 `import type { Tiktoken } from "tiktoken"`，core 运行时 deps 无该包（devDependencies 已有 `js-tiktoken ^1.0.21`，无需新增）——下沉版改本地窄接口（`interface TokenEncoder { encode(text: string): ... }`，结构兼容即可，推荐）或 `js-tiktoken/lite` 类型；node 驱动改 re-export 时**须覆盖全部导出面**（countOpenAiStyleMessages / countWebTokenizerMessages / wrapSerializedPromptAsSystemMessage / OpenAiStyleMessage 等全部符号——`impl/web-tokenizer-counter.ts:14-18` import 了其中三个，re-export 面不全会编译失败） |
| `packages/tokenizer-driver-node/src/impl/encoding-cache.ts` | 内部转 registry：`getNodeEncodingForModel` = 解析 model→encName 后 `getEncoding("enc:"+name, wasmbuild)`；`model:` 键空间删除；导出签名不变 |
| `packages/tokenizer-driver-node/src/count-prompt-llm-input.ts` | :129/:134 `counterKind: web.estimated ? "heuristic" : family`（sp 同理） |
| `packages/tokenizer-driver-rn/src/count-prompt-llm-input.ts` | `countTiktoken` 重写：`getRnEncoding(encName)`（encName 经 `mapVendorModelIdToTiktokenModel` + 编码名解析，参照 mobile `resolveStreamTokenEncodingName` 先例，产出限定 cl100k/o200k 两值；p50k/gpt2 家族解析不出则按边界声明走兜底报 heuristic）→ `countOpenAiStyleMessages`（下沉版原样，分块包装由 tc feature 认领）→ 报真值；删 `import("tiktoken")`、`enc.free()`、`__test__.setTiktokenModuleForTests` 钩子改为表源注入形态 |
| `TokenizerEngine.kt` / `TokenizerModule.kt` | 删 `heuristic()`（companion 内 **:129-133**）及调用点（**实测 7 处**：Engine 内 :30/:34/:43/:51/:92/:97 共 6 处 + Module catch 块 :38 一处）：资产缺/加载失败/编码异常一律 throw；Module catch-all 由 resolve(heuristic) 改 `promise.reject`。**编译连带（P1-3）**：`TokenizerParityTest.kt` :53/:57/:97 三处直调 `TokenizerEngine.heuristic` 须一并改造 |
| `apps/mobile/src/shims/tiktoken.js` + `metro.config.js:305-307` | 删除（唯一消费者消失；`apps/mobile/__tests__/mobile-prompt-token-counter.test.ts:149` 的钩子同步改造） |
| `apps/desktop/renderer/hooks/stream-token-estimator.ts` | 自建 `cl100kEncoding` 单例改经 `@shared/logic/format.ts` 再导出的 registry 入口，注入 js-tiktoken 构造器 |
| `apps/desktop/src/main/runtime/create-desktop-runtime.ts` | 预热不变（经薄包装进 registry） |
| Metro dist smoke（`metro.config.js:11-39`） | core 新文件按需追加 smoke 条目 |
| `packages/core/test/package-exports/snapshots/public-provider-allowlist.json` | 新导出联动 |

## 详细实现步骤

- Step 1 — phase-align-registry — blocking: yes — qa: auto：core 新增 `encoding-registry.ts`（键 `enc:<name>`、null+TTL 5min 重试、不 free、测试钩子分离）+ `count-openai-style-message.ts` 下沉（类型按 P1-2 修正、导出面经 node re-export 全覆盖）+ 导出面与快照 + **core typecheck 通过** + 单测（T-FA1/T-FA2）。
- Step 2 — phase-align-drivers — blocking: yes — qa: auto：node/rn 驱动 `encoding-cache.ts` 转 registry 薄包装，node `model:` 键废除（上游解析）；驱动既有测试全绿（T-FA3）。
- Step 3 — phase-align-node-kind — blocking: yes — qa: auto：node `count-prompt-llm-input.ts` counterKind 降级两行 + 驱动测试补 WEB/SP 加载失败分支的 driver 层 counterKind 断言（impl 层已有 estimated 断言，缺 driver 层失败分支）（T-FA4）。
- Step 4 — phase-align-kotlin — blocking: yes — qa: auto：Kotlin 删折算、失败改 reject；`android-native-bridge.ts` 无需改（catch→null 现成）。**测试路径（P1-3）**：`TokenizerEngine` 构造需 android Context 且依赖树无 Robolectric——把「forFamily 无资产 spec / kind 未知 → throw」分支抽为 companion 静态纯函数 JVM 直测；资产加载/编码异常路径在 `TokenizerParityTest` 层改造（:53/:57/:97）以异常断言覆盖；`TokenizerEngineTest` 补静态函数失败用例 + mobile mock 桥 reject → JS fallbackCount 路径 + counterKind=heuristic（T-FA5）。
- Step 5 — phase-align-rn-exact — blocking: yes — qa: auto：`countTiktoken` 重写（表源/下沉包装/真值/去 free；分块包装由 tc feature 认领）+ `mobile-prompt-token-counter.test.ts` 改造（T-FA6）。
- Step 6 — phase-align-renderer — blocking: yes — qa: auto：renderer estimator 接 registry；删 shim 与 Metro alias；desktop `js-tiktoken-hook` 构造计数断言复核（T-FA7）。
- Step 7 — phase-align-verify — blocking: yes — qa: manual_user：Android 出包真机验证（Kotlin 契约变更 + GPT 家族真值 + 原生失败路径）；真机按 RULE 出包配方（短路径 junction + 清 .cxx），验收记录落 feature 目录。

## 测试策略

### 测试用例

- T-FA1 — blocking: yes — registry 单测（core `test/infra/tokenizer/encoding-registry.test.ts`）：同键同构造器只构造一次；失败缓存后 5 分钟内不重试、超时重试成功（注入假时钟）；`clearForTests` 与 `setFactoryForTests` 互不干扰。
- T-FA2 — blocking: yes — 下沉的 `count-openai-style-message` 与 node 原实现输出**逐字节一致**（对拍用例搬迁）。*时序注记（P1-5）：message-token-cache 合并后该模块 encode 接分块包装，逐字节基准届时迁移至 T-TC5 的 ≤1% 容差口径——本条基准在 fa 单独合入阶段有效。*
- T-FA3 — blocking: yes — 双驱动既有测试（`tokenizer-driver-node/test/*`、desktop `chat-prompt-tokens.test.ts`、mobile `mobile-prompt-token-counter.test.ts`）全绿，`model:` 键废除后 model 路径仍正确解析。
- T-FA4 — blocking: yes — node 驱动：模拟 WEB 资产加载失败（factory 注入抛错）→ `counterKind="heuristic"` + `estimated=true`（driver 层已有成功路径 counterKind 断言，本条补的是 **WEB/SP 失败分支**的 driver 层断言；改回谎报实现必红）。
- T-FA5 — blocking: yes — Kotlin `TokenizerEngineTest` 补失败路径（无资产家族/损坏资产 → 异常传播，不再返回折算值）；mobile mock 桥 reject → JS fallbackCount 路径 + counterKind=heuristic。
- T-FA6 — blocking: yes — rn countTiktoken：GPT 家族（**夹具限定 cl100k/o200k 覆盖域，如 gpt-4o / gpt-4 类模型名**）返回 `tiktoken`/`estimated=false`；数值与 node 精确档同口径（同文本对拍，容差 0——同算法同表）；p50k 家族模型名走兜底报 heuristic（边界声明锁定）；无 free 调用（静态断言或行为：连续两次计数第二次不炸）。**注意：本条不含 12K 病态串性能断言**——fa 阶段 encode 仍是整串路径（12K 无空白串实测 88~93s 病态），分块保护由 message-token-cache 落地后以 T-TC4 锁定；fa 的性能夹具须避开病态输入（正常文本即可）。
- T-FA7 — blocking: yes — 构造计数拆两层：**renderer 侧**沿用 `test/js-tiktoken-hook.mjs`（只拦 js-tiktoken/lite）断言 estimator 只构造一次；**main 侧**用 `__setNodeEncodingFactoryForTests` 注入计数构造器断言（WASM tiktoken 不在 hook 范围），并写明 `model:` 键废除后「精确档与 cl100k 预热共享同键、构造 =1」的新预期与注释更新。

## 风险与回滚方案

- **Kotlin 契约变更是原生改动**：回滚 = revert Kotlin 两文件 + JS 侧 `mapNativeResult` 恢复透传（JS 侧本 feature 不改识别逻辑，回滚面小）。Android SP 家族读数将从「恒折算」变「恒 cl100k」，方向更准但数值会变——CHANGELOG 显式登记。
- **shim 删除**：若有未探明的第三方依赖 `import("tiktoken")`，Metro 解析会炸——Step 6 前全局 `grep -rln "tiktoken"` 复核（已知消费者：rn 驱动 countTiktoken 与 mobile 测试）。回滚 = 恢复 shim 文件与 alias（git revert 即可，无数据面）。
- **registry TTL 重试**新语义若与某端预热互斥（预热失败后立刻被 TTL 允许的重试打穿）：TTL 起点为失败时刻，预热间隔远小于 5 分钟，无冲突；护栏测试锁定。
- **X1 门禁**：renderer 接 registry 必须经 `@shared/logic` 再导出（先例 `format.ts`），不得直连 core——lint 门禁自动把关。
