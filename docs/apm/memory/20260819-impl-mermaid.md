---
date: 2026-08-19
title: markdown-preview-mermaid 迭代实现——双端 Mermaid 图表渲染（impl-mermaid 节点）
keywords: markdown-preview-mermaid, mermaid, MermaidMarkdown, rich-document, chat-transcript, build:webview, feat/chat-improvements-2026-08
abstract: impl-mermaid 节点在 chat-improvements-2026-08 worktree 实现 spec Step 1-6：desktop 新增 MermaidMarkdown 共享组件（memo 缓存 + 未闭合 fence 占位 + 唯一 id + 主题监听），PreviewPane/MessageList 两处接入；mobile 新增 rich-document 与 chat-transcript 两个 WebView 侧 mermaid runtime（懒加载+按源码去重+防抖），样式单源 rich-content-styles.ts；批注回归全绿。
---

user:
【impl-mermaid 节点】按 docs/Iterations/markdown-preview-mermaid/spec.md 完成 Step 1-6（Step 7 真机验收不做）：desktop 共享组件 MermaidMarkdown + PreviewPane/MessageList 接入 + preview-recogito-md.test 断言迁移；mobile 两条 WebView 管线 runtime + rich-content-styles 单源样式 + build:webview；批注回归；T-MD/T-MV/T-MT 测试落地。约束：sanitize 白名单零改动、流式增量岛不破坏、只 git add 自己的文件（有并行同伴）。

assistant:
按 spec Step 1-6 完成，四笔提交（86bbfd2 deps / 9d66cb8 desktop / af58949、647cb31 为同伴提交 / mobile 预览与聊天两笔）：desktop 新增 MermaidMarkdown（围栏配对检测在组件层做、动态 import 与 mermaid.render 只进 useEffect、按主题+源码 memo、自增唯一 id、MutationObserver 监听 data-theme、成功态源码 pre 隐藏保留）；PreviewPane/MessageList 两处接入，preview-recogito-md L67/L68 断言迁移。mobile 下沉 web/shared/mermaid-core（去重缓存含失败、--bg 亮度推断主题），两管线薄 runtime 挂接（rich-document 在 main.ts setDocument 后、chat-transcript 在 snapshot.ts 5 处，150ms 防抖、跳过 #stream-tail）。

验证：desktop 47/51（4 个为需构建产物的环境性失败，dist 未建）；mobile 743/746（唯一失败 use-chat-tab-message-actions-unhide 为 77d3b69 拆卸 unhide 时漏拆的孤儿测试，存量问题）。

坑与教训：1）mermaid 打进 IIFE 后 esbuild 会因顶层符号撞名把 stream.ts 参数 html/bubble 重命名成 html2/bubble3，boot-script 契约测按字面匹配挂掉，改成容忍 \w* 后缀的正则；2）minify:false 契约测要求下未压缩 mermaid 令两个 WebView bundle 各从约 1MB 涨到 8.1/8.8MB（发布说明需注明）；3）JSX 属性字符串里 \n 不转义，测试要用模板字符串；4）desktop memo 缓存 key 是 fence 内源码（remark 剥围栏留尾换行），不是整段 markdown；5）新 worktree 无 node_modules，需先 npm install，mobile jest 依赖 core/cloud-sync/tokenizer 各包 dist 先构建；6）并行同伴同分支工作，提交只 add 自己文件清单，曾遇到同伴边提交边跑测试造成的批量假失败（复跑即恢复）。
