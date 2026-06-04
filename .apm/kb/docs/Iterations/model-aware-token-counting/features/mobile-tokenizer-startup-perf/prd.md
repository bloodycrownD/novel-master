# Mobile Tokenizer 启动性能优化 PRD（迭代内变更）

> **父需求**：[../../prd.md](../../prd.md)  
> **前置 feature**：[../android-native-tokenizer-bridge/prd.md](../android-native-tokenizer-bridge/prd.md)（M1 原生桥已落地）  
> **技术方案**：[spec.md](./spec.md)

## 背景与变更动机

M1 在 Android 上通过 `NovelMasterTokenizer` + `android/app/src/main/assets/tokenizers/` 实现精确计数，但 **`polyfills.ts` 仍在启动时加载 `mobile-tokenizer-loader.js`**，该文件对约 **48MB** 的 JSON / `.model` 做静态 `require()`，导致：

- Metro **JS bundle 体积与解析时间**显著增加，冷启动变慢；
- 与 Android 原生资产 **重复打包**（JS bundle + APK assets 双份）；
- 用户体感「应用加载慢了很多」。

M1 之后 Android **不再依赖** JS 侧 `NM_TOKENIZER_LOADER_KEY` 做 WEB/SP 计数；保留 loader 属于遗留路径，应移除以恢复启动性能。

**本变更目标**：在 **不改变** M1 计数口径与 CLI 对齐的前提下，降低 Android 冷启动与首屏卡顿。

## 范围变更说明（相对 android-native-tokenizer-bridge）

### 保留

- `countPromptLlmInput` + `PromptTokenCounterBridge` + 模型名路由。
- Android 原生 `NovelMasterTokenizer` 与 `TokenizerEngine`（DJL WEB/SP）。
- CLI `apps/cli/assets/tokenizers` 与 Node `tokenizer-node` 路径。
- M1 parity 测试与容差约定（claude / gemma 等）。
- GPT 在 RN 内仍用 `js-tiktoken`（精确），但允许 **按需加载** 模块。

### 变更（本 feature）

| 项 | 变更后 |
|----|--------|
| `mobile-tokenizer-loader.js` | **删除**；Android 不再 `installMobileTokenizerLoader` |
| `apps/mobile/assets/tokenizers/` | **从 Metro/JS 构建中移除**（可保留目录作 CLI 同步源或文档说明，但不得被 RN `require`） |
| Android APK assets | **裁剪**未使用文件（如 `nerdstash*.model`）；仅保留 `TokenizerAssetPaths` 所需族 |
| 顶栏 token 标签 | **延迟显示**：先进聊天显示 `…` 或占位，**后台** `countPromptLlmInput` 完成后更新 |
| `js-tiktoken` | **动态 import**，仅在 `tiktoken`/`gpt2` 族或用户覆盖需要时加载 |

### 不包含

- iOS 原生 tokenizer（iOS 仍启发式；仅顺带去掉无用 JS loader 引用若存在）。
- 修改压缩阈值算法或 `serializePromptLlmInput` 格式。
- 远程 tokenizer、新模型族。
- ARM SentencePiece JNI 打包问题（属 M1 follow-up，本 feature 不承诺解决真机 SP 回退）。

## 影响模块与接口

| 模块 | 影响 |
|------|------|
| `apps/mobile/src/polyfills.ts` | 移除 `installMobileTokenizerLoader`；仅保留 `installMobilePromptTokenCounter` |
| `apps/mobile/src/tokenizer/mobile-tokenizer-loader.js` | **删除** |
| `apps/mobile/src/tokenizer/mobile-prompt-token-counter.js` | GPT 路径改为 lazy `import('tiktoken')`（或等价 shim） |
| `apps/mobile/src/services/chat-prompt-tokens.service.ts` | 无 API 变更；行为仍调 `countPromptLlmInput` |
| `apps/mobile/src/screens/tabs/ChatTabScreen.tsx` | `refreshChatMeta`：token 标签先占位再异步刷新（与现有 `…` 模式对齐） |
| `android/app/src/main/assets/tokenizers/` | 删除 nerdstash 等未引用资产 |
| `packages/core` `get-tokenizer-loader.ts` 错误文案 | 更新 Mobile 提示（不再提及 `installMobileTokenizerLoader`） |
| 测试 | 更新/删除依赖 JS loader 的用例；parity/Jest 保持绿 |

**产品行为**：用户仍看到顶栏 token；首帧可能短暂为 `…`，数百 ms～数秒内变为精确/估算值（与原生首次加载 DJL 有关）。

## 验收标准

### 体积与启动

- **Given** 变更前后各执行一次 release/dev Android bundle 构建  
  **When** 对比 Metro 产出的 JS bundle 大小（或 `npx react-native bundle` 输出文件大小）  
  **Then** **减少 ≥ 30MB**（相对仍包含全部 `assets/tokenizers` require 的基线）。

- **Given** 裁剪后 APK  
  **When** 对比 `android/app/src/main/assets/tokenizers` 总大小  
  **Then** 不含 `nerdstash*.model` 且不低于 M1 所需 12 族资产完整性。

- **Given** 冷启动（清数据后启动 App 至聊天 Tab 可交互）  
  **When** 同一设备/模拟器手工对比变更前后（或团队记录 baseline）  
  **Then** 主观/计时 **不慢于 M1 之前体感** 或明显改善；**不得**因删除 loader 导致启动崩溃。

### 计数口径（回归）

- **Given** Android，`vendorModelId` 为 `gpt-4o` / `claude-3-5-sonnet` / `gemini-2.0-flash`  
  **When** 顶栏 token 后台计算完成  
  **Then** 与 M1 一致：`gpt` → `estimated: false`；claude/gemma 在原生可用时 `estimated: false`；失败仍启发式且不崩溃。

- **Given** 现有 `TokenizerParityTest` / `prompt-tokens-e2e` / mobile Jest  
  **When** CI 或本地全量相关测试  
  **Then** **全绿**（允许更新快照/文案，不允许计数整数回归）。

### 顶栏 UX

- **Given** 进入有 session 的聊天页  
  **When** `refreshChatMeta` 触发  
  **Then** **立即** 显示 agent/model 元数据；token 为 `…`（或空）**不阻塞**首屏列表渲染；计算完成后更新为最终标签。

## 测试用例

| ID | 类型 | 描述 |
|----|------|------|
| PERF-1 | 构建 | `react-native bundle` 产出体积低于基线（记录 before/after 字节数） |
| PERF-2 | 手工 | 冷启动：App 可进入聊天 Tab，无红屏 |
| UX-1 | 手工 | 进聊天先见 `…`，随后 token 数字更新 |
| REG-1 | 自动 | `npm test -w @novel-master/mobile` |
| REG-2 | 自动 | `./gradlew :app:testDebugUnitTest`（含 parity） |
| REG-3 | 自动 | `npx tsx --test apps/cli/test/prompt-tokens-e2e.test.ts` |
| REG-4 | 自动 | `npm test -w @novel-master/core` |

---

**请确认本 PRD**。确认后可按 [spec.md](./spec.md) 在 `feature/model-aware-token-counting`（或后续分支）实施。
