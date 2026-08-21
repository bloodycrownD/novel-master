# 20260821 mermaid 全屏放大模糊问题调研（readonly 子任务）

## 请求
用户反馈 mobile 的 mermaid 预览（含全屏放大查看）对复杂图放大后模糊，希望定位渲染管线里 SVG 的生成、尺寸处理方式，以及模糊的根源（栅格化 / 合成层 / foreignObject / viewport）。

## 执行
readonly 探索，范围：`apps/mobile/src/web/shared/mermaid-core.ts`、两条管线 runtime（rich-document / chat-transcript）、`web/shared/mermaid-fullscreen/`、`rich-content-styles.ts`、各 WebView HTML 模板的 viewport 设置。结论见当轮对话的探索报告。

## 关键事实（备查）
- mermaid 初始化：`startOnLoad: false, securityLevel: 'strict'`，主题按 `--bg` 亮度推断，未显式关 htmlLabels。
- SVG 以字符串返回，经 `chart.innerHTML = svg` 插入 `.mermaid-block__chart`，无栅格化环节。
- 全屏查看器在 `apps/mobile/src/web/shared/mermaid-fullscreen/`（克隆 SVG + pinch 手势）。
