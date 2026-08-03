---
date: 2026-07-24
updated: 2026-07-24
dependency:
  - Iterations/annotate-user-ops-unify/prd.md
supersedes_preview_path:
  - Iterations/annotate-custom-highlight-soft-range/spec.md
  - 本迭代早期「源串插 HTML 锚」方案（已废弃）
---

# annotate-source-anchor-render PRD（修订：Recogito / 仅 Markdown）

## 背景

会话工作区文件预览的划词批注，经历过 DOM 搜字与「往 Markdown 源串插入 `<span>` 再解析」两条路：前者定位不稳，后者会破坏 CommonMark（标题变成裸 `#` 等）。产品改道：

**预览批注层只使用 `@recogito/text-annotator`**，挂在**已经渲染好的 Markdown HTML** 上；**文本（plain）Tab 禁用批注**（不可划词新建、不投影高亮）。不设第二套预览 fallback。

草稿（`AnnotateDraft`）与 Composer chip / 发送附件仍保留：存路径、引文、用户批注文案，以及 **Recogito 在 MD 渲染正文上的 `start/end`**，以便再次打开 MD 预览时 `setAnnotations` 重投影。

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| MD 渲染不被批注破坏 | 有批注时标题/列表/强调仍正常渲染，不出现因插锚导致的裸 `#` |
| 唯一预览引擎 | MD 预览高亮与划词只走 Recogito；无 `buildAnnotatedSource` 注锚主路径，无搜字 apply / Custom Highlight 应急开关主路径 |
| 文本 Tab 关闭批注 | plain Tab 无「添加批注」入口；不挂 Recogito；不投影既有草稿高亮 |
| 重投影 | 同一会话再次打开该文件 MD 预览，chip/草稿对应高亮可按存下的 Recogito `start/end`+quote 回显 |
| 发送仍可用 | 发送时附件仍带 path + originalText（quote）+ userAnnotation；位置字段以 Recogito 渲染坐标为准（见 SPEC） |
| 稿件不被污染 | 磁盘源文件不含批注标签 |

## 范围

### 包含
- Mobile / Desktop：**Markdown 预览**接入 `@recogito/text-annotator`（WebView 内 / 桌面预览 DOM）
- 划词创建 → 写 `AnnotateDraft` → chip；点击高亮 → 既有详情/删除/编辑
- 草稿持久字段：Recogito selector（渲染正文半开 `start`/`end` + `quote`）+ 既有业务字段
- **禁用** plain/文本 Tab 批注采集与投影
- 拆除预览主路径：源串插锚、`applyAnnotateMarks`/`applyAnnotateHighlights`、DOM 搜字 fallback 开关

### 不包含
- 文本 Tab 与 MD Tab 共用同一套 DOM 坐标做双边投影（坐标系不同，v1 不做）
- 把批注写入用户磁盘文件
- 重做 Composer chip 聚合规则
- PDF / Hypothesis 整站旁注产品

## 用户已拍板
- 先做 Markdown；文本模式批注禁用
- 预览只用 Recogito，不自研第二套、不留 fallback
- 重投影依赖草稿中的 Recogito 位置，而非 VFS soft offset 注锚

## 风险摘要
- Recogito 须跑在内容所在 document（Mobile = WebView 内 bundle），不能只在 RN 宿主初始化
- MD 渲染管道变更会导致 `start/end` 漂移；v1 接受「同管道重开可投影」，大改渲染则可能需用户重划
- Desktop / Mobile 须同一合同，避免一端 Recogito、一端旧插锚
