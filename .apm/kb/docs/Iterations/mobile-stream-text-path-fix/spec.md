---
date: 2026-06-13
---

# Mobile 流式 tail 路径统一修复 技术规格（SPEC）

## 设计目标

**正文 DOM 对齐 thinking**；**保留流式 rich**（RN `prepareStreamTailHtml` + bridge `html`）。  
本迭代 **以 Web `main.ts` 为主**；RN 流式路径 **尽量不改**（thinking 零回归；正文修 DOM 后复用现网 RN html 逻辑）。

**基线分支**：`feature/vfs-user-ops-unified-tool-turn` @ `2331875`。

## 根因（代码级）

| | thinking（平稳） | message / 正文（卡顿） |
|--|------------------|------------------------|
| 流式开始时 DOM | 已有 **`.thinking-body`** | **无** `.bubble-body` |
| 增量路径 | `.thinking-body` + `html` / delta | 首字失败 → **`updateStreamBubble` 整泡** |
| RN 流式 rich | `prepareStreamTailHtml` + `html` ✅ | 同上，但叠加整泡重建 |

**结论**：修 **Web 侧正文容器与增量分支**即可让正文复用 thinking 已验证的 rich 路径；**无需**在迭代一删除 `prepareStreamTailHtml`。

## 改动清单

### Web — `apps/mobile/src/web/chat-transcript/main.ts`（主要改动）

1. **`renderStreamBubbleInner` / 建 tail**：仅有 thinking / toolInvoking 时也输出 **空 `.bubble-body` 占位**。  
2. **`appendStreamDeltaIncremental`（text）**：与 thinking **相同**——有 `html` 且 rich 开 → `.bubble-body` `innerHTML`；否则 `insertAdjacentHTML` 追加 delta。  
3. **`appendStreamDeltaIncremental`（thinking）**：**不变**。  
4. **`appendStreamDelta`**：text 路径 `incremental === false` 时 **不** 调用 `updateStreamBubble`（除非无 `#stream-tail` → `renderRows` 一次）。  
5. **`hasText` 0→1**：仅 class / 展示占位，不重建 thinking。

### RN — `apps/mobile/src/components/chat/ChatTranscriptWebView.tsx`

**本迭代不改**（或仅注释 / 测试澄清）：

- **保留** `flushPendingStreamDeltas` 内对 `streamTextAccum` / `streamThinkingAccum` 的 `prepareStreamTailHtml`。  
- **保留** `streamDelta` 的 `html` 字段（thinking + text）。  
- 保留 RAF 与 bus 32ms。

正文 path 修好后，现有 RN 代码 **无需删除 html** 即可让正文获得与 thinking 一致的流式 rich。

### 不变

- RN `prepareStreamTailHtml`、`prepare-stream-tail-html.ts`  
- thinking 全部流式行为  
- `enrichTranscriptRows` / snapshot rich  
- `useAgentStreamMetrics`、`ChatStreamMetricsBar`  
- `useStreamToolInvoking` bridge  

### 测试

| 文件 | 变更 |
|------|------|
| `chat-transcript-webview.test.tsx` | 正文 path 修好后：text / thinking streamDelta **均可**含 `html`（rich 开） |
| `chat-transcript-boot-script.test.ts` | 预置 `.bubble-body`；text 首包增量、无 `updateStreamBubble` |

## 实现步骤

1. Web：预置 `.bubble-body` + text 增量对齐 thinking。  
2. RN：**无必须改动**（真机验证正文 rich 流式）。  
3. 单测更新。  
4. 真机 GLM-4.7 + rich：G1–G6。

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| 正文仍 O(tail) RN md，高吞吐仍卡 | 迭代二 pacer + Web reconciler |
| 预置 `.bubble-body` 布局副作用 | hidden / 零高；单测 + 真机 |

**回滚**：revert 本迭代 commit（主要为 `main.ts`）。

## 检查清单

- [ ] stream tail 预置 `.bubble-body`  
- [ ] text 增量对齐 thinking（含 `html`）  
- [ ] 无 text 路径 `updateStreamBubble`  
- [ ] RN **仍**有流式 `prepareStreamTailHtml` + `streamDelta.html`  
- [ ] thinking 与现网一致；正文阶段不冻屏（G2）
