# 正则系统 PRD

## 背景

对话场景中需要对消息正文做 **可配置的匹配与替换**，分别作用于 **CLI/终端展示** 与 **发给 LLM 的提示词**，以实现内容过滤、脱敏、屏蔽或改写等能力。

当前缺少统一的 **正则组 / 正则规则** 配置模型与生效规则，无法按 **可见消息 floor**、消息角色（用户/助手）精细控制替换范围。

本迭代引入 **两级正则配置**：通过 **当前生效正则组**（工作区状态指针，语义对齐 current project / session / model）选定唯一生效的组；组内可同时启用多条规则，命中关系为 **OR**（各自独立匹配）；**多条同时命中时按组内列表顺序依次执行替换**。

**本期交付**：Core + CLI；**不含** `examples/mobile` / RN（移动原型顺延至后续迭代）。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 可配置过滤/脱敏 | 支持正则组 + 组内多条规则；可分别或单独配置 **提示词替换**、**显示替换** |
| 生效边界清晰 | 按 **可见消息 floor**（与 hide/compact 一致，hidden 不计）与 **闭区间 a ≤ x ≤ b**；按 **用户/助手** 作用范围过滤 |
| 互斥与组合语义明确 | **当前生效正则组** 单指针；组内启用规则为 **OR**，多命中 **按序串联** |
| 切换体验一致 | 与 `nm project use` / `nm session use` / `nm model use` 同类：**use 写入状态、读当前指针** |
| 配置可校验 | 作用范围未选、替换字段皆空、正则非法等 **可判定失败** |
| 占位符一致 | 替换文本支持 JS 风格 `$` 占位符（如 `$1`、`$&`） |
| CLI 双通道可验 | **提示词替换**：`nm prompt render` / `nm agent run`（或等价 LLM 路径）e2e 可判定；**显示替换**：`nm message list`（或 `nm regex test --channel display`）e2e 可判定 |
| 存储与指针 | `nm regex-group` / `nm regex` CRUD；`use`/`current`/`reset`；删除当前组时 **自动清空指针** |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 运营/配置者 | 维护多组正则方案，通过 `nm regex-group use` 切换 **当前生效正则组** |
| 运营/配置者 | 组内多条 OR 规则；按列表顺序串联；后一条作用于前一条输出 |
| CLI 用户 | `nm regex-group`、`nm regex` 管理组与规则；`nm regex test` 预览单条样例 |
| 开发者/运维 | 仅 **显示替换**：`nm message list` 看到打码，DB 与 prompt 侧仍为原文（若未配 llmReplace） |
| 开发者/运维 | 仅 **提示词替换**：`nm prompt render` 送入模型的文本已替换，`message list` 仍为原文 |

## 范围

### 包含范围

#### 1. 数据结构（两级）

- **正则组列表**：多个正则组（定义/元数据）；**哪一组生效** 由工作区 **当前生效正则组** 指针决定，而非组级「勾选启用」。
- **当前生效正则组**：`currentRegexGroupId`（KKV `nm-workspace-state`）；任意时刻 **至多一个** group id；未设置或指向已删除组 → **无正则替换**。
- **正则规则列表**：每组下多条规则，**稳定列表顺序**；组内可 **多条同时启用**（OR）；命中则应用该条已配置的替换字段。
- **组内执行顺序**：在当前生效组内，按列表顺序遍历 **已启用** 且满足 floor、作用范围的规则；**多条均命中时依次执行**（提示词链与展示链各自串联）。

#### 2. 单条正则规则字段

| 字段 | 必填 | 说明 |
|------|------|------|
| 名称 | 是 | 管理、排查用标识 |
| 正则表达式 | 是 | 语义对齐 **TypeScript / JavaScript `RegExp`** |
| 启用状态 | 是 | 禁用则不参与匹配与替换 |
| 提示词替换 | 否* | 命中后用于 **LLM 提示词** 构造；支持 `$` 占位符 |
| 显示替换 | 否* | 命中后用于 **CLI 展示**（如 `nm message list`）；支持 `$` 占位符 |
| 最小层数 `a`、最大层数 `b` | 是 | 可见消息 floor `x` 须满足 **a ≤ x ≤ b** |
| 作用范围 | 是 | **用户**、**助手** 至少选一；未配置 → **校验报错** |

\* **提示词替换** 与 **显示替换** 至少配置其一。

#### 3. 层数 `x`（可见消息 floor）

- `x` = 该消息在会话 **可见消息序列** 中的 1-based 序号（按 `seq` 升序，**不含 `hidden`**）。
- 与 compaction **`floorThreshold`**、`AgentSession.list()` **同一可见集**（参考 `FloorThresholdTrigger`：hidden **不计入** floor，**不参与** regex）。
- **不改写 DB 中的消息原文**；替换仅在构造 prompt / CLI 输出时生效。

#### 4. 替换与占位符

- 仅对 **已配置** 的替换字段执行替换（未配置侧保持原文）。
- 占位符与 **`String.prototype.replace`** 一致（`$1`–`$9`、`$&` 等）。

#### 5. 校验

- 作用范围未选 → **报错**。
- 提示词替换与显示替换皆空 → **报错**。
- 正则非法 → **报错**。
- `minDepth > maxDepth` → **报错**。
- 组间互斥仅由 **当前生效正则组** 指针保证（`use` 覆盖上一指针）。

#### 6. CLI（本期必做）

**命令族**（风格对齐 `nm project` / `nm model`；flag 细节见 SPEC）：

| 命令 | 能力 |
|------|------|
| `nm regex-group` | `create`、`use`、`current`、`reset`、`list`、`edit`、`delete` |
| `nm regex` | `create`、`list`、`show`、`edit`、`delete`、`enable`、`disable`、`test` |

**工作区指针**

- `nm regex-group use <groupId>` → 写入 `currentRegexGroupId`（组须存在）。
- `nm regex-group current` → 打印当前 id；未设置则失败并提示 `use`。
- `nm regex-group reset` → 清空指针。
- `nm regex-group delete <groupId>` → 删除组及组内规则；若删除的是 **当前生效组**，则 **自动 `reset` 指针**。

**规则示例**

```bash
nm regex-group create strict-filter
nm regex-group use strict-filter

nm regex create \
  --regexGroup strict-filter \
  --regexId block-email \
  --name "屏蔽邮箱" \
  --pattern '[\w.-]+@[\w.-]+\.[A-Za-z]{2,}' \
  --llmReplace '[redacted]' \
  --displayReplace '***' \
  --minDepth 1 --maxDepth 99 \
  --user --assistant
```

**双通道验收（本期必须）**

| 通道 | 验收方式（PRD 要求） |
|------|----------------------|
| 提示词替换 | 配置仅 `--llmReplace` 时，`nm prompt render`（及/agent 等等价路径）输出为替换后文本；`nm message list` 仍为原文 |
| 显示替换 | 配置仅 `--displayReplace` 时，`nm message list` 输出为替换后文本；`nm prompt render` 仍为原文 |
| 预览 | `nm regex test --channel llm\|display` 对样例文本可复现上述语义 |

**持久化**：组与规则由 Core **SQLite 表**（`regex_group` / `regex_rule`，见 SPEC）+ Service/Repository 存储；**当前生效组** 指针仍为 KKV `nm-workspace-state`；CLI 不直写 SQL。

### 不包含范围

| 项 | 说明 |
|----|------|
| `examples/mobile` 正则配置 UI | **本期不做**；需求保留见下文「后续：移动原型」 |
| RN 正式 App | 不含 |
| 非用户/助手消息正文 | 默认不处理 system 等（除非 SPEC 扩展） |
| `--file` 批量导入规则 | 二期 |
| KKV 模块名、Service 签名、挂载点实现细节 | SPEC 定 |

### 后续：移动原型（非本期）

顺延自原需求，供下一迭代引用：

- 「我的」→ **正则配置** → 正则组列表 → 正则列表 → 正则详情（交互对齐服务商管理多级列表）。
- mock `workspaceCurrentRegexGroupId` + localStorage；字段与校验与 PRD 一致。
- **不要求** 本期在聊天页接 Core；可选规则编辑页 **测试区** 预览替换。

## 核心需求

1. **两级配置**：正则组 → 组内规则；稳定顺序。
2. **当前生效正则组**：单一工作区指针；`use` / `reset`；删除当前组时 **自动 reset**。
3. **组内 OR + 按序串联**：多规则可同时启用；按列表顺序依次替换。
4. **双通道替换**：提示词 / 显示至少配其一；两侧可不同。
5. **floor 过滤**：`a ≤ x ≤ b`，`x` 为可见消息 floor（hidden 不参与）。
6. **角色过滤**：用户/助手至少选一。
7. **占位符**：JS replace 语义。
8. **CLI 本期必交付**：`nm regex-group`、`nm regex`；**必须用 e2e 验证 llm 与 display 两通道**（见上表）。

## 验收标准

### 当前生效正则组

- **Given** 指针指向组 A，**When** `nm regex-group use B`，**Then** 指针仅为 B。
- **Given** 指针未设置或已 `reset`，**When** 处理消息，**Then** 无替换。
- **Given** 指针指向已删除组，**When** 处理消息，**Then** 等同无生效组（不替换）。
- **Given** 当前生效组为 G，**When** `nm regex-group delete G`，**Then** 指针已清空且 `current` 失败并提示 `use`。

### 组内规则（OR + 按序串联）

- **Given** R1、R2 均启用且均命中，顺序 R1→R2，**When** 应用替换，**Then** 先 R1 后 R2（llm/display 各自串联）。
- **Given** 仅 R1 命中，**When** 应用替换，**Then** 仅 R1 生效。
- **Given** 规则已禁用，**When** 处理，**Then** 该规则不参与。

### 层数（可见 floor）

- **Given** a=2、b=5，可见消息 floor x=2 或 x=5，**When** 评估，**Then** 规则生效。
- **Given** 同上，x=1 或 x=6，**When** 评估，**Then** 不生效。
- **Given** 中间若干消息已 hide，**When** 计算 floor，**Then** hidden 无 floor；其余可见消息 floor 为 1..k（与 compact 可见计数一致）。

### 作用范围与替换字段

- **Given** 仅用户 scope，**When** 处理助手消息，**Then** 不应用。
- **Given** scope 皆未选，**When** `nm regex create`，**Then** 失败。
- **Given** 两侧替换皆空，**When** `nm regex create`，**Then** 失败。
- **Given** 仅 `displayReplace`，**When** `nm message list`，**Then** 展示替换后；**When** `nm prompt render`，**Then** 原文。
- **Given** 仅 `llmReplace`，**When** `nm prompt render`，**Then** 替换后；**When** `nm message list`，**Then** 原文。
- **Given** 含捕获组与 `$1`，**When** 命中替换，**Then** 结果符合 JS replace。

### CLI（配置与指针）

- **Given** 无当前组，**When** `nm regex-group current`，**Then** 失败并提示 `use`。
- **Given** `create` + `use g1`，**When** `current`，**Then** 输出 `g1`。
- **Given** 非法 `--pattern`，**When** `create`，**Then** 失败。
- **Given** 合法规则，**When** `nm regex list --regexGroup <id>`，**Then** 顺序稳定。

### CLI（双通道端到端）

- **Given** 当前生效组含命中规则且仅配置显示替换，**When** `nm message list`，**Then** 可见消息正文为打码后（DB 未改）。
- **Given** 同上规则仅配置提示词替换，**When** `nm prompt render`，**Then** 可见消息段为替换后；**When** `nm message list`，**Then** 仍为原文。

---

**生成路径**：`.apm/kb/docs/Iterations/regex-system/prd.md`

**迭代文件夹名**：`regex-system`

技术方案见同目录 `spec.md`。确认 PRD 后可按 SPEC 进入编码。
