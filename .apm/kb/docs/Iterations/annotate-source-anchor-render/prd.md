---
date: 2026-07-24
dependency:
  - Iterations/annotate-user-ops-unify/prd.md
  - Iterations/annotate-custom-highlight-soft-range/prd.md
supersedes_preview_path:
  - Iterations/annotate-custom-highlight-soft-range/spec.md
---

# annotate-source-anchor-render PRD

## 背景

会话工作区文件预览里的划词批注，上一迭代 `annotate-custom-highlight-soft-range` 仍以「渲染后的 DOM 里搜 originalText」为主定位，再辅以宽松行列与 Custom Highlight。真机上出现：同文多处误高亮、Markdown 与源坐标错位、跨加粗/链接高亮不稳定或看不见。根因是用「搜字」冒充「钉点」。

产品方向改为：**草稿存源文件上的宽松位置范围**（半开 offset）；预览时在内存里按 mode 生成带锚点的派生原文；文本与 Markdown **共用同一份 VFS 原文与同一批 drafts**，各自派生后再渲染（派生串可因 mode 不同而不同，但同一批注的 `data-annotate-id` 一致）。锚点不写进磁盘稿件。文本模式整段一壳；Markdown 按「允许画下划线的单元」切成多段同 id 锚。文本 Tab 须「认锚」安全渲染，不能把锚标签当纯文字甩给用户。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 定位不以搜字为主 | 有有效源范围的新批注，预览高亮不依赖全文 `findAllOccurrences(originalText)`，也不再默认走旧 `applyAnnotateMarks` / `applyAnnotateHighlights` |
| 同文不误多亮 | 源中多处相同原文时，只高亮该条范围对应处（多段锚同 id 算一处批注） |
| 双预览同源 | 同一文件切换文本 / Markdown Tab，高亮指向同一批注 id，观感连续；两侧吃的是 **同一 VFS 原文 + 同一 drafts** 按各自 mode 派生的串（串内容可不同，id 一致） |
| 跨行内结构可见 | 跨 `**` / 链接等划词后，Markdown 下仍能看见下划线并可点开 |
| plain 认锚可读可点 | 文本 Tab 渲染带锚 HTML（消毒 / 白名单），用户看不到裸标签，且可点开详情；保留换行观感（`pre-wrap`） |
| 稿件不被污染 | 磁盘源文件不含批注锚标签；导出/同步不受影响 |
| 模型附件仍可读位置 | 发送附件仍带原文 + 可用位置：优先半开 `startOffset`/`endOffset`（相对 VFS 全文），并可由其派生行列一并写出 |

## 范围

### 包含
- 草稿 schema：宽松半开 `[startOffset, endOffset)`（相对 VFS 全文，含 MD front matter）；`originalText` 校验与给模型；写成功时派生行列一并落库
- 预览管道：JSON + 磁盘原文 → `buildAnnotatedSource({ mode: text\|markdown })` → `{ annotatedSource, skippedDraftIds }` → 文本 / MD 各自吃对应 mode 的派生串
- 文本：单壳锚 + 宿主认锚安全渲染（Desktop `pre.preview-text` / Mobile `DocumentApp`+`TrustedHtml` 等，见 SPEC）；Markdown：按下划线可渲染单元切多壳、同 annotate id；Desktop MD 须能把锚 `span` 送进 DOM（见 SPEC 宿主 Desktop MD 合同）
- 重叠批注 v1：相交则跳过注入、保留 chip（见 SPEC Step 2）
- 点击锚打开既有批注详情 / 删除
- Desktop / Mobile 会话工作区预览对齐合同；预览主路径退役旧 DOM 搜字 apply（清单见 SPEC Step 6）
- 存量无 offset 草稿的兼容策略；MD 划词映射失败走兼容态（见 SPEC A10 / A12 / T-SA8b）；Mobile 划词以 RN `menuItems` / `onCustomMenuSelection` 触发采集（非 Web→RN `selectionAnnotate` 主通道）

### 不包含
- 把锚永久写入用户 `.md` / 文本文件
- 重做 Composer chip 聚合规则
- 保证源文件大改后锚仍 100% 命中（有校验失败或重叠 skip 时保留 chip/草稿底线即可）
- v1 不做重叠嵌套高亮（相交即 skip）

## 参考（业界，原则借用）
- 位置优先、引文校验（Web Annotation / Hypothesis 类 TextPosition + TextQuote 思想）
- 预览侧 source 映射，而非渲染后盲搜 DOM
- **不**照抄「改用户文件埋 HTML 注释」的持久锚方案

## 风险摘要
- Markdown 插锚与围栏代码 / 行内代码交互需明确切开或绕开规则
- 旧草稿仅有 originalText、无 offset 时需兼容路径（可降级或一次性尽力）
- 文本 Tab 若仍走纯文本节点，锚会变成裸标签或不可点——须按 SPEC「宿主 plain 渲染合同」接线并防 XSS
- Desktop MD 若仍用默认 `react-markdown`（不吃 raw HTML），注入的锚 `span` 会被丢掉——须按 SPEC「宿主 Desktop MD 渲染合同」接线
- MD 预览划词映射回源 offset 可能失败：v1 用选区+邻域/窗口定位，失败不写脏 offset；Mobile 以原生选区菜单触发，必要时再向 WebView 取邻域
