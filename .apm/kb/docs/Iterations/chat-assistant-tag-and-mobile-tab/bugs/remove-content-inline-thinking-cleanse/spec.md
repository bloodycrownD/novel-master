---
date: 2026-07-19
agile_trace: true
---

# remove-content-inline-thinking-cleanse 实现规格（SPEC）

## 根因 / 方案摘要

定稿与非流式入站对 `content` 调用 `cleanseReplyTextAndThinking`（含反引号 `extractThinkFencedBlocks`、XML thinking 标签、`>thought` 等），与「专用字段才是协议思考、正文清洗归用户正则」冲突。

方案：生产路径取消对 content 的内嵌清洗；`blocksFromReplyStrings` 等改为 `thinkingRaw`→thinking、`textRaw`→text 直通；删除 splitter / `stream-inline-thinking-split-mode` 死路径。结构化字段映射保持不变。

## 变更点清单

| 模块 | 变更 |
|------|------|
| `openai-content-mapper.ts` | 去掉 cleanse/split；`reasoning_content` 仍进 thinkingParts |
| `gemini-sse-parser.ts` / `gemini-content-mapper.ts` | finish 与非 thought text 直通；`thought: true` 不变 |
| `inline-thinking-parser.ts` | 收缩为直通辅助（如 `emitDirectTextDelta`）；删除 content strip / splitter |
| `stream-inline-thinking-split-mode.ts` | 删除 |
| 协议单测 | 断言改为标签留在 text；删 cleanse/splitter 专用用例 |

## 详细改动说明

1. 组块：有非空 `thinkingRaw` 则 push thinking 块；有非空 `textRaw` 则 push text 块；二者互不 merge/strip。
2. `openAiChoiceToBlocks`：string `content` 直接 `textParts.push`。
3. 流式：仅 `emitDirectTextDelta`；不再提供 `NM_INLINE_STREAM_THINKING_SPLIT` 内嵌拆分。
4. 漏网标签：不在协议层处理；展示 sanitize（父级迭代）与用户正则另行负责。

## 测试策略

### 测试用例

| ID | 说明 |
|----|------|
| T-S1 | `reasoning_content` / `thought: true` → thinking 仍绿 |
| T-S2 | content 含 `<thought>` 时 finish 后 text 保留标签 |
| T-S3 | 反引号 / 旧 splitter 用例删除或不再期望抽 thinking |
| T-S4 | 双字段 chunk：reasoning 与 content 顺序/并存行为按直通+字段映射 |

验证（示例）：

```bash
cd packages/core
npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test \
  test/infra/llm-protocol/inline-thinking-parser.test.ts \
  test/infra/llm-protocol/stream-inline-thinking-split-mode.test.ts \
  test/infra/llm-protocol/openai-content-mapper.test.ts \
  test/infra/llm-protocol/gemini-sse-parser.test.ts \
  test/infra/llm-protocol/openai-partial-stream.test.ts \
  test/infra/llm-protocol/gemini-thought-signature.test.ts \
  test/infra/llm-protocol/gemini-content-mapper.test.ts
```

（若某测试文件已删，以仓库实际文件为准；落地时 46 pass。）

## 风险与回滚方案

| 风险 | 缓解 / 回滚 |
|------|-------------|
| 脏网关只把推理塞进 content 标签时不再自动进 thinking | 产品接受；可用用户正则剥离 |
| 曾依赖 structured+content 去重的回复可能正文与 thinking 重复 | 脏网关场景；回滚可恢复 cleanse 提交 |

回滚：还原 `a8ed0e07` / `8fe77bcb` 两笔提交。
