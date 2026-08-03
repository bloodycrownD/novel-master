# CLI 验收：Agent 与模型解耦

环境：仓库根目录，已 `npm run build`，`NM_AGENT_MOCK_LLM=1` 可选。

## E1 — 无 model 的 agent + workspace 当前模型

```bash
nm project create --name T
nm project use --project <id>
nm session create
nm session use --session <id>
nm model use --modelId mock/test
nm agent continue --content hello --agent-config examples/agent-writer.yaml
```

预期：成功；使用 `mock/test`（state），非 agent 内旧 model 字段。

## E2 — `--modelId` 覆盖 preferredModelId

Agent yaml 含 `preferredModelId: mock/test`，state 为其他模型时：

```bash
nm agent continue --content hi --agent-config <path> --modelId zhipu/glm-4.6
```

预期：flag 优先（mock 场景下 stderr/verbose 可核对）。

## 采样档案

```bash
nm provider model save --vendorModelId glm-4.6   # 需已配置 provider
# 写入 profile JSON 文件 profile.json:
# {"schemaVersion":1,"enabled":true,"params":{"protocol":"openai","openai":{"temperature":0.3}}}

nm provider model sampling set --modelId zhipu/glm-4.6 --file profile.json
nm provider model sampling show --modelId zhipu/glm-4.6
nm provider model sampling clear --modelId zhipu/glm-4.6
```

预期：show 输出 enabled/params；clear 后 show 为 `{ "enabled": false }` 或等效。

## 破坏性校验

含顶层 `model:` 的 agent yaml 应校验失败。
