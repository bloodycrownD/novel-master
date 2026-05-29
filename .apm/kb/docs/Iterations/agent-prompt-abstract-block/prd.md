# Agent Prompt：移除 when、引入 abstract 块 PRD

## 背景与变更动机

在 **agent-config-and-compaction** 迭代中，为在不用宏 `if` 的前提下注入压缩摘要，引入了 **PromptBlock.when**（`present: abstract` / `absent: ...`）配合 `type: text` 块。

实践中该组合带来问题：

1. **认知负担**：用户需理解「字段名 + present/absent」与宏 `{{.abstract}}` 两套概念。
2. **编辑器复杂**：App / 原型 UI 要为每个 text 块提供 when 下拉、字段名输入，易配错。
3. **语义重复**：「仅在有摘要时展示」是压缩场景的固定需求，却用通用条件语法表达。

**动机**：用**专用块类型**表达「摘要段落」，删除通用 `when`；配置更短、校验更严、编辑器更简单。

**与压缩的关系**：`compact.action` 仍负责产生运行时 `abstract` 字符串；prompt 侧只消费，不负责触发逻辑。

---

## 目标（一句话）

移除 Prompt 块上的 **`when` 条件**；新增 **`type: abstract`** 块：支持 `{{.abstract}}` 宏，且当摘要为空时**整块不拼接**进 LLM system。

---

## 范围说明

### 纳入

| 项 | 说明 |
|----|------|
| **移除 `when`** | Agent YAML/JSON 的 `prompts.blocks[]` 不再接受 `when`（含 `present` / `absent`）；解析失败并提示迁移方式。 |
| **新增 `abstract` 块** | `name` + `type: abstract` + `content`（字符串模板）；**无** `role`。 |
| **渲染语义** | `buildPromptLlmInput`：若 `ctx.abstract` trim 后为空 → 跳过所有 `abstract` 块；非空 → 将 `content` 宏展开后并入 **system**（与 `text`+`system` 相同合并路径）。 |
| **宏** | `abstract` 块内可使用 `{{.abstract}}`、`{{.worktree}}`、`{{$time}}`、`{{$week_cn}}` 等既有宏；`{{.abstract}}` 在 dot 中为空时由 optional 规则处理，但**整块已在空摘要时跳过**，通常不会渲染空段。 |
| **示例与文档** | `examples/agent-writer.yaml` 改为 `abstract` 块；`.apm` 中 agent-config-and-compaction 相关叙述标注 superseded。 |
| **UI 壳原型** | `examples/ui-shell-prototype` Agent 编辑器：去掉 when 控件；支持添加/编辑 `abstract` 块；mock 数据与 writer 示例一致。 |
| **迁移说明** | 文档给出 `when: present: abstract` + text → `type: abstract` 对照表。 |

### 不纳入（本期）

| 项 | 说明 |
|----|------|
| 通用条件块 | 不支持 `absent:`、任意 dot 字段的 present/absent；若有需求后续另开迭代。 |
| 改压缩 trigger/action | `compact` schema 不变。 |
| 新宏语法 | 仍禁止 `if` / `range` 等模板控制流。 |
| `text` 块 `user`/`assistant` 注入 LLM | 既有局限不变（仅 system text 进 system）；非本 PRD 范围。 |
| DB 存 Agent | 仍仅文件 / 内存原型。 |

### 相对 agent-config-and-compaction PRD

| 原 PRD | 本 PRD |
|--------|--------|
| `PromptBlock.when` 声明式条件 | **删除** |
| `when: present: abstract` + text 展示摘要 | **`type: abstract` 块** |
| 验收「when 空则跳过 abstract 块」 | 验收「abstract 为空则跳过 abstract 块」 |

---

## 块类型（定稿后）

| type | 字段 | 进入 LLM 方式 |
|------|------|----------------|
| `text` | `role`, `content` | 仅 `role: system` 合并进 `system`；`user`/`assistant` 不进 `buildPromptLlmInput`（与现行为一致）。 |
| `chat` | （无 content） | 注入 `ctx.messages` 为对话历史。 |
| `abstract` | `content` | 仅当 `ctx.abstract` 非空（trim 后）时，宏展开后并入 `system`。 |

**禁止**：任意块上的 `when` 键。

---

## 配置示意

### 变更前（废弃）

```yaml
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

### 变更后（目标）

```yaml
prompts:
  blocks:
    - name: system
      type: text
      role: system
      content: "You are a helpful assistant."
    - name: abstract
      type: abstract
      content: |
        压缩后的内容如下：
        {{.abstract}}
    - name: history
      type: chat
```

**推荐顺序**：`system` text → `abstract` → `chat`（与 writer 示例一致；非强制校验）。

---

## 迁移规则

| 旧配置 | 新配置 |
|--------|--------|
| `type: text` + `when.present: abstract` + `role: system` + `content` | `type: abstract`，去掉 `when`、`role` |
| `when.absent: *` | **无自动迁移**；需产品决定删除该块或改为始终展示的 `text` |
| 无 `when` 的普通 `text` / `chat` | **不变** |

解析器对含 `when` 的文档：**拒绝**，错误信息指向 `type: abstract`。

---

## 影响模块（预期）

| 模块 | 变更 |
|------|------|
| `packages/core` — `prompt-block.ts` | 增加 `abstract` 联合成员；移除 `when` 类型。 |
| `agent-definition.schema.ts` | Zod：`abstractPromptBlockSchema`；`text` 无 `when`。 |
| `prompt-blocks-validate.ts` | 校验 `abstract`；遇 `when` 报错。 |
| `render-prompt.ts` | 按 `abstract` 块 + 空摘要跳过逻辑渲染（**目标行为**）。 |
| `examples/agent-writer.yaml` | 使用 `abstract` 块。 |
| `examples/ui-shell-prototype/app.js` | 编辑器与 mock 数据对齐。 |
| `.apm/kb/.../agent-config-and-compaction/*` | PRD/spec 增加「when 已废弃」注记（可选在本迭代或 follow-up doc PR）。 |
| 测试 | 更新/新增 abstract 块用例；删除 when 相关正向用例；保留「含 when 拒绝」用例。 |

---

## 验收标准

### Core

- [ ] `agentDefinitionFromJson` / `deserializeAgentDefinition` 接受 `type: abstract` 且 `content` 为字符串。
- [ ] 含 `when` 的块文档校验失败，错误信息含「use type abstract」或等价中文说明。
- [ ] Given `abstract` 块存在且 `ctx.abstract === ""`，When `buildPromptLlmInput`，Then 该块内容不出现在 `system` 中。
- [ ] Given `ctx.abstract` 非空，When `buildPromptLlmInput`，Then `abstract` 块 `content` 经宏展开后出现在 `system`（可与其它 system text 用换行拼接）。
- [ ] Given 未配置 `compact` 或从未压缩，`abstract` 仍为空，Then 行为同「跳过 abstract 块」。
- [ ] `abstract` 块不支持 `role`；带 `role` 的文档校验失败。

### 示例与原型

- [ ] `examples/agent-writer.yaml` 无 `when`，使用 `type: abstract`。
- [ ] UI 壳 Agent 编辑页可添加 **abstract** 块（无 when 表单项）；writer mock 与示例 YAML 结构一致。

### 回归

- [ ] `packages/core` 与 `apps/cli` 相关测试全绿。
- [ ] CLI `nm agent run --agent-config examples/agent-writer.yaml` 可正常加载（手工或既有 CLI 用例）。

---

## 测试用例

| ID | 场景 | 预期 |
|----|------|------|
| T1 | 合法 `abstract` 块解析 | 通过，类型为 `abstract` |
| T2 | `text` 块带 `when` | 校验失败 |
| T3 | `abstract` 为空，单 abstract 块 | `system` 不含该块文案 |
| T4 | `abstract` 有内容 | `system` 含展开后文案（含用户写的固定前缀 + 摘要正文） |
| T5 | `abstract` 仅空白 | 同 T3，视为空 |
| T6 | 多 system text + abstract + chat | 顺序合并 system；messages 来自 chat |
| T7 | `abstract` 块带 `role` | 校验失败 |
| T8 | `agent-writer.yaml` 反序列化 | 与 T1/T4 一致 |
| U1 | 原型：新建 abstract 块 | 无 when 字段；保存后 catalog 为 `type: abstract` |
| U2 | 原型：旧 mock 含 `when` | 已清理为 `abstract` 块 |

---

## 用户故事（简要）

1. **配置维护者**：写 Agent YAML 时，压缩摘要段落用 `type: abstract` 一眼可辨，不必记 `when.present`。
2. **App 用户**：在 Agent 编辑器里添加「摘要块」，不会在「条件 / 字段名」上配错。
3. **调试者**：`nm agent` 预览 prompt 时，无摘要则预览中不出现摘要段落，与线上行为一致。

---

## 风险与开放问题

| 项 | 说明 | 建议 |
|----|------|------|
| 已有 `when.absent` 配置 | 仓库内示例已基本无此用法 | 解析拒绝 + 迁移文档；无自动转换 |
| 与旧 spec 文档冲突 | agent-config-and-compaction spec 大量描述 `when` | 本迭代完成后更新 spec 或加 archive 注记 |
| Core 实现进度 | 部分分支可能已落地 `abstract` / 拒绝 `when` | 以本 PRD 验收表为准做 gap 扫描 |

---

## 后续

- 定稿后编写 **spec.md**（类型定义、错误码、CLI 预览行为）。
- 实现顺序建议：Core schema/渲染 → 示例 YAML → UI 原型 → 文档勘误。
- 不在本 PRD 内展开：App 持久化、更多块类型（如 `worktree` 专用块）。
