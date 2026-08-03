# 服务商与模型配置 PRD

## 背景

Novel Master 已具备 **chat**、**prompt-engine** 与 **virtual-worktree** 等能力，但尚无可用的 **LLM 服务商与模型配置**，也无法通过 CLI 发起真实的多协议 HTTP 调用。

本迭代建立 **配置域**：区分 **协议（protocol）** 与 **服务商（provider）**，支持内置/自定义服务商、**已保存模型** 与 **远端模型建议** 分离、应用侧模型 id `providerId/vendorModelId`；CLI 提供配置管理与 **`nm model request` 最小调用**（v1 不写 message/session）。凭据走 [sksp/prd.md](./sksp/prd.md)。

不交付：完整 Agent 循环、RN provider 配置 UI、对外稳定 npm LLM API。

## 目标（含成功指标）

| 目标 | 说明 |
|------|------|
| 配置域 | 服务商/模型 CRUD；内置 seed；自定义可删 |
| 双 ID | 应用模型 id = `providerId/vendorModelId`（**第一个** `/` 分隔）；映射到厂商 API 的 `model` 与 endpoint |
| 协议 | v1 实现 **`openai`**、**`anthropic`**（Claude Messages）、**`gemini`**（Google Generative Language）三类 HTTP 调用；配置层 `protocol` 必选 |
| 模型建议 | `fetch` 只更新**建议**；须 `save` 或 `create` 才进入**已保存模型** |
| CLI | 子命令树见下文；`nm model request` = 单条 user → 单次非流式 assistant 文本 |
| 凭据 | SKSP；详见 sksp PRD |
| **成功指标** | 下文验收标准可判定；至少一份 CLI 用例文档可复现 |

## 概念速览

| 概念 | 说明 |
|------|------|
| **Protocol** | `openai` \| `anthropic` \| `gemini` — 决定 HTTP 路径、请求/响应形态与（后续 SPEC）可调参数 schema |
| **Provider** | `providerId` + `protocol` + **`baseUrl`（必填）** + `secretRef` + 可选 `displayName`、`defaultModelId`、`headers` |
| **模型建议** | `fetch` 写入；仅供浏览与 `save`；**不可**用于 `nm model request` |
| **已保存模型** | 用户 `create` 或 `save` 后存在；**方可** `model use` / `model request` |
| **OpenAI 即协议也是厂商** | 内置 `openai` 的 `protocol=openai`；**OpenRouter** 等为内置/自定义，`protocol=openai`，仅 `baseUrl` 等不同 |

## v1 典型流程（Happy path）

1. 首次打开 DB → `bootstrapNovelMaster` **seed 内置 provider**（见下表）。
2. `nm provider edit --providerId openai --baseUrl … --apiKey …`（按需改 `displayName`、`headers`）。
3. `nm provider model fetch --providerId openai` → 写入**模型建议**。
4. `nm provider model suggest list --providerId openai` → 查看建议。
5. `nm provider model save --providerId openai --vendorModelId gpt-4o`（或 `create` 手工登记）→ **已保存模型**。
6. `nm model use --modelId openai/gpt-4o` → `nm model request --content "hello"` → stdout 为 assistant 文本。

（v1 不写 message/session；二期再与 chat 集成。）

## 内置服务商（bootstrap seed）

`bootstrapNovelMaster`（或等价迁移）后 **必须存在** 下列内置行（不可 `create` 重复 id，不可 `delete`）：

| providerId | protocol | 默认 baseUrl（可被 edit 覆盖） |
|------------|----------|--------------------------------|
| `openai` | `openai` | `https://api.openai.com/v1` |
| `anthropic` | `anthropic` | `https://api.anthropic.com` |
| `google` | `gemini` | `https://generativelanguage.googleapis.com/v1beta` |
| `openrouter` | `openai` | `https://openrouter.ai/api/v1` |

- 内置行初始可无 apiKey（`secretRef` 指向空，list 显示 `apiKey: not set`）。
- 自定义 `nm provider create`：**不得**使用上表 id。

### `provider edit` 字段白名单

| 字段 | 内置 | 自定义 |
|------|------|--------|
| `providerId` / `protocol` | **不可改** | create 时设定；自定义 **可** `edit --protocol` |
| `baseUrl` | 可改 | 可改 |
| `displayName` | 可改 | 可改 |
| `headers` | 可改（JSON 字符串） | 可改 |
| `defaultModelId` | 可改（须为**已保存**的应用模型 id） | 可改 |
| `apiKey` | 可改（SKSP） | 可改（SKSP） |

### `provider create`（仅自定义）

必填：`--providerId`、`--protocol`（`openai` \| `anthropic` \| `gemini`）、`--baseUrl`。  
可选：`--displayName`、`--headers`、`--defaultModelId`；apiKey 可 create 时 `--apiKey` 或事后 `edit`。

### 删除与级联

- `nm provider delete`：仅自定义；删除时级联删除该 provider 下**已保存模型**、**模型建议**、SKSP 中对应 `secretRef`。
- 若删的是 `currentProviderId`：清除 `currentProviderId`；若当前 `currentModelId` 属于该 provider，一并清除。

## 模型：建议 vs 已保存

- **`fetch`**：按 provider 的 `protocol` 调用对应「列模型」API（OpenAI 风格 `/models`、Anthropic/Gemini 等价或 SPEC 文档化端点）；结果 **upsert 到「模型建议」存储**，**不**自动生成已保存模型。
- **建议合并**：同一 `providerId` 下按 `vendorModelId` upsert；再次 `fetch` **不删除** 上次建议中仍出现在远端列表的项；远端未再返回的建议可保留并标记 `stale`（SPEC 实现，验收至少证明建议可持久化且可 `save`）。
- **`nm provider model list`**：仅列出**已保存模型**（含应用 model id）。
- **`nm provider model suggest list`**：列出**模型建议**（含 `vendorModelId`、展示名、是否 `stale` 等，SPEC 定列）。
- **`nm provider model save --vendorModelId <v>`**：从建议复制为已保存模型（应用 id = `providerId/v`）；建议可仍存在。
- **`nm provider model create`**：无建议时手工登记 `vendorModelId`（及可选 `displayName`）。
- **`nm provider model edit`**：仅针对**已保存模型**；可改 `displayName` 等（**不可**改 `providerId`；改 `vendorModelId` 视为迁移，SPEC 可用 delete+create 代替）。

### 应用模型 id

- 格式：`{providerId}/{vendorModelId}`，**仅第一个 `/` 为分隔符**（`vendorModelId` 可含 `/`，如部分 OpenRouter id）。
- 全局唯一；用于 `nm model use` / `nm model request`。

## `nm model request`（v1）

- **语义**：构造**单条** `user` 消息（内容为 `--content`）→ 按已保存模型所属 provider 的 **protocol** 发 **非流式** 请求 → stdout 输出 **assistant 文本**（主路径）；可选 `--raw` 输出完整 JSON（SPEC）。
- **不支持 v1**：session 历史、system 独立注入、多轮 messages JSON、streaming、tool_calls、vision。
- **协议参数**：v1 **不**暴露 temperature 等 CLI flag（用协议默认）；二期或 `--raw` 调试再扩展。

## 作用域、省略与优先级

与 `nm project` / `nm session` 一致：**显式 flag > `config.json` 当前值 > 报错**。

| 命令 | `--providerId` 省略时 | 无当前 provider 时 |
|------|----------------------|-------------------|
| `provider model fetch/suggest list/save/create/edit/list` | 使用 `currentProviderId` | 报错并提示 `nm provider use` |
| `provider edit/delete` | **必须**显式 `--providerId` | — |

| 命令 | `--modelId` 省略时 | 无当前模型时 |
|------|-------------------|-------------|
| `model request` | 使用 `currentModelId` | 报错并提示 `nm model use` |
| `model use` / `model current` | — | `use` 必填 `--modelId`；`current` 无则输出空或退出码 1（SPEC 与 project 对齐） |

- **`currentModelId` 已含 `providerId`**：`model request` **不要求** 同时设置 `currentProviderId`；解析 endpoint 以模型所属 provider 为准。
- **`provider use`**：便于省略 `--providerId` 的子命令；设置 `currentProviderId` **不**自动改 `currentModelId`。
- **`provider use` 切换**到另一 provider 时：**不**清除 `currentModelId`（可能指向旧 provider 的模型）；若 request 时模型与 provider 不一致，以 **modelId 所属 provider** 为准。

凭据：`sksp-env` 与环境变量优先级见 [sksp/prd.md](./sksp/prd.md)。

## 范围

### 包含

- Provider / 模型建议 / 已保存模型表（与 chat **同库** `novel.db`，随 `bootstrapNovelMaster` 迁移；不走 KKV/VFS）。
- 协议实现：`openai`、`anthropic`、`gemini` 的最小 **chat/complete** 路径（SPEC 定各协议 URL 拼接规则）。
- CLI：下文命令树；`config.json` 增加 `currentProviderId`、`currentModelId`。
- Core 内配置、解析、HTTP 客户端（供 CLI；不承诺稳定对外 export）。

### 不包含

- Agent 多轮 / 工具循环；RN provider UI；streaming / 多模态 / embeddings
- `nm model request` 写 message/session（**二期**）
- **`apps/mobile`** 上对等 `nm provider` 子命令（**SKSP Android 本期在 sksp 迭代验收**，见 `Iterations/sksp/spec.md`）
- 云同步、计费面板

## CLI 命令（v1）

### 服务商

```
nm provider list
nm provider create --providerId <id> --protocol <openai|anthropic|gemini> --baseUrl <url> [--displayName] [--headers <json>] [--defaultModelId] [--apiKey]
nm provider delete --providerId <id>          # 仅自定义
nm provider edit --providerId <id> --<attr> <val>   # attr 见白名单
nm provider use --providerId <id>
nm provider current
```

### 模型（配置域，provider 下）

```
nm provider model suggest list [--providerId <id>]
nm provider model fetch [--providerId <id>]
nm provider model save --vendorModelId <v> [--providerId <id>] [--displayName]
nm provider model create --vendorModelId <v> [--providerId <id>] [--displayName]
nm provider model list [--providerId <id>]
nm provider model edit --modelId <providerId/v> [--displayName] ...
nm provider model delete --modelId <providerId/v>   # 仅已保存模型
```

### 选用与调用（顶层 `model`）

```
nm model use --modelId <providerId/vendorModelId>
nm model current
nm model request [--modelId <id>] --content <text> [--raw]
```

## 核心需求

1. 内置 seed + 自定义 create；`baseUrl` 必填；内置不可删、不可改 id/protocol。
2. 模型建议与已保存分离；`request` 仅接受已保存模型 id。
3. 三协议 HTTP 可调用；协议与 provider 解耦（同协议多 provider，如 openrouter）。
4. `fetch` / `save` / `create` / `list` / `suggest list` 行为符合上文。
5. `use` / `current` 与 flag 优先级符合上文。
6. `model request`：单 user、非流式；不写 message 表。
7. apiKey 经 SKSP；list 不泄露完整 key。
8. 可执行 CLI 验收文档。

## 验收标准

### 服务商

- [ ] **When** 新库 bootstrap，**Then** `nm provider list` 含 `openai`、`anthropic`、`google`、`openrouter`。
- [ ] **Given** 自定义 create，**When** `nm provider list`，**Then** id 唯一；**When** create 内置 id，**Then** 失败。
- [ ] **Given** 内置 `openai`，**When** `edit --protocol anthropic`，**Then** 失败；**When** `edit --baseUrl`，**Then** request 使用新 URL。
- [ ] **Given** 自定义 provider，**When** `delete`，**Then** 列表无该 id，且其模型/建议/SKSP ref 已清理。

### 模型建议与已保存

- [ ] **Given** 有效 apiKey，**When** `fetch`，**Then** `suggest list` 非空且 `model list` **仍可为空**。
- [ ] **Given** 有建议无 save，**When** `model request --modelId 建议中的 id`，**Then** 失败（未保存）。
- [ ] **Given** `save --vendorModelId v`，**When** `model list`，**Then** 含 `providerId/v`；**When** `model request`，**Then** 成功（有效 endpoint/key）。

### 调用

- [ ] **Given** 已保存模型，**When** `model request --content hi`，**Then** stdout 含非空 assistant 文本；**无** streaming 分片输出。
- [ ] **Given** `anthropic` / `google` provider + 对应协议模型，**When** `request`，**Then** 走各自协议（非静默改用 openai）。
- [ ] **Given** 无 `--modelId` 且无 `currentModelId`，**When** `request`，**Then** 失败并提示 `nm model use`。

### chat / SKSP / 范围外

- [ ] **Given** `request` 成功，**When** `nm message list`，**Then** 无新消息。
- [ ] **Given** `edit --apiKey`，**Then** DB 无明文 key；`provider list` 不打印完整 key。
- [ ] **When** 仅本期交付，**Then** 无 Agent 编排 CLI。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 三协议工作量 | Claude/Gemini 端点与鉴权头在 SPEC 细化；若某一协议延期，须在 SPEC 标注裁剪并改验收 |
| `message.provider`（二期） | 写回 session 时再定存 providerId 或 application model id |
| 部分网关无 list API | 依赖 `model create` 手工登记；`fetch` 失败时 stderr 可读 |
| Gemini/OpenRouter 兼容度 | 列模型 API 可能与 OpenAI 不一致，SPEC 写降级或仅 openai 协议网关走 OpenAI `/models` |

## 关联文档

- [sksp/prd.md](./sksp/prd.md) — 凭据存储
- [TDBC/prd.md](../TDBC/prd.md) — 协议 + 驱动模式参考
