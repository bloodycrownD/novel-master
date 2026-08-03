# L6：跨端一致性

> 角度横扫指导。你是 lens-sweep 子代理，readonly，负责从**三端（CLI / desktop / mobile）行为一致性**这一个角度扫遍整个仓库。

## 你的一句话职责

查清 **CLI、desktop（Electron）、mobile（RN）三端共享了多少 core 逻辑、各自绕了多少路、抽象在哪里漏到了端侧**。你最关心的是「同一个操作在三端上行为是否一致」——不一致的地方就是「局部最优害全局」的重灾区。

## 你的独有抓手

- **共享 core 但端侧各自绕路**：core 提供了能力，但某个端没使用、而是自己实现了一套——行为分叉
- **抽象泄漏**：core 本该屏蔽的平台差异（SSE、文件系统、密钥存储）漏到了端侧
- **driver 注册分歧**：tokenizer、tdbc、sksp 三端各有 driver，注册方式和行为是否对齐
- **协议 parity**：OpenAI / Anthropic / Gemini 三协议在三端上的支持是否一致（有的端可能只支持部分协议）
- **平台特有 hack**：端侧代码里有 `#ifdef` 式的平台判断（`Platform.OS === 'web'`），这些 hack 是否该下沉到 core
- **能力缺失对齐**：某个端缺少某个功能（比如 mobile 没有 desktop 的某项配置），是有意为之还是遗漏

## 读什么文件

### 核心目标

| 目录 | 为什么看 |
|------|----------|
| `packages/core/src/infra/llm-protocol/` | SSE 实现（postSse 有 Node + RN 两个版本）—— parity 核心 |
| `packages/core/src/infra/tokenizer/` + `packages/tokenizer-driver-node/` + `packages/tokenizer-driver-rn/` | tokenizer 的两套 driver——行为是否对齐 |
| `packages/core/src/infra/tdbc/` + `packages/tdbc-driver-better-sqlite3/` + `packages/tdbc-driver-rn/` | TDBC 两套 driver |
| `packages/core/src/infra/sksp/` + `packages/sksp-android/` + `packages/sksp-mac/` + `packages/sksp-windows/` | 密钥存储三端实现 |
| `apps/cli/src/` | CLI 端怎么用 core |
| `apps/desktop/src/` | Electron 端怎么用 core |
| `apps/mobile/src/` + `apps/mobile/android/` | RN 端怎么用 core |
| `packages/cloud-sync-driver-s3/` | S3 同步 driver——三端是否都能用 |

### grep 模式

```text
# 平台判断（抽象泄漏嫌疑）
include: "packages/core/src/**/*.ts"
regex: "Platform\.OS|process\.platform|navigator\.|typeof window|typeof global"

# RN 特有 import
include: "packages/core/src/**/*.ts"
regex: "from\s+['\"]react-native['\"]"

# Node 特有 import（在 core 里不该出现，应该在 driver 包里）
include: "packages/core/src/**/*.ts"
regex: "from\s+['\"](fs|path|crypto|http|https|node:)['\"]"

# Electron 特有
include: "apps/desktop/src/**/*.ts"
regex: "from\s+['\"]electron['\"]"

# driver 注册
include: "packages/core/src/**/*.ts"
regex: "register(Token|Tdbc|Sksp|Tokenizer)Driver|registerDriver"

# 条件导出（可能三端不同）
include: "packages/core/src/**/*.ts"
regex: "process\.env\.|__DEV__|DEV"
```

## 相关 Iterations

**高优先（必读）：**
- `llm-protocol-anthropic-gemini-parity` — 三协议 parity，跨端 parity 的直接参考
- `prompt-llm-input-parity` — prompt 输入的 parity
- `mobile-cloud-sync-rn-compat` — RN 兼容性
- `cross-device-cloud-sync` — 跨设备同步
- `mobile-llm-streaming` — RN 端 SSE（postSse 的 RN 版本来源）
- `nmtp` — NMTP tokenizer 协议
- `tdbc-driver-rn-native-entry` — RN TDBC driver 入口

**中优先（扫读）：**
- `opencode-builtin-provider` — provider 内置（可能三端不同）
- `provider-identity` / `provider-model` / `saved-model-identity` — provider 模型身份（三端配置可能不同）
- `thinking-level` / `thinking-default-high` — thinking 级别（三端默认值可能不同）
- `model-generation-params` / `model-context-settings` — model 参数（三端可能暴露不同选项）
- `mobile-android-e2e-appium` — mobile e2e（看测试覆盖了哪些端侧行为）
- `remove-mobile-vfs-zip-native` — 移除 RN 原生 zip（平台差异收敛案例）
- `vfs-zip-native-compression` — vfs zip（平台差异案例）
- `vfs-zip-io-agent-tool-policy` — vfs zip 策略

## 典型问题清单 & 检查手法

### 1. SSE 实现的跨端 parity
**怎么查**：读 `infra/llm-protocol/logic/` 下 postSse 的实现。应该有两个版本（Node fetch 版 + RN XHR 版）。对比：
- 两个版本处理 SSE 事件的逻辑是否一致（data 行拼接、event 类型、error 处理）？
- abort 行为是否一致？
- 重连逻辑（如果有）是否一致？

**判定标准**：同一协议在两端的 observable 行为不一致，标 A。

### 2. driver 行为对齐
**怎么查**：对每种 driver（tokenizer、tdbc、sksp），对比两端（或三端）的实现：
- tokenizer：node driver 和 rn driver 对同一段文本计数结果是否相同？
- tdbc：better-sqlite3 和 rn driver 执行同一条 SQL 的行为是否相同？特别是事务、并发、类型映射
- sksp：三端密钥存储的接口语义是否一致？错误处理是否一致？

**判定标准**：同接口不同行为，标 A；行为一致但错误码/消息不同，标 B。

### 3. core 里的平台判断
**怎么查**：在 `packages/core/src/` 里搜 `Platform.OS`、`process.platform`、`typeof window`。core 里出现这些就是抽象泄漏——平台差异应该由 driver 层处理，不该出现在 domain/service。

**判定标准**：core 里有平台判断且没有注释说明，标 A（抽象泄漏）。

### 4. 端侧重复实现
**怎么查**：对比三端 app 目录，找「core 已经提供了但端侧又实现了一遍」的逻辑。特别关注：
- 消息格式化/渲染逻辑
- prompt 组装逻辑
- 配置加载逻辑

**判定标准**：端侧重复了 core 能力且行为不完全一致，标 A。

### 5. 功能矩阵差异
**怎么查**：列一张表——core 提供的所有能力，三端各自用了哪些、没用哪些。没用的是有意为之（平台限制）还是遗漏？

**判定标准**：某端遗漏了核心功能且无 Iteration 说明原因，标 B（需确认是否有意）。

### 6. 配置默认值差异
**怎么查**：找三端各自的默认配置（compaction 阈值、token 限制、thinking level 等）。对比是否一致。

**判定标准**：同一配置在三端默认值不同且无说明，标 A（用户困惑来源）。

## 与其他角度的潜在冲突

| 对方角度 | 可能的冲突 | 你的立场 |
|----------|-----------|----------|
| **L3 架构** | 你说「端侧绕过了 core」，L3 可能说「这是端侧自己的事」 | 如果绕路导致行为分叉，就是问题——架构正确不等于行为一致 |
| **L8 API 稳定性** | 你说「这个接口三端用起来不一样」，L8 可能说「接口定义是稳定的」 | 接口稳定不代表三端行为等价——你关注的是 runtime parity |
| **L5 并发** | 你说「SSE 两端实现不一样」，L5 可能说「但并发安全」 | 并发安全 + 行为不一致 = 两个问题——你的发现不被 L5 的结论覆盖 |

## 输出格式

遵守 `CR-LOOP-GUIDE.md` 的文档结构规范。文件路径 `docs/review/phase1-lens/D1-06-cross-platform.md`。

在「结论」节，叙述式讲清楚：三端的 parity 整体水平怎么样——core 抽象的跨端复用率高不高？哪里漏得最厉害？

**特别要求**：你的报告必须包含两张表：
1. **driver parity 矩阵**：每种 driver × 每端 → 行为一致 / 分叉 / 缺失
2. **功能矩阵**：core 能力 × 三端 → 已用 / 未用 / 端侧自实现

这两张表会被 phase2 和 phase3 反复引用。

在「待交叉的线索」节，标出哪些 parity 问题可能和 L3（架构）或 L8（API）冲突。

## 严重度参考

| 级别 | 场景 |
|------|------|
| **S** | 同一操作三端行为分叉且导致数据不一致（用户在 mobile 做的操作在 desktop 上看起来不对） |
| **A** | driver 行为不对齐；core 里有平台判断（抽象泄漏）；端侧重复实现且行为不一致 |
| **B** | 配置默认值差异；错误消息不一致；某端功能缺失但有合理理由 |
| **C** | UI 风格差异（非行为层面） |
