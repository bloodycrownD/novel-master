---
date: 2026-09-06 21:50
title: 创建 pi 子代理 vision（glm-5.3-flash 视觉通用 agent）
keywords: pi, subagent, agent 定义, glm-5.3-flash, 视觉能力
abstract: 应用户要求在 ~/.pi/agent/agents/ 下新建 vision.md 子代理：模型 zai-coding-cn/glm-5.3-flash（自带 image 输入），全内置工具集；已用测试图端到端验证视觉链路可用。
---

user:
帮我创建一个 agent，模型设置为 glm5.3-flash，要一个有视觉能力的通用 agent。

assistant:
先确认了 pi 子代理的 agent 定义格式（subagent 扩展的 agents.ts：frontmatter 支持 name/description/tools/model，model 原样传给 `pi --model`，支持 `provider/model` 斜杠写法消歧）。查 models-store.json 确认 glm-5.3-flash 同时挂在 zai 与 zai-coding-cn 两个 provider 下、input 含 image（视觉能力是模型自带的）；用户 pi 的默认渠道是 zai-coding-cn，故 model 写 `zai-coding-cn/glm-5.3-flash`。

在 `~/.pi/agent/agents/vision.md` 创建了 vision 子代理：通用定位（探索/改码/问答），系统提示里专门写了视觉工作流（用 read 工具读 jpg/png/gif/webp/bmp 图片作为附件，描述所见内容并回连任务），工具集给全了内置工具。

验证：subagent 扩展每次派发时即时 discoverAgents，无需重启 pi-web。用 PIL 生成写着 PINEAPPLE-7749 的测试图，派 vision 代理去读，正确返回图中文字——发现、模型解析、图片附件、视觉理解整条链路端到端可用。
