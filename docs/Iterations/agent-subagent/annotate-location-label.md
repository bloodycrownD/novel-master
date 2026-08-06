# 补丁：批注附件行号提示（locationLabel）

- 日期: 2026-08-05
- 节点: agent-subagent 迭代收尾（spec 范围外口头追加增强）
- commit: c23c7312

本文件记录「批注附件补行号」这条增强规则的来龙去脉，方便后面有人改 `run-agent-turn` 批注物化块时知道这块逻辑为什么在那儿。

## 背景：上游草稿不带行列

Desktop / Mobile 划词创建批注草稿时（`PreviewAnnotateUi.tsx` 的 handleConfirm、`FileMarkdownPreview.tsx` 的 handleAddConfirm），Recogito 只采集了 `renderStart`/`renderEnd`（UTF-16 渲染坐标，预览权威），`startLine`/`endLine`/`startCol`/`endCol` 这些源文件行列字段**完全没填**。所以光改下游物化函数没用——草稿里压根没行号可写。

模型读批注附件时只看到 `originalText` + `userAnnotation`，不知道这段原文对应源文件第几行，定位上下文很费劲。

## 方案：落库前 VFS 反查 + 渲染态 locationLabel

改动全在 core 注入点完成，不动 UI 三端。因为注入点（`run-agent-turn.ts`）能访问 VFS，可以拿源文本做反查。

### 1. 行号补算（`run-agent-turn.ts` 批注物化块）

落库前遍历 `annotateDrafts`，对缺 `startLine`/`endLine` 的草稿：

1. 用 `runtime.sessionVfs(projectId, sessionId).read(draft.path)` 读源文本
2. 调 `estimateSoftRangeFromOriginalText(sourceText, draft.originalText, { linePadding: 0 })` 反查精确行列
3. 命中则把 `{ startLine, endLine, startCol?, endCol? }` 合并进草稿再物化

三条 graceful skip 路径，任一失败都静默跳过（不加行号，符合「不太准可以接受」）：

- VFS read 抛错（文件不存在 / 权限 / 伪 path）→ catch 住
- 源文本非字符串或空串
- `estimateSoftRangeFromOriginalText` 返回 `null`（`originalText` 在源文本里匹配不到）

注意 `linePadding: 0`：要的是精确行号，不是默认的 ±2 行宽松窗口（宽松窗口是给 Recogito 画下划线用的，给模型读不需要 padding）。

另外 `estimateSoftRangeFromOriginalText` 内部用 `indexOf` 取**首次命中**的位置来算行列，所以如果同一 `originalText` 在源文件里重复出现（比如常见短语、空行分隔等），返回的行号会偏到第一次出现的地方，和用户实际划词的那一处可能对不上。这是已知限制：`padding=0` 只是个给模型读的「大概在第几行」提示，并不保证唯一命中或精确锚定，定位失败可以接受（graceful skip）。

草稿已带 `startLine`/`endLine` 则短路跳过 VFS 补算，不覆盖上游已有值。

### 2. locationLabel 自然语言字段（`build-attachment-action-xml.ts`）

物化时额外写一个 `locationLabel` 渲染态字段，值由 `formatAnnotateLocationLabel(startLine, endLine)` 拼装：

- 单行（`startLine === endLine`）→ `"第 N 行"`
- 跨行 → `"第 A-B 行"`
- `endLine` 缺省或小于 `startLine` → 退化为单行
- `startLine` 缺省/非正整数/NaN → 返回 `undefined`，不写键

这样模型一眼能读到「第 5-7 行」，不用去解读 JSON 里的 `startLine: 5, endLine: 7` 数字。

### 3. 反解析不需要改

`locationLabel` 是纯渲染态字段，只写进落库附件的 JSON 给模型看。`parseAnnotateDraftsFromAttachments`（Undo 恢复用）只读 `startLine/endLine/startCol/endCol` 等草稿字段，不读 `locationLabel`，所以反解析契约不变，老附件也兼容（无此键即不写）。

## 附件示例

命中时落库附件的 JSON 大概长这样（节选）：

```json
{
  "path": "/chapter1.md",
  "originalText": "find-me",
  "userAnnotation": "就是这",
  "startLine": 3,
  "endLine": 3,
  "locationLabel": "第 3 行"
}
```

跨行就是 `"locationLabel": "第 5-7 行"`。读盘失败或匹配不到则只有 `path/originalText/userAnnotation`（外加可能有的 `renderStart/renderEnd`），无行号字段。

## 影响面

只动 core 两个文件，UI 三端的划词创建草稿代码不改：

- `packages/core/src/service/agent/logic/run-agent-turn.ts`：批注物化块（async 化 + VFS 反查循环）
- `packages/core/src/domain/chat/logic/build-attachment-action-xml.ts`：新增 `formatAnnotateLocationLabel` + `buildFileAnnotateAttachmentFromDraft` 写 `locationLabel`
- `packages/core/test/service/agent/annotate-drafts-send.test.ts`：+11 条测试
