# CLI 验收：Agent System

- 日期: 2026-05-28
- 审查人: pending
- 备注: 临时目录 `C:\Users\BloodyCrown\AppData\Local\Temp\tmp58CA.tmp-nm-agent`，数据库 `novel.db`

## 场景 1 — 缺少子命令（用法）

```bash
cd apps/cli
node --import tsx src/index.ts agent
```

标准输出:
```
(无)
```

标准错误:
```
Usage: novel-master agent <subcommand> ...
```

---

## 场景 2 — 缺少 project/session 作用域

```bash
node --import tsx src/index.ts agent run
```

标准输出:
```
(无)
```

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

标准错误:
```
Missing --modelId <id> (or run: nm model use --modelId <provider>/<vendor>)
```

---

## 场景 4 — 单步 continue（缺 API key）

前置：`model use --modelId anthropic/claude-sonnet-4-20250514`

```bash
node --import tsx src/index.ts agent continue --content "ping" --db <db>
```

标准错误:
```
API key not set for provider anthropic (run: nm provider edit --providerId anthropic --apiKey <key>)
```

---

## 场景 5 — prompt render（buildPromptLlmInput + formatPromptLlmInputForCli）

```bash
node --import tsx src/index.ts prompt render --path <tmpdir>/prompt.yaml --db <db>
```

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

标准输出:
```
aac93ab2-414e-45b2-b7f6-9a23e5cd1ccc	1	user		hello agent
8ec9922a-80ff-40c1-9ee5-40b19a59eb7b	2	user		ping
```

---

## 场景 7–12 — 需 Anthropic API key 的 E2E

以下场景在本地未配置 `anthropic` API key 时会在 `agent continue` / `agent run` 阶段以场景 4 相同错误中止。配置 key 后预期行为：

| 场景 | 命令要点 | 预期 |
|------|----------|------|
| 单步 continue | `agent continue --content "..."` | 1 次 model 往返；若有 tool 则执行并写 tool_result，不自动第二次 LLM |
| 多步 run | `agent run --max-steps 5` | 多轮 tool 闭环直至文本结束或达上限 |
| vfs tool | prompt + `vfs.write` 等 | session VFS 内读写 |
| streaming | 默认流式；`--no-stream` 关闭 | stdout 增量 text-delta |
| doom_loop | 模型连续 3 次相同 tool_use | `AgentError: DOOM_LOOP` |
| compaction | `config set agent.compaction.thresholdTokens 10` 等 | 出现 `[Compaction summary]` 前缀的 user 消息 |

Core 单测覆盖：`packages/core/test/agent/*`、`model-request-tools-stream.test.ts`。
