# CLI 验收：Agent System

- 日期: 2026-05-29
- 审查人: pending
- 环境: `NO_COLOR=1`；场景 1–6 与场景 11 见各节说明
- Provider（场景 7–10、12）: **zhipu**（`protocol: openai`，`baseUrl: https://open.bigmodel.cn/api/coding/paas/v4`，模型 `zhipu/glm-4-flash`）；**未设置** `NM_AGENT_MOCK_LLM`
- API key: `NOVEL_MASTER_PROVIDER_ZHIPU_API_KEY` 或 `nm provider edit --providerId zhipu --apiKey <key>`
- 捕获脚本: `node apps/cli/scripts/capture-agent-scenarios.mjs`（真实执行；Z11 固定 mock）

**说明（2026-05-29 捕获环境）**: 下列 Z7–Z10、Z12 在自动化捕获时 **未注入 zhipu API key**，故退出码为 2、stderr 为 `API key not set`。本地配置 key 后重跑脚本可得到 exit 0 与真实 assistant 输出。Z11 始终为 mock，与 zhipu 无关。

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

前置：捕获脚本创建 `zhipu` provider、`provider model save --vendorModelId glm-4-flash`、`model use zhipu/glm-4-flash`；**未设置** `NM_AGENT_MOCK_LLM`。

```bash
cd apps/cli
node --import tsx src/index.ts agent continue --content "用一句话介绍你自己。" --modelId zhipu/glm-4-flash --db <db>
```

退出码: 2（捕获时无 API key）

标准错误:
```
API key not set for provider zhipu (run: nm provider edit --providerId zhipu --apiKey <key>)
```

备注: 配置 key 后预期 exit 0，stdout 为 assistant 文本（流式累积）。

---

## 场景 8 — 多步 run（zhipu 真机）

```bash
node --import tsx src/index.ts agent run --content "先说一句你好，然后结束。" --max-steps 3 --modelId zhipu/glm-4-flash --db <db>
```

退出码: 2（捕获时无 API key）

标准错误:
```
API key not set for provider zhipu (run: nm provider edit --providerId zhipu --apiKey <key>)
```

备注: 配置 key 后预期多轮 message（含 assistant text 或 max_steps 终止）。

---

## 场景 9 — vfs tool（zhipu 真机）

```bash
node --import tsx src/index.ts agent continue --content "请用 vfs.write 在项目 VFS 写入文件 /agent-test.txt，内容为 hello-zhipu" --modelId zhipu/glm-4-flash --db <db>
```

退出码: 2（捕获时无 API key）

标准错误:
```
API key not set for provider zhipu (run: nm provider edit --providerId zhipu --apiKey <key>)
```

备注: 配置 key 后预期 `tool_use` + `tool_result` 与 VFS 文件；image **不在** zhipu 真机范围（见 Core 单测 O6）。

---

## 场景 10 — streaming（zhipu 真机）

```bash
node --import tsx src/index.ts agent continue --content "请流式回复：streaming ok" --modelId zhipu/glm-4-flash --db <db>
```

退出码: 2（捕获时无 API key）

标准错误:
```
API key not set for provider zhipu (run: nm provider edit --providerId zhipu --apiKey <key>)
```

备注: 配置 key 后预期 stdout 增量（`text-delta`）；`--no-stream` 关闭增量。

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

前置（独立库）：10× `message append` 长文本 → `config set --key agent.compaction.thresholdTokens --value 10` → `config set --key agent.compaction.keepLastN --value 2`。

```bash
node --import tsx src/index.ts agent continue --content "请简短总结上文并回复 done" --modelId zhipu/glm-4-flash --db <compact-db>
node --import tsx src/index.ts message list --db <compact-db>
```

退出码: 2（捕获时无 API key；`message list` 仍 exit 0）

标准错误（agent continue）:
```
API key not set for provider zhipu (run: nm provider edit --providerId zhipu --apiKey <key>)
```

标准输出（message list 节选 — 压缩前 agent 未跑通，仅见历史 user 行）:
```
<uuid>	1	user	[H]	long history line 0 ...
...
<uuid>	10	user		long history line 9 ...
<uuid>	11	user		请简短总结上文并回复 done
```

备注: 配置 key 后重跑 continue，预期 summary user 消息、`[H]` 隐藏旧消息、assistant 回复。`[H]` = `hidden: true`。
