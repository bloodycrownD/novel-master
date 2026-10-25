# 2026-10-24 消息列表（msg list）场景的开源对标清单

## 类型与定位
- 类型：**brainstorm 第四轮**（用户：msg 列表是当前最头疼的部分；觉得 rikkahub 的列表实现不如 Discord/QQ 这类成熟 IM，问有没有开源项目可参考）
- 用户判断成立：IM 是海量消息的极端场景，其列表实现经过亿级用户验证，且约束与 novel-master 转录列表高度一致
- 本轮用 `zread` 实证了 Zulip Mobile 的目录结构（唯一与现状同构的开源实现）

## 一、按架构分类的对标清单

### A 类：RN + WebView 渲染消息（与现状同构，最值得抄）
**`zulip/zulip-mobile`** —— 已实证目录结构（`src/webview/`）：
```
MessageList.js                       RN 侧宿主组件
SinglePageWebView.js                 单页 WebView
generateInboundEventEditSequence.js  关键：生成增量 DOM 编辑序列，不是快照替换
generateInboundEvents.js / handleOutboundEvents.js  跨边界事件
html/message.js, messageListElementHtml.js, htmlBody.js, template.js  行 HTML 生成
css/css.js, cssNight.js, cssPygments.js  主题与高亮样式注入
js/handleInboundEvents.js, rewriteHtml.js, script.js, smoothScroll.min.js  WebView 内运行时
static/follow.svg                    贴底跟随按钮
static/loader-*.svg                  分页加载占位
```
- 可抄点：①`generateInboundEventEditSequence` 的增量更新模型（对应 novl-master 的 `appendTailRows/prependPage/streamCommit`，但它是「编辑序列」而非「分片快照」）；②`messageListElementHtml` 的行元素抽象；③smoothScroll + follow 按钮的贴底交互。
- **重要特征：它不做虚拟化**，靠「窄范围 + 分页」把 DOM 规模压在可控区间。与 novel-master 的 60 行窗口 + EWMA 估算形成对照。

### B 类：RN 原生列表（不走 WebView）
- **`RocketChat/Rocket.Chat.ReactNative`** —— RN 原生列表，有完整的贴底 / 加载历史锚定 / 未读分隔实现。可抄 inverted 列表与 prepend 补偿。

### C 类：Kotlin + RecyclerView（工业级原生）
- **`signalapp/Signal-Android`** —— `ConversationAdapter` + `LinearLayoutManager`（`stackFromEnd`），贴底跟尾逻辑多年打磨。
- **`DrKLO/Telegram`** —— 自研 `RecyclerListView` + `ChatMessageCell` 的**精确高度缓存**（`stableIds` + 测量结果缓存），海量消息性能标杆。
- **`element-hq/element-x-android`** —— Kotlin + **Compose**，`TimelineView`。与「重写用 Compose」方向完全吻合，应作为首要参考。可抄：`LazyColumn` 贴底跟尾、prepend 锚定、jump to message。

### D 类：Web 端纯 DOM + 精确测量
- **`element-hq/element-web`** —— 自研 `ScrollPanel`（不用虚拟化，靠精确测量 + transform 平移）。
- **`morethanwords/tweb`**（Telegram Web K）—— 纯 DOM + 精确测量，性能极强。

### E 类：Flutter（仅备查）
- **`FluffyChat`** —— Flutter 的 Matrix 客户端。

## 二、这些项目的共同做法（诊断依据）

1. **没有一家用「估算槽高」。** 要么全量 DOM（Zulip / Element Web / tweb），要么精确测量缓存（Telegram / Signal）。原因：估算一旦偏差，贴底与锚定就错，且误差会随滚动累积。
   - **novel-master 现行是「60 行窗口 + 20 行缓冲 + EWMA 槽高估算」（`row-windowing.ts:1-15`），是这批实现里唯一用估算的** —— 这很可能是「贴底抖 / 锚定跳 / 展开下推错」的共同根因。
2. **贴底是「意图」不是「位置」**：用户手动上滚即解除跟随，滚回底部附近（阈值）恢复。核心是 flag + 阈值，不是 `scrollTop === scrollMax`。
3. **prepend 锚定 = 首条可见 item 的 id + 视口内 offset**，插入后立即补偿滚动位置。
4. **动态高度变化（展开/图片加载/代码块渲染完）单独处理**：记录该行高度差，按方向补偿滚动。
5. **分页优于无限窗口**：Zulip 只保留最近 N 件 + 分页，DOM 规模恒定。

## 三、结论
- 用户「rikkahub 不如这些成熟 IM」的判断成立：rikkahub 的 `ChatList.kt` 只是单会话、非虚拟化、无 prepend 锚定的实现，规模上限远低于 IM。
- 最值得优先深挖的两个：**`zulip/zulip-mobile`**（同构，直接可抄增量更新与分页策略）、**`element-x-android`**（Compose 方向的工业级 timeine 实现）。
- 待验证：row-windowing 的 EWMA 估算实际被哪些路径消费；换成测量缓存 + 分页的影响面。
