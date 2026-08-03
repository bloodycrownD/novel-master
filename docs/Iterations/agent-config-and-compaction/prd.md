# Agent 配置化与压缩策略抽象 PRD

## 背景与变更动机

**前置依赖**：**agent-system** 已合并：`AgentRunner`、`AgentSession`、tools/stream、协议适配、CLI `nm agent`、占位版 `DefaultCompactionService` 等。

用户认可压缩**有必要**，但反对将策略写死在单一 Service + 全局 `agent.compaction.*`。本迭代目标：

1. **压缩**：**Trigger**（何时，扁平 `tokenThreshold` / `floorThreshold`，OR）+ **Action**（hide + 产出 `abstract`）。
2. **Agent 配置化**：`AgentDefinition`（prompts、compact、model、runtime）；摘要经 **prompt 引擎**（`{{.abstract}}`、块级 `when`）注入模型，而非两套 executor 类型。
3. **模型采样参数**：按 provider protocol 配置 temperature、top_p/top_k 等。

**动机**：为 App 存储/编辑 Agent 铺路；**Core 只传对象**（Runner 等不读文件）；**AgentDefinition 序列化**留在 Core（`deserializeAgentDefinition` / `serializeAgentDefinition`）；CLI 保留 `--prompt-path` 作测试。

---

## 范围说明

### 纳入

| 项 | 说明 |
|----|------|
| **AgentDefinition** | `name`、`prompts`、`compact`、`model`、`runtime` |
| **CompactionTrigger** | `tokenThreshold`、`floorThreshold`（可见楼层，不含 hidden）；**OR** |
| **CompactionAction** | `keepLastN` + `abstract`（`type: text` 直写 \| `type: agent` 调模型摘要） |
| **PromptBlock.when** | 声明式 `present: abstract` / `absent: ...`（不用宏 `if`） |
| **ModelInvocationConfig** | `applicationModelId` + protocol `params` |
| **序列化** | Core：`agentDefinitionFromJson` / `validate`；`deserializeAgentDefinition` / `serializeAgentDefinition`（YAML/JSON string ↔ 对象） |
| **CLI** | `--agent-config`（读文件 → Core 反序列化）；`--prompt-path` 测试捷径 |
| **Core 清理** | 废弃 `parsePromptYaml` 主入口；`infra/prompt-yaml/` 并入 `agent-definition-io` |

### 不纳入（本期）

| 项 | 说明 |
|----|------|
| Mobile / Web 编辑器 | 仅 CLI 文件 |
| 自定义脚本 trigger/action | 固定 schema |
| 强制废弃 `prompt.yaml` | CLI 可保留 |
| DB/KKV 存 Agent | 后续 |
| 改 OpenAI adapter tools/stream | 仅回归 |

### 相对 `DefaultCompactionService`

- `tokenThreshold` + `action(keepLastN, abstract: agent)` + `when: present: abstract` 块 ≈ 可观测等价 + 更灵活。
- `floorThreshold`、`abstract.type: text` 为新增。
- 全局 `agent.compaction.*` **迁入** AgentDefinition；**不保留** fallback。

---

## 影响模块与接口

见 **spec.md**（`CompactionPipeline`、`PromptBlock.when`、`buildPromptLlmInput` 扩展 `dot.abstract`）。

### 配置示意

```yaml
compact:
  trigger:
    tokenThreshold: 12000
    floorThreshold: 20
  action:
    keepLastN: 6
    abstract:
      type: agent
prompts:
  blocks:
    - name: abstract
      when:
        present: abstract
      type: text
      role: system
      content: |
        压缩后的内容如下：
        {{.abstract}}
```

---

## 验收标准

### Core

- `fromJson` 合法；`deserializeAgentDefinition` 支持 YAML/JSON；Runner **不**直接依赖文件路径。
- Trigger OR；action 写 `dot.abstract` + summary user 消息；`when` 空则跳过 abstract 块。
- `abstract.type: agent` 摘要 **无 tools**；sampling 进 adapter。

### CLI

- `--agent-config` 可 run；`--prompt-path` 测试路径仍可用。

### 回归

- `npm test` core/cli 全绿。

---

## 测试用例

| ID | 场景 |
|----|------|
| T1–T4 | trigger / action / when |
| T5–T8 | abstract text、present 条件 |
| T9–T12 | sampling、无全局 compaction config |
| C1–C3 | CLI agent 文件 |

---

## 后续

- 编码分支：`feature/agent-config`（spec 已定稿，含 AgentDefinition I/O 命名）。
