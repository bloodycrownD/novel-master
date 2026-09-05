---
date: 2026-09-01 01:16
title: 查询 pi 可用模型列表与 models.json 现状
keywords: pi, models, --list-models, models.json, modelOverrides, glm-5.3, contextWindow
abstract: 用户问 pi 的 models，查了 docs/models.md、~/.pi/agent/models.json（zai/zai-coding-cn 两 provider 对 glm-5.3 覆盖 contextWindow=400K）与 pi --list-models 当前可用模型清单。
---

user:
models（单字查询 pi 的模型情况）

assistant:
- 查 pi 官方文档 docs/models.md：自定义模型/服务商走 ~/.pi/agent/models.json，支持 openai-completions / openai-responses / anthropic-messages / google-generative-ai 四种 API，含 provider 级与 model 级配置、modelOverrides、thinkingLevelMap、samplingParams、compat 兼容开关等。
- 用户本地 models.json 现状：zai 与 zai-coding-cn 两个 provider 各有一条 modelOverrides，把 glm-5.3 的 contextWindow 覆盖为 400000（其余走内置默认）。
- pi --list-models 可见 17 个模型，全部来自 zai / zai-coding-cn（glm-4.x ~ glm-5.3 系列），glm-5.3 显示 400K 即本地覆盖生效的证据。
