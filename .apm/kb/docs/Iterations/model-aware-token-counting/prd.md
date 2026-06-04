# 模型感知 Token 统计与统一口径 PRD

> **边界**：本文件为产品需求（PRD），不含接口设计、模块拆分、依赖版本等技术 SPEC。  
> **关联**：[token-counting](../token-counting/prd.md)（已交付基础 `infra/tokenizer`、tiktoken、CLI `--tokens`、usage 解析）；本迭代 ** supersede ** 其中「按 provider 协议路由」「压缩仅数消息 body」「非 OpenAI tokenizer 后续再做」「Mobile 展示后续再做」等分期约定。  
> **参考**：SillyTavern（`getTokenizerModel` / `/api/tokenizers/openai/count`）——按 **模型 ID 子串** 选 tokenizer，与 HTTP 协议解耦，适配 OpenAI 兼容中转站。

## 背景

Novel Master 已具备 `TokenCounterRegistry`、tiktoken、CLI `prompt render --tokens`、Mobile 聊天顶栏 token 示意与压缩条件中的 token 阈值。但在实际使用中暴露三类产品问题：

1. **路由键错误**：计数器按 `provider.protocol === "openai"` 才启用 tiktoken；大量中转站使用 OpenAI 兼容协议却承载 Claude / Gemini / Llama 等模型，导致 **误用 GPT 编码或退回 chars÷4**，与真实上下文占用偏差大。
2. **口径分裂**：顶栏 / CLI 统计 **完整 prompt**（`serializePromptLlmInput` + `countText`）；压缩触发仅统计 **可见消息 body**（`countMessages`）。用户看到「占用还很低却触发压缩」或相反，体验不可信。
3. **tokenizer 族不全**：未覆盖 Claude、Gemini/Gemma、Llama3、Mistral 等常见模型族；与 SillyTavern 等按模型名匹配多 tokenizer 的做法差距明显。

用户明确要求：**压缩与展示同一套规则**；**一次迭代全部完成**（core + CLI + Mobile），不分期交付。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 模型感知路由 | 给定 `applicationModelId` 的 `vendorModelId`，计数器选择 **仅由模型名规则 + 可选用户覆盖** 决定，**不依赖** provider 协议；OpenAI 协议 + `claude-*` / `gemini-*` 等用对应族 tokenizer，而非 GPT tiktoken |
| 口径统一 | 压缩阈值判断、CLI `--tokens`、Mobile 顶栏 **同一函数、同一输入**（当前 agent 的完整 `PromptLlmInput` 序列化结果） |
| 多 tokenizer 覆盖 | 至少支持 ST 服务端 `openai/count` 同级分支：**GPT（tiktoken）**、**Claude**、**Gemini/Gemma（SentencePiece 或等价）**、**Llama / Llama3**、**Mistral**、**Yi**、**Jamba**、**Qwen2**、**Command-R / Command-A**、**Nemo**、**DeepSeek**；无法匹配时统一 heuristic fallback |
| 三端一致 | `@novel-master/core`、`nm` CLI、Android Mobile **同一 registry 与计数 API**；Mobile 在真机/模拟器上可对 `gpt-4o`、`claude-3-5-sonnet`、`gemini-2.0-flash`（或团队约定 fixture 模型名）展示非零、非明显荒谬的 token 数 |
| 预算语义正确 | 顶栏百分比的分母为 **上下文预算**（模型 context window 或用户可配置的全局/每模型上限），**不得**继续用「最大输出 max_tokens」冒充上下文占比 |
| 可观测 | CLI `--tokens` stderr JSON 含 `counter` 种类（如 `tiktoken` / `claude` / `heuristic`）；与顶栏、压缩决策可对照 |
| 质量 | `packages/core`、相关 CLI/Mobile 测试 **全绿**；新增用例覆盖模型名路由与口径统一，不得回归既有 usage 解析行为 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| Mobile 对话用户 | 使用 OpenAI 兼容中转 + Claude/Gemini 模型；顶栏 token 占用与压缩时机 **与体感一致** |
| Agent / Prompt 作者 | `nm prompt render --tokens` 与顶栏数字 **同口径**；调 compression 阈值时可预期 |
| 开发者 / 运维 | 配置全局 `tokenThreshold` / `tokenRatio` 时，触发基于 **完整 prompt** 且 tokenizer 与模型名一致 |
| 高级用户 | 模型名无法识别时，可在设置中 **手动指定计数器**（类似 SillyTavern「Tokenizer」），避免长期 heuristic |

## 范围

### 包含范围

1. **路由规则（产品级）**
   - 以 `vendorModelId`（大小写不敏感子串、有序最长匹配，对齐 SillyTavern `getTokenizerModel` 优先级）解析 tokenizer 族。
   - **移除**「仅 openai 协议可用 tiktoken」的产品约束；协议只影响 **如何发请求**，不影响 **如何数 token**。
   - 模型未保存到 Provider 时：仍允许用 **工作区当前模型名** 路由（与现「已保存模型」校验解耦，避免误回退 heuristic）；具体保存策略在 SPEC 定，PRD 要求 **不因未保存而静默降级** 除非用户显式选择 heuristic。
   - 可选：**用户设置「Token 计数器」**（自动 / 指定族 / 纯启发式），覆盖自动匹配。

2. **统一计数对象与 API（产品级）**
   - 单一入口：对「当前 session + 当前 agent + 当前 regex 通道 + 当前 worktree 快照」构建的 `PromptLlmInput` 序列化后计数。
   - 压缩 `TokenThresholdTrigger`、Mobile `loadChatPromptTokenLabel*`、CLI `prompt render --tokens` **必须调用同一入口**。
   - 消息级 `countMessages` 仅保留为兼容或内部测试，**不得**再作为压缩触发主路径。

3. **Tokenizer 能力（与 SillyTavern 对齐，一次交付）**
   - GPT 系：tiktoken + OpenAI chat 消息 overhead（与现逻辑一致或对齐 ST `/openai/count`）。
   - Claude：Claude tokenizer（JSON / 等价实现）。
   - Gemini / Gemma / LearnLM 子串：Gemma 系 SentencePiece（或 ST 等价）。
   - Llama、Llama3、Mistral、Yi、Jamba、Qwen2、Command-R、Command-A、Nemo、DeepSeek：与 ST 分支同族，允许 core 与 Mobile 分别选型实现，但 **同模型名在三端计数偏差应在验收容差内**（见验收）。
   - Heuristic fallback：`Math.ceil(chars / 3.35)` 或等价（与 SillyTavern `CHARACTERS_PER_TOKEN_RATIO` 对齐）；加载失败、未知模型、用户选「无 tokenizer」时使用。

4. **Mobile（Android）**
   - 聊天顶栏 token 标签使用统一 API；构建 prompt 失败时的 fallback 须 **标明为估算** 且仍走同一 heuristic 规则（不得与主路径混用不同公式）。
   - RN/Hermes 下各 tokenizer 可加载（沿用或扩展 tiktoken shim 策略）；加载失败回退 heuristic 且 **不崩溃**。

5. **CLI**
   - `nm prompt render --tokens [--model …]` 使用统一 API；stderr 输出 `tokenCount`、`counter`、`model`（或等价字段）。

6. **压缩条件**
   - `tokenThreshold` / `tokenRatio` 作用于 **完整 prompt token 数**。
   - `tokenThreshold === -1` 时，分母为 **解析得到的 context window**（非 max output tokens）。

7. **顶栏展示语义**
   - 展示格式保留「当前 / 预算」可读性；百分比 = prompt tokens / context budget。
   - 无 context 配置时展示绝对 token 数，不展示误导性百分比。

8. **测试与文档**
   - 核心用例：模型名 → tokenizer 族映射表（含中转场景：`openai` 协议 + `claude-3-5-sonnet`）。
   - 口径用例：同一 fixture 下压缩判断与 CLI `--tokens` 数值一致（允许 ±0 或 SPEC 定义 padding 差）。
   - KB：本 PRD；实现后由 SPEC/CHANGELOG 引用本迭代名。

### 不包含范围

- Web 前端 UI 实现（仅要求 core API 可被 Web 复用，本迭代不验收 Web）。
- 按 token 预算 **自动裁剪** prompt 内容（只统计与触发压缩，不替用户删块）。
- Message / Session 表持久化每条消息的 `token_count` 字段。
- 远程 tokenizer API（Kobold / TextGen / OpenRouter 代理计数）；一律 **本地** 实现。
- 与供应商计费账单的 **逐字对齐**（允许估算误差，但须显著优于「协议 openai + 错误编码」）。
- SillyTavern 全部 UI（如逐条消息 token 徽章、LocalForage token 缓存）；本迭代只做 Novel Master 顶栏 + CLI + 压缩。
- 修改 LLM adapter 发请求逻辑或 provider 协议定义。

## 核心需求

1. **模型名优先于协议**：任意 provider 协议下，只要 `vendorModelId` 可识别为 Claude/Gemini/Llama 等，即使用对应 tokenizer；禁止仅因协议为 `openai` 就对 `claude-*` 使用 `gpt-3.5-turbo` tiktoken。
2. **一口径三端**：压缩、Mobile 顶栏、CLI `--tokens` 对同一 session 状态产生 **相同 token 整数**（同一计数 API、同一 `PromptLlmInput` 构建链）。
3. **完整 prompt**：计数包含 system、agent 块渲染结果、worktree/filetree 注入、经 regex 通道后的 messages；与真实发送体积同构（序列化格式由 SPEC 锁定，与现 `serializePromptLlmInput` 延续或显式升级）。
4. **多 tokenizer 一次到位**：交付第二节「包含范围」所列各族；不得再以「后续迭代」推迟 Claude/Gemini/Llama3。
5. **启发式兜底一致**：任意失败路径使用同一 heuristic（3.35 字符/token），并在 UI/CLI 可区分「精确计数」与「估算」。
6. **上下文预算**：顶栏与 `tokenThreshold === -1` 使用 **context window**（来自模型元数据、Provider 配置或全局默认），与「最大输出 token」分离。
7. **用户可覆盖**：设置项支持手动选择计数器族，覆盖自动匹配；默认「自动（按模型名）」。

## 验收标准

### 路由（模型名 vs 协议）

- **Given** Provider 协议为 `openai`，已保存模型 `vendorModelId` 为 `claude-3-5-sonnet-20241022`  
  **When** 解析该模型的计数器  
  **Then** 使用 **Claude** 族 counter（`counter` 不为 `tiktoken`），且 **不为** heuristic（除非 Claude tokenizer 加载失败并显式降级）。

- **Given** Provider 协议为 `openai`，`vendorModelId` 为 `gemini-2.0-flash`  
  **When** 解析计数器  
  **Then** 使用 **Gemma/Gemini** 族 counter，而非 GPT tiktoken。

- **Given** Provider 协议为 `gemini`，`vendorModelId` 为 `gpt-4o`（若存在此类配置）  
  **When** 解析计数器  
  **Then** 使用 **GPT/tiktoken** 族（按模型名），而非因协议为 gemini 强制 heuristic。

- **Given** `vendorModelId` 为无法识别的字符串 `my-custom/foo`  
  **When** 解析计数器且用户未手动覆盖  
  **Then** 使用 heuristic，且 CLI/Mobile 可观测为 `heuristic`。

### 口径统一（压缩 = 展示 = CLI）

- **Given** 固定 fixture：session 含 system + worktree 块 + ≥3 条可见消息，绑定 agent A、模型 M  
  **When** 分别执行：① Mobile 顶栏刷新 token 标签；② `nm prompt render --tokens --model M`；③ 评估 `TokenThresholdTrigger` 所用 token 数  
  **Then** 三处 **token 整数相等**（无消息-body-only 与 full-prompt 差异）。

- **Given** 同上 fixture，完整 prompt token 数为 `N`，配置 `tokenThreshold = N + 1`  
  **When** 评估是否触发压缩  
  **Then** **不触发**；`tokenThreshold = N` 时 **触发**（或按 `tokenRatio` 线性缩放后等价）。

### Tiktoken / 多族精度（样例锁定）

- **Given** `vendorModelId` 含 `gpt-4o`，样例英文短句 `S`  
  **When** `countText(S)`  
  **Then** 与 tiktoken 参考 encode 长度一致（测试用例锁定）。

- **Given** `vendorModelId` 含 `claude-3-5`，样例 `S`  
  **When** `countText(S)`  
  **Then** 与 ST `/openai/count?model=claude` 同口径结果 **相等或在 SPEC 定义容差内**（≤1 token 或固定百分比，由 SPEC 选其一并在测试中写死）。

- **Given** `vendorModelId` 含 `gemini-2.0`，样例 `S`  
  **When** `countText(S)`  
  **Then** 与 ST Gemma 分支同口径 **在容差内**。

### Mobile

- **Given** Android 已选 OpenAI 兼容 Provider + Claude 模型，会话有消息  
  **When** 进入聊天页等待顶栏 token 刷新完成  
  **Then** 展示非空标签；后台日志或 debug 字段显示 `counter` 为 `claude`（非 `tiktoken`）；应用 **不崩溃**。

- **Given** 构建完整 prompt 失败（如 agent 配置缺失）  
  **When** 顶栏 fallback  
  **Then** 仍显示 heuristic 估算，并带「估算」类文案或等价区分（产品文案由实现选定，须可辨认）。

### 顶栏预算语义

- **Given** 模型 context window 配置为 `128000`，当前 prompt 估算 `64000` tokens  
  **When** 展示顶栏  
  **Then** 百分比约为 **50%**，分母标注为上下文容量（非 `max_tokens` 输出上限）。

- **Given** 无法解析 context window  
  **When** 展示顶栏  
  **Then** 仅展示绝对 token 数（如 `64K tokens`），**不展示** 百分比。

### CLI

- **Given** 有效 prompt 路径与 session，`--tokens --model <M>`  
  **When** 执行 `nm prompt render`  
  **Then** stderr JSON 含 `tokenCount`（正整数）、`counter`（族名）、`model`；stdout 仍为渲染文本。

### 回归

- **Given** 全量 `packages/core` 测试及本迭代新增 CLI/Mobile 相关测试  
  **When** `npm test`（各包约定命令）  
  **Then** **全绿**；既有 `LlmChatResult.usage` 解析行为 **不退化**。

### 用户覆盖（若实现设置项）

- **Given** 用户将 Token 计数器设为「Heuristic / 无」  
  **When** 模型名为 `gpt-4o`  
  **Then** 仍使用 heuristic，直至用户改回「自动」。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| RN 包体与启动 | 多 tokenizer 依赖可能增大 Mobile 包体；须在 SPEC 中评估并按本 PRD 一次纳入，不得再拆迭代 |
| Context window 数据源 | 若 Provider 未配置 window，默认值（如 128k）需在 SPEC 与产品确认，避免百分比长期失真 |
| 与 ST 逐 token 对齐 | 不同实现库版本可能导致 ±少量偏差；验收以「同 fixture 相对 ST 可复现」为准，非账单级 |
| 旧 PRD 冲突 | 实现时以 **本 PRD** 为准，更新 [token-counting](../token-counting/prd.md) 文首「已被 supersede」说明（可在 SPEC 任务中执行） |

## 里程碑（本迭代单次交付）

| 阶段 | 交付物（产品视角） |
|------|-------------------|
| 单次发布 | core 统一计数 API + 模型名路由 + 多 tokenizer；压缩/CLI/Mobile 全部切换；测试全绿；用户可选计数器覆盖 |

**不分期**：不得将 Claude/Gemini/Mobile/口径统一拆为后续迭代；未达上表验收标准视为本需求未完成。
