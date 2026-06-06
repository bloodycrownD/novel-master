# Mobile 聊天消息列表（RN 倒序 + 滚动优化）PRD

> **状态：已废弃（2026-06）** — 多轮实现与修复后，RN inverted FlatList + RenderHTML 路线无法稳定满足贴底/流式/prepend/长按菜单等要求。  
> **替代迭代**：[mobile-webview-chat-transcript](../mobile-webview-chat-transcript/prd.md)（单 WebView transcript + RN 壳）。  
> 本文档仅作历史记录，**勿再按本文实施或 merge `feature/mobile-inverted-chat-list`**。

> **平台**：Android + iOS（同一套 RN `MessageList`）  
> **组织方式**：在 `ChatTabScreen` 壳内，用 RN **重构 `MessageList.tsx` 为倒置 FlatList**；行 UI 组件复用，不重写气泡/Thinking/Tool
## 背景

当前 `FlatList` 使用 **升序数据 + `scrollToEnd` / `onContentSizeChange` 补偿**，在初次贴底、流式输出、加载更早消息时易出现闪跳。

**本迭代**：展示层改为 **newest-first + `inverted={true}`**，以 index 0 锚定视觉底部，去掉对 `scrollToEnd` 的依赖。Core/DB 与分页 API **仍保持 seq 升序**，仅在列表层做展示映射。

## 目标

| 目标 | 成功指标 |
|------|----------|
| 贴底 | 无缓存时打开会话 **直接贴底**，无「先顶后底」闪跳 |
| 流式 | 底部附近（≤ 80px）自动跟随且不抖；上翻时不强制回底 |
| prepend | 加载更早后阅读位置 **稳定** |
| 行为不退化 | 富文本、Thinking、Tool、Batch、长按、空状态与现网 **一致** |

## 实现约束（PRD 级决策）

1. **数据序 + inverted 必须配套**  
   - `buildChatListItems` 产出 **newest-first**（index 0 = 最新消息）。  
   - `FlatList` 设置 **`inverted={true}`**（index 0 渲染在视觉底部）。  
   - **禁止**升序数据 + inverted，也 **禁止**对数据 reverse 两次。

2. **流式尾行**  
   - 与最新消息同属视觉底部：在 newest-first 数组中 **紧挨 index 0 侧**（SPEC 定具体插入位置）。  
   - 仍走 `stream-buffer`（40ms）；渲染行为与现网一致（assistant 尾行 plain Text；thinking 富文本开时用 `RichContentBody`）。

3. **「加载更早」仍走 `listHeaderComponent` 语义**  
   - `ChatTabScreen` 继续传 **`listHeaderComponent`**（时间轴顶端 = 加载更早）。  
   - `MessageList` 在 inverted 下将其 **映射为 `ListFooterComponent`**（inverted 下 footer 在视觉顶部）。  
   - prepend 使用 `maintainVisibleContentPosition` 保持视口稳定。

4. **滚动快照升级作废**  
   - `ChatListScrollSnapshot` 增加 **`schemaVersion`**（或等价字段）。  
   - 升级后读到旧版/无版本缓存 → **丢弃，默认贴底**；用户在 inverted 列表滚动后再写入新缓存。  
   - 用户侧语义不变：`nearBottom` 仍表示「距视觉底部 ≤ 80px」。

5. **复用，不重写**  
   - `ThinkingBlockCard`、`ToolCallCard`、`RichContentBody`、`BatchCheckbox`、`stream-buffer` 等 **不改渲染逻辑**，只适配列表顺序与 scroll/key。

## 范围

### 包含

- `MessageList.tsx`：inverted FlatList、newest-first 行模型、滚动/贴底/prepend/快照
- `message-blocks.ts`（或等价）：展示层 reverse
- `chat-list-scroll-cache.ts`：inverted 语义 + schemaVersion
- `ChatTabScreen`：分页与 `loadOlderMessages` 不变；仍传 `listHeaderComponent`

### 不包含

- Kotlin / 原生列表 / `chat-list-android`
- Core/DB seq 顺序改造
- Composer、键盘、工作区、CLI/Web
- assistant 流式实时富文本（非 V1）

## 验收标准

### 贴底

- 无缓存打开会话 → 最新消息在底部，无闪跳；不足一屏时内容沉底。

### 流式

- 底部附近流式 → 跟随且不周期性跳动；上翻 → 不自动回底。  
- 富文本开/关、流式结束落库 → 与现网一致，无可见样式回退。

### 加载更早

- 点击「加载更早」→ 新内容在 **视觉顶部**，当前阅读位置基本不变。

### 其余

- 富文本、Thinking、Tool、长按、Batch、隐藏半透明、主题、空状态、工作区↔聊天快照恢复：与现网一致。  
- Android API ≥ 26 与 iOS 均通过。

## 里程碑

| 阶段 | 交付 |
|------|------|
| M1 | inverted + newest-first + 贴底/沉底 + 流式尾行 + 空状态 |
| M2 | 加载更早 + prepend 锚定 + 快照 schemaVersion |
| M3 | 移除旧 `scrollToEnd` 状态机 + 回归 |
| M4 | 双端真机验收 + 单测更新 |

## 风险（SPEC 细化）

- inverted + RenderHTML 可变高：流式 thinking 富文本是否仍抖  
- `maintainVisibleContentPosition` 双端参数差异  
- Tool 行与 message 行 reverse 后相对顺序须与现网视觉一致
