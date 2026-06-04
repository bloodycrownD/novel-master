# Android 原生 Tokenizer 桥接 PRD（迭代内变更）

> **父需求**：[../../prd.md](../../prd.md) · [../../spec.md](../../spec.md)  
> **变更动机**：在 `feature/model-aware-token-counting` 上验证后，**不可在 React Native JS bundle 内使用 `@agnai/sentencepiece-js` / `@agnai/web-tokenizers`**（Metro 无法解析 `fs`、`url` 等 Node 内置模块，且 WASM 加载方式不适配 Hermes）。  
> **分支策略**：继续在 **`feature/model-aware-token-counting`** 上开发；**保留** 已落地的模型名路由、一口径、`countPromptLlmInput`、压缩/CLI、context window；**移除/停用** Mobile 对 `@agnai/*` 的静态依赖。  
> **技术方案**：[spec.md](./spec.md)

## 背景与变更动机

原迭代 PRD 要求 Mobile 与 CLI **同套 ST 级 JS tokenizer**（`@agnai/*` + tiktoken），在 Android 真机/模拟器上通过 Metro 打包。实际结果：

| 现象 | 原因 |
|------|------|
| `Unable to resolve module fs` | `@agnai/sentencepiece-js` 面向 Node |
| `Unable to resolve module url` | `@agnai/web-tokenizers` 使用 Node/WASM 文件加载 |
| 反复 blockList / bridge 仍易漏依赖 | 任何静态 `import '@agnai/*'` 都会被 Metro 解析 |

**结论**：不是「读不到 tokenizer 资产」，而是 **RN 不能运行这套 npm 实现**。要在 Android 上达到原 PRD 对 Claude/Gemini/SP 等族的精度，应走 **Kotlin 原生模块 + TurboModule/NativeModule**，由 JS 只调用 `PromptTokenCounterBridge`。

本变更 **不否定** 父迭代方向（模型名路由、完整 prompt 一口径、context window 分母），**修正** Mobile 实现路径与验收分档。

## 范围变更说明（相对原需求）

### 保留（父迭代已实现或仅需小改）

- `resolveTokenizerFamily(vendorModelId)`，**不依赖** `provider.protocol`。
- 统一入口 `countPromptLlmInput` + `PromptTokenCounterBridge` + `NM_PROMPT_TOKEN_COUNTER_KEY`。
- 压缩 / CLI / Mobile 顶栏 **同一 `PromptLlmInput` 构建链**（含 regex llm 通道）。
- `resolveContextWindowTokens` 作为顶栏 % 与 `tokenThreshold === -1` 分母。
- CLI / Node：`@novel-master/core/tokenizer-node` + `@agnai/*`（**仅 Node**）。
- 用户设置 `tokenCounter.mode`（自动 / 启发式 / 指定族）。

### 变更（本 feature）

| 原 PRD/SPEC 假设 | 本变更后 |
|------------------|----------|
| Mobile 与 Node 共用 `@agnai/*` JS | **禁止** Mobile JS bundle 依赖 `@agnai/*` |
| Mobile 三端与 CLI **同整数** 且全非启发式 | **CLI 为精确基准**；Mobile **M0** 可 ~启发式；**M1** Android 原生后与 CLI **在容差内**一致 |
| 资产单一目录 | **平台分拆**：`apps/mobile/android/.../assets`（或 `android/app/src/main/assets`）+ `apps/cli/assets/tokenizers`（各维护一份，允许重复） |
| iOS 同精度 | **本变更不验收 iOS**（M0/M1 仅 Android） |
| 一次交付含 RN 全族 JS tokenizer | 拆为 **M0（可运行）+ M1（Android 原生精确）** |

### 不包含

- iOS Swift 原生 tokenizer（后续迭代）。
- 远程 tokenizer API。
- 与供应商账单逐 token 对齐。
- 修改 LLM 请求/adapter 逻辑。

## 影响模块与接口

| 模块 | 影响 |
|------|------|
| `@novel-master/core` | **保持** `countPromptLlmInput`、`PromptTokenCounterBridge`、族解析；**不**在 core 增加 JNI |
| `apps/cli` | Node bridge + **CLI 自有** tokenizer 资产目录；`installNodeTokenizerLoader` 读 CLI 路径 |
| `apps/mobile` | **删除** `mobile-prompt-token-counter.js` 中对 `@agnai/web-tokenizers` 的 import；**新增** Android 原生模块（如 `TokenizerModule`）实现 bridge |
| `apps/mobile` JS | M0：`js-tiktoken`（现有 shim）+ 启发式；M1：调原生 `countPrompt(serialized, family, vendorModelId)` |
| Metro | blockList 保留 `@agnai/*`、`*-node.ts` 等；**不再**尝试在 RN 内打包 web/sentencepiece |
| 父迭代 `spec.md` 架构图 | 由本 feature [spec.md](./spec.md) **supersede** Mobile/资产/实现步骤相关章节 |

### 产品接口（行为级）

- 顶栏仍显示 `formatPromptTokenUsageLabel`；`estimated: true` 时带 `~` 或 `(est.)`。
- `counterKind` / `tokenizerFamily` 仍上报；原生路径为 `claude` / `gemma` 等，非 `heuristic`。
- 压缩触发仍用 `countPromptLlmInput`，与顶栏同源。

## 验收标准

### M0 — RN 可运行（必须）

- **Given** Android 模拟器/真机，已安装当前分支构建  
  **When** 启动 App 并进入有消息的聊天页  
  **Then** Metro **无** `fs` / `url` / `@agnai/*` 解析错误；顶栏 token 标签可显示。

- **Given** 模型 `vendorModelId` 含 `gpt-4o`  
  **When** 刷新顶栏 token  
  **Then** `estimated === false`，`counterKind` 为 `tiktoken`（或等价）。

- **Given** 模型 `claude-3-5-sonnet` 或 `gemini-2.0-flash`（M0 未上原生）  
  **When** 刷新顶栏  
  **Then** 显示 token 数且 **`estimated === true`**（启发式），**不崩溃**。

- **Given** 与 CLI 同一 fixture session  
  **When** 对比 `nm prompt render --tokens` 与 Mobile 顶栏（同模型 GPT）  
  **Then** **GPT** token 整数与 CLI **相等**（0 容差）。

### M1 — Android 原生精确（必须）

- **Given** 已集成 Kotlin tokenizer（SentencePiece + 至少 Claude web-json 或 HF tokenizers 方案之一，见 SPEC）  
  **When** 模型为 `openai/claude-3-5-sonnet`（OpenAI 兼容 Provider）  
  **Then** `estimated === false`，`tokenizerFamily === 'claude'`，与 CLI `--tokens` 偏差 **≤ 本 SPEC 锁定容差**。

- **Given** 模型 `gemini-2.0-flash`  
  **When** 刷新顶栏  
  **Then** `tokenizerFamily === 'gemma'`，`estimated === false`，与 CLI 偏差在容差内。

- **Given** 模型 `openai/gpt-4o`  
  **When** M1 启用后  
  **Then** 仍可用 JS tiktoken 或原生（SPEC 二选一），与 CLI 一致；**不得**因原生回退而劣于 M0。

- **Given** 完整 prompt 含 system + worktree + 消息  
  **When** 压缩阈值边界测试  
  **Then** 与顶栏 `countPromptLlmInput` **同值**（与父迭代一致）。

### 回归

- `packages/core` 测试全绿；`apps/cli` prompt-tokens e2e 全绿；`apps/mobile` 相关测试全绿。
- 父迭代已交付的 **usage 解析** 行为不退化。

## 测试用例

| ID | 类型 | 描述 |
|----|------|------|
| M0-B1 | 手工 | 冷启动 App，确认 Metro bundle 成功 |
| M0-B2 | 手工 | `gpt-4o` 顶栏非估算 |
| M0-B3 | 手工 | `claude-*` 顶栏估算但不闪退 |
| M0-U1 | 单测 | `countPromptLlmInput` 无 bridge 时 Node 动态 import 仍可用（CLI 测试） |
| M1-U1 | Android 仪器/单元 | 原生模块对固定字符串计数 > 0 |
| M1-U2 | 集成 | Mobile service：claude 模型 `estimated === false` |
| M1-I1 | 集成 | 同 fixture：CLI stderr `tokenCount` vs Mobile bridge（claude/gemma/gpt） |
| REG-1 | 回归 | `npm test -w @novel-master/core` |
| REG-2 | 回归 | `npm test -w @novel-master/mobile` |

---

**请确认本 PRD**。确认后可按 [spec.md](./spec.md) 在 **`feature/model-aware-token-counting`** 分支继续实现（先 M0 清理 JS 依赖，再 M1 原生模块）。
