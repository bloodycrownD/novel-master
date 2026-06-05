# NMTP（Novel Master Tokenizer Protocol）PRD

> **边界**：本文件为产品需求（PRD），不含接口设计、模块拆分、依赖版本等技术 SPEC。  
> **关联**：[model-aware-token-counting](../model-aware-token-counting/prd.md)（已交付模型感知计数、Android 原生 tokenizer 桥接、CLI/Mobile 统一口径）；本迭代 **不改变** 其计数规则、tokenizer 族覆盖与序列化口径，仅将平台实现 **协议化**，对齐 [TDBC](../TDBC/prd.md) / [SKSP](../sksp/prd.md) 的 driver 模式。  
> **命名**：对外称 **NMTP**；Node 侧 driver 称 **tokenizer-driver-node**（非「Windows driver」），因同一实现可供 CLI、Electron 等 Node 运行时复用。

## 背景

Novel Master 已具备完整的本地 token 估算能力：`countPromptLlmInput`、按 `vendorModelId` 路由 tokenizer 族、压缩阈值 / CLI `--tokens` / Mobile 顶栏三端同口径，以及 Android 原生 tokenizer（WEB/SP 族）与 Node 侧 `@agnai/*` + tiktoken 实现。

但平台接入方式与 TDBC、SKSP **不一致**：

- 平台能力通过 `globalThis` 注入（`NM_PROMPT_TOKEN_COUNTER_KEY`、`NM_TOKENIZER_LOADER_KEY`），隐式、难发现、测试易泄漏；
- Mobile tokenizer 逻辑散落在 `apps/mobile/src/tokenizer/`，CLI 逻辑在 `apps/cli/src/tokenizer/`，未形成独立 driver package；
- `@novel-master/core` 为服务 Node 计数路径携带 `tiktoken`、`@agnai/*` 等重依赖，与「core 零平台依赖」的 TDBC/SKSP 原则不符。

用户要求：建立 **NMTP** 协议，本次交付 **Android RN driver + Node driver**，架构干净、不保留 global bridge 技术债。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 架构一致性 | `packages/core` 内 `infra/tokenizer` 提供 **port + registry**（类比 `infra/tdbc`、`infra/sksp`）；平台通过 `registerTokenizerDriver()` 注册；运行时 `resolveTokenizerDriver()` 解析；**无** `globalThis` bridge 残留 |
| core 瘦身 | `@agnai/*`、`tiktoken` 等平台重依赖 **下沉** 至 `tokenizer-driver-node`；`@novel-master/core` 仅保留 heuristic fallback、序列化、族解析、registry 与 port 定义 |
| 零行为回归 | 相同 fixture 下，压缩触发、CLI `prompt render --tokens`、Mobile 顶栏 token 标签的 **数值与 `counterKind` / `estimated` 语义** 与重构前一致（允许测试容差内浮点差异） |
| 双 driver v1 | **tokenizer-driver-rn**（Android RN，含现有 Kotlin `TokenizerModule` 能力）、**tokenizer-driver-node**（Node，供 CLI / 未来 Electron）；启动时显式 register |
| 质量 | `packages/core`、两个 driver 包、CLI、Mobile 相关测试 **全绿**；新增 registry 解析与未注册失败路径用例 |

## 用户与场景

| 角色 | 场景 |
|------|------|
| Mobile 对话用户 | 顶栏 token 占用显示与压缩时机 **与现网一致**；无感知架构变更 |
| CLI / Prompt 作者 | `nm prompt render --tokens` 输出与 stderr 元数据 **与现网一致** |
| 库维护者 | 新增平台（如 iOS、Electron 打包环境）时，按 TDBC/SKSP 惯例新增 driver package + `registerTokenizerXxxDriver()`，无需改 core 业务逻辑 |
| 贡献者 / 测试 | 测试套件通过 `clearTokenizerDrivers()` 清理 registry，无 global 副作用泄漏 |

## 范围

### 包含范围

1. **NMTP 协议（PRD 层）**
   - 定义平台 **TokenizerDriver** 契约：至少覆盖完整 prompt 计数（`countPromptLlmInput` 等价能力）；Node driver 另提供 tokenizer 模型资产读取（现 `TokenizerLoader` 职责）。
   - core 内 **registry**：`registerTokenizerDriver` / `resolveTokenizerDriver` / `clearTokenizerDrivers`（测试用）；未注册时 **明确失败**，不回退 silent global。
   - 保留现有 **计数口径**：`serializePromptLlmInput`、`resolveTokenizerFamily`、`TokenCounterRegistry` 注入 compaction 的用法不变；仅「重计数执行」改由 driver 承担。

2. **包结构（意向，SPEC 定名与导出路径）**
   - `@novel-master/core`（或 `@novel-master/core/tokenizer` 子路径）：NMTP port、registry、heuristic、序列化、族解析；**无** Node/RN 原生依赖。
   - `@novel-master/tokenizer-driver-node`：Node 全族计数（`@agnai/*`、tiktoken）、资产 loader；`registerTokenizerNodeDriver()`。
   - `@novel-master/tokenizer-driver-rn`：RN 计数（js-tiktoken GPT 系、Android 原生 WEB/SP、heuristic fallback）；`registerTokenizerRnDriver()`；Kotlin 模块随 RN driver 包或邻接目录维护。

3. **启动接线**
   - Mobile：`getMobileConnection` 或等效启动路径中，与 `registerRnDriver()` / `registerSkspAndroidDriver()` **并列** 调用 `registerTokenizerRnDriver()`；移除 `polyfills.ts` 内 global bridge 安装。
   - CLI：`runtime.ts` 中与 TDBC/SKSP register **并列** 调用 `registerTokenizerNodeDriver()`；移除 `installNodePromptTokenCounter` / `installNodeTokenizerLoader` 写 global 的逻辑。

4. **迁移与清理**
   - **删除** `NM_PROMPT_TOKEN_COUNTER_KEY`、`NM_TOKENIZER_LOADER_KEY` 及所有引用。
   - 将 `apps/mobile/src/tokenizer/`、`apps/cli/src/tokenizer/` 中平台实现 **迁入** 对应 driver package；app 层仅保留 register 调用（或极薄 re-export）。
   - `countPromptLlmInput` 统一经 registry 解析 driver，不再 dynamic import 隐式 Node 模块作为默认路径（Node 行为由已注册 driver 提供）。

5. **测试**
   - core：registry 单测、未注册错误、heuristic 与序列化回归。
   - driver 包：与现有机组对等的计数用例（GPT tiktoken、WEB/SP 族、heuristic fallback）。
   - 集成：CLI `--tokens`、Mobile token label、compaction token threshold 冒烟不回归。

### 不包含范围

1. **iOS tokenizer driver** — 后续迭代；架构预留 registry 多 driver 名。
2. **计数能力变更** — 不新增 tokenizer 族、不调整 `resolveTokenizerFamily` 规则、不修改 `serializePromptLlmInput` 口径、不改变 context window 表。
3. **llm-protocol / 消息发送链路** — 不合并 NMTP 与 provider adapter；orphan `tool_result` 等发送侧逻辑不在本迭代。
4. **API usage 解析** — `LlmChatResult.usage` 既有行为不变。
5. **用户可见新功能** — 无新设置项、无顶栏 UI 改版；纯架构重构。
6. **Electron 应用打包** — 本期仅交付 Node driver 包，Electron 接入为后续消费方。

## 核心需求

1. **协议对齐 TDBC/SKSP**：core 定义 port + registry；平台 driver 独立 package；app 启动显式 register；业务代码通过 `resolveTokenizerDriver()` 获取实现。
2. **彻底移除 global bridge**：不得保留 deprecated shim；未 register 时错误信息须指明调用方应执行的 register 函数（如 CLI / Mobile 启动路径）。
3. **Node driver 平台无关**：命名与实现不绑定 Windows；同一 driver 供 CLI 与未来 Electron 使用。
4. **Android RN driver 能力不降**：GPT 精确计数、Android 原生 WEB/SP、不可用时的 heuristic + `estimated: true` 与现网一致。
5. **core 依赖收敛**：`@novel-master/core` 的 `package.json` 移除 `tiktoken`、`@agnai/sentencepiece-js`、`@agnai/web-tokenizers`（或等价重依赖）；改由 `tokenizer-driver-node` 声明。
6. **三端计数入口不变**：对外仍导出 `countPromptLlmInput`、`TokenCounterRegistry`、`createDefaultTokenCounterRegistry` 等稳定 API；调用方签名无破坏性变更。
7. **测试可清理**：提供 `clearTokenizerDrivers()`，单测/集成测不与 global 状态耦合。

## 验收标准

### 架构与注册

- [ ] **Given** 未调用任何 `registerTokenizerDriver`，**When** 调用 `countPromptLlmInput`，**Then** 抛出可读错误，提示需注册 Node 或 RN driver（非 undefined 行为、非静默 heuristic）。
- [ ] **Given** CLI `runtime.ts` 启动，**When** 执行 `nm prompt render --tokens`，**Then** 使用已注册的 Node driver，**无需** global bridge。
- [ ] **Given** Mobile `getMobileConnection` 完成初始化，**When** 调用 `loadChatPromptTokenLabel`，**Then** 使用已注册的 RN driver，**无需** `polyfills` 写 global。

### 零行为回归

- [ ] **Given** 团队约定的 fixture 模型（如 `gpt-4o`、`claude-3-5-sonnet`、`gemini-2.0-flash`）与固定 `PromptLlmInput`，**When** 重构前后各执行 `countPromptLlmInput`，**Then** `tokenCount`、`counterKind`、`estimated` 与重构前一致或在 documented 容差内。
- [ ] **Given** 相同 session 与 compaction 条件，**When** token 阈值触发判断，**Then** 触发 / 不触发结果与重构前一致。
- [ ] **Given** CLI `prompt render --tokens`，**When** 指定 `--model`，**Then** stdout/stderr 输出格式与元数据字段与重构前一致。

### core 瘦身

- [ ] **Given** `@novel-master/core/package.json`，**Then** 不包含 `tiktoken`、`@agnai/sentencepiece-js`、`@agnai/web-tokenizers`（或 SPEC 锁定的等价列表）。
- [ ] **Given** 仅依赖 core 的纯逻辑单测（heuristic、serialize、族解析），**Then** 无需安装 Node tokenizer 资产即可运行。

### 清理

- [ ] 代码库中 **无** `NM_PROMPT_TOKEN_COUNTER_KEY`、`NM_TOKENIZER_LOADER_KEY` 字符串残留（含测试 helper，除非 SPEC 明确迁移期例外——本 PRD **不允许**）。
- [ ] `apps/mobile/src/tokenizer/` 与 `apps/cli/src/tokenizer/` 不再承载 driver 实现主体（可保留 re-export 或删除）。

### 质量

- [ ] `packages/core`、`tokenizer-driver-node`、`tokenizer-driver-rn`、相关 CLI/Mobile 测试 **全绿**。
- [ ] 新增 registry 单测覆盖：单 driver 自动解析、多 driver 须显式名、clear 后隔离。
