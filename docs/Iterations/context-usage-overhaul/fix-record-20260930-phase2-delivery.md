# 修复记录：占用标签「第二相」投递（手动压缩后分词器变 gpt 兜底）

- 日期：2026-09-30
- 上报：用户 ——「手动压缩时，分词器会变化为 gpt 兜底，而不是当前分词器，这非常不对劲」
- 范围：`apps/mobile`（升级补跑）、`apps/desktop`（第二相推送）；core 读口不改口径

## 现象

手动压缩后，会话占用标签（mobile 顶部 chip / desktop 抽屉「上下文占用」行）
的源记号从 `远程 =`（api 真值）掉到 `gpt ≈`（估算档），并且**不回弹**到当前
模型的家族记号（`glm =` 等）。

## 根因（双端各一条，同一类：两阶段读数的第二相没有送达）

读口是两阶段的（`preferEstimate`：首帧廉价估算即回，后台再跑家族真分词器
精确计数）。压缩会失效该会话的 API 占用（可见 prompt 变了），于是首帧必然
跌进估算档 `gpt ≈`——这本身是设计。问题在第二相：

1. **mobile**：首帧估算后启动的「后台精确升级轮」在两种情况下被丢弃——
   ① 升级在途期间又来了更新的首帧（压缩恰好连发两次刷新：transcript 重载 +
   显式刷新），新鲜度闸（`sessionRefreshGen`）判定在途轮结果陈旧、丢弃；
   ② 新一轮又被在途去重标记（`preciseUpgradeInflight`）挡掉不启动。
   **两头一堵 → 没有任何一轮的精确标签会到达 UI**，chip 停在 `gpt ≈` 直到
   下一次刷新触发（手动压缩这类一次性动作之后往往没有下一个触发）。
2. **desktop**：后台暖机（`preciseWarmInflight`）只把精确值写进 L1 缓存，
   结果直接丢弃，指望「renderer 下一次触发自己去问」。而手动压缩/置位/回滚
   都是一次性动作，之后没有「下一次」——抽屉里就一直是 `gpt ≈`。
   （测试 T-T9b 用轮询掩盖了这一点：测试会 poll，真实 UI 不会。）

## 修复

### mobile —— 升级补跑槽（`apps/mobile/src/services/chat-prompt-tokens.service.ts`）

- 新增 `preciseUpgradeQueued`（按 sessionId，只留最新一次）与
  `startPreciseUpgrade()`：在途期间的更新首帧把升级请求排队，在途轮落定后
  **立刻按最新一次补跑**。
- 语义不变的部分：同会话仍同时只有一轮在途（不并发堆叠整串计数）；新鲜度闸
  仍在（旧家族/旧模型的精确标签不得落 UI）。
- 自愈闭环：任一轮跑完，L1 里就有该内容的精确条目，后续首帧直接命中精确档
  （`upgradeWorthy=false`）→ 不再排队，链条自然收敛。

### desktop —— 第二相推送（新 IPC 通道）

- `shared/ipc-types.ts`：新增 `PROMPT_CHAT_TOKEN_UPDATED`（`nm:prompt/chatTokenUpdated`）
  与 `PromptChatTokenUpdatedPayload`（载荷恒为精确档 stats）。
- `src/main/ipc/forward-prompt-chat-token-updated.ts`：新转发模块（与
  workspaceMutated / composer 建议同范式，共用窗口解析器，`main.ts` 注册）。
- `chat-prompt-tokens.service.ts`：暖机拿到精确档后，经
  `pushPreciseStatsIfReady` **补读一次现值**（`armPreciseWarm:false`，绝不再排
  暖机，否则「内容每次都在变」的会话会让推送与补读互相喂养）并推送。
  补读按当下模型与内容取数：暖机期间切了模型 → 补读拿到新模型的估算档 →
  不推，旧模型的精确标签不会闪进 UI。
- renderer：`SessionDetailDrawer` 订阅（**只在当前是估算档时采纳**，精确标签
  不回退、不覆盖更新的读数）；`ConversationPanel` 的用量详情弹窗在打开期间
  同样订阅（弹窗只存 label，推送恒精确档，直接覆盖）。

## 验收

| 项 | 结果 |
|----|------|
| mobile 定向（`__tests__/chat-prompt-tokens.test.ts`） | 14/14（新增/改写：边界①补跑、边界④多次刷新只补跑最新一次、边界③切模型改由补跑轮到位） |
| desktop 定向（`test/chat-prompt-tokens.test.ts`） | 8/8（T-T9b 改写为「首帧估算 → 主动推送精确读数 → 二次读仍精确」） |
| desktop main `npx tsc --noEmit -p tsconfig.json` | 干净（renderer 的既有红与本次无关，CI 里 typecheck 本就 continue-on-error） |
| 真机 | 待用户验证（荣耀真机安装需用户在场） |
| desktop 全量（`npm test -- "test/**/*.test.ts" "test/**/*.test.tsx" "test/**/*.test.js"`） | 581/581（core dist 重建后复跑） |

## 遗留 / 未做

- 估算档本身不改：无 API 基线时首帧仍是 `gpt ≈`（廉价估算），只是现在**必然**
  会被精确档替换。家族只有近似档（原生分词器不可用等）时停在 `gpt ≈` 才是如实。
- desktop 的 `ConversationPanel` 指标条本身不订阅推送（它只在弹窗打开时取一次
  读数），弹窗已覆盖。
