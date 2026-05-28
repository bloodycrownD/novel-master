# CLI 验收：Agent System

- 日期: 2026-05-28
- 审查人: pending
- 环境: `NO_COLOR=1`；场景 7–12 使用 mock LLM（无 API key）：`NM_AGENT_MOCK_LLM=1` + `NM_AGENT_MOCK_SCENARIO=<name>`
- 捕获脚本: `node apps/cli/scripts/capture-agent-scenarios.mjs`（真实执行，非编造）

---

## 场景 1 — 缺少子命令（用法）

```bash
cd apps/cli
node --import tsx src/index.ts agent
```

退出码: 1

标准错误:
```
Usage: novel-master agent <subcommand> ...
```

---

## 场景 2 — 缺少 project/session 作用域

```bash
node --import tsx src/index.ts agent run
```

退出码: 1

标准错误:
```
Missing --project <id> (or run: nm project use --project <id>)
```

---

## 场景 3 — 单步 continue（缺 modelId）

前置：`project use` + `session use` + `message append` 已执行。

```bash
node --import tsx src/index.ts agent continue --content "step one" --db <db>
```

退出码: 1

标准错误:
```
Missing --modelId <id> (or run: nm model use --modelId <provider>/<vendor>)
```

---

## 场景 4 — 单步 continue（缺 API key）

前置：`model use --modelId anthropic/claude-sonnet-4-20250514`（未设置 `NM_AGENT_MOCK_LLM`）

```bash
node --import tsx src/index.ts agent continue --content "ping" --db <db>
```

退出码: 1

标准错误:
```
API key not set for provider anthropic (run: nm provider edit --providerId anthropic --apiKey <key>)
```

---

## 场景 5 — prompt render（buildPromptLlmInput）

```bash
node --import tsx src/index.ts prompt render --path <tmpdir>/prompt.yaml --db <db>
```

退出码: 0

标准输出:
```
system: You are a helpful assistant.
user: hello agent
user: ping
```

---

## 场景 6 — message list（continue 写入 user 后）

```bash
node --import tsx src/index.ts message list --db <db>
```

退出码: 0

标准输出:
```
<uuid>	1	user		hello agent
<uuid>	2	user		ping
```

---

## 场景 7 — 单步 continue（mock LLM）

前置：同捕获脚本 — `project create` → `project use` → `session create` → `session use`。

```bash
cd apps/cli
set NM_AGENT_MOCK_LLM=1
set NM_AGENT_MOCK_SCENARIO=continue
node --import tsx src/index.ts agent continue --content "step one" --modelId mock/test --db <db>
```

退出码: 0

标准输出:
```
Assistant reply (single step).
```

备注: `maxSteps=1`；仅一次 model 往返；stdout 为流式 text-delta 累积结果。

---

## 场景 8 — 多步 run（mock LLM）

```bash
set NM_AGENT_MOCK_SCENARIO=run
node --import tsx src/index.ts agent run --content multi --max-steps 3 --modelId mock/test --db <db>
```

退出码: 0

标准输出:
```
Multi-step run finished.
```

备注: mock 前两轮返回 `vfs.list` tool_use，第三轮返回文本；`message list` 可见 tool_use / tool_result 与最终 assistant。

---

## 场景 9 — vfs tool（mock LLM）

```bash
set NM_AGENT_MOCK_SCENARIO=vfs
node --import tsx src/index.ts agent continue --content "write file" --modelId mock/test --db <db>
```

退出码: 0

标准输出:
```
(无 — 本轮 assistant 仅 tool_use，无 text 块)
```

备注: `message list` 含 `[tool_use] vfs.write` 与对应 `tool_result`；session VFS 写入由 ToolRunner 完成。

---

## 场景 10 — streaming（mock LLM）

```bash
set NM_AGENT_MOCK_SCENARIO=stream
node --import tsx src/index.ts agent continue --content "stream please" --modelId mock/test --db <db>
```

退出码: 0

标准输出:
```
streamed hello
```

备注: 默认流式；`--no-stream` 时不写增量 text-delta。

---

## 场景 11 — doom_loop（mock LLM）

```bash
set NM_AGENT_MOCK_SCENARIO=doom
node --import tsx src/index.ts agent continue --content doom --modelId mock/test --db <db>
```

退出码: 2

标准错误:
```
Doom loop: tool "vfs.read" invoked 3 times with identical input
```

---

## 场景 12 — compaction（mock LLM）

前置（独立库）：10× `message append` 长文本 → `config set --key agent.compaction.thresholdTokens --value 10` → `config set --key agent.compaction.keepLastN --value 2`。

```bash
set NM_AGENT_MOCK_SCENARIO=compaction
node --import tsx src/index.ts agent continue --content "compact me" --modelId mock/test --db <compact-db>
node --import tsx src/index.ts message list --db <compact-db>
```

退出码: 0

标准输出（agent continue）:
```
After compaction.
```

标准输出（message list 节选 — 原样捕获，长行未截断）:
```
<uuid>	1	user	[H]	long history line 0 ...
...
<uuid>	10	user		long history line 9 ...
<uuid>	11	user		compact me
<uuid>	12	user		[Compaction summary]
summary text
<uuid>	13	assistant		After compaction.
```

备注: `[H]` 表示 `hidden: true`；seq 1–9 已隐藏；可见条数含摘要 user 消息与 keepLastN 保留的最近消息。
