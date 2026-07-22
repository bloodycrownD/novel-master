---
date: 2026-07-22
dependency:
  - Iterations/annotate-user-ops-unify/prd.md
  - Iterations/mobile-chat-composer-annotate-ux/prd.md
---

# annotate-cross-node-highlight Feature PRD

> 敏捷名称：`annotate-cross-node-highlight`  
> 建议挂靠：`annotate-user-ops-unify`（工作区阅读态批注合同）  
> 平台：Mobile + Desktop（预览下划线同合同；宿主可继续分叉）  
> 性质：增强「尽力匹配」下划线——支持跨 DOM 节点的原文高亮  
> SPEC：同目录 `spec.md`

## 背景与变更动机

工作区批注落库以 `originalText` + `userAnnotation` + `path` 为准，UI 下划线为预览 DOM 上的**尽力匹配**。现网双端均在**单个 Text 节点**内 `indexOf` 后包 `<mark>`：

- 跨加粗 / 链接 / 单元格 / 标题内嵌套等选区：草稿与 chip 往往仍在，**下划线常缺失**
- 易被误判为「多文件批注坏了」或「表格/标题不能批注」；多文件 path 同步是另一类问题，已在 `mobile-chat-composer-annotate-ux` 侧处理

产品上希望：**只要原文在可见正文里属于同一「连续匹配域」并连续出现，跨行内节点选区也应能看到与同节点等价的下划线（或等价明确标记）**。

## 范围说明（相对原合同）

| 项 | 说明 |
|----|------|
| **纳入** | 升级预览批注高亮：支持跨**行内**元素连续串的可见标记；点击打开/编辑/删除批注的交互合同保持（或给出等价命中方式） |
| **推荐方向（非 SPEC）** | 优先抽**共享高亮 util**（扁平文本索引 + 多段 wrap）；**双宿主各自接线** |
| **明确不做（本期记录口径）** | **不**以「统一 WebView / 把 Desktop 预览迁到 Mobile rich-document」作为本 feature 前置；统一宿主若另开迭代再议 |
| **不改** | 批注草稿 schema、chip「批注:path」、发送进模型协议、尽力匹配失败时「条目仍保留」的底线（升级后应显著减少因跨行内节点导致的失败） |
| **不纳入** | 消息正文批注（已拆除）；重新定义 offset 锚点落库；跨段落 / 跨单元格「硬拼」成一条视觉高亮 |

## 匹配域与空白（产品定稿，细节见 SPEC）

1. **扁平匹配域**：同一块内、行内相邻 Text **直接拼接**（无分隔符）。在 **block / `br` / 表单元格** 边界切断匹配域（或插入与 `Selection.toString()` 等价的分隔，使跨界无法误命中）。**跨 `<p>` 不得误命中**（例如前段尾字 + 后段首字不得拼成 needle）。
2. **入库 vs 索引归一拆开**：选区入库（needle）可 `\u00a0→space` + **trim**；扁平索引侧对 segment **只做 1:1 `\u00a0→space`，不对 haystack 做 trim**，以免 offset 与 `nodeValue` 错位。
3. **跨单元格**：同单元格内跨行内样式须覆盖；不相邻单元格不要求拼成一条连续高亮（与选区可见连续串一致）。

## 影响模块与接口（意向）

| 端 | 模块 | 意向 |
|----|------|------|
| Core | 扁平索引 / 区间切分 / 归一 helper | **本期落 Core**；经 `public/chat` 导出，Desktop `@shared/logic/chat` 再导出 |
| Mobile | `rich-document` `annotate-marks` + WebView | 替换单 Text wrap + 废弃「200 次 findFirst」 |
| Desktop | `preview-annotate.ts` + PreviewPane | 同合同升级；宿主仍为 renderer DOM，非 WebView |

无强制 IPC / 附件协议变更预期。

## 验收标准

1. **Given** 选区原文跨越行内样式（如部分加粗），**When** 添加批注，**Then** 预览上可见连续下划线（或等价多段标记），且 chip / 草稿仍在。
2. **Given** 选区落在标题或**同一**表格单元格内但为跨嵌套节点的连续可见文本，**When** 添加批注，**Then** 可见标记；点标记仍可打开该条批注。
3. **Given** 原文分属相邻段落（跨 `<p>`）或跨单元格，**When** 刷新高亮，**Then** **不得**因扁平误拼接而标出跨界假命中。
4. **Given** 原文在文档中确实不存在或无法安全映射，**When** 刷新高亮，**Then** 条目与 chip 仍保留（尽力匹配底线不变）。
5. **Given** Mobile 与 Desktop，**When** 同类跨节点选区，**Then** 行为合同一致（实现可分叉）。
6. **Given** 本 feature，**When** 评审范围，**Then** **不**要求 Desktop 预览改为 WebView。

## 测试用例（与 SPEC T-XN* 对齐）

- 跨 `<strong>` / `<a>` 的短语高亮，且 **两段 mark** 覆盖可见串
- 标题内含行内节点的选区
- 表格单元格内纯文本须覆盖；跨单元格不要求连续高亮、且不得误拼
- 跨 `<p>` 不得误命中（Core 扁平域用例）
- 同文多处命中仍全部标记（与现「重复则全部匹配」一致）
- 与多文件切换下划线（既有 T-UL*）无回归

## 非目标 / 后续

- 统一双端富文档 WebView runtime：另开迭代评估，**非**本 feature 阻塞项。
- CSS Highlight API 的点击命中、旧 WebView 降级策略：本期不做；若未来做须另开合同并保留 mark 降级。
