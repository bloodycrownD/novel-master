# 代码库审计整改 PRD

> **来源**：2026-06 代码库健康度调查（18 项审计条目逐项核查）。  
> **范围决策**：覆盖上轮结论为「成立 / 部分成立」的全部条目；**不成立**项（`[debug-chat]` 调试日志）仅记录为已关闭，不纳入开发。

## 背景

近期对 monorepo 进行系统性审计，发现若干 **已确认 Bug**（Gemini / Claude 多轮 thinking signature 丢失、调试日志泄露 API Key）、**高维护成本热点**（`ChatTabScreen` 近 1800 行）、以及 **工程化与架构债**（无根级 Lint/CI PR 检查、Domain 反向依赖 Service、Mobile/Desktop agent 服务重复等）。

代码核查：`ThinkingBlock` 仅存 `text`；Gemini mapper 不回传 `thought_signature`；Anthropic mapper 出站仅 `{ type: "thinking", thinking: text }`，**不读不写 `signature`**；`redacted_thinking` 入站被丢弃；SSE parser 未处理 `signature_delta`。

部分条目已在代码中缓解（Desktop preload 强制 CJS、EventBus UI 订阅有 cleanup），但仍需文档化、回归防护或补齐边界场景。本迭代以 **分阶段交付、可独立验收** 为原则，避免单次 PR 过大。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 修复多厂商 thinking signature 多轮 Bug | Gemini 2.5+ / 3.x：连续 ≥3 轮 tool 无 400，回传 `thought_signature`；Claude extended thinking + tool：回传 `thinking.signature` 与 `redacted_thinking` 块 |
| 消除调试日志 Key 泄露 | 开启 `NM_DEBUG_LLM_FETCH` 或 Mobile `__DEV__` 时，日志中 Gemini `?key=` 显示为 `***` |
| 降低聊天 Tab 维护成本 | `ChatTabScreen.tsx` 行数降至 **≤800**；行为与现网一致（手工 smoke + 现有 e2e 不退化） |
| 提升工程化基线 | 根目录或 workspace 级 `lint` / `format:check` 可 CI 执行；新增 `pull_request` workflow 跑 `build` + `test`（至少 core + desktop smoke） |
| 收敛架构与重复 | Domain→Service 反向依赖清零或迁至 port；`agent-run.service` 共享逻辑提取至 core 或共享模块，两端仅保留平台薄封装 |
| 巩固已知修复 | Desktop preload CJS 回归测试保持绿；`[debug-chat]` 条目标记关闭 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 使用 Gemini / Claude thinking 模型的 Agent 用户 | 多轮 tool 调用（写文件、查 VFS 等）不因 signature 丢失而 400 或推理断裂 |
| 使用 Claude extended thinking 用户 | 含 `redacted_thinking` 的助手轮次在下一轮请求中原样回传 |
| 开发者 / 调试者 | 开启 LLM fetch 调试时，logcat/控制台不泄露 provider API Key |
| Mobile 维护者 | 修改聊天 Tab 某一能力（批量删、WebView transcript、流式）时不必通读 1700+ 行单文件 |
| 贡献者 / CI | 提 PR 时自动跑测试与 lint，减少回归合入 main |
| Desktop 开发者 | macOS/Windows 启动与 preload 行为有自动化守护 |

## 范围

### 包含范围

**P0 — Bug（必须先做）**

1. **Thinking signature 多协议闭环**（Gemini + Anthropic）：
   - **Gemini**：持久化 `thought_signature`；多轮 history 在含 `functionCall` / thinking 的 part 上原样回传（parallel / sequential FC）。
   - **Anthropic / Claude**：持久化 `thinking` 块上的 `signature`；流式解析 `signature_delta`；入站识别 `redacted_thinking` 并原样回传；extended thinking + tool use 时 assistant 轮次在 tool_result 之前保留完整 thinking 块序列。
2. **debug-fetch URL 脱敏**：`createLoggingFetch` 对 URL query `key`、路径中含 key 的场景做 redact。

**P1 — 高维护性**

3. **ChatTabScreen 拆分**：按「会话列表 / 对话工作区 / 流式与 Agent 状态 / 批量与菜单」拆 hooks 与子组件；单文件 ≤800 行。

**P2 — 工程化**

4. **Lint / Format 工具链**：根或 workspace 统一 ESLint + Prettier（或等价），覆盖 `packages/core`、`apps/desktop`、`apps/cli`；mobile 沿用现有配置并纳入根脚本。
5. **CI PR 检查**：新增 `.github/workflows/ci.yml`（`pull_request` → `main`）：`npm ci`、`npm run build`（或分 workspace）、`npm test`（core fast + desktop test）。
6. **Desktop 测试补强**：为 IPC agent stream、update-check 已有测试外，增加 main bootstrap detach / preload CJS 的契约测试（在现有 smoke 上扩展）。

**P2 — 架构与质量（可分批 PR）**

7. **Domain 反向依赖**：`restore-path.ts`、`kkv-model-suggestion.repository.ts`、`compaction-condition-trigger.port.ts` 去除对 `@/service/*` 的直接 import，改为 domain port 或 infra 注入。
8. **EventBus 生命周期**：`main.ts` rebootstrap / `before-quit` 显式调用 forwarder / worktree-sync 返回的 cleanup；`DefaultEventOrchestrator` 提供 `detachFromBus()`（测试与 rebootstrap 用）。
9. **Mobile/Desktop agent-run 去重**：共享 `resolveCurrentAgent*`、`runAgentWithUserMessage` 等至 `@novel-master/core` 或 `packages/shared-runtime` 薄层。
10. **SSE parser buffer 抽取**：三协议 parser 共用 `feedSseLines` helper（行为不变）。
11. **Anthropic API 版本常量**：提取为单处 `ANTHROPIC_API_VERSION`，adapter 引用。
12. **移除 `greet()` 样板**：删除 core 导出与 cli 调用（或改为私有测试用）。
13. **React.memo / 内联 style（增量）**：聊天列表热点组件（`ChatTranscriptWebView` 包装、会话行）优先 memo；新增样式进 StyleSheet，**不**要求一次清零 213 处内联 style。
14. **桶导出瘦身（增量）**：`packages/core/src/index.ts` 按域拆分子路径 export（如 `@novel-master/core/chat`），本迭代至少停止继续膨胀并文档化推荐 import 路径。
15. **Domain repository impl 位置（文档 + 增量）**：新代码不放 `domain/*/repositories/impl`；现有实现迁移列入后续迭代，本迭代仅 ADR/注释说明目标布局。

**P3 — 验证 / 文档化（无代码或极少代码）**

16. **Desktop ESM→CJS**：确认 `preload.cjs` + smoke 测试；补充 README 说明「禁止改回 ESM preload」。
17. **Fetch 路径无整流器**：在 `llm-sse-transport` 模块头注释与 kb 交叉引用，标明 Desktop fetch 路径**有意**不用 `SseChunkEmitter`（RN XHR 专用）。
18. **`[debug-chat]`**：调查结论为全库 0 匹配 — **关闭**，无需开发。

### 不包含范围

- 全量内联 style（213 处）一次性重构
- 所有 `domain/*/repositories/impl` 一次性迁至 `infra/`
- `packages/core/src/index.ts` 完全删除桶导出（破坏性 API 变更需独立迭代）
- Release workflow（`release.yml`）行为变更
- 新功能（关于页、更新检查等已有迭代除外）
- macOS 实机 E2E（无 runner 时不阻塞本迭代）
- `postSseViaFetch` 增加 XHR 同款整流器（除非 RN fetch 回退路径出现新回归）

## 核心需求（7 条）

1. **Thinking signature 闭环（Gemini + Anthropic）**：域模型用可选 `thinkingSignature`（及 `redacted_thinking` 块）承载多厂商 opaque 签名；Gemini 映射 `thought_signature`，Anthropic 映射 `signature`；`content_json` 向后兼容（旧消息无签名字段仍可读）。
2. **调试安全**：LLM fetch 调试日志不得输出完整 API Key（header 与 URL query 均脱敏）。
3. **ChatTabScreen 模块化**：拆分后对外导航与 UX 不变；流式、WebView transcript、批量操作行为与拆分前一致。
4. **CI 门禁**：向 `main` 的 PR 默认跑 build + test；失败则不可合并（需仓库启用 branch protection 配合）。
5. **Lint 可执行**：根目录 `npm run lint` 与 `npm run format:check` 有明确定义且可在 CI 调用。
6. **架构债可追踪**：Domain 反向依赖本迭代至少消减 3 处已知 import；agent-run 重复代码提取后 mobile/desktop 各文件 ≤120 行平台胶水。
7. **回归守护**：现有 core / desktop / mobile 测试套件在整改后保持通过；新增用例覆盖 signature 与 URL redact。

## 验收标准

### P0 — Bug

| ID | Given | When | Then |
|----|-------|------|------|
| B1 | Gemini 模型返回含 `thought_signature` 的 functionCall part | 解析并入库存储 | `content_json` 中对应 thinking/tool_use 块携带可回传的 signature 元数据 |
| B2 | 会话历史含 B1 消息，发起第 2 轮 Gemini generateContent（含 tool） | 检查 HTTP body `contents` | 上一轮 model part 含原样 `thought_signature`；API 返回 200 |
| B3 | 连续 3 轮 Agent tool（Gemini provider，mock 或 e2e） | 跑完 agent run | 无 400 `thought_signature` 相关错误；`run-finished` 正常 |
| B4 | Claude 模型返回 `thinking` 块含 `signature`（或流式 `signature_delta`） | 解析并入库存储 | `content_json` 中 `thinking` 块含 `thinkingSignature` |
| B5 | 会话历史含 B4，发起第 2 轮 Anthropic messages（含 tool） | 检查 HTTP body `messages[].content` | assistant 的 `thinking` 项含原样 `signature`；API 返回 200 |
| B6 | Claude 返回 `redacted_thinking` | 解析 → 存储 → 下一轮回传 | `redacted_thinking` 块 `data` 字段不变；不被丢弃或降级为 text |
| B7 | Claude extended thinking + tool use，连续 ≥2 轮 | Agent run 完成 | 无 400「signature / thinking block」类错误 |
| B8 | `NM_DEBUG_LLM_FETCH=1`，请求 Gemini `?key=SECRET` | 查看控制台/logcat | URL 中 `key=` 值为 `***`，不出现 `SECRET` |
| B9 | 同上，Anthropic `x-api-key` / OpenAI `Authorization` | 发起请求 | header 值仍为 `***`（回归） |

### P1 — ChatTabScreen

| ID | Given | When | Then |
|----|-------|------|------|
| C1 | 拆分合并后 | 统计 `ChatTabScreen.tsx` 行数 | ≤800 |
| C2 | Mobile 聊天主流程 | 会话列表 → 对话 → 流式发送 → 批量删 1 条 | 与拆分前行为一致 |
| C3 | `chat.rollback.e2e` 或等价 e2e | CI / 本地 e2e | 通过或无不相关新增失败 |

### P2 — 工程化

| ID | Given | When | Then |
|----|-------|------|------|
| E1 | 新 PR 打开 | GitHub Actions `ci` workflow | 触发并执行 build + test |
| E2 | 本地 | `npm run lint` | 退出码 0（或仅 warn 白名单） |
| E3 | Desktop 包 | `npm test -w @novel-master/desktop` | 全部通过 |

### P2 — 架构（分批验收）

| ID | Given | When | Then |
|----|-------|------|------|
| A1 | `packages/core/src/domain/**` | `grep '@/service/'` | 0 处 production import（测试 mock 除外） |
| A2 | mobile + desktop agent-run | 行数与重复函数 | 共享逻辑单点；两端文件合计减少 ≥30% 重复行 |
| A3 | `main.ts` rebootstrap | 调用 cleanup | EventBus forwarder 旧订阅已 detach，无重复转发 |
| A4 | 三 SSE parser | 单元测试 | 与重构前快照一致 |

### P3 — 关闭项

| ID | Given | When | Then |
|----|-------|------|------|
| X1 | 全库源码 | 搜索 `[debug-chat]` | 0 匹配（维持） |
| X2 | Desktop build | `smoke.test.js` preload 用例 | 断言 preload 为 CJS、无顶层 `import` |

## 约束与依赖

- **Core 变更**：thinking signature 涉及 `ContentBlock` schema、Gemini / Anthropic mapper 与 SSE parser；需评估 SQLite 已有消息兼容性（缺字段视为无 signature）。
- **Anthropic 文档**：[Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)、[Thinking + tool use](https://platform.claude.com/cookbook/extended-thinking-extended-thinking-with-tool-use) — tool 场景下 **必须**回传 thinking 块及 `signature`。
- **发版**：本迭代可不单独发版；若含 schema 变更，需在 novel-master-publish skill 发版流程中注明。
- **CI 分钟数**：PR workflow 应缓存 npm；Android 完整构建 **不**纳入默认 PR job。

## 风险与待确认项

| 风险 | 缓解 |
|------|------|
| ChatTabScreen 拆分引入回归 | 小步 PR + 保留 e2e；先抽 hooks 再抽 UI |
| ContentBlock 扩展破坏旧客户端 | 新字段 optional；旧 APK 忽略未知块字段 |
| Lint 首次启用大量既有告警 | 分阶段：先 `error` 新代码路径，存量 `warn` 或 eslint-disable 清单 |
| Gemini 3 签名规则演进 | 测试锁定 Google 文档示例 payload；关注 API changelog |
| Claude `signature` 极长、流式分片 | SSE 累积 `signature_delta` 至 `content_block_stop`；单测用拼接样例 |
| `redacted_thinking` UI 展示 | 本迭代仅保证存储与回传；UI 仍显示占位（与现网 thinking 卡片策略一致） |

## 里程碑（建议）

| 阶段 | 内容 | 预估 |
|------|------|------|
| M1 | P0：Gemini + Anthropic signature + debug-fetch redact | 1–2 PR |
| M2 | P1：ChatTabScreen 拆分 | 2–3 PR |
| M3 | P2 工程化：CI + lint | 1 PR |
| M4 | P2 架构债：domain deps、agent-run、EventBus | 2–4 PR |
| M5 | P2/P3 余项：SSE helper、anthropic 常量、greet 删除、文档 | 1–2 PR |
