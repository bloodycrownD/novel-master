# CLI 验收：Agent System

- 日期: 2026-05-29
- 审查人: pending
- 环境: `NO_COLOR=1`；场景 1–6 与场景 11 见各节说明
- Provider（场景 7–10、12）: **zhipu**（`protocol: openai`，`baseUrl: https://open.bigmodel.cn/api/coding/paas/v4`，模型 `zhipu/glm-4.6`）；**未设置** `NM_AGENT_MOCK_LLM`
- API key: SKSP（`nm provider list` 显示 `apiKey: set`）或 `NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY`
- 捕获脚本: `node apps/cli/scripts/capture-agent-scenarios.mjs`（默认 db: `.novel-master/novel.db`；Z11 固定 mock）

**说明（2026-05-29 捕获）**: Z7–Z9、Z12 为 zhipu 真机 exit 0。Z9 使用 `OPENAI_TOOL_CHOICE_REQUIRED=1` 强制 tool 调用，并以 `message list` + `session vfs read` 验证 `tool_use`/`tool_result` 与 VFS 内容。Z10 首次捕获因 `fetch failed`（网络瞬断）exit 2；同环境单独重跑 exit 0（见场景 10 备注）。Z11 为 mock doom_loop（预期 exit 2）。捕获脚本支持 `--scenario N`；会对旧库自动 `ALTER TABLE` 补 `chat_message.hidden` 列。

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

## 场景 7 — 单步 continue（zhipu 真机）

```bash
cd apps/cli
# 未设置 NM_AGENT_MOCK_LLM
node --import tsx src/index.ts agent continue --content "用一句话介绍你自己。" --modelId zhipu/glm-4.6 --db d:\Dev\Js\novel-master\.novel-master\novel.db
```

退出码: 0

标准输出:
```
我是AI助手，致力于为您提供准确、专业的问答和解决方案。
```

备注: 每场景独立 `AgentCaptureZhipu` project/session；db 含 SKSP zhipu apiKey。

---

## 场景 8 — 多步 run（zhipu 真机）

```bash
node --import tsx src/index.ts agent run --content "先说一句你好，然后结束。" --max-steps 3 --modelId zhipu/glm-4.6 --db d:\Dev\Js\novel-master\.novel-master\novel.db
```

退出码: 0

标准输出:
```
你好！
```

---

## 场景 9 — vfs tool（zhipu 真机）

```bash
set OPENAI_TOOL_CHOICE_REQUIRED=1
node --import tsx src/index.ts agent continue --content "You MUST call vfs.write with path /agent-test.txt and content hello-zhipu. Do not describe or explain; invoke the tool now." --modelId zhipu/glm-4.6 --db d:\Dev\Js\novel-master\.novel-master\novel.db
node --import tsx src/index.ts message list --db d:\Dev\Js\novel-master\.novel-master\novel.db
node --import tsx src/index.ts session vfs read /agent-test.txt --db d:\Dev\Js\novel-master\.novel-master\novel.db
```

退出码: 0

标准输出（message list + session vfs 节选）:
```
--- message list ---
…	1	user		You MUST call vfs.write with path /agent-test.txt and content hello-zhipu. …
…	2	assistant		[thinking] …⏎[tool_use] vfs.write (tool-e6d58bc703c64da7b47f8d0b034ce318)
…	3	user		[tool_result] tool-e6d58bc703c64da7b47f8d0b034ce318: {⏎  "version": 1⏎}
--- session vfs read /agent-test.txt ---
hello-zhipu
```

备注: Agent 写入 session VFS（路径 `/agent-test.txt`）；验证用 `session vfs read`，非全局 `vfs read`。捕获：`node apps/cli/scripts/capture-agent-scenarios.mjs --scenario 9`。

---

## 场景 10 — streaming（zhipu 真机）

```bash
node --import tsx src/index.ts agent continue --content "请流式回复：streaming ok" --modelId zhipu/glm-4.6 --db d:\Dev\Js\novel-master\.novel-master\novel.db
```

退出码: 0

标准输出:
```
收到！我将采用流式方式进行回复。

流式响应已就绪...

有什么我可以帮您的吗？

无论是代码编写、文件操作、还是其他任务，我都可以协助您完成。

您可以随时提出具体需求，我会逐步为您处理并流式返回结果。

请继续您的指令...
```

备注: 批量捕获时曾出现 `fetch failed`（exit 2）；上列为同 db/key 单独重跑成功输出。

---

## 场景 11 — doom_loop（mock LLM，非 zhipu）

**显式 mock** — 不使用 zhipu。

```bash
set NM_AGENT_MOCK_LLM=1
set NM_AGENT_MOCK_SCENARIO=doom
node --import tsx src/index.ts agent continue --content doom --modelId mock/test --db <db>
```

退出码: 2

标准错误:
```
Doom loop: tool "vfs.read" invoked 3 times with identical input
```

备注: `NM_AGENT_MOCK_LLM=1` + `NM_AGENT_MOCK_SCENARIO=doom`；与 OpenAI adapter 实现无关。

---

## 场景 12 — compaction（zhipu 真机）

前置（`CompactZhipu` project）：10× `message append` 长文本 → `config set --key agent.compaction.thresholdTokens --value 10` → `config set --key agent.compaction.keepLastN --value 2`（捕获后恢复原 config）。

```bash
node --import tsx src/index.ts agent continue --content "请简短总结上文并回复 done" --modelId zhipu/glm-4.6 --db d:\Dev\Js\novel-master\.novel-master\novel.db
node --import tsx src/index.ts message list --db d:\Dev\Js\novel-master\.novel-master\novel.db
```

退出码: 0

标准输出（message list 节选）:
```
dc64d447-1649-47bb-911e-096113cfe092	1	user	[H]	long history line 0 ...
38779d97-b87e-46ec-bf06-e6fe5369a61c	2	user	[H]	long history line 1 ...
...
27005cd4-b4a8-4e13-b9a5-10852e2041f7	10	user		long history line 9 ...
14bbcf0c-5fb1-402b-ba4d-8713cf1d969d	11	user		请简短总结上文并回复 done
5a7e740e-14fb-4f4d-ada3-551c93977551	12	user		[Compaction summary]⏎The user provided nine repetitive messages...
e00db693-b6db-4cc0-af61-456774aed15f	13	assistant		[thinking] ⏎done
```

备注: `[H]` = `hidden: true`；seq 12 为 compaction summary user 消息。
