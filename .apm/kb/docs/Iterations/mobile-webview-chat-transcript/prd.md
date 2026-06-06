# Mobile 聊天 Transcript（WebView 引擎）PRD

> **平台**：Android + iOS（同一套 RN 壳 + 内嵌 Web transcript）  
> **替代迭代**：[`mobile-native-chat-list`](../mobile-native-chat-list/prd.md)（RN inverted FlatList，**已废弃**）  
> **组织方式**：`ChatTabScreen` 保留 RN 壳（Composer、Runtime、导航、工作区）；**消息列表/transcript 区域** 改为 **单个 WebView** 渲染与滚动，经 RN↔Web **桥** 同步数据与事件。

## 背景与决策

### 问题

Mobile 聊天 transcript（气泡、Thinking、Tool、流式 tail、富文本、prepend、长按菜单）在 RN 上已多轮迭代仍不稳定：

| 路线 | 主要失败点 |
|------|------------|
| 升序 FlatList + `scrollToEnd` | 贴底/流式/`onContentSizeChange` 反馈环 |
| inverted FlatList + newest-first | `VirtualizedList` + `RenderHTML` 异步测高 + inverted offset 语义；长按菜单触发 `contentHeight` 跳变 |

结论：**困难点在「复杂 transcript 页面的滚动与 layout 正确性」**，而非 Core/DB 或 Composer。RN 原生列表与富文本混排在长会话 + 流式场景下维护成本过高。

### 决策（2026-06）

1. **废弃** `mobile-native-chat-list`（inverted RN 列表）路线，不再在该分支上继续 patch offset/MVCP/scroll lock。  
2. **采用单 WebView transcript**：整块消息区域在一个 WebView 内用 DOM 滚动与 CSS 浮层，避免 FlatList 虚拟化与 native layout 耦合。  
3. **性能可接受**：transcript 交互正确性优先；WebView 内存与 bridge 开销在聊天 App 可接受范围内。  
4. **禁止** FlatList 内嵌多个 WebView（与 [`chat-rich-render`](../chat-rich-render/spec.md) 既有边界一致）；仅 **一个** transcript WebView。

## 目标

| 目标 | 成功指标 |
|------|----------|
| 贴底 | 无缓存打开会话 **直接贴底**，无「先顶后底」闪跳 |
| 流式 | 底部附近（≤ 80px）自动跟随且不抖；上翻时不强制回底 |
| prepend | 加载更早后阅读位置 **稳定**（DOM scroll anchoring 或等价策略） |
| 长按/菜单 | 打开操作菜单时 **气泡不位移、列表不跳** |
| 行为不退化 | 富文本、Thinking、Tool、Batch、隐藏态、空状态与现网 **一致** |
| 可回滚 | Feature flag 可切回 legacy RN `MessageList`（至 M4 删除前） |

## 实现约束（PRD 级决策）

1. **职责切分**  
   - **RN 负责**：会话数据加载、Agent 流、`stream-buffer`、Composer、Header/Drawer、消息编辑/回滚等 **Modal**、Android 返回键、主题 token 注入。  
   - **Web 负责**：transcript 滚动容器、行渲染（气泡/Thinking/Tool/stream tail）、Web 内长按菜单（或上报坐标由 RN 弹 Modal，**不得**触发布局 remeasure 链）。

2. **数据序**  
   - Core/DB 与 `ChatTabScreen` 仍保持 **seq 升序** `chatMessages`。  
   - Web 内自行组织 DOM 顺序（推荐 **视觉底部 = 最新消息**，用 `column-reverse` 或 bottom-anchor scroll，**不在 RN FlatList 做 inverted**）。

3. **流式**  
   - RN 仍用 `stream-buffer`（40ms）→ bridge **`streamDelta` / `streamReset`**；Web 更新 stream tail DOM，不整页 reload。

4. **富文本**  
   - Web 内直接渲染 HTML（复用 `prepareRichHtml` / sanitize **语义**；实现可在 Web bundle 内用 markdown-it + DOMPurify 或预编译共享逻辑）。  
   - 流式 tail 仍为 plain text（与现网一致）；落库后由 snapshot 刷新该行。

5. **滚动快照**  
   - 新 schema（`schemaVersion: 2`，Web 语义）；旧 RN inverted 快照（v1）**丢弃**，默认贴底。

6. **Feature flag**  
   - `chatTranscriptEngine: 'legacy-rn' | 'webview'`（KKV 或 dev 常量）；默认 **webview**（M4 后移除 legacy）。

## 范围

### 包含

- 依赖 `react-native-webview`
- `ChatTranscriptWebView`（或等价）替换 transcript 区的 `MessageList`
- Web 资产：`apps/mobile/src/web/chat-transcript/`（HTML/CSS/TS，Metro 打包为 `source` 或 inline bundle）
- RN↔Web **桥协议**（TypeScript 类型 + 单测）
- 滚动缓存 v2、可选 telemetry（沿用 `[ChatListTelemetry]` 前缀或新 `[ChatTranscriptTelemetry]`）
- `ChatTabScreen` 集成：props 收敛、stream/prepend/menu 事件接线
- 单测 + 双端真机验收清单

### 不包含

- Kotlin/Swift 原生 transcript 列表
- Core/DB、分页 API、display 正则通道改造
- Composer、键盘、工作区 VFS、CLI/Web 端
- assistant 流式实时富 HTML（非 V1，与现网一致）
- 将整 App 改为 Capacitor/Electron

## 验收标准

### 贴底与滚动

- **T1** 无缓存打开会话 → 最新消息在底部，无闪跳。  
- **T2** 不足一屏 → 内容沉底。  
- **T3** 底部附近流式 → 跟随、无周期抖。  
- **T4** 上翻后流式 → 不自动回底。  
- **T5** 加载更早 → 新内容在视觉顶部，阅读位置基本不变。  
- **T6** 工作区 ↔ 聊天 → 滚动快照恢复。

### 交互与 parity

- **T7** 长按消息 → 菜单出现，**被按气泡 screen 位置不变**（前后对比截图或录屏）。  
- **T8** 富文本开/关、Thinking、Tool、Batch、隐藏半透明、主题、空状态 → 与 legacy 行为一致。  
- **T9** Android 返回键：Web 内菜单开 → 先关菜单；否则沿用现有 chat back 栈。

### 工程

- **T10** `npm test -w @novel-master/mobile` 相关用例通过；`npm run build -w @novel-master/mobile` 通过。  
- **T11** Feature flag 切 `legacy-rn` 仍可启动（M4 前）；切 `webview` 为默认路径。

## 里程碑

| 阶段 | 交付 |
|------|------|
| M0 | 桥 POC：plain text 历史 + stream tail + 贴底/沉底 + RN 壳接线 |
| M1 | Thinking / Tool / hidden / 空状态；Web 内 scroll + nearBottom 上报 |
| M2 | prepend 加载更早 + 快照 v2 + 富文本（助手 + thinking） |
| M3 | 长按菜单（不跳）+ Batch + 主题 token + telemetry |
| M4 | 删除 legacy `MessageList` 主路径（或仅留 flag 一版）+ 全量回归 + 双端真机 |

## 风险（SPEC 细化）

- WebView 与 RN 键盘/安全区协调  
- 超长会话 DOM 规模 → Web 内虚拟列表或分页 DOM  
- Bridge 高频 stream 性能 → 批量/ rAF 合并  
- 双栈维护（RN + Web）→ 桥类型与契约单测锁死  
- 旧分支 `feature/mobile-inverted-chat-list` 代码 **不 merge**，以本迭代为准

## 与废弃迭代的关系

- [`mobile-native-chat-list`](../mobile-native-chat-list/spec.md) 的 inverted/MVCP/RenderHTML-in-FlatList 方案 **不再实施**。  
- 可复用资产：`message-blocks` 行模型逻辑（迁到 shared 或 Web 侧 TS）、`stream-buffer`、`chat-list-telemetry` 事件语义、`prepareRichHtml` 规则。  
- **不可** 假设 inverted FlatList 上的 patch（offset pin、scroll lock、MessageMenuOverlay 等）会带入本迭代。
